"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  getBalance,
  getPending,
  NeutralApiError,
  type PendingRequest,
  type PendingResponse,
  type VaultBalanceResponse,
} from "@/lib/api";
import { formatRaw, formatUsd } from "@/lib/format";
import { onPositionRefresh } from "@/lib/position-refresh";
import { useWallet } from "@/lib/wallet";

const REDEMPTION_DOCS_URL =
  "https://docs.neutral.trade/additional-info/transparency-hub/fees-%2B-redemption-period";
const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

type PositionState =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      address: string;
      balance: VaultBalanceResponse | null;
      isRefreshing: boolean;
      kind: "ready";
      pending: PendingResponse | null;
    }
  | { address: string; error: unknown; kind: "error" };

interface PositionResult {
  address: string;
  balance: VaultBalanceResponse | null;
  pending: PendingResponse | null;
}

function formatTimestamp(timestamp: number): string {
  return DATE_FORMATTER.format(new Date(timestamp * 1_000));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof NeutralApiError && error.status === 503) {
    return "Position data is temporarily unavailable.";
  }
  if (error instanceof NeutralApiError && error.status === 429) {
    return error.retryAfterSeconds === undefined
      ? "Rate limited. Try again shortly."
      : `Rate limited — retry in ${error.retryAfterSeconds} s`;
  }
  return "Your position could not be loaded.";
}

function pendingAmount(
  request: PendingRequest,
  kind: "deposit" | "withdrawal",
): { raw: string; unit: "asset" | "shares" } | undefined {
  const { amounts } = request;
  const assetAmount =
    kind === "deposit"
      ? (amounts.net ?? amounts.gross ?? amounts.estimatedValue)
      : (amounts.estimatedValue ?? amounts.net ?? amounts.gross);

  if (assetAmount !== undefined) return { raw: assetAmount, unit: "asset" };
  if (amounts.shares !== undefined) {
    return { raw: amounts.shares, unit: "shares" };
  }
}

function PendingList({
  decimals,
  kind,
  requests,
  symbol,
}: {
  decimals: number;
  kind: "deposit" | "withdrawal";
  requests: PendingRequest[];
  symbol: string;
}) {
  if (requests.length === 0) return null;

  return (
    <div className="pending-group">
      <h4>Pending {kind}s</h4>
      <ul>
        {requests.map((request, index) => {
          const amount = pendingAmount(request, kind);
          return (
            <li key={`${request.requestedAt}-${request.stage}-${index}`}>
              <div>
                <strong>{request.stage}</strong>
                <span>
                  {amount
                    ? `${formatRaw(amount.raw, decimals)} ${
                        amount.unit === "asset" ? symbol : "shares"
                      }`
                    : "Amount unavailable"}
                </span>
              </div>
              <p>
                {request.etaProcessAt === null ? (
                  <>
                    ETA unavailable ·{" "}
                    <a href={REDEMPTION_DOCS_URL} rel="noreferrer" target="_blank">
                      Fees + Redemption Period
                    </a>
                  </>
                ) : (
                  <>ETA {formatTimestamp(request.etaProcessAt)}</>
                )}
              </p>
              {kind === "withdrawal" && request.cooldownEnd !== null ? (
                <p>Cooldown ends {formatTimestamp(request.cooldownEnd)}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function hasPosition(
  balance: VaultBalanceResponse | null,
  pending: PendingResponse | null,
): boolean {
  const hasPending = Boolean(
    pending &&
      (pending.data.deposits.length > 0 || pending.data.withdrawals.length > 0),
  );
  if (!balance) return hasPending;
  return (
    BigInt(balance.data.shares.raw) !== 0n ||
    BigInt(balance.data.value.raw) !== 0n ||
    BigInt(balance.data.netDeposits.raw) !== 0n ||
    hasPending
  );
}

export function PositionCard({
  assetDecimals,
  assetSymbol,
}: {
  assetDecimals: number;
  assetSymbol: string;
}) {
  const { account } = useWallet();
  const address = account?.address;
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const [state, setState] = useState<PositionState>({ kind: "idle" });

  const requestPosition = useCallback((): Promise<PositionResult | null> => {
    controllerRef.current?.abort();
    if (!address) return Promise.resolve(null);

    const controller = new AbortController();
    controllerRef.current = controller;
    return Promise.all([
      getBalance(address, controller.signal),
      getPending(address, controller.signal),
    ]).then(([balance, pending]) => ({ address, balance, pending }));
  }, [address]);

  const showPosition = useCallback((result: PositionResult | null) => {
    if (!result) return;
    const { address: resultAddress, balance, pending } = result;
    setState({
      address: resultAddress,
      balance,
      isRefreshing: false,
      kind: "ready",
      pending,
    });
  }, []);

  const showError = useCallback(
    (error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (address) setState({ address, error, kind: "error" });
    },
    [address],
  );

  const refresh = useCallback(() => {
    setState((currentState) =>
      currentState.kind === "ready" && currentState.address === address
        ? { ...currentState, isRefreshing: true }
        : { kind: "loading" },
    );
    void requestPosition().then(showPosition).catch(showError);
  }, [address, requestPosition, showError, showPosition]);

  useEffect(() => {
    void requestPosition().then(showPosition).catch(showError);
    return () => controllerRef.current?.abort();
  }, [requestPosition, showError, showPosition]);

  useEffect(() => {
    if (!address) return;
    window.addEventListener("focus", refresh);
    const unsubscribe = onPositionRefresh(refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      unsubscribe();
    };
  }, [address, refresh]);

  if (!address) return null;

  if (
    state.kind === "idle" ||
    state.kind === "loading" ||
    state.address !== address
  ) {
    return (
      <section className="info-card position-card" aria-busy="true">
        <div className="card-heading">
          <span>Your position</span>
          <span className="status-pill">Loading</span>
        </div>
        <p className="card-state">Loading wallet position…</p>
      </section>
    );
  }

  if (state.kind === "error") {
    return (
      <section className="info-card position-card" role="status">
        <div className="card-heading">
          <span>Your position</span>
          <span className="status-pill warning">Unavailable</span>
        </div>
        <p className="card-state">{getErrorMessage(state.error)}</p>
        <button
          className="secondary-button compact-button"
          onClick={refresh}
          type="button"
        >
          Try again
        </button>
      </section>
    );
  }

  const { balance, pending } = state;
  if (!hasPosition(balance, pending)) {
    return (
      <section className="info-card position-card">
        <div className="card-heading">
          <span>Your position</span>
          <span className="status-pill">Wallet</span>
        </div>
        <h2>No position yet</h2>
        <p className="empty-copy">
          This wallet has no balance or pending activity in this vault.
        </p>
        <button
          className="secondary-button compact-button"
          disabled={state.isRefreshing}
          onClick={refresh}
          type="button"
        >
          {state.isRefreshing ? "Refreshing…" : "Refresh"}
        </button>
      </section>
    );
  }

  const asset = balance?.data.asset;
  const decimals = asset?.decimals ?? assetDecimals;
  const symbol = asset?.symbol ?? assetSymbol;
  const earnings = balance
    ? BigInt(balance.data.value.raw) - BigInt(balance.data.netDeposits.raw)
    : 0n;

  return (
    <section className="info-card position-card">
      <div className="card-heading">
        <span>Your position</span>
        <button
          className="text-button"
          disabled={state.isRefreshing}
          onClick={refresh}
          type="button"
        >
          {state.isRefreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {balance ? (
        <dl className="position-values">
          <div>
            <dt>Shares</dt>
            <dd>{formatRaw(balance.data.shares.raw, decimals, 6)}</dd>
          </div>
          <div>
            <dt>Current value</dt>
            <dd>
              {formatRaw(balance.data.value.raw, decimals)} {symbol}
              <small>{formatUsd(balance.data.value.usd ?? null)}</small>
            </dd>
          </div>
          <div>
            <dt>Net deposits</dt>
            <dd>
              {formatRaw(balance.data.netDeposits.raw, decimals)} {symbol}
            </dd>
          </div>
          <div>
            <dt>Earnings</dt>
            <dd className={earnings < 0n ? "negative-value" : undefined}>
              {formatRaw(earnings, decimals)} {symbol}
            </dd>
          </div>
          <div>
            <dt>Estimated unpaid fees</dt>
            <dd>
              {formatRaw(balance.data.unpaidFeeEstimate.value.raw, decimals)}{" "}
              {symbol}
              <small>
                {formatUsd(balance.data.unpaidFeeEstimate.value.usd ?? null)}
              </small>
            </dd>
          </div>
        </dl>
      ) : null}

      {pending ? (
        <div className="pending-lists">
          <PendingList
            decimals={decimals}
            kind="deposit"
            requests={pending.data.deposits}
            symbol={symbol}
          />
          <PendingList
            decimals={decimals}
            kind="withdrawal"
            requests={pending.data.withdrawals}
            symbol={symbol}
          />
        </div>
      ) : null}
    </section>
  );
}
