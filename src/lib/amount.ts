const MAX_U64 = (1n << 64n) - 1n;
const MAX_TOKEN_DECIMALS = 18;

export class TokenAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenAmountError";
  }
}

function assertDecimals(decimals: number): void {
  if (
    !Number.isSafeInteger(decimals) ||
    decimals < 0 ||
    decimals > MAX_TOKEN_DECIMALS
  ) {
    throw new TokenAmountError(
      `Token decimals must be an integer from 0 to ${MAX_TOKEN_DECIMALS}.`,
    );
  }
}

/** Convert a token-unit decimal string to raw units without a floating-point step. */
export function parseTokenAmount(value: string, decimals: number): bigint {
  assertDecimals(decimals);

  const normalizedValue = value.trim();
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(normalizedValue);
  if (!match) {
    throw new TokenAmountError(
      "Enter a non-negative decimal amount without commas or exponent notation.",
    );
  }

  const wholePart = match[1];
  const fractionalPart = match[2] ?? "";
  if (fractionalPart.length > decimals) {
    throw new TokenAmountError(
      `This asset supports at most ${decimals} decimal place${decimals === 1 ? "" : "s"}.`,
    );
  }

  const scale = 10n ** BigInt(decimals);
  const paddedFractionalPart = fractionalPart.padEnd(decimals, "0");
  const rawAmount =
    BigInt(wholePart) * scale +
    (paddedFractionalPart ? BigInt(paddedFractionalPart) : 0n);

  if (rawAmount > MAX_U64) {
    throw new TokenAmountError("The amount exceeds the maximum supported raw value.");
  }

  return rawAmount;
}

/** Render raw token units as an exact token-unit decimal string. */
export function formatRawAmount(
  value: bigint | string,
  decimals: number,
): string {
  assertDecimals(decimals);

  const rawAmount =
    typeof value === "bigint"
      ? value
      : /^(?:0|[1-9]\d*)$/.test(value)
        ? BigInt(value)
        : undefined;
  if (rawAmount === undefined || rawAmount < 0n) {
    throw new TokenAmountError("Raw amount must be a canonical unsigned integer.");
  }

  if (decimals === 0) {
    return rawAmount.toString();
  }

  const scale = 10n ** BigInt(decimals);
  const wholePart = rawAmount / scale;
  const fractionalPart = (rawAmount % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");

  return fractionalPart
    ? `${wholePart.toString()}.${fractionalPart}`
    : wholePart.toString();
}

