import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  INITIALIZE_BUNDLE_DEPOSITOR_DISCRIMINATOR,
  REQUEST_DEPOSIT_DISCRIMINATOR,
  REQUEST_WITHDRAWAL_DISCRIMINATOR,
  SET_USER_REFERRER_DISCRIMINATOR,
  TOKEN_PROGRAM_ADDRESS,
  getInitializeBundleDepositorInstructionDataDecoder,
  getRequestDepositInstructionDataDecoder,
  getRequestWithdrawalInstructionDataDecoder,
  getSetUserReferrerInstructionDataDecoder,
} from "@neutral-trade/sdk";
import {
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from "@solana/kit";

const COMPUTE_BUDGET_PROGRAM =
  "ComputeBudget111111111111111111111111111111";
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const RENT_SYSVAR = "SysvarRent111111111111111111111111111111111";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";

export type ExpectedTransactionOperation =
  | {
      amountRaw: bigint | string;
      attributionApplied: boolean;
      operation: "deposit";
      vaultAddress: string;
    }
  | {
      operation: "withdraw";
      sharesAmount: bigint | string;
      vaultAddress: string;
    };

export type TransactionInspectionErrorCode =
  | "address-lookup-table"
  | "amount-mismatch"
  | "invalid-fee-payer"
  | "invalid-instruction"
  | "invalid-signature-slot"
  | "invalid-transaction"
  | "operation-mismatch"
  | "unsupported-transaction-version"
  | "vault-mismatch";

export class TransactionInspectionError extends Error {
  readonly code: TransactionInspectionErrorCode;

  constructor(code: TransactionInspectionErrorCode, message: string) {
    super(message);
    this.name = "TransactionInspectionError";
    this.code = code;
  }
}

export interface InspectedInstruction {
  accountCount: number;
  name: string;
  program: string;
}

export interface InspectedTransaction {
  blockhash: string;
  instructions: ReadonlyArray<InspectedInstruction>;
  wireBytes: Uint8Array;
}

type CompiledTransactionMessage = ReturnType<
  ReturnType<typeof getCompiledTransactionMessageDecoder>["decode"]
>;
type InstructionData = Parameters<
  ReturnType<typeof getRequestDepositInstructionDataDecoder>["decode"]
>[0];

interface DecodedInstruction {
  accounts: ReadonlyArray<string>;
  data: InstructionData;
  program: string;
}

function fail(
  code: TransactionInspectionErrorCode,
  message: string,
): never {
  throw new TransactionInspectionError(code, message);
}

function bytesEqual(
  left: InstructionData,
  right: InstructionData,
): boolean {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  );
}

function assertInstructionShape(
  instruction: DecodedInstruction,
  accountCount: number,
  dataLength: number,
  discriminator: InstructionData,
  name: string,
): void {
  if (
    instruction.accounts.length !== accountCount ||
    instruction.data.length !== dataLength ||
    !bytesEqual(instruction.data.subarray(0, discriminator.length), discriminator)
  ) {
    fail(
      "invalid-instruction",
      `${name} must contain ${accountCount} accounts and ${dataLength} data bytes.`,
    );
  }
}

function assertAccount(
  instruction: DecodedInstruction,
  index: number,
  expected: string,
  code: TransactionInspectionErrorCode,
  label: string,
): void {
  const received = instruction.accounts[index];
  if (received !== expected) {
    fail(code, `${label} must be ${expected}; received ${received ?? "none"}.`);
  }
}

function assertExactSequence(
  observed: ReadonlyArray<string>,
  expected: ReadonlyArray<string>,
  operation: ExpectedTransactionOperation["operation"],
): void {
  if (
    observed.length !== expected.length ||
    observed.some((name, index) => name !== expected[index])
  ) {
    fail(
      "operation-mismatch",
      `Transaction instruction sequence does not match a ${operation}.`,
    );
  }
}

export function inspect(input: {
  bundleProgramId: string;
  expected: ExpectedTransactionOperation;
  transactionBase64: string;
  userAddress: string;
}): InspectedTransaction {
  let wireBytes: Uint8Array;
  let transaction: ReturnType<ReturnType<typeof getTransactionDecoder>["decode"]>;
  let message: CompiledTransactionMessage;

  try {
    wireBytes = new Uint8Array(
      getBase64Encoder().encode(input.transactionBase64),
    );
    transaction = getTransactionDecoder().decode(wireBytes);
    message = getCompiledTransactionMessageDecoder().decode(
      transaction.messageBytes,
    );
  } catch {
    fail(
      "invalid-transaction",
      "The builder returned transaction bytes that could not be decoded.",
    );
  }

  if (message.version !== 0) {
    fail(
      "unsupported-transaction-version",
      `Expected a v0 transaction; received ${message.version}.`,
    );
  }

  if ((message.addressTableLookups?.length ?? 0) > 0) {
    fail(
      "address-lookup-table",
      "Address-lookup-table transactions are not accepted by this example.",
    );
  }

  const feePayer = message.staticAccounts[0];
  if (feePayer !== input.userAddress) {
    fail(
      "invalid-fee-payer",
      `Transaction fee payer must be the connected wallet; received ${feePayer ?? "none"}.`,
    );
  }

  const signatureEntries = Object.entries(transaction.signatures);
  if (
    message.header.numSignerAccounts !== 1 ||
    signatureEntries.length !== 1 ||
    signatureEntries[0]?.[0] !== input.userAddress ||
    signatureEntries[0]?.[1] !== null
  ) {
    fail(
      "invalid-signature-slot",
      "The unsigned transaction must have one zero-filled signature slot for the connected wallet.",
    );
  }

  if (new Set(message.staticAccounts).size !== message.staticAccounts.length) {
    fail("invalid-transaction", "Static transaction accounts must be unique.");
  }

  const allowedPrograms = new Set([
    COMPUTE_BUDGET_PROGRAM,
    ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    MEMO_PROGRAM,
    input.bundleProgramId,
  ]);
  const decodedInstructions: Array<DecodedInstruction> = message.instructions.map(
    (instruction, instructionIndex) => {
      const program = message.staticAccounts[instruction.programAddressIndex];
      if (!program || !allowedPrograms.has(program)) {
        fail(
          "invalid-instruction",
          `Instruction ${instructionIndex + 1} invokes a program that is not permitted: ${program ?? "unknown"}.`,
        );
      }

      const accounts = Array.from(
        instruction.accountIndices ?? [],
        (accountIndex) => {
          const account = message.staticAccounts[accountIndex];
          if (!account) {
            fail(
              "invalid-transaction",
              `Instruction ${instructionIndex + 1} references a missing account.`,
            );
          }
          return account;
        },
      );
      return {
        accounts: Object.freeze(accounts),
        data: instruction.data ?? new Uint8Array(),
        program,
      };
    },
  );

  const operationInstructions: Array<string> = [];
  const inspectedInstructions: Array<InspectedInstruction> = [];
  let operationStarted = false;
  let observedAmount: bigint | undefined;
  let observedAttribution = false;
  let observedSharesAmount: bigint | undefined;

  decodedInstructions.forEach((instruction, instructionIndex) => {
    let name: string;

    if (instruction.program === COMPUTE_BUDGET_PROGRAM) {
      if (operationStarted) {
        fail(
          "invalid-instruction",
          "Compute budget instructions must precede operation instructions.",
        );
      }
      name = "computeBudget";
    } else if (instruction.program === MEMO_PROGRAM) {
      operationStarted = true;
      name = "memo";
    } else if (instruction.program === ASSOCIATED_TOKEN_PROGRAM_ADDRESS) {
      operationStarted = true;
      if (input.expected.operation !== "withdraw") {
        fail(
          "operation-mismatch",
          "Associated token account creation is allowed only for withdrawals.",
        );
      }
      if (
        instruction.accounts.length !== 6 ||
        instruction.data.length !== 1 ||
        instruction.data[0] !== 1
      ) {
        fail(
          "invalid-instruction",
          "Associated token account creation must use the idempotent instruction shape.",
        );
      }
      assertAccount(
        instruction,
        0,
        input.userAddress,
        "invalid-instruction",
        "Associated token account payer",
      );
      assertAccount(
        instruction,
        2,
        input.userAddress,
        "invalid-instruction",
        "Associated token account owner",
      );
      name = "createAssociatedTokenAccountIdempotent";
      operationInstructions.push(name);
    } else {
      operationStarted = true;
      const discriminator = instruction.data.subarray(0, 8);

      if (
        bytesEqual(
          discriminator,
          INITIALIZE_BUNDLE_DEPOSITOR_DISCRIMINATOR,
        )
      ) {
        if (input.expected.operation !== "deposit") {
          fail(
            "operation-mismatch",
            "Bundle depositor initialization is allowed only for deposits.",
          );
        }
        name = "initializeBundleDepositor";
        assertInstructionShape(
          instruction,
          5,
          8,
          INITIALIZE_BUNDLE_DEPOSITOR_DISCRIMINATOR,
          name,
        );
        try {
          getInitializeBundleDepositorInstructionDataDecoder().decode(
            instruction.data,
          );
        } catch {
          fail("invalid-instruction", `${name} data could not be decoded.`);
        }
        assertAccount(
          instruction,
          0,
          input.userAddress,
          "invalid-instruction",
          "Depositor payer",
        );
        assertAccount(
          instruction,
          1,
          input.userAddress,
          "invalid-instruction",
          "Depositor authority",
        );
        assertAccount(
          instruction,
          2,
          SYSTEM_PROGRAM,
          "invalid-instruction",
          "System program",
        );
        assertAccount(
          instruction,
          3,
          input.expected.vaultAddress,
          "vault-mismatch",
          "Depositor vault",
        );
        operationInstructions.push(name);
      } else if (bytesEqual(discriminator, SET_USER_REFERRER_DISCRIMINATOR)) {
        if (
          input.expected.operation !== "deposit" ||
          !input.expected.attributionApplied
        ) {
          fail(
            "operation-mismatch",
            "setUserReferrer was not requested for this deposit.",
          );
        }
        name = "setUserReferrer";
        assertInstructionShape(
          instruction,
          5,
          8,
          SET_USER_REFERRER_DISCRIMINATOR,
          name,
        );
        try {
          getSetUserReferrerInstructionDataDecoder().decode(instruction.data);
        } catch {
          fail("invalid-instruction", `${name} data could not be decoded.`);
        }
        assertAccount(
          instruction,
          0,
          input.userAddress,
          "invalid-instruction",
          "Referral user",
        );
        assertAccount(
          instruction,
          1,
          input.expected.vaultAddress,
          "vault-mismatch",
          "Referral vault",
        );
        observedAttribution = true;
        operationInstructions.push(name);
      } else if (bytesEqual(discriminator, REQUEST_DEPOSIT_DISCRIMINATOR)) {
        if (input.expected.operation !== "deposit") {
          fail(
            "operation-mismatch",
            "The transaction contains a deposit instead of a withdrawal.",
          );
        }
        name = "requestDeposit";
        assertInstructionShape(
          instruction,
          12,
          16,
          REQUEST_DEPOSIT_DISCRIMINATOR,
          name,
        );
        try {
          observedAmount =
            getRequestDepositInstructionDataDecoder().decode(
              instruction.data,
            ).amount;
        } catch {
          fail("invalid-instruction", `${name} data could not be decoded.`);
        }
        assertAccount(
          instruction,
          0,
          input.userAddress,
          "invalid-instruction",
          "Deposit user",
        );
        assertAccount(
          instruction,
          8,
          input.expected.vaultAddress,
          "vault-mismatch",
          "Deposit vault",
        );
        assertAccount(
          instruction,
          10,
          TOKEN_PROGRAM_ADDRESS,
          "invalid-instruction",
          "Token program",
        );
        assertAccount(
          instruction,
          11,
          SYSTEM_PROGRAM,
          "invalid-instruction",
          "System program",
        );
        operationInstructions.push(name);
      } else if (
        bytesEqual(discriminator, REQUEST_WITHDRAWAL_DISCRIMINATOR)
      ) {
        if (input.expected.operation !== "withdraw") {
          fail(
            "operation-mismatch",
            "The transaction contains a withdrawal instead of a deposit.",
          );
        }
        name = "requestWithdrawal";
        assertInstructionShape(
          instruction,
          8,
          24,
          REQUEST_WITHDRAWAL_DISCRIMINATOR,
          name,
        );
        try {
          observedSharesAmount =
            getRequestWithdrawalInstructionDataDecoder().decode(
              instruction.data,
            ).sharesAmount;
        } catch {
          fail("invalid-instruction", `${name} data could not be decoded.`);
        }
        assertAccount(
          instruction,
          0,
          input.userAddress,
          "invalid-instruction",
          "Withdrawal user",
        );
        assertAccount(
          instruction,
          2,
          input.expected.vaultAddress,
          "vault-mismatch",
          "Withdrawal vault",
        );
        assertAccount(
          instruction,
          5,
          TOKEN_PROGRAM_ADDRESS,
          "invalid-instruction",
          "Token program",
        );
        assertAccount(
          instruction,
          6,
          SYSTEM_PROGRAM,
          "invalid-instruction",
          "System program",
        );
        assertAccount(
          instruction,
          7,
          RENT_SYSVAR,
          "invalid-instruction",
          "Rent sysvar",
        );
        operationInstructions.push(name);
      } else {
        fail(
          "invalid-instruction",
          `Instruction ${instructionIndex + 1} has an ntbundle discriminator that is not permitted.`,
        );
      }
    }

    inspectedInstructions.push(
      Object.freeze({
        accountCount: instruction.accounts.length,
        name,
        program: instruction.program,
      }),
    );
  });

  if (input.expected.operation === "deposit") {
    const expectedSequence = [
      ...(operationInstructions[0] === "initializeBundleDepositor"
        ? ["initializeBundleDepositor"]
        : []),
      ...(input.expected.attributionApplied ? ["setUserReferrer"] : []),
      "requestDeposit",
    ];
    assertExactSequence(operationInstructions, expectedSequence, "deposit");
    const expectedAmount = BigInt(input.expected.amountRaw);
    if (observedAmount !== expectedAmount) {
      fail(
        "amount-mismatch",
        `Deposit amount must be ${expectedAmount}; received ${observedAmount ?? "missing"}.`,
      );
    }
    if (observedAttribution !== input.expected.attributionApplied) {
      fail(
        "operation-mismatch",
        "Transaction attribution does not match the deposit request.",
      );
    }
  } else {
    const expectedSequence = [
      ...(operationInstructions[0] ===
      "createAssociatedTokenAccountIdempotent"
        ? ["createAssociatedTokenAccountIdempotent"]
        : []),
      "requestWithdrawal",
    ];
    assertExactSequence(operationInstructions, expectedSequence, "withdraw");
    const expectedSharesAmount = BigInt(input.expected.sharesAmount);
    if (observedSharesAmount !== expectedSharesAmount) {
      fail(
        "amount-mismatch",
        `Withdrawal shares amount must be ${expectedSharesAmount}; received ${observedSharesAmount ?? "missing"}.`,
      );
    }
  }

  return Object.freeze({
    blockhash: String(message.lifetimeToken),
    instructions: Object.freeze(inspectedInstructions),
    wireBytes,
  });
}
