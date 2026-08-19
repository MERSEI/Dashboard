'use client'

import React, { useMemo, useState } from 'react'
import type { Transfer } from '@/lib/portfolio'
import { shortenAddress } from '@/lib/address'
import { explorerTxUrl } from '@/lib/etherscan'
import { formatDisplay } from '@/lib/money'

/**
 * The transaction ledger — and the table view that the chart's accessibility pass
 * requires, so every plotted number is also readable as text.
 */

type Props = {
  transfers: Transfer[]
  chainId: number
}

type Filter = 'all' | 'in' | 'out'

export function TransferLedger({ transfers, chainId }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return transfers.filter(t => {
      if (filter !== 'all' && t.direction !== filter) return false
      if (!q) return true
      return (
        t.hash.toLowerCase().includes(q) ||
        t.from.toLowerCase().includes(q) ||
        (t.to ?? '').toLowerCase().includes(q) ||
        t.amount.includes(q) ||
        t.symbol.toLowerCase().includes(q)
      )
    })
  }, [transfers, filter, query])

  return (
    <section className="panel rise rise-4">
      <div className="panel-head">
        <h2 className="label">Transfer history</h2>
        <div className="flex gap-1" role="group" aria-label="Filter transfers">
          {(['all', 'in', 'out'] as Filter[]).map(f => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className="btn btn-small"
              style={
                filter === f
                  ? {
                      color: 'var(--color-acid)',
                      borderColor: 'rgba(212,255,79,0.35)',
                      background: 'rgba(212,255,79,0.10)',
                    }
                  : undefined
              }
            >
              {f === 'all' ? 'All' : f === 'in' ? 'In' : 'Out'}
            </button>
          ))}
        </div>
      </div>

      <div className="border-b border-[var(--hair)] p-3">
        <div className="field-frame">
          <span aria-hidden="true" className="text-[0.8rem] text-bone-mute">⌕</span>
          <input
            className="input"
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by hash, address, amount or symbol…"
            aria-label="Search transfers"
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-12 text-center text-[0.8rem] text-bone-mute">
          {transfers.length === 0
            ? 'No transfers found for this address.'
            : 'No transfers match this filter.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">
              Transfers for this address, newest first, with amount, counterparty and date
            </caption>
            <thead>
              <tr className="border-b border-[var(--hair)]">
                <th scope="col" className="label px-4 py-2 font-medium">Type</th>
                <th scope="col" className="label px-4 py-2 font-medium">Counterparty</th>
                <th scope="col" className="label px-4 py-2 text-right font-medium">Amount</th>
                <th scope="col" className="label px-4 py-2 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(t => {
                const incoming = t.direction === 'in'
                const counterparty = incoming ? t.from : t.to
                return (
                  <tr
                    key={`${t.hash}:${t.direction}:${t.timestamp}:${t.amount}`}
                    className="border-b border-[var(--hair)] last:border-0 hover:bg-ink-600"
                  >
                    <td className="px-4 py-3 align-top">
                      <span
                        className="inline-flex items-center gap-1.5 text-[0.7rem] font-medium tracking-widest uppercase"
                        style={{ color: incoming ? 'var(--color-pos)' : 'var(--color-neg)' }}
                      >
                        {/* Glyph plus word: never direction by colour alone. */}
                        <span aria-hidden="true">{incoming ? '↓' : '↑'}</span>
                        {incoming ? 'In' : 'Out'}
                      </span>
                      {t.failed && (
                        <span className="mt-1 block text-[0.66rem]" style={{ color: 'var(--color-danger)' }}>
                          reverted — moved nothing
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="num text-[0.78rem]">
                        {counterparty ? shortenAddress(counterparty, 8, 6) : 'contract creation'}
                      </span>
                      <span className="mt-0.5 block">
                        <a
                          className="link text-[0.7rem]"
                          href={explorerTxUrl(chainId, t.hash)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          explorer
                        </a>
                      </span>
                    </td>
                    <td className="num px-4 py-3 text-right align-top text-[0.82rem] font-medium">
                      <span style={{ color: t.failed ? 'var(--color-bone-mute)' : undefined }}>
                        {incoming ? '+' : '−'}
                        {formatDisplay(Number(t.amount), 4)}
                      </span>
                      <span className="ml-1 text-[0.68rem] text-bone-mute">{t.symbol}</span>
                    </td>
                    <td className="meta num px-4 py-3 align-top">
                      {t.timestamp
                        ? new Date(t.timestamp).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'unknown'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
