import { getVaultByAddress } from "@neutral-trade/sdk";
import { address as parseAddress } from "@solana/kit";

import type { SolanaCluster } from "@/lib/signer";

const DEFAULT_CLUSTER = "mainnet";
const DEFAULT_VAULT_ADDRESS = "J7qhMAKnB6G5dvoAN9281ufabajKbyGQxxd2bq6R7fPJ";
const DEFAULT_API_URLS: Record<SolanaCluster, string> = {
  devnet: "https://bundle-indexer-api-devnet-kvpc.onrender.com",
  mainnet: "https://api.neutral.trade",
};

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export function getConfiguredCluster(): SolanaCluster {
  const cluster = process.env.NEXT_PUBLIC_CLUSTER?.trim() || DEFAULT_CLUSTER;
  if (cluster !== "mainnet" && cluster !== "devnet") {
    throw new ConfigurationError(
      `NEXT_PUBLIC_CLUSTER must be "mainnet" or "devnet"; received "${cluster}".`,
    );
  }
  return cluster;
}

export function getConfiguredVaultAddress(
  cluster = getConfiguredCluster(),
): string {
  const vaultAddress =
    process.env.NEXT_PUBLIC_VAULT_ADDRESS?.trim() || DEFAULT_VAULT_ADDRESS;

  try {
    parseAddress(vaultAddress);
  } catch {
    throw new ConfigurationError(
      "NEXT_PUBLIC_VAULT_ADDRESS must be a valid Solana address.",
    );
  }

  if (!getVaultByAddress(vaultAddress, cluster)) {
    throw new ConfigurationError(
      `Vault ${vaultAddress} is not in the Neutral registry for ${cluster}.`,
    );
  }
  return vaultAddress;
}

export function getDefaultNeutralApiUrl(cluster: SolanaCluster): string {
  return DEFAULT_API_URLS[cluster];
}
