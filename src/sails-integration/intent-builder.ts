/**
 * Helpers for the published SDK 0.2.0 TradeIntentPayload shape.
 *
 * Only negotiate() remains intentionally unavailable on the Intent facade.
 * submitProof(), releaseAsset(), dispute(), createIntent() and cancelIntent()
 * are real public surfaces. This file only builds TradeIntent payloads; it
 * does not duplicate protocol validation.
 */
import type { TradeIntentPayload, AssetType, TradeSide } from '@satsails/p2p-trading-sdk'

export interface BuildTradeIntentInput {
  asset: AssetType | string
  side: TradeSide
  maxValue?: string
  minValue?: string
  currency?: string
  fiatMethod?: string
  network?: string
  slippageTolerance?: number
  minReputationRating?: number
}

// RFC-009 — priceUsd/amount/lockedAmount/maxValue/minValue must always
// be decimal strings, never a JS `number`, to avoid float precision
// loss once these values cross a JSON boundary and get persisted. This
// runtime check exists specifically so a caller passing a number by
// mistake fails loudly here, not silently 400s (or worse, silently
// rounds) three network hops away inside the real server.
function assertDecimalString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new TypeError(`${field} must be a decimal string (e.g. "100.00"), never a number — RFC-009. Got: ${typeof value}`)
  }
}

export function buildTradeIntentPayload(input: BuildTradeIntentInput): TradeIntentPayload {
  if (input.maxValue !== undefined) assertDecimalString(input.maxValue, 'maxValue')
  if (input.minValue !== undefined) assertDecimalString(input.minValue, 'minValue')

  const payload: TradeIntentPayload = { asset: input.asset, side: input.side }
  if (input.maxValue !== undefined) payload.maxValue = input.maxValue
  if (input.minValue !== undefined) payload.minValue = input.minValue
  if (input.currency !== undefined) payload.currency = input.currency
  if (input.fiatMethod !== undefined) payload.fiatMethod = input.fiatMethod
  if (input.network !== undefined) payload.network = input.network
  if (input.slippageTolerance !== undefined) payload.slippageTolerance = input.slippageTolerance
  if (input.minReputationRating !== undefined) payload.minReputationRating = input.minReputationRating
  return payload
}

export function buildBuyIntent(asset: AssetType | string, opts: Omit<BuildTradeIntentInput, 'asset' | 'side'> = {}): TradeIntentPayload {
  return buildTradeIntentPayload({ ...opts, asset, side: 'BUY' })
}

export function buildSellIntent(asset: AssetType | string, opts: Omit<BuildTradeIntentInput, 'asset' | 'side'> = {}): TradeIntentPayload {
  return buildTradeIntentPayload({ ...opts, asset, side: 'SELL' })
}
