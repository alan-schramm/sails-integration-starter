# Sails Integration Starter

A real, working starting point for integrating `@satsails/p2p-trading-sdk` — a Next.js
app that talks to a live Sails node, plus two standalone scripts that
run the actual protocol flows end-to-end. Everything here has been run
against a real local node while writing it; nothing in this package is
a mock of the protocol itself (the `wallet-mock/` folder is a mock of a
*wallet*, clearly labeled — see below).

## Quick start

This is a standalone project — `npm install` here pulls
`@satsails/p2p-trading-sdk` and `@satsails/sdk-react` straight from the
public npm registry, no monorepo required. All commands below run from
**this directory**.

You still need a running Sails node to talk to (this starter is a
client, not the protocol server itself) — either run the reference
server from [Sails-Protocol](https://github.com/alan-schramm/Sails-Protocol)
locally (steps 1-4 below), or point the env vars in step 6 at any
Sails node you already have running.

**Prerequisites:** Node.js 20+, npm. No Docker needed for the node —
local Postgres and Redis are scripted.

1. **Clone and set up the Sails node** (separate checkout, only needed
   if you don't already have a node to point at):
   ```bash
   git clone https://github.com/alan-schramm/Sails-Protocol.git
   cd Sails-Protocol
   npm install
   npm run db:local:start
   npm run redis:local:start
   cp .env.example .env
   npm run db:generate
   npm run db:migrate
   ```

2. **Start the node** (keep this running in its own terminal):
   ```bash
   npm run dev
   ```
   Confirm it's up: `curl http://localhost:3000/health` should return `200`.

3. **Back in this starter's own directory, install its dependencies**:
   ```bash
   npm install
   ```

4. **Point this starter at the node**:
   ```bash
   cp .env.example .env
   ```
   The defaults already point at `http://localhost:3000`, matching
   step 2 — edit `.env` if your node runs elsewhere.

5. **Start this starter's Next.js app**:
   ```bash
   npm run dev
   ```
   Open http://localhost:3001 — the "Discover offers" section makes a
   real `liquidity.discover()` call against the node from step 2. An
   empty list is expected on a fresh database; publish an offer first
   (step 6) or via [`examples/simple-wallet`](https://github.com/alan-schramm/Sails-Protocol/tree/main/examples/simple-wallet)
   to see one.

6. **Run the golden-path example** (optional, in a second terminal —
   publishes a real offer, opens a real trade, locks and releases a
   real escrow, and prints a `tradeId` you can paste into the "View a
   trade" section of the app from step 5):
   ```bash
   npm run example:p2p-bitcoin-trade
   ```

Step 1 is a one-time setup for the node; once it's running, steps 3-6
are the ones you'll repeat, and take under a minute.

## What's in here

```
src/
  sails-integration/
    client.ts          — SailsClient singleton (browser-safe lazy init)
    intent-builder.ts  — real TradeIntentPayload helpers
    event-handler.ts   — wraps openp2p.chat()'s WebSocketChannel
  wallet-mock/          — a real WalletAdapter implementation with FAKE
                           values — reference for the shape, not a
                           wallet. Neither example script below needs it;
                           this protocol's identity layer doesn't require
                           a wallet at all (see docs/FAQ.md).
  ui/                    — thin re-exports of @satsails/sdk-react's real
                           TradeCard/StatusBadge components
  app/                   — the Next.js pages from the quick start above
examples/
  p2p-bitcoin-trade.ts        — standalone script, the golden path
  escrow-with-arbitration.ts  — standalone script, real dispute/arbitration
tests/
  integration.test.ts   — real unit tests for intent-builder.ts/event-handler.ts (TDD)
docs/
  ARCHITECTURE.md        — how the pieces connect, with real sequence diagrams
  USE_CASES.md            — what's actually provable today vs. planned
  FAQ.md
  API.md                  — index into @satsails/p2p-trading-sdk's real method surface
```

## The two example scripts, in more detail

- **`examples/p2p-bitcoin-trade.ts`** — mirrors `examples/simple-wallet`'s
  proven pattern: two independent `SailsClient`s (seller, buyer), full
  identity → publish → discover → trade → chat → escrow flow. Run with
  `npm run example:p2p-bitcoin-trade`.

- **`examples/escrow-with-arbitration.ts`** — the same setup, but the
  buyer raises a dispute and a Trusted Arbitrator resolves it
  (RFC-007 D4). **Read this file's own header comment before running
  it** — dispute resolution needs a one-time `TRUSTED_ARBITRATORS`
  config step on a fresh node, and the script explains exactly what to
  do (it also runs safely without that step — it just stops with a
  clear message instead of a dispute that can't be resolved). Run with
  `npm run example:escrow-with-arbitration`.

## Honesty notes (per this repo's own convention)

- Both scripts use the node's default escrow type (`MOCK` on this
  repo's own local `.env`), not `MULTISIG` — `MULTISIG` is genuinely
  non-custodial and needs real on-chain funding a script can't
  automate. See `docs/USE_CASES.md` and each script's own header for
  why, and what driving real `MULTISIG` by hand looks like.
- `negotiate()`/`submitProof()`/`releaseAsset()` on the SDK's Intent
  facade always throw `SailsNotImplementedError` — neither example uses
  them. See `docs/FAQ.md`.
- No NFT use case is provable today — no NFT `AssetType` exists. See
  `docs/USE_CASES.md`.
