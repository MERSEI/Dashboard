'use client'

import React, { useState, useTransition } from 'react'
import { depositFunds, withdrawFunds, login, logout } from '@/app/actions'
import { shortenAddress } from '@/lib/address'
import { isValidAmount } from '@/lib/money'
import { explorerTxUrl } from '@/lib/etherscan'

/**
 * The write path: sign in, then move tokens.
 *
 * The UI mirrors the server's rules rather than inventing its own. Two of them are
 * worth stating in the interface itself, because a user who does not know them will
 * read a refusal as a bug:
 *   - a session is required, and it expires;
 *   - withdrawals can only go to an address on the server's allowlist, which is why
 *     the destination is a fixed choice and not a free-text field.
 *
 * The server re-checks both. Nothing here is a security control — it is only an
 * honest reflection of one.
 */

type Props = {
  authenticated: boolean
  signingConfigured: boolean
  withdrawalTargets: string[]
  chainId: number
  symbol: string
  onDone: () => void
}

type Mode = 'deposit' | 'withdraw'

export function TransferPanel({
  authenticated,
  signingConfigured,
  withdrawalTargets,
  chainId,
  symbol,
  onDone,
}: Props) {
  const [signedIn, setSignedIn] = useState(authenticated)
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<Mode>('deposit')
  const [amount, setAmount] = useState('')
  const [target, setTarget] = useState(withdrawalTargets[0] ?? '')
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const handleLogin = () => {
    setError(null)
    startTransition(async () => {
      const result = await login(password)
      if (result.ok) {
        setSignedIn(true)
        setPassword('')
      } else {
        setError(result.error)
      }
    })
  }

  const handleLogout = () => {
    startTransition(async () => {
      await logout()
      setSignedIn(false)
      setTxHash(null)
    })
  }

  const handleSubmit = () => {
    setError(null)
    setTxHash(null)

    if (!isValidAmount(amount)) {
      setError('Enter a plain decimal amount, e.g. 12.50')
      return
    }
    if (mode === 'withdraw' && !target) {
      setError('Choose a destination from the allowlist.')
      return
    }

    startTransition(async () => {
      const result =
        mode === 'deposit' ? await depositFunds(amount) : await withdrawFunds(target, amount)

      if (result.ok) {
        setTxHash(result.txHash)
        setAmount('')
        onDone()
      } else {
        setError(result.error)
      }
    })
  }

  if (!signingConfigured) {
    return (
      <section className="panel rise rise-2">
        <div className="panel-head">
          <h2 className="label">Move funds</h2>
          <span className="chip">Read-only</span>
        </div>
        <div className="p-4">
          <div className="alert alert-info">
            <span aria-hidden="true">○</span>
            <span>
              No signing key is configured, so this deployment is read-only. That is the safer
              default — see <code className="mark">WALLET_PRIVATE_KEY</code> in the README before
              enabling transfers.
            </span>
          </div>
        </div>
      </section>
    )
  }

  if (!signedIn) {
    return (
      <section className="panel rise rise-2">
        <div className="panel-head">
          <h2 className="label">Move funds</h2>
          <span className="chip">Locked</span>
        </div>
        <div className="flex flex-col gap-3 p-4">
          <p className="meta">
            Moving funds requires the dashboard password. Attempts are rate limited.
          </p>
          <div className="field-frame">
            <input
              className="input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleLogin()
              }}
              placeholder="Dashboard password"
              aria-label="Dashboard password"
              autoComplete="current-password"
            />
          </div>
          {error && (
            <p className="text-[0.76rem]" role="alert" style={{ color: 'var(--color-danger)' }}>
              {error}
            </p>
          )}
          <button className="btn btn-primary" onClick={handleLogin} disabled={pending || !password}>
            {pending ? <span className="spinner h-3.5 w-3.5" /> : 'Unlock transfers'}
          </button>
        </div>
      </section>
    )
  }

  const withdrawalsDisabled = withdrawalTargets.length === 0

  return (
    <section className="panel rise rise-2">
      <div className="panel-head">
        <h2 className="label">Move funds</h2>
        <div className="flex items-center gap-2">
          <span className="chip chip-live">
            <span className="chip-dot" aria-hidden="true" />
            Unlocked
          </span>
          <button className="btn btn-small" onClick={handleLogout} disabled={pending}>
            Lock
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 p-4">
        <div className="flex gap-1" role="group" aria-label="Transfer direction">
          {(['deposit', 'withdraw'] as Mode[]).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m)
                setError(null)
                setTxHash(null)
              }}
              aria-pressed={mode === m}
              className="btn btn-small flex-1"
              style={
                mode === m
                  ? {
                      color: 'var(--color-acid)',
                      borderColor: 'rgba(212,255,79,0.35)',
                      background: 'rgba(212,255,79,0.10)',
                    }
                  : undefined
              }
            >
              {m === 'deposit' ? 'Deposit' : 'Withdraw'}
            </button>
          ))}
        </div>

        {mode === 'withdraw' && (
          <div className="flex flex-col gap-1.5">
            <span className="label">Destination · allowlist only</span>
            {withdrawalsDisabled ? (
              <div className="alert alert-warn">
                <span aria-hidden="true">◆</span>
                <span>
                  <strong>Withdrawals are disabled.</strong> The server&rsquo;s{' '}
                  <code className="mark">WITHDRAW_ALLOWLIST</code> is empty, so there is nowhere to
                  send to. An empty allowlist blocks everything rather than permitting everything.
                </span>
              </div>
            ) : (
              <>
                <div className="field-frame">
                  <select
                    className="input bg-transparent"
                    value={target}
                    onChange={e => setTarget(e.target.value)}
                    aria-label="Withdrawal destination"
                  >
                    {withdrawalTargets.map(address => (
                      <option key={address} value={address} className="bg-ink-800">
                        {shortenAddress(address, 10, 8)}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="meta">
                  Free-text destinations are not accepted: the server refuses any address outside
                  this list.
                </p>
              </>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="label">Amount · {symbol}</span>
          <div className="field-frame">
            <input
              className="input text-[1.05rem]"
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={e => setAmount(e.target.value.replace(',', '.'))}
              placeholder="0.00"
              aria-label={`Amount in ${symbol}`}
              autoComplete="off"
            />
          </div>
        </div>

        {error && (
          <div className="alert alert-danger" role="alert">
            <span aria-hidden="true">▲</span>
            <span>{error}</span>
          </div>
        )}

        {txHash && (
          <div className="alert alert-ok" role="status">
            <span aria-hidden="true">✓</span>
            <span>
              Confirmed on-chain.{' '}
              <a
                className="link"
                href={explorerTxUrl(chainId, txHash)}
                target="_blank"
                rel="noopener noreferrer"
              >
                View transaction
              </a>
            </span>
          </div>
        )}

        <button
          className={mode === 'withdraw' ? 'btn btn-danger' : 'btn btn-primary'}
          onClick={handleSubmit}
          disabled={pending || !amount || (mode === 'withdraw' && withdrawalsDisabled)}
        >
          {pending ? (
            <span className="spinner h-3.5 w-3.5" />
          ) : mode === 'deposit' ? (
            `Deposit ${symbol}`
          ) : (
            `Withdraw ${symbol}`
          )}
        </button>

        <p className="meta">
          The signing wallet is held server-side. A leak of the server environment is a loss of
          funds — see the security notes in the README.
        </p>
      </div>
    </section>
  )
}
