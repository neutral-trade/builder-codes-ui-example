export interface AsOf {
  blockTime: number;
  slot: number;
}

export interface ApiEnvelope<Data> {
  asOf?: AsOf;
  data: Data;
  priceAsOf?: AsOf;
  success: true;
}

export interface TimestampedApiEnvelope<Data> extends ApiEnvelope<Data> {
  asOf: AsOf;
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
  tiers: Array<VaultReferralTier>;
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
  deposits: Array<PendingRequest>;
  user: string;
  vaultId: string;
  withdrawals: Array<PendingRequest>;
}

export type VaultResponse = TimestampedApiEnvelope<VaultData>;
export type VaultMetricsResponse = TimestampedApiEnvelope<VaultMetricsData>;
export type VaultBalanceResponse = TimestampedApiEnvelope<VaultBalanceData>;
export type PendingResponse = TimestampedApiEnvelope<PendingData>;

export type BuilderAttribution =
  | { kind: "address"; address: string }
  | { kind: "code"; code: string };

export const ATTRIBUTION_FAILURE_REASONS = [
  "ATTRIBUTION_NOT_YET_ENABLED",
  "UNKNOWN_CODE",
  "REFERRALS_DISABLED",
  "INVALID_REFERRER",
  "REFERRAL_ALREADY_SET",
  "USER_BUNDLE_ACCOUNT_HAS_ACTIVITY",
  "REFERRER_NOT_REGISTERED",
  "REFERRER_DEACTIVATED",
  "REFERRER_DEPOSIT_TOO_LOW",
  "BUILDER_DEPOSIT_AMOUNT_TOO_LOW",
] as const;

export type AttributionFailureReason =
  (typeof ATTRIBUTION_FAILURE_REASONS)[number];

export type DepositAttribution =
  | {
      applied: true;
      code?: string;
      referrer: string;
    }
  | {
      applied: false;
      existingReferrer?: string;
      existingReferrerMatchesRequest?: boolean;
      reason: AttributionFailureReason;
      requiredGrossDepositAmount?: string;
    };

export interface RejectionReason {
  code: string;
  message: string;
}

export interface WireInstruction {
  accounts: ReadonlyArray<{
    isSigner: boolean;
    isWritable: boolean;
    pubkey: string;
  }>;
  dataBase64: string;
  programId: string;
}

export interface TransactionBuildData {
  blockhash?: string;
  computeUnitLimit?: number;
  instructions?: ReadonlyArray<WireInstruction>;
  lastValidBlockHeight?: number;
  priorityFeeMicroLamports?: string;
  signers?: ReadonlyArray<string>;
  simulation?: "simulated" | "skipped";
  transactionBase64?: string;
  validation: {
    accepted: boolean;
    rejectionReasons: ReadonlyArray<RejectionReason>;
  };
}

export interface DepositBuildData extends TransactionBuildData {
  attribution?: DepositAttribution;
}

export interface WithdrawBuildData extends TransactionBuildData {
  sharesAmount?: string;
}

export interface TransactionBuilderEndpoint {
  apiBaseUrl: string;
  vault: string;
}

export interface DepositBuildInput {
  amountRaw: bigint | string;
  attribution?: BuilderAttribution;
  requireAttribution: boolean;
  userAddress: string;
}

type WithdrawBuildInput =
  | {
      amountRaw: bigint | string;
      userAddress: string;
      withdrawAll?: false;
    }
  | {
      amountRaw?: never;
      userAddress: string;
      withdrawAll: true;
    };

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

export class TransactionBuilderApiError extends Error {
  readonly code?: string;
  readonly logs?: ReadonlyArray<string>;
  readonly retryAfterSeconds?: number;
  readonly status: number;

  constructor(input: {
    code?: string;
    logs?: ReadonlyArray<string>;
    message: string;
    retryAfterSeconds?: number;
    status: number;
  }) {
    super(input.message);
    this.name = "TransactionBuilderApiError";
    this.code = input.code;
    this.logs = input.logs;
    this.retryAfterSeconds = input.retryAfterSeconds;
    this.status = input.status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function serializeRawAmount(value: bigint | string): string {
  const rawAmount = typeof value === "bigint" ? value.toString() : value;
  if (!/^(?:0|[1-9]\d*)$/.test(rawAmount)) {
    throw new TypeError("amountRaw must be a canonical unsigned integer.");
  }
  return rawAmount;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;

  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    return Number.isSafeInteger(seconds) ? seconds : undefined;
  }

  const retryAt = Date.parse(value);
  return Number.isFinite(retryAt)
    ? Math.max(0, Math.ceil((retryAt - Date.now()) / 1_000))
    : undefined;
}

async function readResponseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

async function readTransactionBuildError(
  response: Response,
): Promise<TransactionBuilderApiError> {
  const body = await readResponseBody(response);
  const record = isRecord(body) ? body : undefined;
  const logs = Array.isArray(record?.logs)
    ? record.logs.filter((log): log is string => typeof log === "string")
    : undefined;
  const fallbackMessage =
    response.status === 429
      ? "Too many transaction builds. Wait before trying again."
      : "Neutral Trade could not build this transaction.";

  return new TransactionBuilderApiError({
    ...(typeof record?.code === "string" ? { code: record.code } : {}),
    ...(logs ? { logs } : {}),
    message:
      typeof record?.message === "string" ? record.message : fallbackMessage,
    ...(response.status === 429
      ? {
          retryAfterSeconds: parseRetryAfter(
            response.headers.get("retry-after"),
          ),
        }
      : {}),
    status: response.status,
  });
}

function readTransactionBuildEnvelope<Data>(
  value: unknown,
  status: number,
): ApiEnvelope<Data> {
  const data = isRecord(value) && isRecord(value.data) ? value.data : undefined;
  const validation = isRecord(data?.validation) ? data.validation : undefined;
  const rejectionReasons = validation?.rejectionReasons;
  const hasValidRejectionReasons =
    Array.isArray(rejectionReasons) &&
    rejectionReasons.every(
      (reason) =>
        isRecord(reason) &&
        typeof reason.code === "string" &&
        typeof reason.message === "string",
    );
  if (
    !isRecord(value) ||
    value.success !== true ||
    !data ||
    typeof validation?.accepted !== "boolean" ||
    !hasValidRejectionReasons
  ) {
    throw new TransactionBuilderApiError({
      code: "INVALID_API_RESPONSE",
      message: "Neutral Trade returned an unexpected transaction response.",
      status,
    });
  }
  return value as unknown as ApiEnvelope<Data>;
}

async function postTransactionBuild<Data>(
  endpoint: TransactionBuilderEndpoint,
  operation: "deposit" | "withdraw",
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ApiEnvelope<Data>> {
  const apiBaseUrl = endpoint.apiBaseUrl.replace(/\/+$/, "");
  const response = await fetch(
    `${apiBaseUrl}/v2/vault/${encodeURIComponent(endpoint.vault)}/tx/${operation}`,
    {
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "omit",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      method: "POST",
      referrerPolicy: "no-referrer",
      signal,
    },
  );

  if (!response.ok) {
    throw await readTransactionBuildError(response);
  }
  return readTransactionBuildEnvelope<Data>(
    await readResponseBody(response),
    response.status,
  );
}

export function buildDepositTx(
  input: DepositBuildInput,
  endpoint: TransactionBuilderEndpoint,
  signal?: AbortSignal,
): Promise<ApiEnvelope<DepositBuildData>> {
  if (input.requireAttribution && !input.attribution) {
    throw new TypeError("Strict attribution requires a referrer address or code.");
  }

  return postTransactionBuild(
    endpoint,
    "deposit",
    {
      amountRaw: serializeRawAmount(input.amountRaw),
      ...(input.attribution?.kind === "address"
        ? { referrer: input.attribution.address }
        : input.attribution?.kind === "code"
          ? { code: input.attribution.code }
          : {}),
      ...(input.requireAttribution ? { requireAttribution: true } : {}),
      userAddress: input.userAddress,
    },
    signal,
  );
}

export function buildWithdrawTx(
  input: WithdrawBuildInput,
  endpoint: TransactionBuilderEndpoint,
  signal?: AbortSignal,
): Promise<ApiEnvelope<WithdrawBuildData>> {
  return postTransactionBuild(
    endpoint,
    "withdraw",
    {
      ...(input.withdrawAll
        ? { withdrawAll: true }
        : { amountRaw: serializeRawAmount(input.amountRaw) }),
      userAddress: input.userAddress,
    },
    signal,
  );
}

async function getNeutralApiData<Data>(
  path: string,
  options?: {
    allowNotFound?: boolean;
    noStore?: boolean;
    signal?: AbortSignal;
  },
): Promise<ApiEnvelope<Data> | null> {
  const response = await fetch(path, {
    cache: options?.noStore ? "no-store" : "default",
    headers: { Accept: "application/json" },
    signal: options?.signal,
  });

  if (response.status === 404 && options?.allowNotFound) return null;
  if (!response.ok) {
    throw new NeutralApiError(
      response.status,
      response.headers.get("Retry-After"),
    );
  }
  return (await response.json()) as ApiEnvelope<Data>;
}

export async function getVault(signal?: AbortSignal): Promise<VaultResponse> {
  return (await getNeutralApiData<VaultData>("/api/neutral/vault", {
    signal,
  })) as VaultResponse;
}

export async function getVaultMetrics(
  signal?: AbortSignal,
): Promise<VaultMetricsResponse> {
  return (await getNeutralApiData<VaultMetricsData>(
    "/api/neutral/vault/metrics",
    { signal },
  )) as VaultMetricsResponse;
}

export async function getBalance(
  address: string,
  signal?: AbortSignal,
): Promise<VaultBalanceResponse | null> {
  return (await getNeutralApiData<VaultBalanceData>(
    `/api/neutral/vault/user/${encodeURIComponent(address)}/balance`,
    { allowNotFound: true, noStore: true, signal },
  )) as VaultBalanceResponse | null;
}

export async function getPending(
  address: string,
  signal?: AbortSignal,
): Promise<PendingResponse | null> {
  return (await getNeutralApiData<PendingData>(
    `/api/neutral/vault/user/${encodeURIComponent(address)}/pending`,
    { allowNotFound: true, noStore: true, signal },
  )) as PendingResponse | null;
}
