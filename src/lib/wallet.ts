"use client";

import type { ReactNode } from "react";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import type {
  StandardConnectFeature,
  StandardDisconnectFeature,
} from "@wallet-standard/features";
import { SolanaSignTransaction } from "@solana/wallet-standard-features";
import { getWallets } from "@wallet-standard/app";
import {
  StandardConnect,
  StandardDisconnect,
} from "@wallet-standard/features";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  createWalletSignerAdapter,
  type SolanaCluster,
} from "@/lib/signer";

interface WalletContextValue {
  account: WalletAccount | undefined;
  connect(walletName: string): Promise<void>;
  disconnect(): Promise<void>;
  wallet: Wallet | undefined;
  wallets: ReadonlyArray<Wallet>;
}

interface WalletProviderProps {
  children: ReactNode;
  cluster: SolanaCluster;
}

interface WalletConnection {
  account: WalletAccount;
  wallet: Wallet;
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

function isConnectFeature(
  value: unknown,
): value is StandardConnectFeature[typeof StandardConnect] {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).connect === "function"
  );
}

function isDisconnectFeature(
  value: unknown,
): value is StandardDisconnectFeature[typeof StandardDisconnect] {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).disconnect === "function"
  );
}

async function getConnectedAccount(wallet: Wallet): Promise<WalletAccount> {
  const existingAccount = wallet.accounts[0];
  if (existingAccount) {
    return existingAccount;
  }

  const connectFeature = wallet.features[StandardConnect];
  if (!isConnectFeature(connectFeature)) {
    throw new Error(`${wallet.name} has no connected account and cannot connect.`);
  }

  const result = await connectFeature.connect();
  const connectedAccount = result.accounts[0];
  if (!connectedAccount) {
    throw new Error(`${wallet.name} did not return an account.`);
  }
  return connectedAccount;
}

export function WalletProvider({
  children,
  cluster,
}: WalletProviderProps): ReactNode {
  const [wallets, setWallets] = useState<ReadonlyArray<Wallet>>([]);
  const [connection, setConnection] = useState<WalletConnection>();
  const wallet = connection?.wallet;
  const account = connection?.account;

  useEffect(() => {
    const walletRegistry = getWallets();
    const refreshWallets = (): void => {
      setWallets(
        walletRegistry
          .get()
          .filter(
            (registeredWallet) =>
              SolanaSignTransaction in registeredWallet.features,
          ),
      );
    };

    const unregisterRegisterListener = walletRegistry.on(
      "register",
      refreshWallets,
    );
    const unregisterUnregisterListener = walletRegistry.on(
      "unregister",
      (...unregisteredWallets) => {
        refreshWallets();
        setConnection((currentConnection) =>
          currentConnection &&
          unregisteredWallets.includes(currentConnection.wallet)
            ? undefined
            : currentConnection,
        );
      },
    );
    refreshWallets();

    return () => {
      unregisterRegisterListener();
      unregisterUnregisterListener();
    };
  }, []);

  const connect = useCallback(
    async (walletName: string): Promise<void> => {
      const selectedWallet = wallets.find(
        (availableWallet) => availableWallet.name === walletName,
      );
      if (!selectedWallet) {
        throw new Error(`Wallet "${walletName}" is not available.`);
      }

      const connectedAccount = await getConnectedAccount(selectedWallet);
      const signerAddress = createWalletSignerAdapter(
        selectedWallet,
        connectedAccount,
        cluster,
      ).createKitSigner().address;
      console.info("Connected Solana Kit signer:", signerAddress);
      setConnection({ account: connectedAccount, wallet: selectedWallet });
    },
    [cluster, wallets],
  );

  const disconnect = useCallback(async (): Promise<void> => {
    const disconnectFeature = wallet?.features[StandardDisconnect];
    try {
      if (isDisconnectFeature(disconnectFeature)) {
        await disconnectFeature.disconnect();
      }
    } finally {
      setConnection(undefined);
    }
  }, [wallet]);

  const value = useMemo<WalletContextValue>(
    () => ({ account, connect, disconnect, wallet, wallets }),
    [account, connect, disconnect, wallet, wallets],
  );

  return createElement(WalletContext.Provider, { value }, children);
}

export function useWallet(): WalletContextValue {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used inside WalletProvider.");
  }
  return context;
}
