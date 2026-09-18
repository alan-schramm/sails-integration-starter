# Sails Integration Starter

Standalone partner/reference starter for the published Sails SDK family.

Current verified baseline:

- `@satsails/p2p-trading-sdk@0.2.0`
- `@satsails/sdk-react@0.2.0`
- transitive `@satsails/p2p-schemas@0.2.0`

This repository consumes the SDKs from the public npm registry. It does not
link to the Sails Protocol monorepo and does not require workspace-local
packages.

## What this proves

A clean external consumer can:

1. install the published SDK artifacts from npm;
2. construct a real `SailsClient`;
3. call public liquidity APIs from a Next.js app;
4. run authenticated buyer/seller example flows;
5. exercise dispute/arbitration with a signed authority decision;
6. build and test without cloning the protocol source as a dependency.

The Sails node itself is a separate service. Point this starter at any
compatible node, or run the reference node locally for development.

## Prerequisites

- Node.js 22.12+ (Node 24 is the CI baseline)
- npm
- a running Sails node for network examples

## Quick start

```bash
git clone https://github.com/alan-schramm/sails-integration-starter.git
cd sails-integration-starter
npm ci
cp .env.example .env
npm run dev
```

Open http://localhost:3001.

The default environment points to:

```text
http://localhost:3000
```

Change `NEXT_PUBLIC_SAILS_BASE_URL` and `SAILS_BASE_URL` if your node
runs elsewhere.

## Running a reference Sails node locally

If you do not already have a node, use a separate checkout of
[Sails-Protocol](https://github.com/alan-schramm/Sails-Protocol):

```bash
git clone https://github.com/alan-schramm/Sails-Protocol.git
cd Sails-Protocol
npm ci
npm run db:local:start
npm run redis:local:start
cp .env.example .env
npm run db:generate
npm run db:migrate
npm run dev
```

That checkout is the server/reference implementation. This starter still
consumes its SDK dependencies only from npm.

## Examples

### P2P Bitcoin trade

```bash
npm run example:p2p-bitcoin-trade
```

The script creates two independent authenticated clients, publishes and
accepts an offer, opens chat, registers the buyer's payout address, creates
an escrow, marks payment sent and releases.

For an unattended demo it explicitly uses `type: 'MOCK'`. This is
intentional. In SDK 0.2.0, omitting the type for BTC selects the real
`MULTISIG` provider, which requires actual funding and should not be
silently replaced by a fake provider.

### Escrow with arbitration

```bash
npm run example:escrow-with-arbitration
```

This script opens a dispute and resolves it through the assigned arbiter.
SDK 0.2.0 requires a signed authority decision, so the example uses
`resolveDisputeWithWallet()` and signs locally with the deterministic
demo arbiter key.

The one-time `TRUSTED_ARBITRATORS` setup is explained in the file header.

## Next.js demo

The web app intentionally demonstrates the public offer-discovery path.

It does **not** expose a "paste any trade id" viewer. In 0.2.0, trade and
escrow reads are authenticated and scoped to the trade parties (or other
explicitly authorized actors). A random authenticated user must not be able
to inspect another participant's trade.

Use the standalone scripts for the authenticated end-to-end flows.

## Repository map

```text
src/
  app/                  Next.js registry-consumer demo
  sails-integration/    client + small typed integration helpers
  wallet-mock/          fake WalletAdapter implementation for interface examples
  ui/                   thin SDK React re-export layer

examples/
  p2p-bitcoin-trade.ts
  escrow-with-arbitration.ts

tests/
  integration.test.ts

docs/
  API.md
  ARCHITECTURE.md
  FAQ.md
  USE_CASES.md
  UPGRADING.md
```

## Verification

CI runs the same external-consumer path a partner should rely on:

```bash
npm ci
npm ls @satsails/p2p-trading-sdk@0.2.0
npm ls @satsails/sdk-react@0.2.0
npm ls @satsails/p2p-schemas@0.2.0
npm test -- --runInBand
npm run typecheck
npm run build
```

If registry artifacts, lockfile state, public types or the production build
drift, the starter fails closed.

## Version policy

The starter pins the Sails packages to the exact verified baseline rather
than silently floating to a new release.

Upgrades are deliberate: update package versions, regenerate/verify the
lockfile, run CI, and reconcile any public API changes. See
[docs/UPGRADING.md](docs/UPGRADING.md).

## Safety / truthfulness notes

- `MOCK` settlement is only for deterministic local/demo coordination
  flows. It is not evidence that real funds moved.
- Real BTC settlement is `MULTISIG` and requires its real funding/signing
  flow.
- Release-time destination arguments are not destination authority in
  0.2.0. The beneficiary's registered `PayoutAddress` governs.
- `submitProof()` and `releaseAsset()` are real in 0.2.0.
- `negotiate()` remains intentionally unavailable because the real
  negotiation surface is the persistent `openp2p.chat()` WebSocket
  channel.
- `wallet-mock/` demonstrates interface wiring only. Never use it for
  real keys or funds.
