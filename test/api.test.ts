import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDepositTx,
  buildWithdrawTx,
  TransactionBuilderApiError,
} from "../src/lib/api.ts";

const ENDPOINT = {
  apiBaseUrl: "https://api.example.test/",
  vault: "8TqrZmyiWQ3F3WysiBaBQC1Nzj1LDn5AR7JjXBYzFxxQ",
};

const USER_ADDRESS = "GgBaCs3NpeEJ7YhVtQzE9rqwG5azSMPmNJydJVJs2e92";
const REFERRER = "EpZtPfeiyT7avVCuKfucUCj4Kaj81sF87aeLKNPghGvh";

function acceptedResponse(extraData: Record<string, unknown> = {}): Response {
  return Response.json({
    data: {
      ...extraData,
      validation: { accepted: true, rejectionReasons: [] },
    },
    success: true,
  });
}

test("buildDepositTx sends strict attribution without browser credentials or an API key", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  let capturedInput: RequestInfo | URL | undefined;
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    capturedInput = input;
    capturedInit = init;
    return acceptedResponse();
  };

  await buildDepositTx(
    {
      amountRaw: 1_250_000n,
      attribution: { address: REFERRER, kind: "address" },
      requireAttribution: true,
      userAddress: USER_ADDRESS,
    },
    ENDPOINT,
  );

  assert.equal(
    capturedInput,
    `https://api.example.test/v2/vault/${ENDPOINT.vault}/tx/deposit`,
  );
  assert.equal(capturedInit?.credentials, "omit");
  assert.deepEqual(capturedInit?.headers, {
    accept: "application/json",
    "content-type": "application/json",
  });
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
    amountRaw: "1250000",
    referrer: REFERRER,
    requireAttribution: true,
    userAddress: USER_ADDRESS,
  });
});

test("an explicitly unattributed rebuild omits attribution fields and the strict flag", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  let capturedBody: unknown;
  globalThis.fetch = async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body));
    return acceptedResponse();
  };

  await buildDepositTx(
    {
      amountRaw: "5000000",
      requireAttribution: false,
      userAddress: USER_ADDRESS,
    },
    ENDPOINT,
  );

  assert.deepEqual(capturedBody, {
    amountRaw: "5000000",
    userAddress: USER_ADDRESS,
  });
});

test("buildWithdrawTx sends withdrawAll without an amount", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  let capturedBody: unknown;
  globalThis.fetch = async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body));
    return acceptedResponse({ sharesAmount: "42" });
  };

  await buildWithdrawTx(
    { userAddress: USER_ADDRESS, withdrawAll: true },
    ENDPOINT,
  );

  assert.deepEqual(capturedBody, {
    userAddress: USER_ADDRESS,
    withdrawAll: true,
  });
});

test("non-2xx errors retain status, code, logs, and Retry-After", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () =>
    Response.json(
      {
        code: "SIMULATION_FAILED",
        logs: ["Program log: failure"],
        message: "Transaction preflight simulation failed",
        success: false,
      },
      { headers: { "retry-after": "17" }, status: 429 },
    );

  await assert.rejects(
    buildWithdrawTx(
      { amountRaw: "1000000", userAddress: USER_ADDRESS },
      ENDPOINT,
    ),
    (error: unknown) => {
      assert.ok(error instanceof TransactionBuilderApiError);
      assert.equal(error.status, 429);
      assert.equal(error.code, "SIMULATION_FAILED");
      assert.deepEqual(error.logs, ["Program log: failure"]);
      assert.equal(error.retryAfterSeconds, 17);
      return true;
    },
  );
});

test("a malformed success envelope is rejected", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () =>
    Response.json({ data: {}, success: true }, { status: 200 });

  await assert.rejects(
    buildDepositTx(
      {
        amountRaw: "1000000",
        attribution: { code: "NEUTRAL", kind: "code" },
        requireAttribution: true,
        userAddress: USER_ADDRESS,
      },
      ENDPOINT,
    ),
    (error: unknown) =>
      error instanceof TransactionBuilderApiError &&
      error.code === "INVALID_API_RESPONSE",
  );
});
