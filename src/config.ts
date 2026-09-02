import {
  getBundleProgramId,
  getSolanaTokenDecimals,
  getVaultByAddress,
} from "@neutral-trade/sdk";
import { address as parseAddress } from "@solana/kit";

import type { SolanaCluster } from "@/lib/signer";

const DEFAULT_CLUSTER = "mainnet";
const DEFAULT_VAULT_ADDRESS = "J7qhMAKnB6G5dvoAN9281ufabajKbyGQxxd2bq6R7fPJ";
const DEFAULT_API_URLS: Record<SolanaCluster, string> = {
  devnet: "https://bundle-indexer-api-devnet-kvpc.onrender.com",
  mainnet: "https://api.neutral.trade",
};

export type Attribution =
  | { kind: "address"; address: string }
  | { kind: "code"; code: string };

export interface PublicConfig {
  attribution: Attribution;
  cluster: SolanaCluster;
  neutralApiUrl: string;
  rpcUrl: string;
  vault: {
    address: string;
    bundleProgramId: string;
    depositToken: {
      decimals: number;
      symbol: string;
    };
    name: string;
  };
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

function getOptionalValue(value: string | undefined): string | undefined {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : undefined;
}

function getCluster(value: string | undefined): SolanaCluster {
  const cluster = getOptionalValue(value) ?? DEFAULT_CLUSTER;
  if (cluster !== "mainnet" && cluster !== "devnet") {
    throw new ConfigurationError(
      `NEXT_PUBLIC_CLUSTER must be "mainnet" or "devnet"; received "${cluster}".`,
    );
  }
  return cluster;
}

function getRequiredValue(name: string, value: string | undefined): string {
  const requiredValue = getOptionalValue(value);
  if (!requiredValue) {
    throw new ConfigurationError(`${name} is required.`);
  }
  return requiredValue;
}

function validateAddress(name: string, value: string): void {
  try {
    parseAddress(value);
  } catch {
    throw new ConfigurationError(`${name} must be a valid Solana address.`);
  }
}

function validateUrl(name: string, value: string): void {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Unsupported protocol");
    }
  } catch {
    throw new ConfigurationError(`${name} must be a valid HTTP or HTTPS URL.`);
  }
}

function getAttribution(
  builderAddressValue: string | undefined,
  builderCodeValue: string | undefined,
): Attribution {
  const builderAddress = getOptionalValue(builderAddressValue);
  const builderCode = getOptionalValue(builderCodeValue);

  if (Boolean(builderAddress) === Boolean(builderCode)) {
    throw new ConfigurationError(
      "Set exactly one of NEXT_PUBLIC_BUILDER_ADDRESS or NEXT_PUBLIC_BUILDER_CODE.",
    );
  }

  if (builderAddress) {
    validateAddress("NEXT_PUBLIC_BUILDER_ADDRESS", builderAddress);
    return { kind: "address", address: builderAddress };
  }

  if (builderCode) {
    return { kind: "code", code: builderCode };
  }

  throw new ConfigurationError(
    "Set exactly one of NEXT_PUBLIC_BUILDER_ADDRESS or NEXT_PUBLIC_BUILDER_CODE.",
  );
}

function readConfig(): PublicConfig {
  const cluster = getCluster(process.env.NEXT_PUBLIC_CLUSTER);
  const vaultAddress =
    getOptionalValue(process.env.NEXT_PUBLIC_VAULT_ADDRESS) ??
    DEFAULT_VAULT_ADDRESS;
  validateAddress("NEXT_PUBLIC_VAULT_ADDRESS", vaultAddress);

  const vault = getVaultByAddress(vaultAddress, cluster);
  if (!vault) {
    throw new ConfigurationError(
      `Vault ${vaultAddress} is not in the Neutral registry for ${cluster}.`,
    );
  }
  const bundleProgramId = getBundleProgramId(vault, cluster);
  if (!bundleProgramId) {
    throw new ConfigurationError(
      `Vault ${vaultAddress} is not an ntbundle vault for ${cluster}.`,
    );
  }
  validateAddress("Resolved ntbundle program ID", bundleProgramId);

  const rpcUrl = getRequiredValue(
    "NEXT_PUBLIC_RPC_URL",
    process.env.NEXT_PUBLIC_RPC_URL,
  );
  validateUrl("NEXT_PUBLIC_RPC_URL", rpcUrl);

  const neutralApiUrl =
    getOptionalValue(process.env.NEXT_PUBLIC_NEUTRAL_API_URL) ??
    DEFAULT_API_URLS[cluster];
  validateUrl("NEXT_PUBLIC_NEUTRAL_API_URL", neutralApiUrl);

  return Object.freeze({
    attribution: getAttribution(
      process.env.NEXT_PUBLIC_BUILDER_ADDRESS,
      process.env.NEXT_PUBLIC_BUILDER_CODE,
    ),
    cluster,
    neutralApiUrl,
    rpcUrl,
    vault: {
      address: vaultAddress,
      bundleProgramId,
      depositToken: {
        decimals: getSolanaTokenDecimals(vault.depositToken),
        symbol: vault.depositToken,
      },
      name: vault.name,
    },
  });
}

export const config = readConfig();
export const attribution = config.attribution;
