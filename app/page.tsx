import React from 'react'
import { getDashboardData, getTransferCapability } from './actions'
import DashboardClient from '@/components/DashboardClient'
import { readConfig } from '@/lib/config'

/**
 * Balances must never be baked in at build time.
 *
 * Next.js prerendered this route as static, so the figures were frozen at whatever
 * the build saw — and when the environment was missing, the *error* page was the
 * thing that got cached, so fixing the variable did not fix the page.
 */
export const dynamic = 'force-dynamic'

function ConfigNotice({ missing, invalid }: { missing: string[]; invalid: string[] }) {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="panel max-w-md">
        <div className="panel-head">
          <span className="label">Setup required</span>
          <span className="chip">Not configured</span>
        </div>
        <div className="flex flex-col gap-3 p-5">
          <h1 className="title">Almost there</h1>
          <p className="meta">
            Copy <code className="mark">.env.example</code> to{' '}
            <code className="mark">.env.local</code> and fill in the values below.
          </p>
          {missing.length > 0 && (
            <div>
              <span className="label">Missing</span>
              <ul className="mt-1 flex flex-col gap-1">
                {missing.map(key => (
                  <li key={key} className="num text-[0.78rem]">
                    {key}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {invalid.length > 0 && (
            <div>
              <span className="label">Invalid</span>
              <ul className="mt-1 flex flex-col gap-1">
                {invalid.map(key => (
                  <li key={key} className="num text-[0.78rem]">
                    {key}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

function LoadError({ message }: { message: string }) {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="panel max-w-md">
        <div className="panel-head">
          <span className="label">Could not load</span>
        </div>
        <div className="flex flex-col gap-3 p-5">
          <h1 className="title">Nothing to show yet</h1>
          <p className="meta">{message}</p>
        </div>
      </div>
    </main>
  )
}

export default async function HomePage() {
  const cfg = readConfig()
  if (!cfg.ok) return <ConfigNotice missing={cfg.missing} invalid={cfg.invalid} />

  try {
    const [data, capability] = await Promise.all([
      getDashboardData(undefined, '1M'),
      getTransferCapability(),
    ])
    return (
      <main>
        <DashboardClient initial={data} capability={capability} />
      </main>
    )
  } catch (error) {
    // publicErrorMessage has already stripped anything infrastructure-specific.
    return <LoadError message={(error as Error).message} />
  }
}
