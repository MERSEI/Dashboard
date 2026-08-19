import React from 'react'

/**
 * A single figure with its label.
 *
 * Deliberately not a chart: a lone magnitude is read faster as a number, and a
 * one-bar bar chart communicates nothing the number does not.
 */

type Props = {
  label: string
  value: string
  unit?: string
  /** Secondary line under the figure — context, not decoration. */
  note?: string
  tone?: 'neutral' | 'pos' | 'neg' | 'mute'
  /** Rendered before the label; pair it with the tone so colour is never alone. */
  glyph?: string
}

const TONE: Record<NonNullable<Props['tone']>, string> = {
  neutral: 'var(--color-bone)',
  pos: 'var(--color-pos)',
  neg: 'var(--color-neg)',
  mute: 'var(--color-bone-mute)',
}

export function StatTile({ label, value, unit, note, tone = 'neutral', glyph }: Props) {
  return (
    <div className="panel panel-quiet flex flex-col gap-2 p-4">
      <div className="label flex items-center gap-1.5">
        {glyph && <span aria-hidden="true">{glyph}</span>}
        {label}
      </div>
      <div className="num text-[1.35rem] leading-none font-medium" style={{ color: TONE[tone] }}>
        {value}
        {unit && <span className="ml-1.5 text-[0.7rem] tracking-widest text-bone-mute">{unit}</span>}
      </div>
      {note && <div className="meta">{note}</div>}
    </div>
  )
}
