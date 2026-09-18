/**
 * Beta scenario #206 — previous arbiter loses authority after a completed
 * appeal/reassignment. Sequential only; does not exercise the in-flight
 * appeal/resolve race that remains architecturally blocked.
 *
 * Run:
 *   npm run example:previous-arbiter-after-appeal
 */
import nacl from 'tweetnacl'
import {
  SailsClient,
  SailsForbiddenError,
  type Ed25519Keypair,
} from '@satsails/p2p-trading-sdk'

const BASE_URL = process.env.SAILS_BASE_URL ?? 'http://localhost:3000'

function signerFor(keypair: Ed25519Keypair) {
  return {
    signMessage: async (message: Uint8Array): Promise<Uint8Array> =>
      nacl.sign.detached(message, keypair.secretKey),
  }
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
  throw new Error(`${label}: stale authority unexpectedly succeeded`)
}

async function main() {
  const oldArbiter = new SailsClient({ baseUrl: BASE_URL })
  const newArbiter = new SailsClient({ baseUrl: BASE_URL })
  const seller = new SailsClient({ baseUrl: BASE_URL })
  const buyer = new SailsClient({ baseUrl: BASE_URL })

  console.log('[1] Register/authenticate the only initially eligible arbiter')
  const oldCreated = await oldArbiter.identity.create(undefined, 'Appeal Scenario — Old Arbiter')
  const oldAuth = await oldArbiter.identity.authenticate(oldCreated.keypair)
  await oldArbiter.arbitration.register('100')
  console.log(`ARBITER_EVIDENCE role=old participantId=${oldAuth.participantId}`)

  console.log('[2] Register/authenticate seller and buyer')
  const sellerCreated = await seller.identity.create(undefined, 'Appeal Scenario — Seller')
  const sellerAuth = await seller.identity.authenticate(sellerCreated.keypair)
  const buyerCreated = await buyer.identity.create(undefined, 'Appeal Scenario — Buyer')
  const buyerAuth = await buyer.identity.authenticate(buyerCreated.keypair)
  console.log(`PARTICIPANT_EVIDENCE role=seller participantId=${sellerAuth.participantId}`)
  console.log(`PARTICIPANT_EVIDENCE role=buyer participantId=${buyerAuth.participantId}`)

  console.log('[3] Create Trade and explicit MOCK Escrow')
  const offer = await seller.liquidity.publish({
    asset: 'BTC',
    side: 'SELL',
    priceUsd: '0.01',
    minAmount: '0.001',
    maxAmount: '1',
    paymentMethod: 'PIX',
    paymentDetails: 'previous-arbiter-after-appeal-pix-key',
  })
  const trade = await buyer.openp2p.trade(offer.id, '0.01')
  await buyer.settlement.setPayoutAddress({
    asset: 'BTC',
    address: 'appeal-buyer-payout-address',
  })
  const escrow = await seller.settlement.create({
    tradeId: trade.id,
    lockedAmount: '0.01',
    asset: 'BTC',
    type: 'MOCK',
  })
  await seller.settlement.lock(escrow.id)
  const locked = await seller.settlement.get(escrow.id)
  if (locked.status !== 'FUNDS_LOCKED') {
    throw new Error(`Expected FUNDS_LOCKED, got ${locked.status}`)
  }
  await buyer.settlement.markPaymentSent(escrow.id)

  console.log('[4] Buyer raises dispute; only old arbiter is eligible')
  const dispute = await buyer.settlement.dispute(
    escrow.id,
    'Seller did not release after payment; exercising appeal authority lifecycle.',
  )
  if (dispute.arbiterId !== oldAuth.participantId) {
    throw new Error(
      `Initial arbiter mismatch: expected ${oldAuth.participantId}, got ${dispute.arbiterId}`,
    )
  }
  console.log(
    `ASSIGNMENT_EVIDENCE disputeId=${dispute.id} appealRound=${dispute.appealRound} arbiterId=${dispute.arbiterId}`,
  )

  console.log('[5] Old arbiter signs first RELEASE ruling')
  const firstResolved = await oldArbiter.settlement.resolveDisputeWithWallet(
    dispute.id,
    'RELEASE',
    signerFor(oldCreated.keypair),
  )
  if (firstResolved.status !== 'RESOLVED' || firstResolved.ruling !== 'RELEASE') {
    throw new Error(
      `First ruling did not resolve as RELEASE: status=${firstResolved.status} ruling=${firstResolved.ruling}`,
    )
  }
  console.log(
    `FIRST_RULING_EVIDENCE disputeId=${firstResolved.id} status=${firstResolved.status} ruling=${firstResolved.ruling} arbiterId=${oldAuth.participantId}`,
  )

  console.log('[6] Register second arbiter only after first resolution')
  const newCreated = await newArbiter.identity.create(undefined, 'Appeal Scenario — New Arbiter')
  const newAuth = await newArbiter.identity.authenticate(newCreated.keypair)
  await newArbiter.arbitration.register('100')
  console.log(`ARBITER_EVIDENCE role=new participantId=${newAuth.participantId}`)

  console.log('[7] Seller appeals; old arbiter must be excluded from reassignment')
  const appealed = await seller.settlement.appealDispute(dispute.id)
  const appealedDispute = appealed.dispute

  if (appealedDispute.status !== 'APPEALED') {
    throw new Error(`Expected APPEALED, got ${appealedDispute.status}`)
  }
  if (appealedDispute.appealRound !== 1) {
    throw new Error(`Expected appealRound=1, got ${appealedDispute.appealRound}`)
  }
  if (appealedDispute.previousArbiterId !== oldAuth.participantId) {
    throw new Error(
      `previousArbiterId mismatch: expected ${oldAuth.participantId}, got ${appealedDispute.previousArbiterId}`,
    )
  }
  if (appealedDispute.arbiterId !== newAuth.participantId) {
    throw new Error(
      `new arbiter mismatch: expected ${newAuth.participantId}, got ${appealedDispute.arbiterId}`,
    )
  }

  console.log(
    `APPEAL_EVIDENCE disputeId=${appealedDispute.id} status=${appealedDispute.status} appealRound=${appealedDispute.appealRound} previousArbiterId=${appealedDispute.previousArbiterId} arbiterId=${appealedDispute.arbiterId}`,
  )

  console.log('[8] Previous arbiter attempts a stale ruling after reassignment')
  await expectForbidden('oldArbiterResolveAfterAppeal', () =>
    oldArbiter.settlement.resolveDispute(
      dispute.id,
      'REFUND',
      undefined,
      undefined,
      undefined,
      'deadbeef',
      '2026-09-18T00:00:00.000Z',
    ),
  )

  console.log('[9] Legitimate party rereads dispute and proves state was preserved')
  const afterRejected = await seller.settlement.getDispute(dispute.id)
  if (afterRejected.status !== 'APPEALED') {
    throw new Error(`Post-rejection status changed: ${afterRejected.status}`)
  }
  if (afterRejected.appealRound !== 1) {
    throw new Error(`Post-rejection appealRound changed: ${afterRejected.appealRound}`)
  }
  if (afterRejected.previousArbiterId !== oldAuth.participantId) {
    throw new Error('Post-rejection previousArbiterId changed')
  }
  if (afterRejected.arbiterId !== newAuth.participantId) {
    throw new Error('Post-rejection current arbiter changed')
  }
  if (afterRejected.ruling !== null) {
    throw new Error(`Post-rejection stale ruling was written: ${afterRejected.ruling}`)
  }

  console.log(
    `STATE_EVIDENCE disputeId=${afterRejected.id} status=${afterRejected.status} appealRound=${afterRejected.appealRound} previousArbiterId=${afterRejected.previousArbiterId} arbiterId=${afterRejected.arbiterId} ruling=null`,
  )
  console.log(
    `EVIDENCE tradeId=${trade.id} escrowId=${escrow.id} disputeId=${dispute.id} oldArbiterId=${oldAuth.participantId} newArbiterId=${newAuth.participantId} staleResolveRejected=true finalDisputeStatus=${afterRejected.status} appealRound=${afterRejected.appealRound}`,
  )
  console.log('Done — prior-round arbiter lost authority after completed appeal reassignment.')
}

main().catch((err) => {
  console.error('Failed:', err instanceof Error ? `${err.name}: ${err.message}` : err)
  process.exitCode = 1
})
