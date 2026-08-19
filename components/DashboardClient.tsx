'use client'

import React, { useCallback, useState, useTransition } from 'react'
import { getDashboardData, type DashboardData } from '@/app/actions'
import { BalanceChart } from './BalanceChart'
import { StatTile } from './StatTile'
import { TransferLedger } from './TransferLedger'
import { TransferPanel } from './TransferPanel'
import { isValidAddress, shortenAddress } from '@/lib/address'
import { formatDisplay, formatSigned } from '@/lib/money'
import { chainLabel, explorerAddressUrl } from '@/lib/etherscan'
import type { Period } from '@/lib/portfolio'

type Props = {
  initial: DashboardData
  capability: {
    authenticated: boolean
    signingConfigured: boolean
    withdrawalTargets: string[]
  }
}

export function DashboardClient({ initial, capability }: Props) {
  const [data, setData] = useState(initial)
  const [period, setPeriod] = useState<Period>('1M')
  const [addressInput, setAddressInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const load = useCallback((address: string, nextPeriod: Period) => {
    startTransition(async () => {
      setError(null)
      try {
        setData(await getDashboardData(address, nextPeriod))
      } catch (e) {
        setError((e as Error).message || 'Could not load that address.')
      }
    })
  }, [])

  const handlePeriod = (next: Period) => {
    setPeriod(next)
    load(data.address, next)
  }

  const handleAddressSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const candidate = addressInput.trim()
    if (!candidate) {
      load(initial.address, period)
      setAddressInput('')
      return
    }
    if (!isValidAddress(candidate)) {
      setError('That is not a valid Ethereum address — check the characters.')
      return
    }
    load(candidate, period)
    setAddressInput('')
  }

  const balance = Number(data.tokenBalance)
  const { performance, flows } = data

  const [whole, frac] = data.tokenBalance.split('.')

  return (
    <div className="mx-auto flex max-w-[980px] flex-col gap-4 px-4 pt-6 pb-16">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="rise rise-1 flex flex-wrap items-center justify-between gap-3">
        <span className="font-[family-name:var(--font-display)] text-[1.05rem]">
          Wallet&thinsp;·&thinsp;Analytics
        </span>
        <div className="flex items-center gap-2">
          <span className="chip chip-live">
            <span className="chip-dot" aria-hidden="true" />
            {chainLabel(data.chainId)}
          </span>
          {pending && <span className="spinner h-3.5 w-3.5" role="status" aria-label="Loading" />}
        </div>
      </header>

      {/* ── Address switcher: the dashboard reports on any address ─── */}
      <form onSubmit={handleAddressSubmit} className="rise rise-1 flex flex-col gap-2">
        <label className="label" htmlFor="address-input">
          Address
        </label>
        <div className="flex flex-wrap gap-2">
          <div className={`field-frame flex-1 ${error ? 'field-frame-alert' : ''}`}>
            <input
              id="address-input"
              className="input"
              type="text"
              value={addressInput}
              onChange={e => {
                setAddressInput(e.target.value)
                setError(null)
              }}
              placeholder={data.address}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <button className="btn" type="submit" disabled={pending}>
            Look up
          </button>
        </div>
        <p className="meta">
          Viewing{' '}
          <a
            className="link num"
            href={explorerAddressUrl(data.chainId, data.address)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {data.address}
          </a>
        </p>
        {error && (
          <p className="text-[0.76rem]" role="alert" style={{ color: 'var(--color-danger)' }}>
            {error}
          </p>
        )}
      </form>

      {data.warnings.map(warning => (
        <div className="alert alert-warn rise rise-1" role="status" key={warning}>
          <span aria-hidden="true">◆</span>
          <span>{warning}</span>
        </div>
      ))}

      {/* ── Balance ────────────────────────────────────────────────── */}
      <section className="panel rise rise-2">
        <div className="panel-head">
          <span className="label">{data.token.symbol} balance</span>
          <span className="meta num">
            {formatDisplay(Number(data.nativeBalance), 4)} ETH held
          </span>
        </div>
        <div className="p-5">
          <div className="hero-figure">
            <span className="num">
              {whole}
              {frac && <span className="hero-frac">.{frac}</span>}
            </span>
            <span className="hero-unit">{data.token.symbol}</span>
          </div>
        </div>
      </section>

      {/* ── Figures. A lone magnitude reads faster as a number than as a chart. ── */}
      <div className="rise rise-2 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          label="Received"
          glyph="↓"
          value={formatDisplay(flows.in, 2)}
          unit={data.token.symbol}
          tone="pos"
          note={`${flows.count} transfer${flows.count === 1 ? '' : 's'} counted`}
        />
        <StatTile
          label="Sent"
          glyph="↑"
          value={formatDisplay(flows.out, 2)}
          unit={data.token.symbol}
          tone="neg"
        />
        <StatTile
          label="Net deposited"
          value={formatSigned(flows.net, 2)}
          unit={data.token.symbol}
          note="received − sent"
        />
        <StatTile
          label="Vs deposits"
          value={
            performance.hasBasis
              ? performance.gainPercent !== null
                ? `${formatSigned(performance.gainPercent, 2)}%`
                : formatSigned(performance.gain, 2)
              : '—'
          }
          unit={performance.gainPercent === null && performance.hasBasis ? data.token.symbol : undefined}
          tone={performance.gain > 0 ? 'pos' : performance.gain < 0 ? 'neg' : 'mute'}
          note={
            !performance.hasBasis
              ? 'no transfers to compare against'
              : performance.gainPercent === null
                ? 'more was withdrawn than deposited, so a percentage would be meaningless'
                : 'balance against net deposits'
          }
        />
      </div>

      <BalanceChart
        points={data.series}
        symbol={data.token.symbol}
        period={period}
        onPeriodChange={handlePeriod}
        loading={pending}
      />

      <TransferPanel
        authenticated={capability.authenticated}
        signingConfigured={capability.signingConfigured}
        withdrawalTargets={capability.withdrawalTargets}
        chainId={data.chainId}
        symbol={data.token.symbol}
        onDone={() => load(data.address, period)}
      />

      <TransferLedger transfers={data.transfers} chainId={data.chainId} />

      <footer className="meta rise rise-4 pt-2">
        Balance read live from the chain; history from Etherscan. Figures are token amounts, not
        fiat — no price feed is involved, so nothing here is a valuation. Watching{' '}
        {shortenAddress(data.address, 8, 6)} · {balance > 0 ? 'funded' : 'empty'}.
      </footer>
    </div>
  )
}

export default DashboardClient
