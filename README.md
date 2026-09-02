# builder-codes-ui-example

A Next.js reference app for integrating a Neutral vault with a Wallet Standard
wallet. The widget flow demonstrates the hosted Neutral deposit and withdrawal
experience, builder attribution, and lifecycle events.

## Setup

Install dependencies, copy `.env.example` to `.env.local`, then set your RPC URL,
exactly one builder attribution value, and `NEUTRAL_API_KEY`. The configured
builder address must already be registered on the selected vault. Production
partner keys are created in the
[builder dashboard](https://www.neutral.trade/builder).

```sh
pnpm install
cp .env.example .env.local
pnpm dev
```

See `.env.example` for every public configuration option and its default. Connect
a Wallet Standard wallet and open the Widget tab to mount the hosted experience.
The app keeps the newest eight widget events visible and requests a position
refresh after confirmed deposits and withdrawals.

`NEUTRAL_API_KEY` is read only by the server-side proxy. Never rename it with a
`NEXT_PUBLIC_` prefix.

## Verification

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```
