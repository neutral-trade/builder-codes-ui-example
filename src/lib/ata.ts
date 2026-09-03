import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from "@neutral-trade/sdk";
import type { Address, TransactionSigner } from "@solana/kit";
import { AccountRole, address } from "@solana/kit";

export const SYSTEM_PROGRAM_ADDRESS = address(
  "11111111111111111111111111111111",
);

interface CreateAssociatedTokenIdempotentInstructionParams {
  mint: Address;
  owner: Address;
  payer: TransactionSigner;
}

export async function getCreateAssociatedTokenIdempotentInstruction({
  mint,
  owner,
  payer,
}: CreateAssociatedTokenIdempotentInstructionParams) {
  const [associatedTokenAddress] = await findAssociatedTokenPda({ mint, owner });

  return {
    accounts: [
      {
        address: payer.address,
        role: AccountRole.WRITABLE_SIGNER,
        signer: payer,
      },
      { address: associatedTokenAddress, role: AccountRole.WRITABLE },
      { address: owner, role: AccountRole.READONLY },
      { address: mint, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ] as const,
    data: Uint8Array.of(1),
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  };
}
