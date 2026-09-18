'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSailsClient } from '@satsails/sdk-react'
import type { AssetType, TradeSide } from '@satsails/p2p-trading-sdk'

function DiscoverOffers() {
  const client = useSailsClient()
  const [asset, setAsset] = useState<AssetType>('BTC')
  const [side, setSide] = useState<TradeSide>('SELL')

  const { data, isLoading, error } = useQuery({
    queryKey: ['discover', asset, side],
    queryFn: () => client.liquidity.discover({ asset, side, limit: 10 }),
  })

  return (
    <section className="rounded-lg border border-slate-800 p-4">
      <h2 className="text-lg font-semibold">Discover offers</h2>
      <p className="text-sm text-slate-400">
        Public registry SDK call through <code>@satsails/sdk-react</code> + <code>@satsails/p2p-trading-sdk</code>.
      </p>
      <div className="mt-3 flex gap-2">
        <select className="rounded bg-slate-800 px-2 py-1" value={asset} onChange={(e) => setAsset(e.target.value as AssetType)}>
          {(['BTC', 'USDT_ERC20', 'LN_BTC'] satisfies AssetType[]).map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <select className="rounded bg-slate-800 px-2 py-1" value={side} onChange={(e) => setSide(e.target.value as TradeSide)}>
          <option value="BUY">BUY</option>
          <option value="SELL">SELL</option>
        </select>
      </div>
      <div className="mt-3 space-y-2">
        {isLoading && <p className="text-slate-500">Loading…</p>}
        {error && <p className="text-red-400">{error instanceof Error ? error.message : 'Failed to load offers'}</p>}
        {data?.offers.length === 0 && <p className="text-slate-500">No offers found for {asset} {side}.</p>}
        {data?.offers.map((offer) => (
          <div key={offer.id} className="rounded border border-slate-800 p-2 text-sm">
            <span className="font-mono">{offer.asset}</span> · {offer.side} · ${offer.priceUsd} · {offer.paymentMethods.join(', ')}
          </div>
        ))}
      </div>
    </section>
  )
}

export default function Home() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-bold">Sails Integration Starter</h1>
        <p className="mt-2 text-sm text-slate-400">
          Registry-consumer reference for the published Sails SDK 0.2.0 family.
        </p>
      </div>

      <DiscoverOffers />

      <section className="rounded-lg border border-slate-800 p-4 text-sm text-slate-300">
        <h2 className="text-lg font-semibold text-slate-100">Authenticated flows</h2>
        <p className="mt-2">
          Trade and escrow reads are party-scoped in 0.2.0. Run the standalone examples for the real authenticated
          buyer/seller flows instead of pasting an unrelated trade id into a public screen.
        </p>
        <code className="mt-3 block text-orange-400">npm run example:p2p-bitcoin-trade</code>
      </section>
    </main>
  )
}
