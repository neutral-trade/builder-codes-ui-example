"use client";

import type { FormEvent } from "react";
import type { PublicConfig } from "@/config";
import type {
  AttributionFailureReason,
  DepositAttribution,
  DepositBuildData,
  RejectionReason,
  TransactionBuildData,
  TransactionBuilderEndpoint,
  WithdrawBuildData,
} from "@/lib/api";
import type {
  ExpectedTransactionOperation,
  InspectedTransaction,
} from "@/lib/inspect";
import { createRpcTransactionTransport } from "@neutral-trade/widget-sdk";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatRawAmount, parseTokenAmount } from "@/lib/amount";
import {
  buildDepositTx,
  buildWithdrawTx,
  TransactionBuilderApiError,
} from "@/lib/api";
import { inspect } from "@/lib/inspect";
import { refreshPosition } from "@/lib/position-refresh";
import { createWalletSignerAdapter } from "@/lib/signer";
import { useWallet } from "@/lib/wallet";

type Operation = "deposit" | "withdraw";
type Phase =
  | "idle"
  | "building"
  | "review"
  | "signing"
  | "submitting"
  | "confirming"
  | "submitted"
  | "confirmed";

type PreparedRequest =
  | {
      amountRaw: string;
      attributionMode: "required" | "without-attribution";
      operation: "deposit";
    }
  | {
      amountRaw?: string;
      operation: "withdraw";
      withdrawAll: boolean;
    };

interface ReviewState {
  attribution?: DepositAttribution;
  build: TransactionBuildData;
  inspection: InspectedTransaction;
  operation: Operation;
  request: PreparedRequest;
  sharesAmount?: string;
}

type AttributionConsentKind =
  | "already-yours"
  | "another-builder"
  | "permanently-ineligible"
  | "temporarily-unavailable";

interface ConsentCopy {
  body: string;
  kind: AttributionConsentKind;
  title: string;
}

interface ConsentState {
  attribution: Extract<DepositAttribution, { applied: false }>;
  copy: ConsentCopy;
  request: Extract<PreparedRequest, { operation: "deposit" }>;
}

interface FlowError {
  code?: string;
  logs?: ReadonlyArray<string>;
  message: string;
  reasons?: ReadonlyArray<RejectionReason>;
}

function ensureError(thrownObject: unknown): Error {
  return thrownObject instanceof Error
    ? thrownObject
    : new Error(`Unexpected error: ${String(thrownObject)}`);
}

function shortenAddress(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-6)}`;
}

function getBuilderLabel(config: PublicConfig): string {
  return config.attribution.kind === "address"
    ? shortenAddress(config.attribution.address)
    : config.attribution.code;
}

function getConsentCopy(
  attribution: Extract<DepositAttribution, { applied: false }>,
  config: PublicConfig,
): ConsentCopy {
  const builderLabel = getBuilderLabel(config);

  if (
    attribution.reason === "REFERRAL_ALREADY_SET" &&
    attribution.existingReferrerMatchesRequest === true
  ) {
    return {
      body: `The API reports that this wallet already has the configured ${builderLabel} relationship. This build could not apply a new attribution instruction, so continuing requires an unattributed rebuild.`,
      kind: "already-yours",
      title: "This relationship already exists",
    };
  }

  if (
    attribution.reason === "REFERRAL_ALREADY_SET" &&
    attribution.existingReferrer &&
    attribution.existingReferrerMatchesRequest === false
  ) {
    return {
      body: `This wallet is already linked to ${shortenAddress(attribution.existingReferrer)}. The configured ${builderLabel} builder will not receive credit for this deposit.`,
      kind: "another-builder",
      title: "Another builder is already linked",
    };
  }

  if (
    attribution.reason === "USER_BUNDLE_ACCOUNT_HAS_ACTIVITY" ||
    attribution.reason === "INVALID_REFERRER"
  ) {
    return {
      body: `This vault position is not eligible for a new ${builderLabel} attribution. Continuing will build a deposit without attribution.`,
      kind: "permanently-ineligible",
      title: "Attribution is permanently unavailable",
    };
  }

  const reasonCopy: Partial<Record<AttributionFailureReason, string>> = {
    ATTRIBUTION_NOT_YET_ENABLED:
      "Attribution is not enabled for this network yet.",
    BUILDER_DEPOSIT_AMOUNT_TOO_LOW:
      "This amount does not meet the builder-attribution minimum.",
    REFERRALS_DISABLED:
      "This vault is not accepting referral attribution right now.",
    REFERRER_DEACTIVATED:
      "The configured referrer is currently deactivated.",
    REFERRER_DEPOSIT_TOO_LOW:
      "The configured referrer does not meet the vault eligibility threshold.",
    REFERRER_NOT_REGISTERED:
      "The configured referrer is not registered for this vault.",
    UNKNOWN_CODE: "The configured builder code is not active.",
  };
  return {
    body: `${reasonCopy[attribution.reason] ?? "Attribution is currently unavailable."} Retry later, or explicitly continue knowing ${builderLabel} may not receive credit.`,
    kind: "temporarily-unavailable",
    title: "Attribution is temporarily unavailable",
  };
}

function readPositiveAmount(value: string, decimals: number): string {
  const amountRaw = parseTokenAmount(value, decimals);
  if (amountRaw === 0n) {
    throw new Error("Amount must be greater than zero.");
  }
  return amountRaw.toString();
}

function assertAcceptedBuild(
  data: TransactionBuildData,
  userAddress: string,
): asserts data is TransactionBuildData &
  Required<
    Pick<
      TransactionBuildData,
      "blockhash" | "instructions" | "signers" | "transactionBase64"
    >
  > {
  if (
    !data.blockhash ||
    !data.transactionBase64 ||
    !Array.isArray(data.instructions) ||
    !Array.isArray(data.signers)
  ) {
    throw new Error(
      "The accepted build is missing transaction bytes or inspection metadata.",
    );
  }
  if (data.signers.length !== 1 || data.signers[0] !== userAddress) {
    throw new Error("The builder returned an unexpected required signer.");
  }
}

function inspectAcceptedBuild(
  data: TransactionBuildData,
  config: PublicConfig,
  expected: ExpectedTransactionOperation,
  userAddress: string,
): InspectedTransaction {
  assertAcceptedBuild(data, userAddress);
  const inspection = inspect({
    bundleProgramId: config.vault.bundleProgramId,
    expected,
    transactionBase64: data.transactionBase64,
    userAddress,
  });
  if (inspection.blockhash !== data.blockhash) {
    throw new Error("Decoded transaction blockhash does not match the build response.");
  }
  if (
    inspection.instructions.length !== data.instructions.length ||
    inspection.instructions.some(
      (instruction, index) =>
        instruction.program !== data.instructions[index]?.programId ||
        instruction.accountCount !== data.instructions[index]?.accounts.length,
    )
  ) {
    throw new Error(
      "Decoded transaction instructions do not match the build response.",
    );
  }
  return inspection;
}

function isAttributionRequired(
  reasons: ReadonlyArray<RejectionReason>,
): boolean {
  return reasons.some(({ code }) => code === "ATTRIBUTION_REQUIRED");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function explorerUrl(signature: string, cluster: PublicConfig["cluster"]): string {
  const suffix = cluster === "devnet" ? "?cluster=devnet" : "";
  return `https://solscan.io/tx/${encodeURIComponent(signature)}${suffix}`;
}

function ApiFlowState({ config }: { config: PublicConfig }) {
  const { account, wallet } = useWallet();
  const [operation, setOperation] = useState<Operation>("deposit");
  const [depositAmount, setDepositAmount] = useState("5");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawAll, setWithdrawAll] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [review, setReview] = useState<ReviewState>();
  const [consent, setConsent] = useState<ConsentState>();
  const [flowError, setFlowError] = useState<FlowError>();
  const [notice, setNotice] = useState<string>();
  const [signature, setSignature] = useState<string>();
  const [rateLimitSeconds, setRateLimitSeconds] = useState(0);
  const activeController = useRef<AbortController | undefined>(undefined);

  const endpoint = useMemo<TransactionBuilderEndpoint>(
    () => ({
      apiBaseUrl: config.neutralApiUrl,
      vault: config.vault.address,
    }),
    [config.neutralApiUrl, config.vault.address],
  );
  const transport = useMemo(
    () =>
      createRpcTransactionTransport(config.cluster, {
        rpcUrl: config.rpcUrl,
      }),
    [config.cluster, config.rpcUrl],
  );

  const isBusy =
    phase === "building" ||
    phase === "signing" ||
    phase === "submitting" ||
    phase === "confirming";

  useEffect(() => {
    return () => activeController.current?.abort();
  }, []);

  useEffect(() => {
    if (rateLimitSeconds <= 0) {
      return;
    }
    const timeout = window.setTimeout(
      () => setRateLimitSeconds((seconds) => Math.max(0, seconds - 1)),
      1_000,
    );
    return () => window.clearTimeout(timeout);
  }, [rateLimitSeconds]);

  function resetOutcome(): void {
    activeController.current?.abort();
    activeController.current = undefined;
    setConsent(undefined);
    setFlowError(undefined);
    setNotice(undefined);
    setPhase("idle");
    setReview(undefined);
    setSignature(undefined);
  }

  function reportError(thrownObject: unknown): void {
    if (thrownObject instanceof TransactionBuilderApiError) {
      if (thrownObject.status === 429) {
        setRateLimitSeconds(thrownObject.retryAfterSeconds ?? 60);
      }
      setFlowError({
        ...(thrownObject.code ? { code: thrownObject.code } : {}),
        ...(thrownObject.logs ? { logs: thrownObject.logs } : {}),
        message: thrownObject.message,
      });
      return;
    }
    setFlowError({ message: ensureError(thrownObject).message });
  }

  async function prepareRequest(
    request: PreparedRequest,
    refreshed = false,
  ): Promise<void> {
    if (!account) {
      setFlowError({ message: "Connect a wallet before building a transaction." });
      return;
    }

    const controller = new AbortController();
    activeController.current?.abort();
    activeController.current = controller;
    setConsent(undefined);
    setFlowError(undefined);
    setNotice(undefined);
    setReview(undefined);
    setSignature(undefined);
    setPhase("building");

    try {
      if (request.operation === "deposit") {
        const response = await buildDepositTx(
          {
            amountRaw: request.amountRaw,
            attribution:
              request.attributionMode === "required"
                ? config.attribution
                : undefined,
            requireAttribution: request.attributionMode === "required",
            userAddress: account.address,
          },
          endpoint,
          controller.signal,
        );
        if (controller.signal.aborted) {
          return;
        }
        const data: DepositBuildData = response.data;
        if (!data.validation.accepted) {
          if (
            request.attributionMode === "required" &&
            isAttributionRequired(data.validation.rejectionReasons) &&
            data.attribution?.applied === false
          ) {
            setConsent({
              attribution: data.attribution,
              copy: getConsentCopy(data.attribution, config),
              request,
            });
          } else {
            setFlowError({
              message: "The deposit was rejected before any wallet prompt.",
              reasons: data.validation.rejectionReasons,
            });
          }
          setPhase("idle");
          return;
        }
        if (
          request.attributionMode === "required" &&
          data.attribution?.applied !== true
        ) {
          throw new Error(
            "The strict build did not prove that attribution was applied.",
          );
        }

        const inspection = inspectAcceptedBuild(
          data,
          config,
          {
            amountRaw: request.amountRaw,
            attributionApplied: data.attribution?.applied === true,
            operation: "deposit",
            vaultAddress: config.vault.address,
          },
          account.address,
        );
        setReview({
          attribution: data.attribution,
          build: data,
          inspection,
          operation: "deposit",
          request,
        });
      } else {
        const response = await buildWithdrawTx(
          request.withdrawAll
            ? { userAddress: account.address, withdrawAll: true }
            : {
                amountRaw: request.amountRaw ?? "0",
                userAddress: account.address,
              },
          endpoint,
          controller.signal,
        );
        if (controller.signal.aborted) {
          return;
        }
        const data: WithdrawBuildData = response.data;
        if (!data.validation.accepted) {
          setFlowError({
            message: data.validation.rejectionReasons.some(
              ({ code }) => code === "USER_BUNDLE_ACCOUNT_NOT_FOUND",
            )
              ? "No position in this vault."
              : "The withdrawal was rejected before any wallet prompt.",
            reasons: data.validation.rejectionReasons,
          });
          setPhase("idle");
          return;
        }
        if (!data.sharesAmount) {
          throw new Error("The accepted withdrawal did not include sharesAmount.");
        }

        const inspection = inspectAcceptedBuild(
          data,
          config,
          {
            operation: "withdraw",
            sharesAmount: data.sharesAmount,
            vaultAddress: config.vault.address,
          },
          account.address,
        );
        setReview({
          build: data,
          inspection,
          operation: "withdraw",
          request,
          sharesAmount: data.sharesAmount,
        });
      }

      setNotice(
        refreshed
          ? "The old blockhash expired. A fresh transaction was inspected; review it again before signing."
          : undefined,
      );
      setPhase("review");
    } catch (thrownObject) {
      if (!controller.signal.aborted && !isAbortError(thrownObject)) {
        reportError(thrownObject);
        setPhase("idle");
      }
    } finally {
      if (activeController.current === controller) {
        activeController.current = undefined;
      }
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    try {
      const request: PreparedRequest =
        operation === "deposit"
          ? {
              amountRaw: readPositiveAmount(
                depositAmount,
                config.vault.depositToken.decimals,
              ),
              attributionMode: "required",
              operation: "deposit",
            }
          : withdrawAll
            ? { operation: "withdraw", withdrawAll: true }
            : {
                amountRaw: readPositiveAmount(
                  withdrawAmount,
                  config.vault.depositToken.decimals,
                ),
                operation: "withdraw",
                withdrawAll: false,
              };
      void prepareRequest(request);
    } catch (thrownObject) {
      reportError(thrownObject);
    }
  }

  function handleUnattributedDeposit(): void {
    if (!consent) {
      return;
    }
    void prepareRequest({
      ...consent.request,
      attributionMode: "without-attribution",
    });
  }

  async function handleSignAndSubmit(): Promise<void> {
    if (!account || !wallet || !review) {
      setFlowError({ message: "Reconnect the wallet before signing." });
      return;
    }

    const controller = new AbortController();
    activeController.current?.abort();
    activeController.current = controller;
    setFlowError(undefined);
    setNotice(undefined);
    setPhase("signing");
    let submittedSignature: string | undefined;

    try {
      const blockhashIsValid = await transport.isBlockhashValid(
        review.inspection.blockhash,
      );
      if (controller.signal.aborted) {
        return;
      }
      if (!blockhashIsValid) {
        if (activeController.current === controller) {
          activeController.current = undefined;
        }
        await prepareRequest(review.request, true);
        return;
      }

      const signer = createWalletSignerAdapter(
        wallet,
        account,
        config.cluster,
      );
      const signedWireTransaction = await signer.signWireTransaction(
        review.inspection.wireBytes,
      );
      if (controller.signal.aborted) {
        return;
      }
      setPhase("submitting");
      submittedSignature = await transport.sendTransaction(
        signedWireTransaction,
      );
      if (controller.signal.aborted) {
        return;
      }
      setPhase("confirming");
      await transport.confirmTransaction({
        blockhash: review.inspection.blockhash,
        signal: controller.signal,
        signature: submittedSignature,
      });

      setSignature(submittedSignature);
      setNotice("Transaction confirmed. The position panel is refreshing.");
      setPhase("confirmed");
      refreshPosition();
    } catch (thrownObject) {
      if (!controller.signal.aborted && !isAbortError(thrownObject)) {
        if (submittedSignature) {
          setSignature(submittedSignature);
          setFlowError({
            message: `The transaction was submitted, but confirmation could not be verified: ${ensureError(thrownObject).message}`,
          });
          setPhase("submitted");
        } else {
          reportError(thrownObject);
          setPhase("review");
        }
      }
    } finally {
      if (activeController.current === controller) {
        activeController.current = undefined;
      }
    }
  }

  const amountDecimals = config.vault.depositToken.decimals;
  const symbol = config.vault.depositToken.symbol;
  const buildButtonLabel =
    phase === "building"
      ? "Building and inspecting…"
      : !account
        ? "Connect wallet to build"
        : rateLimitSeconds > 0
          ? `Try again in ${rateLimitSeconds}s`
          : operation === "deposit"
            ? "Build deposit transaction"
            : "Build withdrawal transaction";

  return (
    <div className="flow-content api-flow">
      <p className="eyebrow">Public transaction builder</p>
      <h2>Inspect, sign, and submit through REST</h2>
      <p>
        The browser sends no API key. Neutral prepares unsigned bytes, this app
        verifies them, and your connected wallet remains the only signer.
      </p>

      <div className="operation-switch" aria-label="REST operation">
        <button
          aria-pressed={operation === "deposit"}
          disabled={isBusy}
          onClick={() => {
            resetOutcome();
            setOperation("deposit");
          }}
          type="button"
        >
          Deposit
        </button>
        <button
          aria-pressed={operation === "withdraw"}
          disabled={isBusy}
          onClick={() => {
            resetOutcome();
            setOperation("withdraw");
          }}
          type="button"
        >
          Withdraw
        </button>
      </div>

      <form className="transaction-form" onSubmit={handleSubmit}>
        {operation === "deposit" ? (
          <label className="field-label" htmlFor="deposit-amount">
            <span>Deposit amount</span>
            <span className="amount-field">
              <input
                autoComplete="off"
                disabled={isBusy}
                id="deposit-amount"
                inputMode="decimal"
                onChange={(event) => {
                  resetOutcome();
                  setDepositAmount(event.target.value);
                }}
                placeholder="5"
                type="text"
                value={depositAmount}
              />
              <span>{symbol}</span>
            </span>
          </label>
        ) : (
          <>
            <label className="checkbox-label" htmlFor="withdraw-all">
              <input
                checked={withdrawAll}
                disabled={isBusy}
                id="withdraw-all"
                onChange={(event) => {
                  resetOutcome();
                  setWithdrawAll(event.target.checked);
                }}
                type="checkbox"
              />
              Withdraw the entire live position
            </label>
            {!withdrawAll ? (
              <label className="field-label" htmlFor="withdraw-amount">
                <span>Withdrawal amount</span>
                <span className="amount-field">
                  <input
                    autoComplete="off"
                    disabled={isBusy}
                    id="withdraw-amount"
                    inputMode="decimal"
                    onChange={(event) => {
                      resetOutcome();
                      setWithdrawAmount(event.target.value);
                    }}
                    placeholder="1"
                    type="text"
                    value={withdrawAmount}
                  />
                  <span>{symbol}</span>
                </span>
              </label>
            ) : null}
            <p className="form-note">
              Withdrawal settlement is keeper-push after the cooldown. Its ETA
              appears in the position panel after confirmation.
            </p>
          </>
        )}

        <button
          className="primary-button transaction-button"
          disabled={!account || isBusy || rateLimitSeconds > 0}
          type="submit"
        >
          {buildButtonLabel}
        </button>
      </form>

      {rateLimitSeconds > 0 ? (
        <p className="rate-limit" role="status">
          Build limit reached. Retry-After: {rateLimitSeconds} second
          {rateLimitSeconds === 1 ? "" : "s"}. No automatic retry will run.
        </p>
      ) : null}

      {consent ? (
        <section className="consent-card" aria-labelledby="consent-title">
          <div className="review-heading">
            <span className={`consent-kind ${consent.copy.kind}`}>
              {consent.copy.kind.replaceAll("-", " ")}
            </span>
            <code>{consent.attribution.reason}</code>
          </div>
          <h3 id="consent-title">{consent.copy.title}</h3>
          <p>{consent.copy.body}</p>
          {consent.attribution.requiredGrossDepositAmount ? (
            <p>
              Required gross amount: {" "}
              <strong>
                {formatRawAmount(
                  consent.attribution.requiredGrossDepositAmount,
                  amountDecimals,
                )}{" "}
                {symbol}
              </strong>
            </p>
          ) : null}
          <button
            className="danger-button"
            disabled={isBusy || rateLimitSeconds > 0}
            onClick={handleUnattributedDeposit}
            type="button"
          >
            Deposit without attribution
          </button>
        </section>
      ) : null}

      {notice ? (
        <p className="flow-notice" role="status">
          {notice}
        </p>
      ) : null}

      {flowError ? (
        <section className="flow-error" role="alert">
          {flowError.code ? <code>{flowError.code}</code> : null}
          <p>{flowError.message}</p>
          {flowError.reasons?.length ? (
            <ul>
              {flowError.reasons.map((reason, index) => (
                <li key={`${reason.code}-${index}`}>
                  <code>{reason.code}</code>: {reason.message}
                </li>
              ))}
            </ul>
          ) : null}
          {flowError.logs ? (
            <details open>
              <summary>Preflight logs</summary>
              <pre>
                {flowError.logs.join("\n") || "No preflight logs returned."}
              </pre>
            </details>
          ) : null}
        </section>
      ) : null}

      {review ? (
        <section className="review-card" aria-labelledby="review-title">
          <div className="review-heading">
            <span className="verified-pill">Amount and vault verified</span>
            <span>v0 · one signer · no lookup tables</span>
          </div>
          <h3 id="review-title">
            Review the transaction before opening your wallet
          </h3>

          {review.operation === "deposit" ? (
            review.attribution?.applied === true ? (
              <p className="attribution-status applied">
                This deposit will be attributed to {" "}
                <code title={review.attribution.referrer}>
                  {shortenAddress(review.attribution.referrer)}
                </code>
                .
              </p>
            ) : (
              <p className="attribution-status unavailable">
                You explicitly approved a build without attribution. This
                transaction does not claim builder credit.
              </p>
            )
          ) : (
            <p className="attribution-status withdrawal">
              The keeper settles this request to your associated token account
              after the cooldown.
            </p>
          )}

          <dl className="transaction-summary">
            <div>
              <dt>{review.operation === "deposit" ? "Deposit" : "Requested"}</dt>
              <dd>
                {review.request.operation === "withdraw" &&
                review.request.withdrawAll
                  ? "Entire position"
                  : `${formatRawAmount(review.request.amountRaw ?? "0", amountDecimals)} ${symbol}`}
              </dd>
            </div>
            {review.sharesAmount ? (
              <div>
                <dt>Shares requested</dt>
                <dd>
                  {formatRawAmount(review.sharesAmount, amountDecimals)} shares
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Compute limit</dt>
              <dd>{review.build.computeUnitLimit?.toLocaleString() ?? "API default"}</dd>
            </div>
            <div>
              <dt>Priority fee</dt>
              <dd>
                {review.build.priorityFeeMicroLamports ?? "0"} µ-lamports/CU
              </dd>
            </div>
            <div>
              <dt>Blockhash</dt>
              <dd title={review.inspection.blockhash}>
                {shortenAddress(review.inspection.blockhash)}
              </dd>
            </div>
          </dl>

          <div className="instruction-review">
            <h4>Decoded instructions</h4>
            <ol>
              {review.inspection.instructions.map((instruction, index) => (
                <li key={`${instruction.program}-${index}`}>
                  <span title={instruction.program}>
                    {instruction.name} · {instruction.program}
                  </span>
                  <small>
                    {instruction.accountCount} account
                    {instruction.accountCount === 1 ? "" : "s"}
                  </small>
                </li>
              ))}
            </ol>
          </div>

          {phase === "review" ? (
            <button
              className="primary-button transaction-button"
              onClick={() => void handleSignAndSubmit()}
              type="button"
            >
              Sign and submit
            </button>
          ) : phase === "signing" ? (
            <p className="progress-copy">Waiting for wallet approval…</p>
          ) : phase === "submitting" ? (
            <p className="progress-copy">Submitting through your RPC…</p>
          ) : phase === "confirming" ? (
            <p className="progress-copy">Submitted. Waiting for confirmation…</p>
          ) : null}
        </section>
      ) : null}

      {signature ? (
        <section className="signature-card">
          <span>
            {phase === "confirmed" ? "Confirmed signature" : "Submitted signature"}
          </span>
          <a
            href={explorerUrl(signature, config.cluster)}
            rel="noreferrer"
            target="_blank"
            title={signature}
          >
            {shortenAddress(signature)} ↗
          </a>
        </section>
      ) : null}
    </div>
  );
}

export function ApiFlow({ config }: { config: PublicConfig }) {
  const { account } = useWallet();
  return (
    <ApiFlowState
      config={config}
      key={account?.address ?? "disconnected"}
    />
  );
}
