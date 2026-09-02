import {
  createNeutralServerClient,
  MissingNeutralApiKeyError,
} from "@/lib/neutral-server";

const USER_PATH_PATTERN =
  /^vault\/user\/([1-9A-HJ-NP-Za-km-z]{32,44})\/(balance|pending)$/;
const ERROR_CODES: Record<number, string> =
  { 404: "NOT_FOUND", 429: "RATE_LIMITED", 503: "PROJECTION_UNAVAILABLE" };

function errorResponse(status: number, error: string, retryAfter?: string) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (retryAfter) headers.set("Retry-After", retryAfter);
  return Response.json({ success: false, error }, { status, headers });
}

type Target = [(vault: string) => string, boolean];

function mapPath(segments: string[]): Target | undefined {
  const path = segments.join("/");
  if (path === "vault") return [(vault) => `/v2/vault/${vault}`, true];
  if (path === "vault/metrics")
    return [(vault) => `/v2/vault/${vault}/metrics`, true];
  const match = USER_PATH_PATTERN.exec(path);
  if (!match) return;
  const [, address, resource] = match;
  return [(vault) => `/v2/vault/${vault}/user/${address}/${resource}`, false];
}

/*
 * The browser can call only these fixed routes. The configured vault and partner
 * key are added here so neither secret material nor arbitrary upstream paths can
 * ever be supplied by client code.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const path = (await params).path;
  const target = Array.isArray(path) ? mapPath(path) : undefined;
  if (!target) return errorResponse(404, "NOT_FOUND");

  try {
    const client = createNeutralServerClient();
    const [buildPath, sharedCache] = target;
    const upstream = await client.get(buildPath(client.vaultAddress), sharedCache);
    const cacheControl =
      sharedCache && upstream.status === 200 ? "public, max-age=60" : "no-store";

    if (upstream.status === 200) {
      return new Response(await upstream.text(), {
        status: 200,
        headers: {
          "Cache-Control": cacheControl,
          "Content-Type": "application/json",
        },
      });
    }

    const error = ERROR_CODES[upstream.status];
    if (error) {
      const retryAfter =
        upstream.status === 429
          ? (upstream.headers.get("Retry-After") ?? undefined)
          : undefined;
      return errorResponse(upstream.status, error, retryAfter);
    }
    return errorResponse(502, "UPSTREAM_ERROR");
  } catch (error) {
    const missingKey = error instanceof MissingNeutralApiKeyError;
    return errorResponse(
      missingKey ? 500 : 502,
      missingKey ? "NEUTRAL_API_KEY is not configured" : "UPSTREAM_ERROR",
    );
  }
}
