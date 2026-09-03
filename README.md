# Neutral Trade builder codes UI example

## What this is

This Next.js reference app shows the same Neutral Strategy Vault deposit and
withdrawal-request journey through the hosted Widget, the public REST
transaction builder, and the TypeScript SDK. Choose one path for your product;
the other tabs are working appendices for comparing the security boundaries.

| Flow | Choose it when | UI and transaction source | Credentials and RPC |
| --- | --- | --- | --- |
| Widget | You want the fastest integration | Neutral owns the UI and builds the transaction | No API key or supplied RPC is required by a standalone embed |
| REST | You own the UI and do not want an SDK | Neutral returns unsigned transaction bytes | No key in the browser; 20 builds per 60 seconds per IP by default |
| SDK | You own the UI and transaction pipeline | Your app builds directly from onchain state | No transaction-builder API dependency with a Builder ID; builder codes use Neutral's public code endpoint; use your own RPC |

This all-flows example still requires a browser-safe RPC because the Widget
mount, REST transaction transport, and SDK tab use it. The vault and position
cards do not use that RPC; they read through the app's server-side proxy, which
is the only place the API key is used.

> **Attribution rollout, verified 3 September 2026:** the SDK applies
> attribution directly onchain, and the mainnet and devnet REST builders now
> construct attributed transactions. The Widget uses that public builder, so
> all three paths can attribute. If any deployment returns
> `ATTRIBUTION_NOT_YET_ENABLED`, stop; do not approve an unattributed fallback
> when referral credit is required.

## Prerequisites

- Node.js 20 or newer and pnpm 10.
- A user wallet that implements Solana Wallet Standard. Use a fresh wallet for
  an attribution test because any prior activity in the vault is permanent.
- A browser-safe Solana RPC URL. The SDK needs account reads, transaction
  simulation and submission, signature-status reads, and block-height reads.
- A Builder ID. For mainnet, connect the wallet that will receive rebates at
  [builder registration](https://www.neutral.trade/builder/register), select
  the vault, and approve the one wallet prompt. That wallet address is the
  Builder ID.
- A server-side API key. Open the
  [builder dashboard](https://www.neutral.trade/builder), choose **Integration
  → Generate key**, and store the key when it is shown. It is shown once, is a
  production key, and issuing a replacement through that dashboard flow revokes
  earlier active dashboard keys after the new key is issued. Sandbox keys are
  issued separately for devnet.

In this example the key authenticates vault and position reads. It does not
authorize, sign, submit, or custody transactions; the REST builders are public
and the connected user wallet is always the signer.

## Configure

Copy the template after cloning:

```sh
cp .env.example .env.local
```

Every setting is listed below. Values beginning with `YOUR_` are placeholders.

| Variable | Meaning | Example | Exposure |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_CLUSTER` | Solana cluster; `mainnet` or `devnet` | `devnet` | Browser |
| `NEXT_PUBLIC_VAULT_ADDRESS` | Registry vault account for that cluster | `8TqrZmyiWQ3F3WysiBaBQC1Nzj1LDn5AR7JjXBYzFxxQ` | Browser |
| `NEXT_PUBLIC_BUILDER_ADDRESS` | Registered builder wallet (Builder ID); set this or the code | `YOUR_REGISTERED_BUILDER_ID` | Browser |
| `NEXT_PUBLIC_BUILDER_CODE` | Dashboard-managed public code; set this or the address | `YOUR_BUILDER_CODE` | Browser |
| `NEXT_PUBLIC_RPC_URL` | Required browser-safe Solana RPC endpoint | `https://api.devnet.solana.com` | Browser |
| `NEXT_PUBLIC_NEUTRAL_API_URL` | Optional browser transaction-builder and code-resolver API override | `https://bundle-indexer-api-devnet-kvpc.onrender.com` | Browser |
| `NEUTRAL_API_KEY` | Partner key for this app's authenticated data proxy | `YOUR_SANDBOX_API_KEY` | Server only |
| `NEUTRAL_API_URL` | Optional upstream override for server-side reads | `https://bundle-indexer-api-devnet-kvpc.onrender.com` | Server only |

Set exactly one of `NEXT_PUBLIC_BUILDER_ADDRESS` and
`NEXT_PUBLIC_BUILDER_CODE`; leave the other empty. Blank API URL overrides use
the selected cluster's default. Restart the development server after changing
any setting.

All `NEXT_PUBLIC_*` values are compiled into browser JavaScript. An RPC URL in
that group must be safe to disclose and should use provider-side origin and
quota restrictions.

## Run

Install the locked dependencies and start Next.js:

```sh
pnpm install
pnpm dev
```

Open `http://localhost:3000`. You should see the selected cluster and vault,
live vault terms, a **Connect wallet** action, and **Widget**, **REST API**, and
**SDK** tabs. Connecting a wallet adds its current position and pending
requests. A page-load validation failure for a `NEXT_PUBLIC_*` setting, such as
a missing required value or invalid URL or address, produces a configuration
page that names the setting to fix. A missing `NEUTRAL_API_KEY` or invalid
`NEUTRAL_API_URL` fails later in the server-side proxy: the page still renders,
and the vault and position cards report that their data could not be loaded
without naming the setting.

Before publishing a change, run the same local checks as this repository:

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

## The rules that cannot be worked around

- Attribution can be written only in a user's first transaction with a vault.
  A wallet with a prior deposit, withdrawal, fee, share, or pending-request
  history cannot be attributed later.
- Account initialization when needed, builder binding, the deposit request,
  and the points memo belong in one transaction and in that order. The binding
  and deposit are atomic: both succeed or neither does.
- One user can have one builder per vault. That link is permanent and cannot be
  replaced. The same user can have a different builder in another vault.
- The rebate rate is the builder's live tier for that vault when management
  fees are charged. It is not frozen when the user is bound, can rise or fall
  with referred net deposits, and can be superseded by a live override.
- Set `requireAttribution: true` on every REST build intended to be a referred
  first deposit. Require `validation.accepted: true` and
  `attribution.applied: true` before showing a wallet prompt.
- A successful deposit is not proof of attribution. Confirm the affirmative
  attribution result and then verify the resulting account or reporting data.

## Security do-nots

- Do not put `NEUTRAL_API_KEY` in browser code, a `NEXT_PUBLIC_*` variable, a
  mobile binary, source control, screenshots, logs, or analytics. Store it in a
  server-side secret manager.
- Do not use floating-point values for tokens or shares. Keep canonical values
  as raw base-10 integer strings or `bigint`, then apply token decimals only
  for display.
- Do not ask a wallet to sign bytes you have not inspected. Verify the fee
  payer, sole signer, cluster, vault, program and instruction allowlist,
  operation, amount or shares, and expected referrer first.
- Do not poll faster than the projection changes. Refresh after user actions,
  use the API's `asOf` cursor, honor `Retry-After`, and back off on unavailable
  data instead of turning it into zero.

## Devnet recipe

Devnet is ops-assisted; there is no self-service funding or sandbox-key flow.
Send your Neutral integration contact or
[@NeutralTradeWill](https://t.me/NeutralTradeWill) your Builder ID and a
separate fresh user-wallet address. Request registration on `bundle-4`, a
sandbox API key, and devnet USDC for the user wallet. The user wallet also needs
devnet SOL for transaction fees. Do not use someone else's registered builder
as a test identity.

Use this `.env.local`, replacing both `YOUR_` values:

```dotenv
NEXT_PUBLIC_CLUSTER=devnet
NEXT_PUBLIC_VAULT_ADDRESS=8TqrZmyiWQ3F3WysiBaBQC1Nzj1LDn5AR7JjXBYzFxxQ
NEXT_PUBLIC_BUILDER_ADDRESS=YOUR_REGISTERED_DEVNET_BUILDER_ID
NEXT_PUBLIC_BUILDER_CODE=
NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_NEUTRAL_API_URL=https://bundle-indexer-api-devnet-kvpc.onrender.com
NEUTRAL_API_KEY=YOUR_SANDBOX_API_KEY
NEUTRAL_API_URL=https://bundle-indexer-api-devnet-kvpc.onrender.com
```

The devnet deposit asset is USDC mint
`6a8hWCCa2QDQTqzLUapZwZtgHTox8BsgataN6JVLwdo7`; tokens with another mint will
not fund this vault.

1. Start the app, switch the wallet to Solana devnet, and connect the funded
   fresh user wallet—not the builder wallet.
2. Open **SDK**, enter at least the minimum shown in **Vault terms**, and choose
   **Simulate & deposit**. Inspect the transaction in the wallet before signing.
3. Wait for confirmation. The SDK reads the `UserBundleAccount` back; the result
   must say **Attributed to** followed by your Builder ID. An absent or different
   address is a failed acceptance run even if the deposit request confirmed.
4. Wait for the keeper to process the deposit and for **Your position** to show
   a withdrawable balance. In **SDK**, choose **Max** or enter a smaller amount,
   then choose **Simulate & request withdrawal**. This creates a request; it
   does not settle immediately.

For an independent attribution check, call this authenticated endpoint from a
trusted shell or server and find the fresh user under your builder:

```sh
set -a
. ./.env.local
set +a
curl --fail --silent --show-error \
  --header "x-api-key: ${NEUTRAL_API_KEY}" \
  "${NEUTRAL_API_URL}/v2/referrer/${NEXT_PUBLIC_BUILDER_ADDRESS}/users"
```

Alternatively derive the user's vault account with the SDK and confirm its
onchain `UserBundleAccount.referrer` equals your Builder ID.

With the Builder ID configuration above, the SDK path performs attribution
without depending on the Neutral API and remains the deterministic acceptance
path. A builder code instead requires the public code endpoint to resolve its
referrer wallet. The current devnet REST builder and Widget path are also
enabled. Still treat
`ATTRIBUTION_NOT_YET_ENABLED` as a hard stop if another deployment returns it;
do not choose the app's explicit unattributed fallback.

## Mainnet

Register your own Builder ID and generate a production key first. Then use the
following configuration, replacing the placeholders and using a browser-safe,
production-grade RPC:

```dotenv
NEXT_PUBLIC_CLUSTER=mainnet
NEXT_PUBLIC_VAULT_ADDRESS=J7qhMAKnB6G5dvoAN9281ufabajKbyGQxxd2bq6R7fPJ
NEXT_PUBLIC_BUILDER_ADDRESS=YOUR_REGISTERED_MAINNET_BUILDER_ID
NEXT_PUBLIC_BUILDER_CODE=
NEXT_PUBLIC_RPC_URL=https://YOUR_BROWSER_SAFE_MAINNET_RPC
NEXT_PUBLIC_NEUTRAL_API_URL=https://api.neutral.trade
NEUTRAL_API_KEY=YOUR_PRODUCTION_API_KEY
NEUTRAL_API_URL=https://api.neutral.trade
```

Neutral Autopilot's mainnet terms, verified 2 September 2026, are:

| Term | Value |
| --- | --- |
| Vault | `J7qhMAKnB6G5dvoAN9281ufabajKbyGQxxd2bq6R7fPJ` |
| Deposit asset | USDC, mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| Minimum deposit | 5 USDC |
| Management fee | 1% annually |
| Performance fee | None |
| Withdrawal fee | 0.30% |
| Builder referrals | Enabled; builder minimum deposit is 0 USDC |

The builder ladder is evaluated from referred net deposits separately for
this vault: 100,000 / 500,000 / 3,000,000 / 5,000,000 / 10,000,000 USDC earns
10% / 20% / 30% / 40% / 50% of the management fee actually charged.

**Mainnet deposits spend real USDC.** Deposit and withdrawal requests settle on
the vault's keeper processing schedule, not when the request transaction
confirms. The position remains exposed to price-per-share movement until
settlement. Re-check the live vault terms and API before using these dated
values in production.

## Troubleshooting

| Code or response | Meaning | What to do |
| --- | --- | --- |
| `ATTRIBUTION_NOT_YET_ENABLED` | Attribution is gated in this API environment | Stop the referred flow; use the SDK path or wait for the flag, and never silently fall back |
| `UNKNOWN_CODE` | The builder code is unknown, disabled, or no longer resolves | Check the code in the dashboard, or use your registered Builder ID |
| `REFERRALS_DISABLED` | The selected vault is not accepting builder referrals | Remove the vault from the referred flow until its live configuration enables referrals |
| `INVALID_REFERRER` | The address cannot refer this user or vault, including self-referral | Check the Builder ID and connect a distinct user wallet |
| `REFERRAL_ALREADY_SET` | This user's permanent vault referrer is already set | Do not try to replace it; confirm whether it is yours, or use a fresh wallet for testing |
| `USER_BUNDLE_ACCOUNT_HAS_ACTIVITY` | The user has prior vault activity without an eligible new bind | Attribution cannot be repaired; use a genuinely fresh wallet for the acceptance test |
| `REFERRER_NOT_REGISTERED` | The builder is not registered on this vault | Register the Builder ID on the exact vault and cluster, then retry with fresh state |
| `REFERRER_DEACTIVATED` | The vault registration exists but is inactive | Reactivate it through Neutral before accepting referred deposits |
| `REFERRER_DEPOSIT_TOO_LOW` | The builder's processed own deposit is below this vault's builder minimum | Meet the displayed builder minimum, wait for keeper processing, then retry |
| `BUILDER_DEPOSIT_AMOUNT_TOO_LOW` | The proposed attributed deposit is below the required gross minimum | Use `requiredGrossDepositAmount` when returned, or enter at least the live vault minimum |
| `ATTRIBUTION_REQUIRED` | Strict REST validation wrapped one of the attribution failures above | Read `attribution.reason`, fix that cause, and request a new build; no transaction should be signed |
| `MIN_DEPOSIT_AMOUNT_NOT_MET` | The user's ordinary deposit is below the vault minimum | Enter at least the live minimum shown in **Vault terms** |
| `VAULT_PAUSED` | Deposits or withdrawals are paused onchain | Do not keep rebuilding; wait for the live vault status to become active |
| `USER_BUNDLE_ACCOUNT_NOT_FOUND` | The connected wallet has no position account in this vault | Check the wallet, cluster, and vault; wait for its deposit if still processing |
| `ZERO_WITHDRAWAL_SHARES` | The SDK amount rounds below one share at the current price | Increase the amount or use **Max**; REST may call this `WITHDRAWAL_SHARES_ZERO` |
| HTTP `429` | The IP or API key quota is exhausted | Honor `Retry-After`; public transaction builds default to 20 per 60 seconds per IP |
| HTTP `503` | A required projection is missing, catching up, or degraded | Show unavailable, retry with backoff, and never render an empty list or zero balance |

## Links

- [Integration guide](https://docs.neutral.trade/for-distribution-partners/integration-guide)
- [Developers](https://docs.neutral.trade/developers/developers)
- [Builder dashboard](https://www.neutral.trade/builder)
- [Live OpenAPI](https://api.neutral.trade/docs)
- [TypeScript SDK reference](https://sdk.neutral.trade/)
- [Widget SDK README](https://github.com/neutral-trade/sdk/blob/main/packages/widget-sdk/README.md)
