/**
 * Fase 6 — dispute/arbitration example: a trade goes wrong, the buyer
 * raises a dispute (`settlement.dispute`), and a Trusted Arbitrator
 * (RFC-007 D4) resolves it (`settlement.resolveDispute`) — the real
 * escalation path, not a simulated one.
 *
 * Real, load-bearing setup requirement this script depends on and
 * documents rather than hides: `resolveDispute()` only succeeds for
 * whichever participantId the running node's own `TRUSTED_ARBITRATORS`
 * env var lists (`arbitration-provider.ts`'s `TrustedArbitratorProvider`,
 * assigned round-robin in `dispute.service.ts`'s `raiseDispute()`). This
 * script authenticates as a FIXED, deterministic identity (derived from a
 * hardcoded seed below, purely for repeatable local demos — never do this
 * for a real arbiter) specifically so it can be registered once and
 * referenced by the same participantId on every run. Before running this
 * for the first time against a fresh node:
 *
 *   1. Run this script once anyway — it prints the fixed arbiter's
 *      participantId and, if that id isn't in TRUSTED_ARBITRATORS yet,
 *      stops with a clear message instead of guessing or faking a result.
 *   2. Add the printed id to the repo root's `.env`
 *      (`TRUSTED_ARBITRATORS=<id>`) and restart `npm run dev`.
 *   3. Run this script again — it now resolves the dispute for real.
 *
 * Escrow type: this standalone demo passes `type: 'MOCK'` explicitly.
 * BTC without an explicit type now selects the real MULTISIG provider in
 * SDK 0.2.0, which correctly requires real funding and is not appropriate
 * for an unattended demo.
 *
 * Resolution uses `resolveDisputeWithWallet()`: SDK 0.2.0 requires a
 * signed authority decision from the assigned arbiter. The deterministic
 * demo arbiter signs that decision locally; its secret key never goes to
 * the Sails node.
 *
 * Run: npm run example:escrow-with-arbitration
 */
import { createHash } from 'node:crypto'
import nacl from 'tweetnacl'
import { SailsClient, type Ed25519Keypair } from '@satsails/p2p-trading-sdk'

const BASE_URL = process.env.SAILS_BASE_URL ?? 'http://localhost:3000'
const ARBITER_BOOTSTRAP_ONLY = process.env.SAILS_ARBITER_BOOTSTRAP_ONLY === 'true'
const EXPECTED_ARBITER_ID = process.env.SAILS_EXPECTED_ARBITER_ID

// Deterministic across runs so the same participant (and therefore the
// same participantId, once registered) comes back every time — see the
// header comment above for why that matters here specifically.
const ARBITER_SEED_STRING = 'sails-example-escrow-arbitration-fixed-arbiter-seed-v1'

function fixedArbiterKeypair(): Ed25519Keypair {
  const seed = createHash('sha256').update(ARBITER_SEED_STRING).digest()
  const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(seed))
  return { publicKey: kp.publicKey, secretKey: kp.secretKey }
}

let stepNumber = 0
function step(label: string): void {
  stepNumber += 1
  console.log(`\n[${stepNumber}] ${label}`)
}

async function main() {
  const arbiterClient = new SailsClient({ baseUrl: BASE_URL })

  step('Arbiter authenticates with the fixed demo identity (registers it on first run only)')
  const arbiterKeypair = fixedArbiterKeypair()
  let arbiter
  try {
    const authResult = await arbiterClient.identity.authenticate(arbiterKeypair)
    arbiter = await arbiterClient.identity.get(authResult.participantId)
    console.log(`    fixed arbiter already registered: ${arbiter.id}`)
  } catch {
    const created = await arbiterClient.identity.create(arbiterKeypair, 'Sails Integration Starter — Fixed Demo Arbiter')
    arbiter = created.participant
    await arbiterClient.identity.authenticate(arbiterKeypair)
    console.log(`    fixed arbiter registered for the first time: ${arbiter.id}`)
  }
  console.log(`\n    >>> Arbiter participantId: ${arbiter.id}`)
  console.log(`ARBITER_EVIDENCE participantId=${arbiter.id}`)
  console.log('    >>> This must appear in the running node\'s TRUSTED_ARBITRATORS env var (see this file\'s header).\n')

  if (ARBITER_BOOTSTRAP_ONLY) {
    console.log('Arbiter bootstrap complete; no economic lifecycle executed.')
    return
  }

  if (!EXPECTED_ARBITER_ID) {
    throw new Error('SAILS_EXPECTED_ARBITER_ID is required for the bounded dispute evidence run')
  }
  if (arbiter.id !== EXPECTED_ARBITER_ID) {
    throw new Error(`Configured expected arbiter ${EXPECTED_ARBITER_ID} does not match deterministic identity ${arbiter.id}`)
  }

  const sellerWallet = new SailsClient({ baseUrl: BASE_URL })
  const buyerWallet = new SailsClient({ baseUrl: BASE_URL })

  step('Seller registers and authenticates')
  const { keypair: sellerKeypair } = await sellerWallet.identity.create(undefined, 'Escrow Arbitration — Seller')
  await sellerWallet.identity.authenticate(sellerKeypair)
  console.log('    seller session established')

  step('Buyer registers and authenticates')
  const { keypair: buyerKeypair } = await buyerWallet.identity.create(undefined, 'Escrow Arbitration — Buyer')
  await buyerWallet.identity.authenticate(buyerKeypair)
  console.log('    buyer session established')

  step('Seller publishes a BTC/SELL offer, buyer opens a trade')
  const offer = await sellerWallet.liquidity.publish({
    asset: 'BTC',
    side: 'SELL',
    priceUsd: '0.01',
    minAmount: '0.001',
    maxAmount: '1',
    paymentMethod: 'PIX',
    paymentDetails: 'escrow-with-arbitration-example-pix-key',
  })
  const trade = await buyerWallet.openp2p.trade(offer.id, '0.01')
  console.log(`    trade ${trade.id} created against offer ${offer.id}`)

  step('Buyer registers the authoritative BTC payout address')
  await buyerWallet.settlement.setPayoutAddress({
    asset: 'BTC',
    address: 'example-buyer-payout-address',
  })

  step('Seller creates and locks the escrow, buyer marks payment sent')
  const escrow = await sellerWallet.settlement.create({
    tradeId: trade.id,
    lockedAmount: '0.01',
    asset: 'BTC',
    type: 'MOCK',
  })
  await sellerWallet.settlement.lock(escrow.id)
  const lockedEscrow = await sellerWallet.settlement.get(escrow.id)
  if (lockedEscrow.status !== 'FUNDS_LOCKED') {
    throw new Error(`Escrow did not reach FUNDS_LOCKED after lock(); got ${lockedEscrow.status}`)
  }
  console.log(`    escrow status after lock: ${lockedEscrow.status} (id: ${lockedEscrow.id}, type: ${lockedEscrow.type})`)
  await buyerWallet.settlement.markPaymentSent(escrow.id)
  console.log('    payment marked sent')

  step('Buyer raises a dispute (settlement.dispute) — e.g. seller went silent after payment')
  let dispute
  try {
    dispute = await buyerWallet.settlement.dispute(
      escrow.id,
      'I sent the PIX payment over an hour ago and the seller has not released the escrow or responded in chat.'
    )
  } catch (err) {
    console.error('\nCould not raise the dispute:', err instanceof Error ? err.message : err)
    console.error('This is almost certainly the TRUSTED_ARBITRATORS gap described in this file\'s header — see the arbiter participantId printed above.')
    process.exitCode = 1
    return
  }
  console.log(`    dispute ${dispute.id} opened, assigned to arbiter ${dispute.arbiterId}`)

  if (dispute.arbiterId !== EXPECTED_ARBITER_ID || dispute.arbiterId !== arbiter.id) {
    console.error(
      `\nThe assigned arbiter (${dispute.arbiterId}) is not this script's fixed demo identity (${arbiter.id}). ` +
      'TrustedArbitratorProvider assigns round-robin across every id in TRUSTED_ARBITRATORS — if you\'ve added ' +
      'other arbiters too, re-run this script until it lands on the fixed one, or trim TRUSTED_ARBITRATORS down ' +
      'to just this id for a deterministic demo.'
    )
    process.exitCode = 1
    return
  }

  step('Arbiter reviews and signs a RELEASE authority decision')
  const arbiterSigner = {
    signMessage: async (message: Uint8Array): Promise<Uint8Array> =>
      nacl.sign.detached(message, arbiterKeypair.secretKey),
  }
  const resolved = await arbiterClient.settlement.resolveDisputeWithWallet(
    dispute.id,
    'RELEASE',
    arbiterSigner,
  )
  console.log(`    dispute ${resolved.id} resolved: status=${resolved.status}, ruling=${resolved.ruling}`)

  const finalEscrow = await sellerWallet.settlement.get(escrow.id)
  const finalTrade = await sellerWallet.openp2p.getTrade(trade.id)

  if (resolved.status !== 'RESOLVED') {
    throw new Error(`Dispute did not reach RESOLVED; got ${resolved.status}`)
  }
  if (resolved.ruling !== 'RELEASE') {
    throw new Error(`Dispute ruling was not RELEASE; got ${resolved.ruling}`)
  }
  if (finalEscrow.status !== 'COMPLETED') {
    throw new Error(`Escrow did not reach COMPLETED; got ${finalEscrow.status}`)
  }

  console.log(`    final escrow status: ${finalEscrow.status}, txReleaseId: ${finalEscrow.txReleaseId ?? '(none — MOCK provider)'}`)
  console.log(
    `\nEVIDENCE tradeId=${finalTrade.id} tradeStatus=${finalTrade.status} escrowId=${finalEscrow.id} escrowStatus=${finalEscrow.status} escrowType=${finalEscrow.type} disputeId=${resolved.id} disputeStatus=${resolved.status} ruling=${resolved.ruling} arbiterId=${dispute.arbiterId}`
  )

  console.log('\nDone — real dispute -> assign -> resolve -> release flow completed end-to-end.')
}

main().catch((err) => {
  console.error('\nFailed:', err instanceof Error ? err.message : err)
  console.error(`\nIs a Sails node running at ${BASE_URL}? Start one with "npm run dev" from the repo root.`)
  process.exitCode = 1
})
