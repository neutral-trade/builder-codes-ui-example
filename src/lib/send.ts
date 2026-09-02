import type { Instruction, Signature, TransactionSigner } from "@solana/kit";
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";

import { rpc } from "@/lib/rpc";
import { describeRpcError } from "@/lib/rpc-error";

const CONFIRMATION_POLL_INTERVAL_MS = 1_000;

export type SendTransactionPhase =
  | "assembling"
  | "simulating"
  | "signing"
  | "sending"
  | "confirming";

export interface SendTransactionUpdate {
  instructionCount: number;
  phase: SendTransactionPhase;
  signature?: string;
}

interface SendInstructionsParams {
  instructions: ReadonlyArray<Instruction>;
  onUpdate?(update: SendTransactionUpdate): void;
  signer: TransactionSigner;
}

export class TransactionSimulationError extends Error {
  readonly logs: ReadonlyArray<string>;

  constructor(rpcError: unknown, logs: ReadonlyArray<string>) {
    super(`Transaction simulation failed: ${describeRpcError(rpcError)}`);
    this.name = "TransactionSimulationError";
    this.logs = logs;
  }
}

function waitForNextPoll(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, CONFIRMATION_POLL_INTERVAL_MS);
  });
}

async function confirmTransaction(
  signature: Signature,
  lastValidBlockHeight: bigint,
): Promise<void> {
  while (true) {
    const [statusesResponse, currentBlockHeight] = await Promise.all([
      rpc.getSignatureStatuses([signature]).send(),
      rpc.getBlockHeight({ commitment: "confirmed" }).send(),
    ]);
    const status = statusesResponse.value[0];

    if (status?.err) {
      throw new Error(
        `Transaction ${signature} failed: ${describeRpcError(status.err)}`,
      );
    }
    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    ) {
      return;
    }
    if (currentBlockHeight > lastValidBlockHeight) {
      throw new Error(
        `Transaction ${signature} was not confirmed before its blockhash expired.`,
      );
    }

    await waitForNextPoll();
  }
}

export async function sendInstructions({
  instructions,
  onUpdate,
  signer,
}: SendInstructionsParams): Promise<string> {
  const instructionCount = instructions.length;
  onUpdate?.({ instructionCount, phase: "assembling" });

  const { value: latestBlockhash } = await rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send();

  // Partners can prepend network-specific instructions from
  // @solana-program/compute-budget when they adopt a priority-fee policy.
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (message) => setTransactionMessageFeePayerSigner(signer, message),
    (message) =>
      setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, message),
    (message) => appendTransactionMessageInstructions(instructions, message),
  );

  onUpdate?.({ instructionCount, phase: "simulating" });
  const simulationTransaction = compileTransaction(transactionMessage);
  const simulationResponse = await rpc
    .simulateTransaction(
      getBase64EncodedWireTransaction(simulationTransaction),
      {
        commitment: "confirmed",
        encoding: "base64",
        replaceRecentBlockhash: true,
        sigVerify: false,
      },
    )
    .send();

  if (simulationResponse.value.err) {
    throw new TransactionSimulationError(
      simulationResponse.value.err,
      simulationResponse.value.logs ?? [],
    );
  }

  const signingBlockhash =
    simulationResponse.value.replacementBlockhash ?? latestBlockhash;
  const transactionMessageForSigning =
    setTransactionMessageLifetimeUsingBlockhash(
      signingBlockhash,
      transactionMessage,
    );

  onUpdate?.({ instructionCount, phase: "signing" });
  const signedTransaction = await signTransactionMessageWithSigners(
    transactionMessageForSigning,
  );
  const wireTransaction = getBase64EncodedWireTransaction(signedTransaction);

  onUpdate?.({ instructionCount, phase: "sending" });
  const signature = await rpc
    .sendTransaction(wireTransaction, {
      encoding: "base64",
      preflightCommitment: "confirmed",
    })
    .send();

  onUpdate?.({ instructionCount, phase: "confirming", signature });
  await confirmTransaction(signature, signingBlockhash.lastValidBlockHeight);
  return signature;
}
