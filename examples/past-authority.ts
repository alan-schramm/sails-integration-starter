import { createHash } from 'node:crypto'
import nacl from 'tweetnacl'
import { SailsClient, SailsForbiddenError, hashAuthorityDecision, type Ed25519Keypair } from '@satsails/p2p-trading-sdk'

const BASE_URL = process.env.SAILS_BASE_URL ?? 'http://127.0.0.1:3000'

function deterministicKeypair(label: string): Ed25519Keypair {
  const seed = createHash('sha256').update(label).digest()
  const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(seed))
  return { publicKey: kp.publicKey, secretKey: kp.secretKey }
}

async function authenticateDeterministic(client: SailsClient, keypair: Ed25519Keypair, displayName: string): Promise<string> {
  try {
    const auth = await client.identity.authenticate(keypair)
    return auth.participantId
  } catch {
    const created = await client.identity.create(keypair, displayName)
    await client.identity.authenticate(keypair)
    return created.participant.id
  }
}

function signer(keypair: Ed25519Keypair) {
  return { signMessage: async (message: Uint8Array): Promise<Uint8Array> => nacl.sign.detached(message, keypair.secretKey) }
}

async function runConcurrentRace<T, U>(left: () => Promise<T>, right: () => Promise<U>) {
  const gate = Promise.withResolvers<void>()
  const arm = async <R>(fn: () => Promise<R>) => {
    await gate.promise
    return fn()
  }
  const leftPromise = arm(left)
  const rightPromise = arm(right)
  gate.resolve()
  return Promise.allSettled([leftPromise, rightPromise])
}

async function main() {
  const oldArbiterClient = new SailsClient({ baseUrl: BASE_URL })
  const newArbiterClient = new SailsClient({ baseUrl: BASE_URL })
  const seller = new SailsClient({ baseUrl: BASE_URL })
  const buyer = new SailsClient({ baseUrl: BASE_URL })
  const oldKeypair = deterministicKeypair('sails-beta-206-old-arbiter-v1')
  const newKeypair = deterministicKeypair('sails-beta-206-new-arbiter-v1')

  const oldArbiterId = await authenticateDeterministic(oldArbiterClient, oldKeypair, 'Beta #206 - Old Arbiter')
  const oldProfile = await oldArbiterClient.arbitration.register('1', 'BTC')
  if (oldProfile.participantId !== oldArbiterId) throw new Error('Old arbiter registration participant mismatch')
  console.log('OLD_ARBITER participantId=' + oldArbiterId + ' collateral=' + oldProfile.monetaryCollateral)

  const sellerCreated = await seller.identity.create(undefined, 'Beta #206 - Seller')
  await seller.identity.authenticate(sellerCreated.keypair)
  const buyerCreated = await buyer.identity.create(undefined, 'Beta #206 - Buyer')
  await buyer.identity.authenticate(buyerCreated.keypair)
  console.log('PARTIES sellerId=' + sellerCreated.participant.id + ' buyerId=' + buyerCreated.participant.id)

  const offer = await seller.liquidity.publish({
    asset: 'BTC', side: 'SELL', priceUsd: '0.01', minAmount: '0.001', maxAmount: '1',
    paymentMethod: 'PIX', paymentDetails: 'beta-206-pix-key'
  })
  const trade = await buyer.openp2p.trade(offer.id, '0.01')
  await buyer.settlement.setPayoutAddress({ asset: 'BTC', address: 'beta-206-buyer-payout-address' })
  const escrow = await seller.settlement.create({ tradeId: trade.id, lockedAmount: '0.01', asset: 'BTC', type: 'MOCK' })
  await seller.settlement.lock(escrow.id)
  const locked = await seller.settlement.get(escrow.id)
  if (locked.status !== 'FUNDS_LOCKED' || locked.type !== 'MOCK') throw new Error('Expected MOCK/FUNDS_LOCKED; got ' + locked.type + '/' + locked.status)
  await buyer.settlement.markPaymentSent(escrow.id)

  const dispute = await buyer.settlement.dispute(escrow.id, 'Beta #206 deterministic past-authority invalidation scenario')
  if (dispute.arbiterId !== oldArbiterId) throw new Error('Initial arbiter mismatch: expected ' + oldArbiterId + ', got ' + dispute.arbiterId)
  console.log('FIRST_ASSIGNMENT disputeId=' + dispute.id + ' arbiterId=' + dispute.arbiterId + ' appealRound=' + dispute.appealRound)

  const firstResolved = await oldArbiterClient.settlement.resolveDisputeWithWallet(dispute.id, 'RELEASE', signer(oldKeypair))
  if (firstResolved.status !== 'RESOLVED' || firstResolved.ruling !== 'RELEASE') throw new Error('First ruling did not resolve as RELEASE')
  console.log('FIRST_RULING disputeId=' + firstResolved.id + ' status=' + firstResolved.status + ' ruling=' + firstResolved.ruling)

  const newArbiterId = await authenticateDeterministic(newArbiterClient, newKeypair, 'Beta #206 - New Arbiter')
  const newProfile = await newArbiterClient.arbitration.register('1', 'BTC')
  if (newProfile.participantId !== newArbiterId) throw new Error('New arbiter registration participant mismatch')
  console.log('NEW_ARBITER participantId=' + newArbiterId + ' collateral=' + newProfile.monetaryCollateral)

  const appeal = await buyer.settlement.appealDispute(dispute.id)
  const appealed = appeal.dispute
  if (appealed.status !== 'APPEALED' || appealed.appealRound !== 1 || appealed.previousArbiterId !== oldArbiterId || appealed.arbiterId !== newArbiterId) {
    throw new Error('Unexpected appeal state: status=' + appealed.status + ' round=' + appealed.appealRound + ' previous=' + appealed.previousArbiterId + ' current=' + appealed.arbiterId)
  }
  console.log('APPEAL_STATE disputeId=' + appealed.id + ' status=' + appealed.status + ' appealRound=' + appealed.appealRound + ' previousArbiterId=' + appealed.previousArbiterId + ' arbiterId=' + appealed.arbiterId)

  const staleIssuedAt = new Date().toISOString()
  const staleDigest = hashAuthorityDecision({
    disputeId: appealed.id, escrowId: appealed.escrowId, appealRound: appealed.appealRound,
    authorityId: oldArbiterId, outcome: 'RELEASE', buyerBps: null, issuedAt: staleIssuedAt
  })
  const staleSignature = Buffer.from(nacl.sign.detached(staleDigest, oldKeypair.secretKey)).toString('hex')

  let rejection: SailsForbiddenError | null = null
  try {
    await oldArbiterClient.settlement.resolveDispute(appealed.id, 'RELEASE', undefined, undefined, undefined, staleSignature, staleIssuedAt)
    throw new Error('Old arbiter stale resolution unexpectedly succeeded')
  } catch (err) {
    if (err instanceof SailsForbiddenError) rejection = err
    else throw err
  }
  if (!rejection || rejection.code !== 'FORBIDDEN' || rejection.statusCode !== 403) throw new Error('Expected SailsForbiddenError/FORBIDDEN/403')
  console.log('STALE_AUTHORITY_REJECTED class=' + rejection.name + ' code=' + rejection.code + ' status=' + rejection.statusCode)

  // #225 external race evidence. Both requests are armed before the same
  // local barrier is released, then race through the published SDK against
  // the live node. This deliberately does NOT claim deterministic lock-entry
  // ordering: the protocol must serialize either winner safely.
  //
  // We first need a fresh RESOLVED generation whose current arbiter is the
  // new arbiter. Resolve round 1, then race a second appeal against a stale
  // replay from that same round. The stale request is signed before the
  // barrier so signing/getDispute latency cannot accidentally serialize the
  // HTTP requests for us.
  const roundOne = await newArbiterClient.settlement.resolveDisputeWithWallet(
    dispute.id, 'RELEASE', signer(newKeypair)
  )
  if (roundOne.status !== 'RESOLVED' || roundOne.appealRound !== 1) {
    throw new Error('Expected round 1 to be RESOLVED before race')
  }

  const raceIssuedAt = new Date().toISOString()
  const raceDigest = hashAuthorityDecision({
    disputeId: roundOne.id, escrowId: roundOne.escrowId, appealRound: roundOne.appealRound,
    authorityId: newArbiterId, outcome: 'RELEASE', buyerBps: null, issuedAt: raceIssuedAt
  })
  const raceSignature = Buffer.from(nacl.sign.detached(raceDigest, newKeypair.secretKey)).toString('hex')

  const race = await runConcurrentRace(
    () => newArbiterClient.settlement.resolveDispute(
      roundOne.id, 'RELEASE', undefined, undefined, undefined, raceSignature, raceIssuedAt
    ),
    () => buyer.settlement.appealDispute(roundOne.id),
  )
  const raceState = await buyer.settlement.getDispute(roundOne.id)
  const summary = race.map((result) => result.status === 'fulfilled'
    ? 'fulfilled'
    : 'rejected:' + (result.reason instanceof Error ? result.reason.name : typeof result.reason)
  ).join(',')
  console.log(
    'RACE_EVIDENCE disputeId=' + roundOne.id +
    ' startRound=1 results=' + summary +
    ' finalStatus=' + raceState.status +
    ' finalRound=' + raceState.appealRound +
    ' currentArbiterId=' + raceState.arbiterId
  )

  // At most one authority-moving operation may succeed. If appeal wins,
  // generation must advance. If the stale resolve wins/rejects first, the
  // final state must still be a valid serialized state, never a hybrid.
  const fulfilled = race.filter((result) => result.status === 'fulfilled').length
  if (fulfilled > 1) throw new Error('Race allowed both competing authority transitions to succeed')
  if (raceState.appealRound < 1 || raceState.appealRound > 2) {
    throw new Error('Race produced impossible appeal generation: ' + raceState.appealRound)
  }
  if (raceState.appealRound === 2 && raceState.status !== 'APPEALED') {
    throw new Error('Advanced race generation is not APPEALED')
  }

  const finalDispute = await buyer.settlement.getDispute(dispute.id)
  if (finalDispute.status !== 'APPEALED' || finalDispute.appealRound !== 1 || finalDispute.previousArbiterId !== oldArbiterId || finalDispute.arbiterId !== newArbiterId) {
    throw new Error('Post-rejection state mutated')
  }
  console.log('POST_REJECTION disputeId=' + finalDispute.id + ' status=' + finalDispute.status + ' appealRound=' + finalDispute.appealRound + ' previousArbiterId=' + finalDispute.previousArbiterId + ' arbiterId=' + finalDispute.arbiterId)
  console.log('EVIDENCE tradeId=' + trade.id + ' escrowId=' + escrow.id + ' escrowType=MOCK disputeId=' + dispute.id + ' oldArbiterId=' + oldArbiterId + ' newArbiterId=' + newArbiterId + ' rejectionClass=' + rejection.name + ' rejectionCode=' + rejection.code + ' rejectionStatus=' + rejection.statusCode + ' finalStatus=' + finalDispute.status + ' appealRound=' + finalDispute.appealRound)
}

main().catch((err) => { console.error('BETA_206_FAILED', err); process.exitCode = 1 })
