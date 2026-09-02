const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});

const PERCENT_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  style: "percent",
});

function groupInteger(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatRaw(
  raw: string | bigint,
  decimals: number,
  maxFraction = 2,
): string {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new RangeError("decimals must be a non-negative integer");
  }
  if (!Number.isInteger(maxFraction) || maxFraction < 0) {
    throw new RangeError("maxFraction must be a non-negative integer");
  }

  const amount = typeof raw === "bigint" ? raw : BigInt(raw);
  const isNegative = amount < 0n;
  const absoluteAmount = isNegative ? -amount : amount;
  const scale = 10n ** BigInt(decimals);
  let whole = absoluteAmount / scale;
  const fraction = absoluteAmount % scale;
  const visibleDigits = Math.min(decimals, maxFraction);
  let visibleFraction = fraction;

  if (visibleDigits < decimals) {
    const hiddenScale = 10n ** BigInt(decimals - visibleDigits);
    visibleFraction = fraction / hiddenScale;
    if ((fraction % hiddenScale) * 2n >= hiddenScale) {
      visibleFraction += 1n;
    }

    const visibleScale = 10n ** BigInt(visibleDigits);
    if (visibleFraction === visibleScale) {
      whole += 1n;
      visibleFraction = 0n;
    }
  }

  const sign = isNegative && (whole !== 0n || visibleFraction !== 0n) ? "-" : "";
  const fractionText = visibleFraction
    .toString()
    .padStart(visibleDigits, "0")
    .replace(/0+$/, "");

  return `${sign}${groupInteger(whole)}${fractionText ? `.${fractionText}` : ""}`;
}

export function formatUsd(value: number | null): string {
  return value === null ? "—" : USD_FORMATTER.format(value);
}

export function formatBps(bps: number): string {
  return PERCENT_FORMATTER.format(bps / 10_000);
}

export function formatRate(fraction: number | null): string {
  return fraction === null ? "—" : PERCENT_FORMATTER.format(fraction);
}
