# Use cases

This file describes what this starter itself demonstrates against the
published 0.2.0 SDK family.

## ✅ External registry consumption

A clean repository checkout installs the published Sails packages from npm,
then typechecks/tests/builds without workspace links to Sails Protocol.

This is the primary purpose of the repository.

## ✅ Public market discovery

The Next.js app performs real `liquidity.discover()` calls against a
compatible Sails node through the published SDK.

No authentication is required for that public discovery surface.

## ✅ Authenticated P2P coordination demo

`examples/p2p-bitcoin-trade.ts` demonstrates:

- participant creation/authentication;
- offer publication/discovery;
- trade creation;
- WebSocket chat;
- beneficiary payout-address registration;
- escrow lifecycle;
- payment-sent transition;
- release.

The example intentionally uses `type: 'MOCK'` so it can run unattended.
It proves coordination semantics, not movement of real BTC.

## ✅ Signed arbitration demo

`examples/escrow-with-arbitration.ts` demonstrates:

- dispute creation;
- assigned-arbiter flow;
- signed authority decision;
- `resolveDisputeWithWallet()`;
- resulting settlement transition.

The demo arbiter signs locally.

## 🏗️ Real BTC settlement

The published SDK supports the BTC MULTISIG path, and BTC is mapped to
MULTISIG when escrow type is omitted.

This starter does not automate real funding/signing/broadcasting in its
unattended examples. A successful MOCK example must never be presented as
proof that real BTC moved.

## Intent facade truth in 0.2.0

Real:

- `createIntent()`
- `cancelIntent()`
- `submitProof()`
- `releaseAsset()`
- `dispute()`

Still intentionally unavailable:

- `negotiate()`

Real negotiation uses the persistent `openp2p.chat()` WebSocket channel.

## Not claimed by this repository

- production readiness of every settlement rail;
- live deployment availability;
- arbitrary public access to trade/escrow data;
- real-funds safety from MOCK examples;
- protocol semantics beyond what the published SDK exposes.
