import assert from "node:assert/strict";
import test from "node:test";

import {
  BUNDLE_PROGRAM_ID_V2_MAINNET,
  getRequestWithdrawalInstruction,
} from "@neutral-trade/sdk";
import {
  address,
  appendTransactionMessageInstruction,
  blockhash as parseBlockhash,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getAddressEncoder,
  getBase64Decoder,
  getBase64Encoder,
  getTransactionEncoder,
  getU64Encoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";

import { inspect, TransactionInspectionError } from "../src/lib/inspect.ts";
import { DEVNET_DEPOSIT_FIXTURE } from "./fixtures/devnet-deposit.ts";

function findBytes(haystack: Uint8Array, needle: Uint8Array): number {
  for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    if (needle.every((byte, offset) => haystack[index + offset] === byte)) {
      return index;
    }
  }
  return -1;
}

function replaceBytes(
  transactionBase64: string,
  from: Uint8Array,
  to: Uint8Array,
): string {
  assert.equal(from.length, to.length);
  const transactionBytes = new Uint8Array(
    getBase64Encoder().encode(transactionBase64),
  );
  const offset = findBytes(transactionBytes, from);
  assert.notEqual(offset, -1, "fixture must contain the target bytes");
  transactionBytes.set(to, offset);
  return getBase64Decoder().decode(transactionBytes);
}

function replaceAddress(
  transactionBase64: string,
  fromAddress: string,
  toAddress: string,
): string {
  return replaceBytes(
    transactionBase64,
    new Uint8Array(getAddressEncoder().encode(address(fromAddress))),
    new Uint8Array(getAddressEncoder().encode(address(toAddress))),
  );
}

function flipAddressByte(
  transactionBase64: string,
  addressValue: string,
): string {
  const encodedAddress = new Uint8Array(
    getAddressEncoder().encode(address(addressValue)),
  );
  const changedAddress = encodedAddress.slice();
  changedAddress[0] ^= 1;
  return replaceBytes(transactionBase64, encodedAddress, changedAddress);
}

function inspectDeposit(transactionBase64: string) {
  return inspect({
    bundleProgramId: DEVNET_DEPOSIT_FIXTURE.bundleProgramId,
    expected: {
      amountRaw: DEVNET_DEPOSIT_FIXTURE.amountRaw,
      attributionApplied: false,
      operation: "deposit",
      vaultAddress: DEVNET_DEPOSIT_FIXTURE.vaultAddress,
    },
    transactionBase64,
    userAddress: DEVNET_DEPOSIT_FIXTURE.userAddress,
  });
}

function createWithdrawalTransaction(sharesAmount: bigint): string {
  const user = address(DEVNET_DEPOSIT_FIXTURE.userAddress);
  const instruction = getRequestWithdrawalInstruction(
    {
      bundleAccount: address(DEVNET_DEPOSIT_FIXTURE.vaultAddress),
      bundleTempData: address(
        "4Qzddh5jpArRfTM24UUPy4mitVczyGfNSr3SXfZgcwjV",
      ),
      oracleData: address("7qNsifnwV3vifnCZVLmtkG7VopztVPCFQQVKQWb2bXyW"),
      sharesAmount,
      user: createNoopSigner(user),
      userBundleAccount: address(
        "HQTJaogndXuu99WLMFtsBQNp5hrHA4dvTinGNax39tbP",
      ),
    },
    { programAddress: address(DEVNET_DEPOSIT_FIXTURE.bundleProgramId) },
  );
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (transactionMessage) =>
      setTransactionMessageFeePayer(user, transactionMessage),
    (transactionMessage) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: parseBlockhash(DEVNET_DEPOSIT_FIXTURE.blockhash),
          lastValidBlockHeight: 1n,
        },
        transactionMessage,
      ),
    (transactionMessage) =>
      appendTransactionMessageInstruction(instruction, transactionMessage),
  );
  return getBase64Decoder().decode(
    new Uint8Array(getTransactionEncoder().encode(compileTransaction(message))),
  );
}

test("inspect accepts a captured unsigned devnet deposit", () => {
  const result = inspectDeposit(DEVNET_DEPOSIT_FIXTURE.transactionBase64);

  assert.equal(result.blockhash, DEVNET_DEPOSIT_FIXTURE.blockhash);
  assert.deepEqual(
    result.instructions.map(({ accountCount, name, program }) => ({
      accountCount,
      name,
      program,
    })),
    [
      {
        accountCount: 0,
        name: "computeBudget",
        program: "ComputeBudget111111111111111111111111111111",
      },
      {
        accountCount: 12,
        name: "requestDeposit",
        program: DEVNET_DEPOSIT_FIXTURE.bundleProgramId,
      },
    ],
  );
});

test("inspect accepts the configured non-default bundle program", () => {
  const transactionBase64 = replaceAddress(
    DEVNET_DEPOSIT_FIXTURE.transactionBase64,
    DEVNET_DEPOSIT_FIXTURE.bundleProgramId,
    BUNDLE_PROGRAM_ID_V2_MAINNET,
  );

  const result = inspect({
    bundleProgramId: BUNDLE_PROGRAM_ID_V2_MAINNET,
    expected: {
      amountRaw: DEVNET_DEPOSIT_FIXTURE.amountRaw,
      attributionApplied: false,
      operation: "deposit",
      vaultAddress: DEVNET_DEPOSIT_FIXTURE.vaultAddress,
    },
    transactionBase64,
    userAddress: DEVNET_DEPOSIT_FIXTURE.userAddress,
  });

  assert.equal(result.instructions[1]?.program, BUNDLE_PROGRAM_ID_V2_MAINNET);
});

test("inspect rejects a transaction whose fee payer byte was changed", () => {
  const transactionBase64 = flipAddressByte(
    DEVNET_DEPOSIT_FIXTURE.transactionBase64,
    DEVNET_DEPOSIT_FIXTURE.userAddress,
  );

  assert.throws(
    () => inspectDeposit(transactionBase64),
    (error: unknown) =>
      error instanceof TransactionInspectionError &&
      error.code === "invalid-fee-payer",
  );
});

test("inspect rejects a one-byte change to the configured bundle program", () => {
  const transactionBase64 = flipAddressByte(
    DEVNET_DEPOSIT_FIXTURE.transactionBase64,
    DEVNET_DEPOSIT_FIXTURE.bundleProgramId,
  );

  assert.throws(
    () => inspectDeposit(transactionBase64),
    (error: unknown) =>
      error instanceof TransactionInspectionError &&
      error.code === "invalid-instruction",
  );
});

test("inspect rejects a different connected wallet", () => {
  assert.throws(
    () =>
      inspect({
        bundleProgramId: DEVNET_DEPOSIT_FIXTURE.bundleProgramId,
        expected: {
          amountRaw: DEVNET_DEPOSIT_FIXTURE.amountRaw,
          attributionApplied: false,
          operation: "deposit",
          vaultAddress: DEVNET_DEPOSIT_FIXTURE.vaultAddress,
        },
        transactionBase64: DEVNET_DEPOSIT_FIXTURE.transactionBase64,
        userAddress: "GgBaCs3NpeEJ7YhVtQzE9rqwG5azSMPmNJydJVJs2e92",
      }),
    (error: unknown) =>
      error instanceof TransactionInspectionError &&
      error.code === "invalid-fee-payer",
  );
});

test("inspect rejects a changed deposit amount", () => {
  const encodedAmount = new Uint8Array(
    getU64Encoder().encode(BigInt(DEVNET_DEPOSIT_FIXTURE.amountRaw)),
  );
  const changedAmount = encodedAmount.slice();
  changedAmount[0] ^= 1;
  const transactionBase64 = replaceBytes(
    DEVNET_DEPOSIT_FIXTURE.transactionBase64,
    encodedAmount,
    changedAmount,
  );

  assert.throws(
    () => inspectDeposit(transactionBase64),
    (error: unknown) =>
      error instanceof TransactionInspectionError &&
      error.code === "amount-mismatch",
  );
});

test("inspect rejects a changed deposit vault", () => {
  const transactionBase64 = replaceAddress(
    DEVNET_DEPOSIT_FIXTURE.transactionBase64,
    DEVNET_DEPOSIT_FIXTURE.vaultAddress,
    "2bPiNfJEGjJ97WBUCV7eBzY8QZ8FpA7uQnPzKqQd2QWq",
  );

  assert.throws(
    () => inspectDeposit(transactionBase64),
    (error: unknown) =>
      error instanceof TransactionInspectionError &&
      error.code === "vault-mismatch",
  );
});

test("inspect decodes and accepts the requested withdrawal shares", () => {
  const sharesAmount = 100_000_000n;
  const result = inspect({
    bundleProgramId: DEVNET_DEPOSIT_FIXTURE.bundleProgramId,
    expected: {
      operation: "withdraw",
      sharesAmount,
      vaultAddress: DEVNET_DEPOSIT_FIXTURE.vaultAddress,
    },
    transactionBase64: createWithdrawalTransaction(sharesAmount),
    userAddress: DEVNET_DEPOSIT_FIXTURE.userAddress,
  });

  assert.equal(result.instructions.at(-1)?.name, "requestWithdrawal");
});

test("inspect rejects changed withdrawal shares", () => {
  const sharesAmount = 100_000_000n;

  assert.throws(
    () =>
      inspect({
        bundleProgramId: DEVNET_DEPOSIT_FIXTURE.bundleProgramId,
        expected: {
          operation: "withdraw",
          sharesAmount,
          vaultAddress: DEVNET_DEPOSIT_FIXTURE.vaultAddress,
        },
        transactionBase64: createWithdrawalTransaction(sharesAmount + 1n),
        userAddress: DEVNET_DEPOSIT_FIXTURE.userAddress,
      }),
    (error: unknown) =>
      error instanceof TransactionInspectionError &&
      error.code === "amount-mismatch",
  );
});
