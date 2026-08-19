'use client'

/**
 * Balance over time.
 *
 * Form: one measure against time → a line with a supporting area fill. A single
 * series, so there is no legend (the panel title names it) and no categorical
 * palette to balance.
 *
 * Colour: the mark uses --color-acid-mark, a step below the UI accent. The bright
 * accent (#D4FF4F) sits at OKLCH L 0.94, which blooms as a thin stroke on
 * near-black; the mark step keeps the brand hue while passing contrast against the
 * panel surface. The categorical lightness band does not apply here — that check
 * exists to stop one series out-shouting another, and there is only one series.
 *
 * The area fill is capped at 10% opacity so it supports the line instead of
 * competing with it, and the grid is a hairline so it stays recessive.
 *
 * Interaction: a crosshair plus tooltip, which a line chart gets by default. The
 * value at the cursor is read from the data, never interpolated for display.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react'
import { PERIODS, type Period, type SeriesPoint } from '@/lib/portfolio'
import { formatDisplay, formatSigned } from '@/lib/money'

type Props = {
  points: SeriesPoint[]
  symbol: string
  period: Period
  onPeriodChange: (period: Period) => void
  loading?: boolean
}

/** Plot geometry in user units; the SVG scales via viewBox. */
const W = 760
const H = 240
const PAD = { top: 18, right: 16, bottom: 26, left: 16 }

export function BalanceChart({ points, symbol, period, onPeriodChange, loading }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)

  const geometry = useMemo(() => {
    if (points.length < 2) return null

    const values = points.map(p => p.value)
    const rawMin = Math.min(...values)
    const rawMax = Math.max(...values)
    // A flat series would collapse to a zero-height range; give it breathing room
    // so the line sits mid-plot instead of on an edge.
    const span = rawMax - rawMin
    const min = span === 0 ? Math.max(0, rawMin - 1) : rawMin - span * 0.12
    const max = span === 0 ? rawMax + 1 : rawMax + span * 0.12

    const innerW = W - PAD.left - PAD.right
    const innerH = H - PAD.top - PAD.bottom

    const coords = points.map((p, i) => ({
      ...p,
      x: PAD.left + (i / (points.length - 1)) * innerW,
      y: PAD.top + innerH - ((p.value - min) / (max - min)) * innerH,
    }))

    const line = coords
      .map((c, i) => (i === 0 ? `M ${c.x} ${c.y}` : `L ${c.x} ${c.y}`))
      .join(' ')
    const area = `${line} L ${coords[coords.length - 1].x} ${PAD.top + innerH} L ${coords[0].x} ${PAD.top + innerH} Z`

    return { coords, area, line, min, max, innerH }
  }, [points])

  const change = useMemo(() => {
    if (points.length < 2) return null
    const first = points[0].value
    const last = points[points.length - 1].value
    return {
      absolute: last - first,
      percent: first > 0 ? ((last - first) / first) * 100 : null,
    }
  }, [points])

  const handleMove = useCallback(
    (event: React.MouseEvent<SVGSVGElement>) => {
      if (!geometry || !svgRef.current) return
      const rect = svgRef.current.getBoundingClientRect()
      const x = ((event.clientX - rect.left) / rect.width) * W
      let nearest = 0
      let best = Number.POSITIVE_INFINITY
      geometry.coords.forEach((c, i) => {
        const distance = Math.abs(c.x - x)
        if (distance < best) {
          best = distance
          nearest = i
        }
      })
      setHover(nearest)
    },
    [geometry],
  )

  const active = hover !== null && geometry ? geometry.coords[hover] : null

  return (
    <section className="panel rise rise-3">
      <div className="panel-head">
        <div className="flex items-baseline gap-3">
          <h2 className="label">Balance history</h2>
          {change && (
            <span
              className="num text-[0.72rem]"
              style={{
                color:
                  change.absolute > 0
                    ? 'var(--color-pos)'
                    : change.absolute < 0
                      ? 'var(--color-neg)'
                      : 'var(--color-bone-dim)',
              }}
            >
              {/* Sign carries the meaning; the colour only reinforces it. */}
              {formatSigned(change.absolute)} {symbol}
              {change.percent !== null && ` · ${formatSigned(change.percent)}%`}
            </span>
          )}
        </div>

        <div className="flex gap-1" role="group" aria-label="Chart period">
          {PERIODS.map(p => (
            <button
              key={p}
              type="button"
              onClick={() => onPeriodChange(p)}
              aria-pressed={p === period}
              className="btn btn-small"
              style={
                p === period
                  ? {
                      color: 'var(--color-acid)',
                      borderColor: 'rgba(212,255,79,0.35)',
                      background: 'rgba(212,255,79,0.10)',
                    }
                  : undefined
              }
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="relative px-2 pt-2 pb-1">
        {loading && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-ink-700/60">
            <span className="spinner h-5 w-5" role="status" aria-label="Loading chart" />
          </div>
        )}

        {!geometry ? (
          /* No invented data. The old implementation drew a flat line at 1000 when
             history was missing, which read as a real portfolio. */
          <div className="grid h-[240px] place-items-center px-4 text-center">
            <div>
              <p className="text-[0.8rem] text-bone-dim">No transfer history to chart.</p>
              <p className="meta mt-1">
                A balance series needs at least two points from this address&rsquo;s transfers.
              </p>
            </div>
          </div>
        ) : (
          <>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              className="h-[240px] w-full touch-none"
              onMouseMove={handleMove}
              onMouseLeave={() => setHover(null)}
              role="img"
              aria-label={`Balance over the selected period, from ${formatDisplay(points[0].value)} to ${formatDisplay(points[points.length - 1].value)} ${symbol}`}
            >
              <defs>
                <linearGradient id="balance-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-acid-mark)" stopOpacity="0.10" />
                  <stop offset="100%" stopColor="var(--color-acid-mark)" stopOpacity="0" />
                </linearGradient>
              </defs>

              {/* Recessive gridlines: four horizontal hairlines, no vertical clutter. */}
              {[0, 0.25, 0.5, 0.75, 1].map(t => (
                <line
                  key={t}
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={PAD.top + geometry.innerH * t}
                  y2={PAD.top + geometry.innerH * t}
                  stroke="var(--hair)"
                  strokeWidth="1"
                />
              ))}

              <path d={geometry.area} fill="url(#balance-fill)" />
              <path
                d={geometry.line}
                fill="none"
                stroke="var(--color-acid-mark)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Direct label on the final point only — never a number on every point. */}
              <circle
                cx={geometry.coords[geometry.coords.length - 1].x}
                cy={geometry.coords[geometry.coords.length - 1].y}
                r="3.5"
                fill="var(--color-acid-mark)"
                stroke="var(--color-ink-700)"
                strokeWidth="2"
              />

              {active && (
                <g>
                  <line
                    x1={active.x}
                    x2={active.x}
                    y1={PAD.top}
                    y2={PAD.top + geometry.innerH}
                    stroke="var(--hair-strong)"
                    strokeWidth="1"
                  />
                  <circle
                    cx={active.x}
                    cy={active.y}
                    r="4.5"
                    fill="var(--color-acid-mark)"
                    stroke="var(--color-ink-700)"
                    strokeWidth="2"
                  />
                </g>
              )}
            </svg>

            {/* Tooltip in HTML rather than SVG text, so it inherits type tokens. */}
            <div className="flex h-8 items-center justify-between px-2">
              {active ? (
                <>
                  <span className="meta num">
                    {new Date(active.timestamp).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <span className="num text-[0.82rem] font-medium">
                    {formatDisplay(active.value)} <span className="text-bone-mute">{symbol}</span>
                  </span>
                </>
              ) : (
                <span className="meta">Hover the chart to read a point</span>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
