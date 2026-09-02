import "server-only";

import {
  ConfigurationError,
  getConfiguredCluster,
  getConfiguredVaultAddress,
  getDefaultNeutralApiUrl,
} from "@/lib/neutral-config";

export class MissingNeutralApiKeyError extends Error {
  constructor() {
    super("NEUTRAL_API_KEY is not configured");
    this.name = "MissingNeutralApiKeyError";
  }
}

function getApiUrl(cluster: ReturnType<typeof getConfiguredCluster>): string {
  const configuredUrl = process.env.NEUTRAL_API_URL?.trim();
  const apiUrl = configuredUrl || getDefaultNeutralApiUrl(cluster);

  try {
    const parsedUrl = new URL(apiUrl);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error("Unsupported protocol");
    }
    return parsedUrl.toString();
  } catch {
    throw new ConfigurationError(
      "NEUTRAL_API_URL must be a valid HTTP or HTTPS URL.",
    );
  }
}

export interface NeutralServerClient {
  get(path: string, sharedCache: boolean): Promise<Response>;
  vaultAddress: string;
}

export function createNeutralServerClient(): NeutralServerClient {
  const apiKey = process.env.NEUTRAL_API_KEY?.trim();
  if (!apiKey) {
    throw new MissingNeutralApiKeyError();
  }

  const cluster = getConfiguredCluster();
  const vaultAddress = getConfiguredVaultAddress(cluster);
  const apiUrl = getApiUrl(cluster);

  return {
    vaultAddress,
    get(path, sharedCache) {
      return fetch(new URL(path, apiUrl), {
        headers: { "x-api-key": apiKey },
        ...(sharedCache
          ? { next: { revalidate: 60 } }
          : { cache: "no-store" }),
      });
    },
  };
}
