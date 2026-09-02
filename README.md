# Neutral builder integration example

## Purpose

This Next.js app shows three ways a partner can integrate deposits into a Neutral vault while sharing one Wallet Standard connection. The SDK tab also demonstrates direct withdrawal requests.

## Major concepts

The **Wallet signer adapter** keeps private keys inside the connected wallet and exposes the Solana Kit signer used by the direct SDK flow. The **RPC client** is a browser-side singleton created only from `NEXT_PUBLIC_RPC_URL`.

The direct SDK flow reads current vault, oracle, user, and builder accounts from that RPC. It builds an attributed first deposit or an explicit unattributed deposit, simulates the unsigned transaction, opens the wallet only after simulation succeeds, sends the signed transaction, and polls until confirmed or expired. Direct attribution talks to the program and does not depend on an API attribution flag.

Withdrawal requests prepend an idempotent create for the user's asset associated token account. The request enters the vault cooldown and keeper settlement cycle after confirmation.

## Setup

Install dependencies and copy the public configuration template:

```sh
pnpm install
cp .env.example .env.local
```

Set a browser-safe RPC URL and exactly one of `NEXT_PUBLIC_BUILDER_ADDRESS` or `NEXT_PUBLIC_BUILDER_CODE`. Public devnet defaults for the ticket scenario are:

```dotenv
NEXT_PUBLIC_CLUSTER=devnet
NEXT_PUBLIC_VAULT_ADDRESS=8TqrZmyiWQ3F3WysiBaBQC1Nzj1LDn5AR7JjXBYzFxxQ
NEXT_PUBLIC_BUILDER_ADDRESS=EpZtPfeiyT7avVCuKfucUCj4Kaj81sF87aeLKNPghGvh
NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
```

`NEXT_PUBLIC_` values are bundled into browser JavaScript and must not contain secrets. A production integration should use a dedicated RPC that supports `getAccountInfo`, `getMultipleAccounts`, `simulateTransaction`, `sendTransaction`, signature status reads, and block-height reads.

## Usage

Start the app and connect a Wallet Standard wallet for the configured cluster:

```sh
pnpm dev
```

Enter a deposit amount in major units. Attribution failures that permit continuing expose a separate **Deposit without attribution** action; the app never falls back silently. For withdrawals, **Max** reads the current redeemable balance in exact minor units before filling the input.

## Testing

Run the focused unit tests, followed by the project checks:

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```
