import type { WalletStandardSigner } from "@neutral-trade/widget-sdk";
import type { SolanaSignTransactionFeature } from "@solana/wallet-standard-features";
import type {
  Transaction,
  TransactionModifyingSigner,
  TransactionWithinSizeLimit,
  TransactionWithLifetime,
} from "@solana/kit";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { createWalletStandardSigner } from "@neutral-trade/widget-sdk";
import { SolanaSignTransaction } from "@solana/wallet-standard-features";
import {
  address,
  assertIsTransactionWithinSizeLimit,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  getTransactionEncoder,
} from "@solana/kit";

export type SolanaCluster = "mainnet" | "devnet";

type SignTransactionFeature =
  SolanaSignTransactionFeature[typeof SolanaSignTransaction];

export interface WalletSignerAdapter {
  createKitSigner(): TransactionModifyingSigner;
  createWidgetSigner(): WalletStandardSigner;
  signWireTransaction(bytes: Uint8Array): Promise<Uint8Array>;
}

function publicKeysEqual(
  firstPublicKey: WalletAccount["publicKey"],
  secondPublicKey: WalletAccount["publicKey"],
): boolean {
  return (
    firstPublicKey.length === secondPublicKey.length &&
    firstPublicKey.every(
      (value, index) => value === secondPublicKey[index],
    )
  );
}

function findConnectedAccount(
  wallet: Wallet,
  account: WalletAccount,
): WalletAccount | undefined {
  return wallet.accounts.find(
    (connectedAccount) =>
      connectedAccount.address === account.address &&
      publicKeysEqual(connectedAccount.publicKey, account.publicKey),
  );
}

function getSignTransactionFeature(wallet: Wallet): SignTransactionFeature {
  const feature = wallet.features[SolanaSignTransaction];
  if (typeof feature !== "object" || feature === null) {
    throw new Error(`${wallet.name} does not support ${SolanaSignTransaction}.`);
  }

  const candidate = feature as Record<string, unknown>;
  if (
    candidate.version !== "1.0.0" ||
    typeof candidate.signTransaction !== "function" ||
    !Array.isArray(candidate.supportedTransactionVersions)
  ) {
    throw new Error(
      `${wallet.name} exposes an incompatible ${SolanaSignTransaction} feature.`,
    );
  }

  return feature as SignTransactionFeature;
}

export function createWalletSignerAdapter(
  wallet: Wallet,
  account: WalletAccount,
  cluster: SolanaCluster,
): WalletSignerAdapter {
  const chain = cluster === "devnet" ? "solana:devnet" : "solana:mainnet";

  async function signWireTransaction(bytes: Uint8Array): Promise<Uint8Array> {
    const feature = getSignTransactionFeature(wallet);
    const connectedAccount = findConnectedAccount(wallet, account);

    if (!connectedAccount) {
      throw new Error(
        `Account ${account.address} is not connected to ${wallet.name}.`,
      );
    }
    if (!connectedAccount.features.includes(SolanaSignTransaction)) {
      throw new Error(
        `Account ${connectedAccount.address} cannot sign Solana transactions.`,
      );
    }
    if (!connectedAccount.chains.includes(chain)) {
      throw new Error(
        `Account ${connectedAccount.address} does not support ${chain}.`,
      );
    }

    const transaction = getTransactionDecoder().decode(bytes);
    const transactionMessage = getCompiledTransactionMessageDecoder().decode(
      transaction.messageBytes,
    );
    if (
      transactionMessage.version !== "legacy" &&
      transactionMessage.version !== 0
    ) {
      throw new Error(
        `${wallet.name} cannot sign transaction version ${transactionMessage.version}.`,
      );
    }
    if (
      !feature.supportedTransactionVersions.includes(transactionMessage.version)
    ) {
      throw new Error(
        `${wallet.name} does not support transaction version ${transactionMessage.version}.`,
      );
    }

    const outputs = await feature.signTransaction({
      account: connectedAccount,
      chain,
      transaction: bytes.slice(),
    });
    const signedTransaction = outputs[0]?.signedTransaction;
    if (
      outputs.length !== 1 ||
      !(signedTransaction instanceof Uint8Array)
    ) {
      throw new Error(`${wallet.name} returned an invalid signed transaction.`);
    }

    return signedTransaction.slice();
  }

  function createKitSigner(): TransactionModifyingSigner {
    return Object.freeze({
      address: address(account.address),
      async modifyAndSignTransactions(transactions) {
        const signedTransactions: Array<
          Transaction & TransactionWithinSizeLimit & TransactionWithLifetime
        > = [];

        for (const transaction of transactions) {
          if (!("lifetimeConstraint" in transaction)) {
            throw new Error(
              "Cannot sign a transaction without a lifetime constraint.",
            );
          }

          const wireTransaction = new Uint8Array(
            getTransactionEncoder().encode(transaction),
          );
          const signedWireTransaction =
            await signWireTransaction(wireTransaction);
          const decodedTransaction = getTransactionDecoder().decode(
            signedWireTransaction,
          );
          const transactionWithLifetime: Transaction & TransactionWithLifetime = {
            ...decodedTransaction,
            lifetimeConstraint: transaction.lifetimeConstraint,
          };
          assertIsTransactionWithinSizeLimit(transactionWithLifetime);
          signedTransactions.push(transactionWithLifetime);
        }

        return signedTransactions;
      },
    });
  }

  function createWidgetSigner(): WalletStandardSigner {
    return createWalletStandardSigner(wallet, account);
  }

  return Object.freeze({
    createKitSigner,
    createWidgetSigner,
    signWireTransaction,
  });
}
