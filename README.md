# Builder codes UI example

## Purpose

This Next.js reference app shows how a partner interface can integrate a Neutral Trade vault with a Wallet Standard wallet. The hosted widget and public REST deposit and withdrawal flows are implemented, while the SDK tab outlines the direct integration path. Live vault metrics, wallet balances, and pending requests come through a server-side API proxy.

## Major concepts

- **Public configuration** selects a registry vault, Solana cluster, browser-safe RPC, and exactly one builder address or code.
- **Registry resolution** provides the vault's ntbundle program ID, including vaults pinned to a non-default program.
- **Hosted widget flow** mounts Neutral's deposit and withdrawal experience, displays the newest eight lifecycle events, and refreshes the position panel after confirmation.
- **REST flow** requests unsigned transaction bytes from Neutral's public builder. A first deposit requires attribution, and the user must explicitly approve any second build without attribution.
- **Transaction inspection** verifies the v0 transaction signer, program allowlist, operation sequence, configured vault, and decoded deposit amount or withdrawal shares before the wallet prompt.
- **Server data proxy** adds `NEUTRAL_API_KEY` only for live vault and position requests. Browser transaction builds do not use the partner key.
- Raw token amounts remain decimal strings or `bigint` values, and the connected wallet signs the exact `transactionBase64` returned by the builder.

## Setup

Install dependencies and create the local environment file:

```sh
pnpm install
cp .env.example .env.local
```

Set `NEXT_PUBLIC_RPC_URL`, `NEUTRAL_API_KEY`, and exactly one of `NEXT_PUBLIC_BUILDER_ADDRESS` or `NEXT_PUBLIC_BUILDER_CODE`. A configured builder address must be registered for the selected vault to receive attribution. Production partner keys are available from the [builder dashboard](https://www.neutral.trade/builder).

`NEXT_PUBLIC_NEUTRAL_API_URL` optionally overrides the public transaction-builder API. `NEUTRAL_API_URL` independently overrides the server proxy's upstream API. See `.env.example` for cluster and vault defaults.

Never place secrets in a `NEXT_PUBLIC_` variable. `NEUTRAL_API_KEY` is read only by the server-side proxy.

## Usage

Start the development server:

```sh
pnpm dev
```

Open the local URL shown by Next.js and connect a compatible Solana wallet. Use the Widget tab for the hosted experience or the REST API tab to build, inspect, sign, submit, and confirm a deposit or withdrawal. A stale REST transaction blockhash causes a fresh build that must be reviewed again.

## Testing

Run the unit tests, typecheck, lint, and production build:

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

The test command uses `tsx` with Node's test runner across both test directories. Coverage includes formatting, exact token amount parsing, transaction-builder requests and errors, a captured devnet deposit, and deterministic transaction tampering cases.
