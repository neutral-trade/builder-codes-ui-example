"use client";

import { useState } from "react";

import { useWallet } from "@/lib/wallet";

function formatAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function ensureError(thrownObject: unknown): Error {
  // JavaScript permits any value to be thrown, so normalize unexpected values.
  if (thrownObject instanceof Error) {
    return thrownObject;
  }
  return new Error(`Non-Error thrown: ${String(thrownObject)}`);
}

export function ConnectWallet() {
  const { account, connect, disconnect, wallet, wallets } = useWallet();
  const [preferredWalletName, setPreferredWalletName] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();

  const selectedWalletName = wallets.some(
    (availableWallet) => availableWallet.name === preferredWalletName,
  )
    ? preferredWalletName
    : (wallets[0]?.name ?? "");

  async function handleConnect(): Promise<void> {
    if (!selectedWalletName) {
      return;
    }

    setErrorMessage(undefined);
    setIsConnecting(true);
    try {
      await connect(selectedWalletName);
    } catch (thrownObject) {
      setErrorMessage(ensureError(thrownObject).message);
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleDisconnect(): Promise<void> {
    setErrorMessage(undefined);
    try {
      await disconnect();
    } catch (thrownObject) {
      setErrorMessage(ensureError(thrownObject).message);
    }
  }

  if (wallet && account) {
    return (
      <div className="wallet-control">
        <span className="wallet-address" title={account.address}>
          <span className="connection-dot" aria-hidden="true" />
          {wallet.name} · {formatAddress(account.address)}
        </span>
        <button
          className="secondary-button"
          onClick={() => void handleDisconnect()}
          type="button"
        >
          Disconnect
        </button>
        {errorMessage ? (
          <span className="wallet-error">{errorMessage}</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="wallet-control">
      <label className="sr-only" htmlFor="wallet-select">
        Wallet
      </label>
      <select
        id="wallet-select"
        onChange={(event) => setPreferredWalletName(event.target.value)}
        value={selectedWalletName}
      >
        {wallets.length === 0 ? (
          <option value="">No compatible wallets</option>
        ) : null}
        {wallets.map((availableWallet) => (
          <option key={availableWallet.name} value={availableWallet.name}>
            {availableWallet.name}
          </option>
        ))}
      </select>
      <button
        className="primary-button"
        disabled={!selectedWalletName || isConnecting}
        onClick={() => void handleConnect()}
        type="button"
      >
        {isConnecting ? "Connecting…" : "Connect wallet"}
      </button>
      {errorMessage ? (
        <span className="wallet-error">{errorMessage}</span>
      ) : null}
    </div>
  );
}
