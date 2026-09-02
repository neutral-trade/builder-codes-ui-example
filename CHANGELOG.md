# Changelog

## Unreleased

- Add direct attributed and explicit unattributed SDK deposit requests.
- Add direct withdrawal requests with idempotent destination token account creation and a live over-balance guard.
- Simulate transactions before wallet signing, preserve structured RPC failure details, and poll confirmation through blockhash expiry.
- Add exact decimal amount parsing, builder code resolution with a 60-second cache, and focused unit tests.
