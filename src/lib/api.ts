export interface AsOf {
  blockTime: number;
  slot: number;
}

export interface ApiEnvelope<T> {
  asOf: AsOf;
  data: T;
  priceAsOf?: AsOf;
  success: true;
}

export interface TokenAmount {
  raw: string;
  token: string;
}

export interface TokenValue extends TokenAmount {
  usd?: number | null;
}

export interface VaultAsset {
  decimals: number;
  mint: string;
  symbol: string | null;
}

export interface VaultReferralTier {
  mfeeBps: number;
  pfeeBps: number;
  threshold: string;
}

export interface VaultReferral {
  enabled: boolean;
  mfeeBps: number;
  minDepositAmount: string;
  pfeeBps: number;
  tiers: VaultReferralTier[];
}

export interface VaultData {
  asset: VaultAsset;
  bundleKey: string;
  category: string | null;
  depositFeeBps: number;
  managementFeeBps: number;
  maxCap: string;
  minDepositAmount: string;
  name: string | null;
  oracleAgeSeconds: number;
  paused: boolean;
  performanceFeeBps: number;
  processFrequency: "30min" | "hourly" | "daily" | null;
  referral: VaultReferral | null;
  withdrawalFeeBps: number;
}

export interface VaultMetricsData {
  apy7d: number | null;
  apy7dAfterFees: number | null;
  apy30d: number | null;
  apy30dAfterFees: number | null;
  apyInception: number | null;
  apyInceptionAfterFees: number | null;
  computedAt: number;
  maxDrawdown: number | null;
  sharpeRatio30d: number | null;
  tvl: {
    asset: {
      decimals: number;
      mint: string;
      symbol?: string;
    };
    value: TokenValue;
  };
}

export interface VaultBalanceData {
  asset: {
    decimals: number;
    mint: string;
    symbol?: string;
  };
  netDeposits: TokenAmount;
  shares: TokenAmount;
  unpaidFeeEstimate: {
    estimatedAt: number;
    totalFeeShares: TokenAmount;
    value: TokenValue;
  };
  value: TokenValue;
}

export interface PendingRequest {
  amounts: {
    estimatedValue?: string;
    fee?: string;
    gross?: string;
    net?: string;
    shares?: string;
  };
  cooldownEnd: number | null;
  etaProcessAt: number | null;
  requestedAt: number;
  stage: "requested" | "netted" | "processed" | "refunded";
}

export interface PendingData {
  deposits: PendingRequest[];
  user: string;
  vaultId: string;
  withdrawals: PendingRequest[];
}

export type VaultResponse = ApiEnvelope<VaultData>;
export type VaultMetricsResponse = ApiEnvelope<VaultMetricsData>;
export type VaultBalanceResponse = ApiEnvelope<VaultBalanceData>;
export type PendingResponse = ApiEnvelope<PendingData>;

export class NeutralApiError extends Error {
  readonly retryAfterSeconds: number | undefined;
  readonly status: number;

  constructor(status: number, retryAfter: string | null) {
    super(`Neutral API request failed with status ${status}.`);
    this.name = "NeutralApiError";
    this.status = status;
    this.retryAfterSeconds = parseRetryAfter(retryAfter);
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return parseInt(value, 10);

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, Math.ceil((timestamp - Date.now()) / 1_000));
}

async function get<T>(
  path: string,
  options?: {
    allowNotFound?: boolean;
    noStore?: boolean;
    signal?: AbortSignal;
  },
): Promise<ApiEnvelope<T> | null> {
  const response = await fetch(path, {
    cache: options?.noStore ? "no-store" : "default",
    headers: { Accept: "application/json" },
    signal: options?.signal,
  });

  if (response.status === 404 && options?.allowNotFound) return null;
  if (!response.ok) {
    throw new NeutralApiError(response.status, response.headers.get("Retry-After"));
  }
  return (await response.json()) as ApiEnvelope<T>;
}

export async function getVault(signal?: AbortSignal): Promise<VaultResponse> {
  return (await get<VaultData>("/api/neutral/vault", { signal })) as VaultResponse;
}

export async function getVaultMetrics(
  signal?: AbortSignal,
): Promise<VaultMetricsResponse> {
  return (await get<VaultMetricsData>("/api/neutral/vault/metrics", {
    signal,
  })) as VaultMetricsResponse;
}

export async function getBalance(
  address: string,
  signal?: AbortSignal,
): Promise<VaultBalanceResponse | null> {
  return (await get<VaultBalanceData>(
    `/api/neutral/vault/user/${encodeURIComponent(address)}/balance`,
    { allowNotFound: true, noStore: true, signal },
  )) as VaultBalanceResponse | null;
}

export async function getPending(
  address: string,
  signal?: AbortSignal,
): Promise<PendingResponse | null> {
  return (await get<PendingData>(
    `/api/neutral/vault/user/${encodeURIComponent(address)}/pending`,
    { allowNotFound: true, noStore: true, signal },
  )) as PendingResponse | null;
}
