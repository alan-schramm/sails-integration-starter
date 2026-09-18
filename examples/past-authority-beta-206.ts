/**
 * Beta Scenario #206 — Past Authority != Current Authority
 * External published-SDK scenario against a live Sails node.
 */
import { createHash } from 'node:crypto'
import nacl from 'tweetnacl'
import {
  SailsClient,
  SailsForbiddenError,
  hashAuthorityDecision,
  type Ed25519Keypair,
} from '@satsails/p2p-trading-sdk'

const BASE_URL = process.env.SAILS_BASE_URL ?? 'http://127.0.0.1:3000'

function deterministicKeypair(label: string): Ed25519Keypair {
  const seed = createHash('sha256').update(label).digest()
  const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(seed))
  return { publicKey: kp.publicKey, secretKey: kp.secretKey }
}

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex')
}

async function ensureIdentity(client: SailsClient, keypair: Ed25519Keypair, displayName: string): Promise<string> {
  try {
    const auth = await client.identity.authenticate(keypair)
    return auth.participantId
  } catch {
    const created = await client.identity.create(keypair, displayName)
    await client.identity.authenticate(keypair)
    return created.participant.id
  }
}

async function main() {
  const seller = new SailsClient({ baseUrl: BASE_URL })
  const buyer = new SailsClient({ baseUrl: BASE_URL })
  const oldArbiter = new SailsClient({ baseUrl: BASE_URL })
  const newArbiter = new SailsClient({ baseUrl: BASE_URL })

  const oldKeypair = deterministicKeypair('sails-beta-206-old-arbiter-v1')
  const newKeypair = deterministicKeypair('sails-beta-206-new-arbiter-v1')

  const oldArbiterId = await ensureIdentity(oldArbiter, oldKeypair, 'Beta 206 — Old Arbiter')
  console.log('OLD_ARBITER_ID=' + oldArbiterId)

  const oldProfile = await oldArbiter.arbitration.register('1', 'BTC')
  if (oldProfile.participantId !== oldArbiterId) throw new Error('Old arbiter profile identity mismatch')

  const sellerCreated = await seller.identity.create(undefined, 'Beta 206 — Seller')
  await seller.identity.authenticate(sellerCreated.keypair)
  const buyerCreated = await buyer.identity.create(undefined, 'Beta 206 — Buyer')
  await buyer.identity.authenticate(buyerCreated.keypair)

  console.log('SELLER_ID=' + sellerCreated.participant.id)
  console.log('BUYER_ID=' + buyerCreated.participant.id)

  const offer = await seller.liquidity.publish({
    asset: 'BTC',
    side: 'SELL',
    priceUsd: '0.01',
    minAmount: '0.001',
    maxAmount: '1',
    paymentMethod: 'PIX',
    paymentDetails: 'beta-206-pix-key',
  })

  const trade = await buyer.openp2p.trade(offer.id, '0.01')
  console.log('TRADE_ID=' + trade.id)

  await buyer.settlement.setPayoutAddress({ asset: 'BTC', address: 'beta-206-buyer-payout' })
  await seller.settlement.setPayoutAddress({ asset: 'BTC', address: 'beta-206-seller-payout' })

  const escrow = await seller.settlement.create({
    tradeId: trade.id,
    lockedAmount: '0.01',
    asset: 'BTC',
    type: 'MOCK',
  })
  await seller.settlement.lock(escrow.id)

  const locked = await seller.settlement.get(escrow.id)
  if (locked.status !== 'FUNDS_LOCKED' || locked.type !== 'MOCK') {
    throw new Error('Expected MOCK/FUNDS_LOCKED, got ' + locked.type + '/' + locked.status)
  }
  console.log('ESCROW_ID=' + escrow.id)

  await buyer.settlement.markPaymentSent(escrow.id)

  const opened = await buyer.settlement.dispute(
    escrow.id,
    'Beta #206 deterministic stale-authority scenario',
  )
  if (opened.arbiterId !== oldArbiterId) {
    throw new Error('First arbiter was not deterministic old arbiter: ' + opened.arbiterId)
  }
  console.log('DISPUTE_ID=' + opened.id)
  console.log('FIRST_ARBITER_ID=' + String(opened.arbiterId))

  const oldSigner = {
    signMessage: async (message: Uint8Array): Promise<Uint8Array> =>
      nacl.sign.detached(message, oldKeypair.secretKey),
  }

  const firstResolved = await oldArbiter.settlement.resolveDisputeWithWallet(opened.id, 'RELEASE', oldSigner)
  if (firstResolved.status !== 'RESOLVED' || firstResolved.ruling !== 'RELEASE') {
    throw new Error('Round 0 did not resolve as expected: ' + firstResolved.status + '/' + firstResolved.ruling)
  }
  console.log('FIRST_RULING_STATUS=RESOLVED')
  console.log('FIRST_RULING=RELEASE')

  const newArbiterId = await ensureIdentity(newArbiter, newKeypair, 'Beta 206 — New Arbiter')
  const newProfile = await newArbiter.arbitration.register('1', 'BTC')
  if (newProfile.participantId !== newArbiterId) throw new Error('New arbiter profile identity mismatch')
  console.log('NEW_ARBITER_ID=' + newArbiterId)

  const appealed = await buyer.settlement.appealDispute(opened.id)
  const reassigned = appealed.dispute

  if (reassigned.status !== 'APPEALED') throw new Error('Expected APPEALED, got ' + reassigned.status)
  if (reassigned.appealRound !== 1) throw new Error('Expected appealRound=1, got ' + reassigned.appealRound)
  if (reassigned.previousArbiterId !== oldArbiterId) {
    throw new Error('Wrong previousArbiterId: ' + reassigned.previousArbiterId)
  }
  if (reassigned.arbiterId !== newArbiterId) throw new Error('Wrong current arbiter: ' + reassigned.arbiterId)

  console.log('APPEAL_STATUS=APPEALED')
  console.log('APPEAL_ROUND=1')
  console.log('PREVIOUS_ARBITER_ID=' + String(reassigned.previousArbiterId))
  console.log('CURRENT_ARBITER_ID=' + String(reassigned.arbiterId))

  const staleIssuedAt = new Date().toISOString()
  const staleDigest = hashAuthorityDecision({
    disputeId: reassigned.id,
    escrowId: reassigned.escrowId,
    appealRound: reassigned.appealRound,
    authorityId: oldArbiterId,
    outcome: 'REFUND',
    buyerBps: null,
    issuedAt: staleIssuedAt,
  })
  const staleSignature = toHex(nacl.sign.detached(staleDigest, oldKeypair.secretKey))

  let rejection: unknown
  try {
    await oldArbiter.settlement.resolveDispute(
      reassigned.id,
      'REFUND',
      undefined,
      undefined,
      undefined,
      staleSignature,
      staleIssuedAt,
    )
    throw new Error('Old arbiter unexpectedly retained authority after appeal')
  } catch (err) {
    rejection = err
  }

  if (!(rejection instanceof SailsForbiddenError)) {
    throw rejection instanceof Error
      ? new Error('Expected SailsForbiddenError, got ' + rejection.name + ': ' + rejection.message)
      : new Error('Expected SailsForbiddenError from stale arbiter')
  }
  if (rejection.code !== 'FORBIDDEN' || rejection.statusCode !== 403) {
    throw new Error('Wrong rejection shape: code=' + rejection.code + ' status=' + rejection.statusCode)
  }
  if (!rejection.message.includes('is not the arbiter assigned to dispute')) {
    throw new Error('Authority rejection happened at the wrong boundary: ' + rejection.message)
  }

  console.log('STALE_REJECTION_CLASS=' + rejection.name)
  console.log('STALE_REJECTION_CODE=' + rejection.code)
  console.log('STALE_REJECTION_STATUS=' + rejection.statusCode)

  const finalState = await buyer.settlement.getDispute(reassigned.id)
  if (
    finalState.status !== 'APPEALED' ||
    finalState.appealRound !== 1 ||
    finalState.previousArbiterId !== oldArbiterId ||
    finalState.arbiterId !== newArbiterId ||
    finalState.ruling !== null
  ) {
    throw new Error(
      'Post-rejection state drift: status=' + finalState.status +
      ' round=' + finalState.appealRound +
      ' previous=' + finalState.previousArbiterId +
      ' current=' + finalState.arbiterId +
      ' ruling=' + finalState.ruling,
    )
  }

  console.log(
    'EVIDENCE tradeId=' + trade.id +
    ' escrowId=' + escrow.id +
    ' disputeId=' + reassigned.id +
    ' sellerId=' + sellerCreated.participant.id +
    ' buyerId=' + buyerCreated.participant.id +
    ' oldArbiterId=' + oldArbiterId +
    ' newArbiterId=' + newArbiterId +
    ' status=' + finalState.status +
    ' appealRound=' + finalState.appealRound +
    ' previousArbiterId=' + finalState.previousArbiterId +
    ' currentArbiterId=' + finalState.arbiterId +
    ' ruling=' + (finalState.ruling ?? 'null') +
    ' staleCode=' + rejection.code +
    ' staleStatus=' + rejection.statusCode,
  )
  console.log('BETA_206_RESULT=PASS')
}

main().catch((err) => {
  console.error('BETA_206_RESULT=FAIL')
  console.error(err instanceof Error ? (err.stack ?? err.message) : err)
  process.exitCode = 1
})
