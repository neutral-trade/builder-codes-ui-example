"use client";

import type {
  AttributionUnavailableReason,
  NeutralTradeWidgetEvent,
  WalletStandardSigner,
} from "@neutral-trade/widget-sdk";
import { NeutralTradeWidget } from "@neutral-trade/widget-sdk/react";
import { useCallback, useMemo, useState } from "react";

import { attribution, config } from "@/config";
import { createWalletSignerAdapter } from "@/lib/signer";
import { refreshPosition } from "@/lib/position-refresh";
import { useWallet } from "@/lib/wallet";

// The hosted widget reads positions and pending requests without a partner key,
// strictly verifies transaction bytes, presents attribution consent states, and
// coordinates blockhash rebuilds. Neutral owns its branding; the host owns the
// iframe height, and builderAddress must already be registered on the vault.
const attributionProps =
  attribution.kind === "address"
    ? { builderAddress: attribution.address }
    : { builderCode: attribution.code };

const MAX_VISIBLE_EVENTS = 8;
const ATTRIBUTION_UNAVAILABLE_MESSAGES: Readonly<
  Record<AttributionUnavailableReason, string>
> = {
  "builder-code-unrecognized": "The builder code does not resolve.",
  "referrer-ineligible":
    "Neutral could not apply builder attribution; the API may not be enabled or the builder may not be eligible, so this deposit will not be credited to your builder.",
  "referrer-not-registered":
    "The configured builder is not registered on this vault.",
  "user-already-attributed":
    "This wallet already has activity in the vault; attribution is one-shot on the first deposit.",
};

function formatEvent(event: NeutralTradeWidgetEvent): string {
  return JSON.stringify(
    event,
    (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    2,
  );
}

interface WidgetSessionProps {
  signer: WalletStandardSigner | undefined;
  vaults: ReadonlyArray<string>;
}

function WidgetSession({ signer, vaults }: WidgetSessionProps) {
  const [events, setEvents] = useState<
    ReadonlyArray<NeutralTradeWidgetEvent>
  >([]);
  const [attributionUnavailableMessage, setAttributionUnavailableMessage] =
    useState<string>();

  const handleEvent = useCallback((event: NeutralTradeWidgetEvent): void => {
    setEvents((currentEvents) =>
      [event, ...currentEvents].slice(0, MAX_VISIBLE_EVENTS),
    );

    if (event.type === "attribution-unavailable") {
      setAttributionUnavailableMessage(
        ATTRIBUTION_UNAVAILABLE_MESSAGES[event.reason],
      );
    } else if (event.type === "attribution-applied") {
      setAttributionUnavailableMessage(undefined);
    }

    if (
      event.type === "deposit-confirmed" ||
      event.type === "withdraw-confirmed"
    ) {
      refreshPosition();
    }
  }, []);

  return (
    <div className="flow-content">
      <p className="eyebrow">Hosted experience</p>
      <h2>Deposit with the Neutral widget</h2>
      <p>
        Embed Neutral&apos;s verified deposit experience while your app supplies
        the connected Wallet Standard signer and builder attribution.
      </p>
      {signer ? (
        <NeutralTradeWidget
          {...attributionProps}
          className="widget-mount"
          cluster={config.cluster}
          height={720}
          mode="inline"
          onEvent={handleEvent}
          rpcUrl={config.rpcUrl}
          signer={signer}
          vaults={vaults}
        />
      ) : (
        <p className="widget-prompt">
          Connect a Wallet Standard wallet to load the Neutral widget.
        </p>
      )}

      <section className="widget-events" aria-label="Widget lifecycle events">
        <div className="widget-events-heading">
          <h3>Lifecycle events</h3>
          <span>{events.length} / {MAX_VISIBLE_EVENTS}</span>
        </div>
        {attributionUnavailableMessage && (
          <p className="widget-attribution-notice" role="status">
            {attributionUnavailableMessage}
          </p>
        )}
        {events.length === 0 ? (
          <p className="widget-events-empty">Waiting for the widget.</p>
        ) : (
          <ol className="widget-event-list">
            {events.map((event, index) => (
              <li
                className="widget-event"
                key={`${event.type}-${"requestId" in event ? event.requestId : index}`}
              >
                <strong>{event.type}</strong>
                <pre>{formatEvent(event)}</pre>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

export function WidgetFlow() {
  const { account, wallet } = useWallet();
  const signer = useMemo(
    () =>
      account && wallet
        ? createWalletSignerAdapter(
            wallet,
            account,
            config.cluster,
          ).createWidgetSigner()
        : undefined,
    [account, wallet],
  );
  const vaults = useMemo(() => [config.vault.address], []);

  return (
    <WidgetSession
      key={account?.address ?? "disconnected"}
      signer={signer}
      vaults={vaults}
    />
  );
}
