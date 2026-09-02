# builder-codes-ui-example

Copy `.env.example` to `.env.local`, then set your RPC URL, exactly one
builder attribution value, and `NEUTRAL_API_KEY`. Production partner keys are
created in the [builder dashboard](https://www.neutral.trade/builder).

`NEUTRAL_API_KEY` is read only by the server-side proxy. Never rename it with a
`NEXT_PUBLIC_` prefix. See `.env.example` for the remaining configuration and
defaults.
