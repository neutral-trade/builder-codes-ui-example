import assert from "node:assert/strict";
import test from "node:test";

import {
  AmountExceedsBalanceError,
  assertAmountWithinBalance,
  formatRawAmount,
  parsePositiveTokenAmount,
  parseTokenAmount,
  TokenAmountError,
} from "../src/lib/amount.ts";

test("parseTokenAmount converts token units without floating point", () => {
  assert.equal(parseTokenAmount("5", 6), 5_000_000n);
  assert.equal(parseTokenAmount("0.000001", 6), 1n);
  assert.equal(parseTokenAmount("12.34", 6), 12_340_000n);
  assert.equal(parseTokenAmount(" 1.25 ", 6), 1_250_000n);
});

test("parseTokenAmount rejects lossy or non-decimal values", () => {
  for (const value of [
    "1.0000001",
    "1e6",
    "1,000",
    "-1",
    ".5",
    "01",
    "1".repeat(41),
  ]) {
    assert.throws(() => parseTokenAmount(value, 6), TokenAmountError);
  }
});

test("positive amounts reject zero after exact decimal parsing", () => {
  assert.equal(parseTokenAmount("0", 6), 0n);
  assert.throws(() => parsePositiveTokenAmount("0", 6), TokenAmountError);
  assert.equal(parsePositiveTokenAmount("0.000001", 6), 1n);
});

test("parseTokenAmount rejects values outside the API u64 range", () => {
  assert.equal(parseTokenAmount("18446744073709551615", 0), (1n << 64n) - 1n);
  assert.throws(
    () => parseTokenAmount("18446744073709551616", 0),
    /maximum supported raw value/,
  );
});

test("formatRawAmount renders exact token units", () => {
  assert.equal(formatRawAmount("12340000", 6), "12.34");
  assert.equal(formatRawAmount(1n, 6), "0.000001");
  assert.equal(formatRawAmount(5_000_000n, 6), "5");
  assert.equal(formatRawAmount(42n, 0), "42");
});

test("formatting and parsing round trip exact u64 amounts", () => {
  const edgeCases: Array<bigint> = [
    1n,
    999_999n,
    1_000_000n,
    123_450_000n,
    18_446_744_073_709_551_615n,
  ];

  for (const amountRaw of edgeCases) {
    assert.equal(
      parseTokenAmount(formatRawAmount(amountRaw, 6), 6),
      amountRaw,
    );
  }

  for (let amountRaw = 1n; amountRaw <= 10_000n; amountRaw += 137n) {
    assert.equal(
      parseTokenAmount(formatRawAmount(amountRaw, 6), 6),
      amountRaw,
    );
  }
});

test("withdrawal amounts may equal but never exceed the available balance", () => {
  assert.doesNotThrow(() => assertAmountWithinBalance(999n, 1_000n));
  assert.doesNotThrow(() => assertAmountWithinBalance(1_000n, 1_000n));
  assert.throws(
    () => assertAmountWithinBalance(1_001n, 1_000n),
    (error: unknown) =>
      error instanceof AmountExceedsBalanceError &&
      error.availableBalanceRaw === 1_000n,
  );
});
