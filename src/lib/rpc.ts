import { createSolanaRpc } from "@solana/kit";

import { config } from "@/config";

export const rpc = createSolanaRpc(config.rpcUrl);
