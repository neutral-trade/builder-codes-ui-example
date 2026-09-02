# Builder codes UI example

## Purpose

This Next.js app demonstrates three ways to integrate a Neutral Trade vault into a partner interface while keeping wallet authority with the user. The REST flow requests an unsigned deposit or withdrawal transaction from Neutral's public builder, inspects the returned wire bytes, asks a Wallet Standard wallet to sign, submits through the configured RPC, and waits for confirmation.

## Major concepts

- Public configuration selects a registry vault, cluster, browser-safe RPC, and exactly one builder address or code.
- The registry entry resolves the vault's ntbundle program ID, including vaults pinned to a non-default program.
- A first deposit requires attribution. If the API cannot apply it, the user must explicitly approve a second build without attribution.
- Before a wallet prompt, the REST flow decodes the v0 transaction and verifies its signer, program allowlist, operation sequence, configured vault, and deposit amount or withdrawal shares.
- Raw token amounts remain decimal strings or `bigint` values. No floating-point conversion is used.
- The connected wallet is the only signer. The app signs the exact `transactionBase64` returned by the builder and does not reconstruct it from response metadata.

## Setup

Install dependencies with Node 20 or newer and pnpm:

```sh
pnpm install
```

Copy `.env.example` to `.env.local`. Set `NEXT_PUBLIC_RPC_URL` and exactly one of `NEXT_PUBLIC_BUILDER_ADDRESS` or `NEXT_PUBLIC_BUILDER_CODE`. The other public settings have documented defaults in `.env.example`.

Never place secrets or an API key in a `NEXT_PUBLIC_` variable. These values are included in browser JavaScript.

## Usage

Start the development server:

```sh
pnpm dev
```

Open the local URL shown by Next.js, connect a compatible Solana wallet, and choose an integration tab. In the REST tab, build and review a deposit or withdrawal before signing. A stale blockhash causes a fresh build that must be reviewed again.

## Testing

Run the unit tests, typecheck, lint, and production build:

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

The test script uses `tsx` with Node's test runner so TypeScript tests work across the declared Node 20 and newer engine range. Inspection tests include a captured devnet deposit plus deterministic amount, vault, program, signer, and withdrawal-share tampering cases.
