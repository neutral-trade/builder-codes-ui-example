import type { Address } from "@solana/kit";
import { address } from "@solana/kit";

const CODE_CACHE_TTL_MS = 60_000;

interface CachedReferrer {
  expiresAt: number;
  referrer: Address;
}

export type ReferrerCodeResolver = (code: string) => Promise<Address>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readReferrer(responseBody: unknown): Address {
  if (!isRecord(responseBody) || !isRecord(responseBody.data)) {
    throw new Error("INVALID_REFERRER_CODE_RESPONSE");
  }

  const referrer = responseBody.data.referrer;
  if (typeof referrer !== "string") {
    throw new Error("INVALID_REFERRER_CODE_RESPONSE");
  }

  try {
    return address(referrer);
  } catch {
    throw new Error("INVALID_REFERRER_CODE_RESPONSE");
  }
}

export function createReferrerCodeResolver(
  apiBaseUrl: string,
): ReferrerCodeResolver {
  const normalizedApiBaseUrl = apiBaseUrl.replace(/\/+$/, "");
  const cache = new Map<string, CachedReferrer>();

  return async (code: string): Promise<Address> => {
    const normalizedCode = code.trim();
    if (!normalizedCode) {
      throw new Error("INVALID_REFERRER_CODE");
    }

    const now = Date.now();
    const cachedReferrer = cache.get(normalizedCode);
    if (cachedReferrer && cachedReferrer.expiresAt > now) {
      return cachedReferrer.referrer;
    }

    const response = await fetch(
      `${normalizedApiBaseUrl}/public/codes/${encodeURIComponent(normalizedCode)}`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error(
        response.status === 404
          ? "REFERRER_CODE_NOT_FOUND"
          : `REFERRER_CODE_LOOKUP_FAILED_${response.status}`,
      );
    }

    const referrer = readReferrer(await response.json());
    cache.set(normalizedCode, {
      expiresAt: Date.now() + CODE_CACHE_TTL_MS,
      referrer,
    });
    return referrer;
  };
}
