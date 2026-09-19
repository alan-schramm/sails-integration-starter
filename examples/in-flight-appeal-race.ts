/**
 * Issue #225 — [Beta Scenario] In-flight arbiter resolve cannot overwrite
 * newer appeal generation.
 *
 * Distinct from #206 (past-authority.ts), which proves the SEQUENTIAL
 * case: the old arbiter's resolve() completes fully BEFORE an appeal ever
 * runs, then a SECOND, later resolve() attempt from the same old arbiter
 * is rejected. This scenario fires the old arbiter's resolve() and the
 * buyer's appeal() as genuinely overlapping, concurrent public-SDK
 * requests against the SAME live node — exercising ADR-005's real
 * Postgres advisory-lock serialization through the HTTP surface, not a
 * mocked transaction.
 *
 * One trial per process invocation, deliberately — MarketArbitrationProvider's
 * assign() (market-arbitration.provider.ts) does a real weighted-random
 * pick across EVERY currently-registered, eligible arbiter, with no
 * unregister/reset endpoint in the public API. Running several trials
 * against one shared node would leave earlier trials' arbiters in later
 * trials' own eligible pool, breaking "the old arbiter is the sole
 * eligible candidate at initial assignment" from the second trial
 * onward. The workflow that runs this script (.github/workflows/
 * in-flight-appeal-race-beta.yml) instead repeats the WHOLE trial via a
 * job matrix, each with its own fresh Postgres/Redis service containers
 * — real process/data isolation between trials, not a harness-side reset
 * hook, which would itself be exactly the kind of direct-DB shortcut
 * this scenario's own brief forbids.
 *
 * AUDIT FINDING (structural, verified directly against the exact frozen
 * merge SHA's source, `dispute.service.ts`, and reproduced live against
 * this exact node before being written up here): `resolveDispute()`'s
 * and `appeal()`'s own top-level preconditions are mutually exclusive on
 * the SAME field —
 *   resolveDispute(): `if (dispute.status === 'RESOLVED') throw ...`
 *   appeal():         `if (dispute.status !== 'RESOLVED') throw ...`
 * — neither guarded by the economic-disposition lock; both are plain,
 * unlocked reads that run before either method does anything else. This
 * makes "appeal's generation commits first, causing a genuinely in-flight,
 * not-yet-committed resolve() of THE SAME (first) round to subsequently
 * lose" structurally unreachable for a dispute's very first ruling:
 * appeal() cannot see status=RESOLVED before resolve() is the very call
 * that sets it, and resolve() cannot lose a lock race to an appeal() that
 * cannot yet exist. The same mutual exclusion recurs at every later round
 * (a round N+1 appeal still requires round N's own resolve to have
 * already committed first). See this repo's PR/#225 evidence for the
 * full reasoning trail and the live confirmation this produced.
 *
 * What IS reachable, and is what this script proves with real overlap:
 *   - the old arbiter's resolve() commits (its generation becomes
 *     current, and for MOCK — a direct-call rail — its settlement action
 *     runs to completion within that same call);
 *   - a buyer appeal() fired at genuinely overlapping wall-clock time is
 *     correctly rejected with a real, typed 400 if its own read still
 *     sees the pre-resolution state — a real, unlocked, independent
 *     precondition, not the ADR-005 lock itself, but no less a genuine
 *     public-contract guarantee that "you cannot appeal a still-open
 *     dispute";
 *   - in every observed case, the dispute's final durable state is
 *     exactly the legal shape — never the forbidden "an in-flight old
 *     generation silently overwrote a newer appeal generation" state.
 *
 * No privileged shortcut is used anywhere in this file: every action is
 * a real `@satsails/p2p-trading-sdk` call against a live node.
 */
import { createHash } from 'node:crypto'
import nacl from 'tweetnacl'
import { SailsClient, SailsForbiddenError, SailsValidationError, hashAuthorityDecision, type Ed25519Keypair } from '@satsails/p2p-trading-sdk'

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

type ErrorEvidence = { class?: string; code?: string; status?: number; message?: string }

function errorEvidence(err: unknown): ErrorEvidence {
  const e = err as { constructor?: { name?: string }; code?: string; statusCode?: number; message?: string }
  return { class: e?.constructor?.name, code: e?.code, status: e?.statusCode, message: e?.message }
}

async function main() {
  const trialId = process.env.BETA_225_TRIAL_ID ?? 'local'
  const oldArbiterClient = new SailsClient({ baseUrl: BASE_URL })
  const newArbiterClient = new SailsClient({ baseUrl: BASE_URL })
  const seller = new SailsClient({ baseUrl: BASE_URL })
  const buyer = new SailsClient({ baseUrl: BASE_URL })
  const oldKeypair = deterministicKeypair(`sails-beta-225-old-arbiter-v1-${trialId}`)
  const newKeypair = deterministicKeypair(`sails-beta-225-new-arbiter-v1-${trialId}`)

  const oldArbiterId = await authenticateDeterministic(oldArbiterClient, oldKeypair, `Beta #225 - Old Arbiter ${trialId}`)
  const oldProfile = await oldArbiterClient.arbitration.register('1', 'BTC')
  if (oldProfile.participantId !== oldArbiterId) throw new Error('Old arbiter registration participant mismatch')
  console.log(`OLD_ARBITER participantId=${oldArbiterId} collateral=${oldProfile.monetaryCollateral}`)

  const sellerCreated = await seller.identity.create(undefined, `Beta #225 - Seller ${trialId}`)
  await seller.identity.authenticate(sellerCreated.keypair)
  const buyerCreated = await buyer.identity.create(undefined, `Beta #225 - Buyer ${trialId}`)
  await buyer.identity.authenticate(buyerCreated.keypair)
  console.log(`PARTIES sellerId=${sellerCreated.participant.id} buyerId=${buyerCreated.participant.id}`)

  const offer = await seller.liquidity.publish({
    asset: 'BTC', side: 'SELL', priceUsd: '0.01', minAmount: '0.001', maxAmount: '1',
    paymentMethod: 'PIX', paymentDetails: `beta-225-pix-key-${trialId}`
  })
  const trade = await buyer.openp2p.trade(offer.id, '0.01')
  await buyer.settlement.setPayoutAddress({ asset: 'BTC', address: `beta-225-buyer-payout-${trialId}` })
  const escrow = await seller.settlement.create({ tradeId: trade.id, lockedAmount: '0.01', asset: 'BTC', type: 'MOCK' })
  await seller.settlement.lock(escrow.id)
  const locked = await seller.settlement.get(escrow.id)
  if (locked.status !== 'FUNDS_LOCKED' || locked.type !== 'MOCK') {
    throw new Error(`Expected MOCK/FUNDS_LOCKED; got ${locked.type}/${locked.status}`)
  }
  await buyer.settlement.markPaymentSent(escrow.id)

  const dispute = await buyer.settlement.dispute(escrow.id, `Beta #225 in-flight overlap trial ${trialId}`)
  if (dispute.arbiterId !== oldArbiterId) {
    throw new Error(`Initial arbiter mismatch: expected ${oldArbiterId}, got ${dispute.arbiterId} — this node's arbiter pool was not exclusively this trial's own old arbiter (see this file's own header on why trials must not share a node)`)
  }
  console.log(`FIRST_ASSIGNMENT disputeId=${dispute.id} arbiterId=${dispute.arbiterId} appealRound=${dispute.appealRound}`)

  // The new arbiter is only registered AFTER the initial assignment —
  // required so it is not itself an eligible candidate for that first
  // assignment (mirrors #206's own established ordering).
  const newArbiterId = await authenticateDeterministic(newArbiterClient, newKeypair, `Beta #225 - New Arbiter ${trialId}`)
  const newProfile = await newArbiterClient.arbitration.register('1', 'BTC')
  if (newProfile.participantId !== newArbiterId) throw new Error('New arbiter registration participant mismatch')
  console.log(`NEW_ARBITER participantId=${newArbiterId} collateral=${newProfile.monetaryCollateral}`)

  // The old arbiter's signed decision is built and signed BEFORE either
  // concurrent request is fired — real ADR-005 client-side authority
  // construction (arbitration-authority.ts's canonical digest), not a
  // privileged shortcut. Only the two real HTTP calls below are timed.
  const issuedAt = new Date().toISOString()
  const digest = hashAuthorityDecision({
    disputeId: dispute.id, escrowId: dispute.escrowId, appealRound: dispute.appealRound,
    authorityId: oldArbiterId, outcome: 'RELEASE', buyerBps: null, issuedAt
  })
  const signature = Buffer.from(nacl.sign.detached(digest, oldKeypair.secretKey)).toString('hex')
  console.log(`SIGNED_DECISION disputeId=${dispute.id} appealRound=${dispute.appealRound} authorityId=${oldArbiterId} outcome=RELEASE issuedAt=${issuedAt} digest=${Buffer.from(digest).toString('hex')}`)

  const overlapStartedAt = Date.now()
  const [resolveSettlement, appealSettlement] = await Promise.allSettled([
    oldArbiterClient.settlement.resolveDispute(dispute.id, 'RELEASE', undefined, undefined, undefined, signature, issuedAt)
      .then((r) => ({ result: r, ms: Date.now() - overlapStartedAt })),
    buyer.settlement.appealDispute(dispute.id)
      .then((r) => ({ result: r, ms: Date.now() - overlapStartedAt })),
  ])

  const resolveMs = resolveSettlement.status === 'fulfilled' ? resolveSettlement.value.ms : -1
  const appealMs = appealSettlement.status === 'fulfilled' ? appealSettlement.value.ms : -1

  let resolveRejection: ErrorEvidence | undefined
  if (resolveSettlement.status === 'rejected') {
    const err = resolveSettlement.reason
    resolveRejection = errorEvidence(err)
    // Legal rejection shapes for the old arbiter's attempt losing the
    // race — see this file's own header. Anything else is unexpected.
    if (!(err instanceof SailsForbiddenError) && !(err instanceof SailsValidationError)) throw err
  }

  let appealRejection: ErrorEvidence | undefined
  if (appealSettlement.status === 'rejected') {
    const err = appealSettlement.reason
    appealRejection = errorEvidence(err)
    // Legal: appeal's own (unlocked, independent) precondition
    // "only a RESOLVED dispute can be appealed" fires when its read
    // lands before resolve's commit — see this file's own header note
    // on why this is the ONLY way appeal can lose this particular race.
    if (!(err instanceof SailsValidationError)) throw err
  }

  console.log(`RESOLVE_ATTEMPT settled=${resolveSettlement.status} ms=${resolveMs}` +
    (resolveRejection ? ` rejectionClass=${resolveRejection.class} rejectionCode=${resolveRejection.code} rejectionStatus=${resolveRejection.status}` : ''))
  console.log(`APPEAL_ATTEMPT settled=${appealSettlement.status} ms=${appealMs}` +
    (appealRejection ? ` rejectionClass=${appealRejection.class} rejectionCode=${appealRejection.code} rejectionStatus=${appealRejection.status} rejectionMessage=${JSON.stringify(appealRejection.message)}` : ''))

  const finalDispute = await buyer.settlement.getDispute(dispute.id)
  console.log(`FINAL_STATE disputeId=${finalDispute.id} status=${finalDispute.status} appealRound=${finalDispute.appealRound} arbiterId=${finalDispute.arbiterId} previousArbiterId=${finalDispute.previousArbiterId} ruling=${finalDispute.ruling}`)

  // Classify which legal shape actually occurred, from the durably
  // observed final state re-read AFTER both requests have settled —
  // never from wall-clock timing alone (the server-side lock, not client
  // request order, is what actually decides). Exactly one of these
  // shapes is legal; anything else is the forbidden state this scenario
  // exists to rule out.
  let ordering: string
  let staleOverwriteDetected = false

  if (finalDispute.appealRound === 1 && finalDispute.arbiterId === newArbiterId && finalDispute.previousArbiterId === oldArbiterId) {
    // Appeal's generation is current. Whether the old arbiter's
    // overlapping resolve() attempt itself fulfilled or was rejected does
    // NOT by itself indicate a stale overwrite — resolve() committing
    // generation 0 and appeal() separately advancing to generation 1
    // AFTERWARD is legitimate, non-overlapping causation (appeal's own
    // write only ever runs once status is already RESOLVED, so it can
    // never race resolve's own single write for the same row version).
    ordering = resolveSettlement.status === 'fulfilled' ? 'RESOLVE_COMMITS_APPEAL_ALSO_SUCCEEDS' : 'APPEAL_COMMITS_RESOLVE_REJECTED'
  } else if (finalDispute.status === 'RESOLVED' && finalDispute.ruling === 'RELEASE' && finalDispute.arbiterId === oldArbiterId && finalDispute.appealRound === 0) {
    // The old arbiter's generation is current. FORBIDDEN only if appeal()
    // itself reported success (durably committed APPEALED/round 1) yet
    // this re-read shows the dispute regressed back to RESOLVED/round 0
    // — that would mean a later resolve() write silently overwrote an
    // already-committed newer appeal generation, exactly the defect
    // ADR-005's generation-bound conditional claims exist to prevent.
    if (appealSettlement.status === 'fulfilled') {
      staleOverwriteDetected = true
      ordering = 'FORBIDDEN_STALE_OVERWRITE'
    } else {
      ordering = 'RESOLVE_COMMITS_APPEAL_TOO_EARLY'
    }
  } else {
    throw new Error(`Final dispute state matches no legal shape — status=${finalDispute.status} appealRound=${finalDispute.appealRound} arbiterId=${finalDispute.arbiterId} previousArbiterId=${finalDispute.previousArbiterId} ruling=${finalDispute.ruling}`)
  }

  if (staleOverwriteDetected) {
    throw new Error('FORBIDDEN STATE: old-generation resolve() committed over a newer appeal generation')
  }

  console.log(`ORDERING ${ordering}`)
  console.log(`EVIDENCE tradeId=${trade.id} escrowId=${escrow.id} escrowType=MOCK disputeId=${dispute.id} oldArbiterId=${oldArbiterId} newArbiterId=${newArbiterId} ordering=${ordering} resolveSettled=${resolveSettlement.status} resolveMs=${resolveMs} appealSettled=${appealSettlement.status} appealMs=${appealMs} finalStatus=${finalDispute.status} finalAppealRound=${finalDispute.appealRound} finalArbiterId=${finalDispute.arbiterId} finalPreviousArbiterId=${finalDispute.previousArbiterId} finalRuling=${finalDispute.ruling} staleOverwriteDetected=${staleOverwriteDetected}`)
}

main().catch((err) => { console.error('BETA_225_FAILED', err); process.exitCode = 1 })
