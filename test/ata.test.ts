import assert from "node:assert";
import { test } from "node:test";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from "@neutral-trade/sdk";
import { AccountRole, address, createNoopSigner } from "@solana/kit";

import {
  getCreateAssociatedTokenIdempotentInstruction,
  SYSTEM_PROGRAM_ADDRESS,
} from "../src/lib/ata.ts";

test("idempotent ATA create uses the required account order and data", async () => {
  const payer = createNoopSigner(
    address("EpZtPfeiyT7avVCuKfucUCj4Kaj81sF87aeLKNPghGvh"),
  );
  const owner = address("8TqrZmyiWQ3F3WysiBaBQC1Nzj1LDn5AR7JjXBYzFxxQ");
  const mint = address("So11111111111111111111111111111111111111112");
  const [associatedTokenAddress] = await findAssociatedTokenPda({ mint, owner });
  const instruction = await getCreateAssociatedTokenIdempotentInstruction({
    mint,
    owner,
    payer,
  });

  assert.equal(instruction.programAddress, ASSOCIATED_TOKEN_PROGRAM_ADDRESS);
  assert.deepEqual(Array.from(instruction.data), [1]);
  assert.deepEqual(
    instruction.accounts.map((account) => account.address),
    [
      payer.address,
      associatedTokenAddress,
      owner,
      mint,
      SYSTEM_PROGRAM_ADDRESS,
      TOKEN_PROGRAM_ADDRESS,
    ],
  );
  assert.deepEqual(
    instruction.accounts.map((account) => account.role),
    [
      AccountRole.WRITABLE_SIGNER,
      AccountRole.WRITABLE,
      AccountRole.READONLY,
      AccountRole.READONLY,
      AccountRole.READONLY,
      AccountRole.READONLY,
    ],
  );
  assert.equal(instruction.accounts[0].signer, payer);
});
