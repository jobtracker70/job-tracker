'use client'

import { useState } from 'react'
import { inputClass } from './ui'

const label = (mins: number) => {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h % 12 || 12}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`
}
const toMins = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
}
const toHHMM = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`

// Every 15 minutes from 4am to 11:45pm, plus the current value if it is in between
function options(current: number | null) {
  const list: number[] = []
  for (let m = 4 * 60; m < 24 * 60; m += 15) list.push(m)
  if (current != null && !list.includes(current)) list.push(current)
  return list.sort((a, b) => a - b)
}

const shiftDay = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const chip = (on: boolean) =>
  `px-3 py-2 rounded-xl text-sm font-semibold border transition ${on ? 'bg-brand text-white border-brand' : 'bg-white text-ink border-line hover:bg-brand-tint'}`

// Day + start + finish pickers for a shift. Sends `start` and `end` as "YYYY-MM-DDTHH:MM" (Sydney time).
export function ShiftTimes({ defaultStart, defaultEnd, today, usualStart, usualEnd, allowOpen = false }: {
  defaultStart: string; defaultEnd: string; today: string; usualStart: number; usualEnd: number; allowOpen?: boolean
}) {
  const [day, setDay] = useState(defaultStart.slice(0, 10) || today)
  const [start, setStart] = useState<number>(toMins(defaultStart.slice(11, 16)) ?? usualStart)
  const [end, setEnd] = useState<number | null>(defaultEnd ? toMins(defaultEnd.slice(11, 16)) : allowOpen ? null : usualEnd)

  const yesterday = shiftDay(today, -1)
  const valid = end == null || end > start
  const hours = end == null ? null : (end - start) / 60
  const isUsual = start === usualStart && end === usualEnd

  return (
    <div className="space-y-3">
      <input type="hidden" name="start" value={`${day}T${toHHMM(start)}`} />
      <input type="hidden" name="end" value={end == null ? '' : `${day}T${toHHMM(end)}`} />

      <div>
        <span className="text-sm font-medium">Day</span>
        <div className="flex flex-wrap items-center gap-2 mt-1.5">
          <button type="button" className={chip(day === today)} onClick={() => setDay(today)}>Today</button>
          <button type="button" className={chip(day === yesterday)} onClick={() => setDay(yesterday)}>Yesterday</button>
          <input type="date" value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} className={`${inputClass} !w-auto !py-2`} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm font-medium">Started</span>
          <select value={start} onChange={(e) => setStart(Number(e.target.value))} className={`${inputClass} mt-1.5 text-base`}>
            {options(start).map((m) => <option key={m} value={m}>{label(m)}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium">Finished</span>
          <select
            value={end ?? ''}
            onChange={(e) => setEnd(e.target.value === '' ? null : Number(e.target.value))}
            className={`${inputClass} mt-1.5 text-base`}
          >
            {allowOpen && <option value="">Still on site</option>}
            {options(end).map((m) => <option key={m} value={m}>{label(m)}</option>)}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className={chip(isUsual)} onClick={() => { setStart(usualStart); setEnd(usualEnd) }}>
          Usual hours {label(usualStart)} – {label(usualEnd)}
        </button>
        <span className={`text-sm font-semibold ${valid ? 'text-muted' : 'text-bad'}`}>
          {!valid ? 'Finish must be after start' : hours == null ? 'Still on site' : `${Math.floor(hours)}h${hours % 1 ? ` ${Math.round((hours % 1) * 60)}m` : ''} on site`}
        </span>
      </div>
    </div>
  )
}
