import { assertValidAmountRaw } from "@neutral-trade/sdk";

const MAX_TOKEN_DECIMALS = 18;

export class AmountInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmountInputError";
  }
}

export class AmountExceedsBalanceError extends AmountInputError {
  readonly availableBalanceRaw: bigint;

  constructor(availableBalanceRaw: bigint) {
    super("Amount exceeds the current withdrawable balance.");
    this.name = "AmountExceedsBalanceError";
    this.availableBalanceRaw = availableBalanceRaw;
  }
}

export function assertAmountWithinBalance(
  amountRaw: bigint,
  availableBalanceRaw: bigint,
): void {
  if (amountRaw > availableBalanceRaw) {
    throw new AmountExceedsBalanceError(availableBalanceRaw);
  }
}

function assertDecimals(decimals: number): void {
  if (
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > MAX_TOKEN_DECIMALS
  ) {
    throw new AmountInputError("Token decimals must be an integer from 0 to 18.");
  }
}

export function parseTokenAmount(value: string, decimals: number): bigint {
  assertDecimals(decimals);

  const trimmedValue = value.trim();
  if (trimmedValue.length > 40) {
    throw new AmountInputError("Amount is too long.");
  }
  const match = /^(\d+)(?:\.(\d+))?$/.exec(trimmedValue);
  if (!match) {
    throw new AmountInputError(
      "Enter a positive decimal amount without commas or exponent notation.",
    );
  }

  const wholePart = match[1];
  const fractionPart = match[2] ?? "";
  if (fractionPart.length > decimals) {
    throw new AmountInputError(
      `Enter no more than ${decimals} decimal places.`,
    );
  }

  const scale = 10n ** BigInt(decimals);
  const paddedFraction = fractionPart.padEnd(decimals, "0");
  const amountRaw = BigInt(wholePart) * scale + BigInt(paddedFraction || "0");

  try {
    assertValidAmountRaw(amountRaw);
  } catch {
    throw new AmountInputError(
      "Amount must be greater than zero and fit in an unsigned 64-bit integer.",
    );
  }

  return amountRaw;
}

export function formatTokenAmount(
  amountRaw: bigint,
  decimals: number,
  maxFractionDigits = decimals,
): string {
  assertDecimals(decimals);
  if (!Number.isInteger(maxFractionDigits) || maxFractionDigits < 0) {
    throw new AmountInputError(
      "Maximum fraction digits must be a non-negative integer.",
    );
  }

  const sign = amountRaw < 0n ? "-" : "";
  const absoluteAmount = amountRaw < 0n ? -amountRaw : amountRaw;
  const scale = 10n ** BigInt(decimals);
  const wholePart = absoluteAmount / scale;
  const visibleFractionDigits = Math.min(decimals, maxFractionDigits);

  if (visibleFractionDigits === 0) {
    return `${sign}${wholePart}`;
  }

  const fractionPart = (absoluteAmount % scale)
    .toString()
    .padStart(decimals, "0")
    .slice(0, visibleFractionDigits)
    .replace(/0+$/, "");

  return fractionPart
    ? `${sign}${wholePart}.${fractionPart}`
    : `${sign}${wholePart}`;
}
