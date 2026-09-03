import assert from "node:assert";
import { test } from "node:test";

import { describeRpcError } from "../src/lib/rpc-error.ts";

test("RPC instruction errors retain bigint indices and custom codes", () => {
  assert.equal(
    describeRpcError({ InstructionError: [2n, { Custom: 6_001n }] }),
    '{"InstructionError":["2",{"Custom":"6001"}]}',
  );
});

test("plain-string RPC errors remain readable", () => {
  assert.equal(describeRpcError("InsufficientFundsForFee"), "InsufficientFundsForFee");
});
