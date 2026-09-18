/**
 * Beta scenario #204 — authenticated non-party cannot mutate another
 * trade/escrow. This is an external-consumer proof using only the
 * published @satsails/p2p-trading-sdk surface.
 *
 * Run:
 *   npm run example:nonparty-authority
 */
import {
  SailsClient,
  SailsForbiddenError,
  type Escrow,
} from '@satsails/p2p-trading-sdk'

const BASE_URL = process.env.SAILS_BASE_URL ?? 'http://localhost:3000'

function assertStatus(escrow: Escrow, expected: string, label: string): void {
  if (escrow.status !== expected) {
    throw new Error(`${label}: expected escrow status ${expected}, got ${escrow.status}`)
  }
  console.log(`STATE_EVIDENCE label=${label} escrowId=${escrow.id} status=${escrow.status}`)
}

async function expectForbidden(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    if (err instanceof SailsForbiddenError) {
      console.log(
        `NEGATIVE_EVIDENCE action=${label} class=${err.name} code=${err.code} statusCode=${err.statusCode}`,
      )
      return
    }
    throw new Error(
      `${label}: expected SailsForbiddenError but got ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
    )
  }
  throw new Error(`${label}: unauthorized action unexpectedly succeeded`)
}

async function main() {
  const seller = new SailsClient({ baseUrl: BASE_URL })
  const buyer = new SailsClient({ baseUrl: BASE_URL })
  const outsider = new SailsClient({ baseUrl: BASE_URL })

  console.log('[1] Register and authenticate seller, buyer, and unrelated participant')
  const sellerIdentity = await seller.identity.create(undefined, 'Authority Scenario — Seller')
  const buyerIdentity = await buyer.identity.create(undefined, 'Authority Scenario — Buyer')
  const outsiderIdentity = await outsider.identity.create(undefined, 'Authority Scenario — Outsider')

  const sellerAuth = await seller.identity.authenticate(sellerIdentity.keypair)
  const buyerAuth = await buyer.identity.authenticate(buyerIdentity.keypair)
  const outsiderAuth = await outsider.identity.authenticate(outsiderIdentity.keypair)

  console.log(`PARTICIPANT_EVIDENCE role=seller participantId=${sellerAuth.participantId}`)
  console.log(`PARTICIPANT_EVIDENCE role=buyer participantId=${buyerAuth.participantId}`)
  console.log(`PARTICIPANT_EVIDENCE role=outsider participantId=${outsiderAuth.participantId}`)

  console.log('[2] Create offer, trade, buyer payout address, and MOCK escrow')
  const offer = await seller.liquidity.publish({
    asset: 'BTC',
    side: 'SELL',
    priceUsd: '0.01',
    minAmount: '0.001',
    maxAmount: '1',
    paymentMethod: 'PIX',
    paymentDetails: 'nonparty-authority-example-pix-key',
  })
  const trade = await buyer.openp2p.trade(offer.id, '0.01')
  await buyer.settlement.setPayoutAddress({
    asset: 'BTC',
    address: 'example-buyer-payout-address',
  })

  const escrow = await seller.settlement.create({
    tradeId: trade.id,
    lockedAmount: '0.01',
    asset: 'BTC',
    type: 'MOCK',
  })
  await seller.settlement.lock(escrow.id)

  let observed = await seller.settlement.get(escrow.id)
  assertStatus(observed, 'FUNDS_LOCKED', 'before-outsider-payment-sent')

  console.log('[3] Authenticated outsider attempts buyer-only markPaymentSent')
  await expectForbidden('markPaymentSent', () => outsider.settlement.markPaymentSent(escrow.id))
  observed = await seller.settlement.get(escrow.id)
  assertStatus(observed, 'FUNDS_LOCKED', 'after-rejected-outsider-payment-sent')

  console.log('[4] Real buyer marks payment sent')
  await buyer.settlement.markPaymentSent(escrow.id)
  observed = await seller.settlement.get(escrow.id)
  assertStatus(observed, 'PAYMENT_PENDING', 'after-legitimate-buyer-payment-sent')

  console.log('[5] Authenticated outsider attempts seller-only release')
  await expectForbidden('release', () => outsider.settlement.release(escrow.id))
  observed = await seller.settlement.get(escrow.id)
  assertStatus(observed, 'PAYMENT_PENDING', 'after-rejected-outsider-release')

  console.log('[6] Authenticated outsider attempts party-only dispute')
  await expectForbidden('dispute', () =>
    outsider.settlement.dispute(
      escrow.id,
      'Unauthorized third party must not be able to open a dispute on this escrow.',
    ),
  )
  observed = await seller.settlement.get(escrow.id)
  assertStatus(observed, 'PAYMENT_PENDING', 'after-rejected-outsider-dispute')

  console.log('[7] Real seller releases successfully')
  await seller.settlement.release(escrow.id)

  const finalEscrow = await seller.settlement.get(escrow.id)
  const finalTrade = await seller.openp2p.getTrade(trade.id)
  assertStatus(finalEscrow, 'COMPLETED', 'after-legitimate-seller-release')

  if (finalTrade.status !== 'COMPLETED') {
    throw new Error(`Trade did not reach COMPLETED; got ${finalTrade.status}`)
  }

  console.log(
    `EVIDENCE tradeId=${finalTrade.id} tradeStatus=${finalTrade.status} escrowId=${finalEscrow.id} escrowStatus=${finalEscrow.status} escrowType=${finalEscrow.type} sellerId=${sellerAuth.participantId} buyerId=${buyerAuth.participantId} outsiderId=${outsiderAuth.participantId} rejectedActions=3`,
  )
  console.log('Done — authenticated non-party was denied on all economic mutations and legitimate parties completed the lifecycle.')
}

main().catch((err) => {
  console.error('Failed:', err instanceof Error ? `${err.name}: ${err.message}` : err)
  process.exitCode = 1
})
