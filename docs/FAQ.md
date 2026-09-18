# FAQ

## Which Sails SDK versions does this starter use?

The verified baseline is:

- `@satsails/p2p-trading-sdk@0.2.0`
- `@satsails/sdk-react@0.2.0`
- transitive `@satsails/p2p-schemas@0.2.0`

The starter installs them from the public npm registry.

## Do I need the Sails Protocol monorepo?

Not as an SDK dependency.

You need a compatible Sails node to make network calls. For local development,
you may run the reference node from a separate Sails-Protocol checkout, but
this starter itself remains a normal external npm consumer.

## Why can't I paste any trade id into the web app anymore?

Because that would model the wrong security contract.

In 0.2.0, trade and escrow reads require an authenticated session and are
scoped to authorized participants. The standalone examples create and retain
the correct buyer/seller sessions, so they are the right place to demonstrate
those flows.

## Why do the examples pass `type: 'MOCK'` explicitly?

For BTC, SDK 0.2.0 recommends the real `MULTISIG` settlement provider when
`type` is omitted.

The examples are unattended coordination demos, so they ask for the fake
provider explicitly rather than silently pretending a real BTC settlement was
performed.

## Where does a release pay out?

The beneficiary's registered `PayoutAddress` is authoritative.

A release-time `toAddress` argument remains accepted for source
compatibility but does not decide the destination in 0.2.0. The examples call
`settlement.setPayoutAddress()` before release.

## How does dispute resolution work in 0.2.0?

A ruling requires a signed authority decision from the assigned arbiter.

Most callers should use `settlement.resolveDisputeWithWallet()`, which builds
the canonical decision and asks the wallet/signer to sign it locally.

The arbitration example demonstrates this without sending the arbiter private
key to the node.

## Which Intent facade methods are real?

In 0.2.0:

- `createIntent()` is real
- `cancelIntent()` is real
- `submitProof()` is real
- `releaseAsset()` is real
- `dispute()` is real
- `negotiate()` remains intentionally unavailable

The real negotiation surface is `openp2p.chat(tradeId)`, a persistent
WebSocket channel. A one-shot `Promise<void>` call would not represent that
capability honestly.

## Do I need a WalletAdapter?

Not for every SDK call.

A WalletAdapter becomes important where the application delegates signing,
wallet capability discovery, balances/addresses, or wallet-backed identity.
The interface includes the required `signMessage(message)` method.

The starter's `wallet-mock/` implementation is fake and is only an interface
example. Never use it for real funds or keys.

## Why Node 22.12+?

The published SDK dependency tree includes Arkade SDK versions whose engine
range starts at Node 22.12. CI uses Node 24 as the reference environment.
