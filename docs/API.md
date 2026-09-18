# Public API quick reference

This file is a starter-oriented index for the published
`@satsails/p2p-trading-sdk@0.2.0` surface. It is not a second protocol
specification.

## Client

```ts
import { SailsClient } from '@satsails/p2p-trading-sdk'

const client = new SailsClient({
  baseUrl: 'http://localhost:3000',
})
```

Main modules:

- `client.identity`
- `client.liquidity`
- `client.openp2p`
- `client.settlement`
- `client.reputation`
- `client.peers`
- `client.capabilities`

The Intent facade is also exposed on the client.

## Identity

Common methods:

- `identity.create()`
- `identity.createWithPublicKey()`
- `identity.authenticate()`
- `identity.authenticateWithWallet()`
- `identity.get()`
- `identity.me()`

Authenticated calls store/use the session token inside the client transport.

## Liquidity

- `liquidity.publish()`
- `liquidity.discover()`
- `liquidity.getOffer()`
- `liquidity.book()`
- `liquidity.updateStatus()`

Offer discovery is the public read path used by the Next.js demo.

## OpenP2P

- `openp2p.trade(offerId, amount, idempotencyKey?)`
- `openp2p.getTrades()`
- `openp2p.getTrade()`
- `openp2p.getTradeByIntent()`
- `openp2p.updateTradeStatus()`
- `openp2p.getMessages()`
- `openp2p.reconcileTrade()`
- `openp2p.chat()`

Trade reads are authenticated and participant-scoped in 0.2.0.

`chat()` returns the persistent WebSocket channel used for real negotiation.

## Settlement

Important integration methods:

- `settlement.create()`
- `settlement.get()`
- `settlement.lock()`
- `settlement.markPaymentSent()`
- `settlement.release()`
- `settlement.refund()`
- `settlement.dispute()`
- `settlement.resolveDisputeWithWallet()`
- `settlement.setPayoutAddress()`
- `settlement.getPayoutAddress()`

For BTC, omitting `type` selects the recommended real `MULTISIG` provider.
Use `type: 'MOCK'` only when a fake/demo settlement is explicitly intended.

Destination authority belongs to the beneficiary's registered payout address;
a release-time destination argument is not authoritative in 0.2.0.

## Intent facade

Current 0.2.0 truth:

| Method | Status |
|---|---|
| `createIntent()` | real |
| `cancelIntent()` | real |
| `submitProof()` | real |
| `releaseAsset()` | real |
| `dispute()` | real |
| `negotiate()` | intentionally unavailable; use `openp2p.chat()` |

## React binding

`@satsails/sdk-react@0.2.0` provides the provider/hooks/components layer,
including:

- `SailsProvider`
- `useSailsClient()`
- `useSailsTrade()`
- `useSailsTrades()`
- `useSailsEscrow()`
- `TradeCard`
- `TradeStatusBadge`
- `EscrowStatusBadge`
- `ReputationBadge`

The React hooks do not bypass SDK authorization rules. A hook backed by an
authenticated SDK call still needs the appropriate authenticated client
session.

## WalletAdapter

Relevant shape:

```ts
interface WalletAdapter {
  getPeerId(): Promise<string>
  getAddress(asset: string): Promise<string>
  getBalance(asset: string): Promise<string>
  signTransaction(asset: string, tx: unknown): Promise<unknown>
  broadcastTransaction(asset: string, signedTx: unknown): Promise<string>
  getCapabilities(): Promise<WalletCapabilitiesDeclaration>
  signMessage(message: Uint8Array): Promise<Uint8Array>
  disconnect?(): Promise<void>
}
```

The starter's mock adapter implements this shape with fake values only.
