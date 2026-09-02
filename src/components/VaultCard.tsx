"use client";

import { useCallback, useEffect, useState } from "react";

import {
  getVault,
  getVaultMetrics,
  NeutralApiError,
  type VaultMetricsData,
  type VaultMetricsResponse,
  type VaultResponse,
} from "@/lib/api";
import { formatBps, formatRate, formatRaw, formatUsd } from "@/lib/format";

type VaultState =
  | { kind: "loading" }
  | { kind: "ready"; metrics: VaultMetricsResponse; vault: VaultResponse }
  | { error: unknown; kind: "error" };

interface VaultResult {
  metrics: VaultMetricsResponse;
  vault: VaultResponse;
}

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatTimestamp(timestamp: number): string {
  return DATE_FORMATTER.format(new Date(timestamp * 1_000));
}

function humanize(value: string | null): string {
  if (!value) return "Uncategorized";
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (firstCharacter) => firstCharacter.toUpperCase());
}

function formatCadence(value: string | null): string {
  if (value === "30min") return "Every 30 minutes";
  if (value === "hourly") return "Hourly";
  if (value === "daily") return "Daily";
  return "Not published";
}

function preferredApy(
  gross: number | null,
  afterFees: number | null,
): { label: string; value: number | null } {
  return afterFees !== null
    ? { label: "after fees", value: afterFees }
    : { label: "gross", value: gross };
}

function Metric({
  label,
  note,
  value,
}: {
  label: string;
  note?: string;
  value: string;
}) {
  return (
    <div className="vault-metric">
      <dt>
        {label}
        {note ? <small>{note}</small> : null}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}

function ApyMetrics({ metrics }: { metrics: VaultMetricsData }) {
  const sevenDay = preferredApy(metrics.apy7d, metrics.apy7dAfterFees);
  const thirtyDay = preferredApy(metrics.apy30d, metrics.apy30dAfterFees);
  const inception = preferredApy(
    metrics.apyInception,
    metrics.apyInceptionAfterFees,
  );

  return (
    <dl className="metric-grid">
      <Metric
        label="APY · 7d"
        note={sevenDay.label}
        value={formatRate(sevenDay.value)}
      />
      <Metric
        label="APY · 30d"
        note={thirtyDay.label}
        value={formatRate(thirtyDay.value)}
      />
      <Metric
        label="APY · inception"
        note={inception.label}
        value={formatRate(inception.value)}
      />
      <Metric
        label="Sharpe · 30d"
        value={
          metrics.sharpeRatio30d === null
            ? "—"
            : metrics.sharpeRatio30d.toFixed(2)
        }
      />
      <Metric
        label="Max drawdown"
        value={formatRate(metrics.maxDrawdown)}
      />
    </dl>
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof NeutralApiError && error.status === 503) {
    return "Data temporarily unavailable";
  }
  if (error instanceof NeutralApiError && error.status === 429) {
    return error.retryAfterSeconds === undefined
      ? "Rate limited. Try again shortly."
      : `Rate limited — retry in ${error.retryAfterSeconds} s`;
  }
  return "Vault data could not be loaded.";
}

async function requestVault(signal?: AbortSignal): Promise<VaultResult> {
  const [vault, metrics] = await Promise.all([
    getVault(signal),
    getVaultMetrics(signal),
  ]);
  return { metrics, vault };
}

export function VaultCard() {
  const [state, setState] = useState<VaultState>({ kind: "loading" });

  const showVault = useCallback(({ metrics, vault }: VaultResult) => {
    setState({ kind: "ready", metrics, vault });
  }, []);

  const showError = useCallback((error: unknown) => {
    if (error instanceof DOMException && error.name === "AbortError") return;
    setState({ error, kind: "error" });
  }, []);

  function retry(): void {
    setState({ kind: "loading" });
    void requestVault().then(showVault).catch(showError);
  }

  useEffect(() => {
    const controller = new AbortController();
    void requestVault(controller.signal).then(showVault).catch(showError);
    return () => controller.abort();
  }, [showError, showVault]);

  if (state.kind === "loading") {
    return (
      <section className="info-card live-card" aria-busy="true">
        <div className="card-heading">
          <span>Vault</span>
          <span className="status-pill">Loading</span>
        </div>
        <p className="card-state">Loading live vault data…</p>
      </section>
    );
  }

  if (state.kind === "error") {
    return (
      <section className="info-card live-card" role="status">
        <div className="card-heading">
          <span>Vault</span>
          <span className="status-pill warning">Unavailable</span>
        </div>
        <p className="card-state">{getErrorMessage(state.error)}</p>
        <button
          className="secondary-button compact-button"
          onClick={retry}
          type="button"
        >
          Try again
        </button>
      </section>
    );
  }

  const { data: vault } = state.vault;
  const { data: metrics } = state.metrics;
  const symbol = vault.asset.symbol ?? metrics.tvl.asset.symbol ?? "tokens";
  const tvl = metrics.tvl.value;

  return (
    <section className="info-card live-card">
      <div className="card-heading">
        <span>{humanize(vault.category)}</span>
        <span className={`status-pill${vault.paused ? " warning" : ""}`}>
          {vault.paused ? "Paused" : "Live"}
        </span>
      </div>
      <h2>{vault.name ?? "Neutral vault"}</h2>

      <div className="tvl-block">
        <span>TVL</span>
        <strong>
          {formatRaw(tvl.raw, vault.asset.decimals)} {symbol}
        </strong>
        <small>{formatUsd(tvl.usd ?? null)}</small>
      </div>

      <ApyMetrics metrics={metrics} />

      <h3 className="section-label">Vault terms</h3>
      <dl className="detail-list">
        <div>
          <dt>Asset</dt>
          <dd>{symbol}</dd>
        </div>
        <div>
          <dt>Deposit fee</dt>
          <dd>{formatBps(vault.depositFeeBps)}</dd>
        </div>
        <div>
          <dt>Management fee</dt>
          <dd>{formatBps(vault.managementFeeBps)}</dd>
        </div>
        <div>
          <dt>Performance fee</dt>
          <dd>{formatBps(vault.performanceFeeBps)}</dd>
        </div>
        <div>
          <dt>Withdrawal fee</dt>
          <dd>{formatBps(vault.withdrawalFeeBps)}</dd>
        </div>
        <div>
          <dt>Minimum deposit</dt>
          <dd>
            {formatRaw(vault.minDepositAmount, vault.asset.decimals)} {symbol}
          </dd>
        </div>
        <div>
          <dt>Processing</dt>
          <dd>{formatCadence(vault.processFrequency)}</dd>
        </div>
      </dl>

      <div className="referral-block">
        <h3>
          Builder referrals: {vault.referral?.enabled ? "enabled" : "disabled"}
        </h3>
        {vault.referral?.enabled ? (
          <>
            <p>
              Eligible from {formatRaw(
                vault.referral.minDepositAmount,
                vault.asset.decimals,
              )}{" "}
              {symbol}
            </p>
            <ul>
              {vault.referral.tiers.map((tier) => (
                <li key={`${tier.threshold}-${tier.mfeeBps}`}>
                  ≥ {formatRaw(tier.threshold, vault.asset.decimals, 0)} {symbol}
                  {" → "}
                  {formatBps(tier.mfeeBps).replace("%", " %")} of management
                  fee
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>

      <p className="freshness-line">
        Chain {formatTimestamp(state.vault.asOf.blockTime)} · Metrics{" "}
        {formatTimestamp(metrics.computedAt)}
      </p>
    </section>
  );
}
