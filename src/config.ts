import {
  getBundleProgramId,
  getSolanaTokenDecimals,
  getVaultByAddress,
} from "@neutral-trade/sdk";
import { address as parseAddress } from "@solana/kit";

import {
  ConfigurationError,
  getConfiguredCluster,
  getConfiguredVaultAddress,
  getDefaultNeutralApiUrl,
} from "@/lib/neutral-config";
import type { SolanaCluster } from "@/lib/signer";

export { ConfigurationError } from "@/lib/neutral-config";

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

function getOptionalValue(value: string | undefined): string | undefined {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : undefined;
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

export function readConfig(): PublicConfig {
  const cluster = getConfiguredCluster();
  const vaultAddress = getConfiguredVaultAddress(cluster);

  const vault = getVaultByAddress(vaultAddress, cluster);
  // getConfiguredVaultAddress already verifies this registry lookup.
  if (!vault) throw new ConfigurationError("Configured vault is unavailable.");

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
    getDefaultNeutralApiUrl(cluster);
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
