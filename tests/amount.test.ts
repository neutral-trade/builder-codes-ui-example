import assert from "node:assert";
import { test } from "node:test";

import {
  AmountExceedsBalanceError,
  assertAmountWithinBalance,
  formatTokenAmount,
  parseTokenAmount,
} from "../src/lib/amount.ts";

test("decimal input is converted to exact minor units", () => {
  assert.equal(parseTokenAmount("123.45", 6), 123_450_000n);
  assert.equal(parseTokenAmount("0.000001", 6), 1n);
  assert.equal(parseTokenAmount(" 10 ", 6), 10_000_000n);
});

test("formatting and parsing round trip exact u64 amounts", () => {
  const edgeCases = [
    1n,
    999_999n,
    1_000_000n,
    123_450_000n,
    18_446_744_073_709_551_615n,
  ];

  for (const amountRaw of edgeCases) {
    assert.equal(
      parseTokenAmount(formatTokenAmount(amountRaw, 6), 6),
      amountRaw,
    );
  }

  for (let amountRaw = 1n; amountRaw <= 10_000n; amountRaw += 137n) {
    assert.equal(
      parseTokenAmount(formatTokenAmount(amountRaw, 6), 6),
      amountRaw,
    );
  }
});

test("formatting stays exact for the largest u64 amount", () => {
  assert.equal(
    formatTokenAmount(18_446_744_073_709_551_615n, 6),
    "18446744073709.551615",
  );
  assert.equal(formatTokenAmount(123_450_000n, 6), "123.45");
});

test("invalid or lossy decimal input is rejected", () => {
  assert.throws(() => parseTokenAmount("0", 6));
  assert.throws(() => parseTokenAmount("1.0000001", 6));
  assert.throws(() => parseTokenAmount("1e3", 6));
  assert.throws(() => parseTokenAmount("1,000", 6));
  assert.throws(() => parseTokenAmount("1".repeat(41), 6));
  assert.throws(() => parseTokenAmount("18446744073709.551616", 6));
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
