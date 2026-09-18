/**
 * Beta scenario #208 — Economic Disposition Authority != Destination Authority.
 *
 * A trusted arbiter signs RELEASE while supplying an attacker-controlled
 * releaseToAddress. The protocol must ignore that destination and execute
 * to the buyer's own registered PayoutAddress.
 */
import { createHash } from 'node:crypto'
import nacl from 'tweetnacl'
import { SailsClient, type Ed25519Keypair } from '@satsails/p2p-trading-sdk'

const BASE_URL = process.env.SAILS_BASE_URL ?? 'http://localhost:3000'
const ARBITER_BOOTSTRAP_ONLY = process.env.SAILS_ARBITER_BOOTSTRAP_ONLY === 'true'
const EXPECTED_ARBITER_ID = process.env.SAILS_EXPECTED_ARBITER_ID

const ARBITER_SEED_STRING = 'sails-destination-authority-fixed-arbiter-seed-v1'
const BENEFICIARY_ADDRESS = 'beneficiary-authoritative-btc-address'
const ATTACKER_ADDRESS = 'attacker-substituted-btc-address'

function fixedArbiterKeypair(): Ed25519Keypair {
  const seed = createHash('sha256').update(ARBITER_SEED_STRING).digest()
  const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(seed))
  return { publicKey: kp.publicKey, secretKey: kp.secretKey }
}

async function main() {
  const arbiterClient = new SailsClient({ baseUrl: BASE_URL })
  const arbiterKeypair = fixedArbiterKeypair()

  let arbiter
  try {
    const auth = await arbiterClient.identity.authenticate(arbiterKeypair)
    arbiter = await arbiterClient.identity.get(auth.participantId)
  } catch {
    const created = await arbiterClient.identity.create(
      arbiterKeypair,
      'Destination Authority — Fixed Arbiter',
    )
    arbiter = created.participant
    await arbiterClient.identity.authenticate(arbiterKeypair)
  }

  console.log(`ARBITER_EVIDENCE participantId=${arbiter.id}`)

  if (ARBITER_BOOTSTRAP_ONLY) {
    console.log('Arbiter bootstrap complete.')
    return
  }

  if (!EXPECTED_ARBITER_ID) {
    throw new Error('SAILS_EXPECTED_ARBITER_ID is required')
  }
  if (arbiter.id !== EXPECTED_ARBITER_ID) {
    throw new Error(
      `Expected arbiter ${EXPECTED_ARBITER_ID}, deterministic arbiter is ${arbiter.id}`,
    )
  }

  const seller = new SailsClient({ baseUrl: BASE_URL })
  const buyer = new SailsClient({ baseUrl: BASE_URL })

  const sellerIdentity = await seller.identity.create(undefined, 'Destination Authority — Seller')
  const sellerAuth = await seller.identity.authenticate(sellerIdentity.keypair)
  const buyerIdentity = await buyer.identity.create(undefined, 'Destination Authority — Buyer')
  const buyerAuth = await buyer.identity.authenticate(buyerIdentity.keypair)

  console.log(`PARTICIPANT_EVIDENCE role=seller participantId=${sellerAuth.participantId}`)
  console.log(`PARTICIPANT_EVIDENCE role=buyer participantId=${buyerAuth.participantId}`)

  const offer = await seller.liquidity.publish({
    asset: 'BTC',
    side: 'SELL',
    priceUsd: '0.01',
    minAmount: '0.001',
    maxAmount: '1',
    paymentMethod: 'PIX',
    paymentDetails: 'destination-authority-example-pix-key',
  })
  const trade = await buyer.openp2p.trade(offer.id, '0.01')

  await buyer.settlement.setPayoutAddress({
    asset: 'BTC',
    address: BENEFICIARY_ADDRESS,
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

  const dispute = await buyer.settlement.dispute(
    escrow.id,
    'Destination authority adversarial validation.',
  )
  if (dispute.arbiterId !== EXPECTED_ARBITER_ID) {
    throw new Error(
      `Assigned arbiter mismatch: expected ${EXPECTED_ARBITER_ID}, got ${dispute.arbiterId}`,
    )
  }

  console.log(
    `DESTINATION_INPUT beneficiary=${BENEFICIARY_ADDRESS} attacker=${ATTACKER_ADDRESS}`,
  )

  const arbiterSigner = {
    signMessage: async (message: Uint8Array): Promise<Uint8Array> =>
      nacl.sign.detached(message, arbiterKeypair.secretKey),
  }

  const resolved = await arbiterClient.settlement.resolveDisputeWithWallet(
    dispute.id,
    'RELEASE',
    arbiterSigner,
    ATTACKER_ADDRESS,
  )

  const finalEscrow = await seller.settlement.get(escrow.id)
  const finalTrade = await seller.openp2p.getTrade(trade.id)

  if (resolved.status !== 'RESOLVED' || resolved.ruling !== 'RELEASE') {
    throw new Error(
      `Expected RESOLVED/RELEASE, got ${resolved.status}/${resolved.ruling}`,
    )
  }
  if (finalEscrow.status !== 'COMPLETED') {
    throw new Error(`Expected escrow COMPLETED, got ${finalEscrow.status}`)
  }

  const txReleaseId = finalEscrow.txReleaseId
  if (!txReleaseId) {
    throw new Error('Expected MOCK txReleaseId evidence, got null')
  }

  const beneficiaryPrefix = BENEFICIARY_ADDRESS.slice(0, 8)
  const attackerPrefix = ATTACKER_ADDRESS.slice(0, 8)

  if (!txReleaseId.includes(`-to-${beneficiaryPrefix}`)) {
    throw new Error(
      `Release destination mismatch: txReleaseId does not prove beneficiary prefix ${beneficiaryPrefix}: ${txReleaseId}`,
    )
  }
  if (txReleaseId.includes(`-to-${attackerPrefix}`)) {
    throw new Error(
      `Destination substitution succeeded unexpectedly: ${txReleaseId}`,
    )
  }

  console.log(
    `DESTINATION_EVIDENCE txReleaseId=${txReleaseId} beneficiaryPrefix=${beneficiaryPrefix} attackerPrefix=${attackerPrefix} substitutionRejected=true`,
  )
  console.log(
    `EVIDENCE tradeId=${finalTrade.id} tradeStatus=${finalTrade.status} escrowId=${finalEscrow.id} escrowStatus=${finalEscrow.status} escrowType=${finalEscrow.type} disputeId=${resolved.id} disputeStatus=${resolved.status} ruling=${resolved.ruling} arbiterId=${dispute.arbiterId} destinationAuthority=BENEFICIARY`,
  )
}

main().catch((err) => {
  console.error('Failed:', err instanceof Error ? `${err.name}: ${err.message}` : err)
  process.exitCode = 1
})
