import assert from "node:assert/strict";
import test from "node:test";

import { formatBps, formatRate, formatRaw, formatUsd } from "./format.js";

test("formatRaw keeps token amounts lossless above Number.MAX_SAFE_INTEGER", () => {
  assert.equal(formatRaw("123450000", 6), "123.45");
  assert.equal(
    formatRaw("18446744073709551615", 6),
    "18,446,744,073,709.55",
  );
  assert.equal(formatRaw("-1500001", 6), "-1.5");
});

test("formatRaw rounds using integer arithmetic", () => {
  assert.equal(formatRaw("999999", 6), "1");
  assert.equal(formatRaw("1499", 3, 2), "1.5");
});

test("nullable prices and rates remain unavailable instead of becoming zero", () => {
  assert.equal(formatUsd(null), "—");
  assert.equal(formatUsd(0), "$0.00");
  assert.equal(formatRate(null), "—");
  assert.equal(formatBps(100), "1%");
});
