const TZ = 'Australia/Sydney'

export function money(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return '—'
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString('en-AU')}`
}

export function hrs(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return '—'
  return `${(Math.round(n * 10) / 10).toLocaleString('en-AU')}h`
}

export function num(v: FormDataEntryValue | null): number | null {
  if (v == null) return null
  const s = String(v).replace(/[$,\s]/g, '')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export function text(v: FormDataEntryValue | null): string | null {
  const s = v == null ? '' : String(v).trim()
  return s === '' ? null : s
}

// Date-only values (YYYY-MM-DD) are calendar dates with no timezone.
export function fmtDate(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  })
}

export function fmtDateTime(ts: string | null | undefined) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('en-AU', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: TZ,
  })
}

export function todaySydney(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
}

function sydneyOffset(date: string) {
  const probe = new Date(`${date}T12:00:00Z`)
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' })
    .formatToParts(probe)
    .find((p) => p.type === 'timeZoneName')?.value.replace('GMT', '') || '+10:00'
}

// ISO timestamp for midnight in Sydney on the given date.
export function sydneyMidnightISO(date: string) {
  return new Date(`${date}T00:00:00${sydneyOffset(date)}`).toISOString()
}

// "2026-10-12T07:30" typed in Sydney time -> ISO timestamp.
export function sydneyLocalToISO(local: string) {
  const [date, time] = local.split('T')
  if (!date || !time) return null
  const d = new Date(`${date}T${time.slice(0, 5)}:00${sydneyOffset(date)}`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

// ISO timestamp -> "2026-10-12T07:30" in Sydney time (for datetime-local inputs).
export function toSydneyLocalInput(ts: string | null | undefined) {
  if (!ts) return ''
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(ts)).map((p) => [p.type, p.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

function toDate(d: string) {
  return new Date(`${d.slice(0, 10)}T00:00:00Z`)
}

function iso(d: Date) {
  return d.toISOString().slice(0, 10)
}

function isWeekday(d: Date) {
  const day = d.getUTCDay()
  return day !== 0 && day !== 6
}

// Mon–Fri days from start to end, both inclusive.
export function workingDaysBetween(start: string, end: string) {
  const s = toDate(start)
  const e = toDate(end)
  if (e < s) return 0
  let count = 0
  for (const d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    if (isWeekday(d)) count++
  }
  return count
}

// The date on which the nth working day falls, counting `start` as day 1 if it is a weekday.
export function addWorkingDays(start: string, n: number) {
  const d = toDate(start)
  let counted = isWeekday(d) ? 1 : 0
  while (counted < n) {
    d.setUTCDate(d.getUTCDate() + 1)
    if (isWeekday(d)) counted++
  }
  return iso(d)
}

export function phoneE164(input: string) {
  const digits = input.replace(/[^\d+]/g, '')
  if (digits.startsWith('+')) return digits
  if (digits.startsWith('61')) return `+${digits}`
  if (digits.startsWith('0')) return `+61${digits.slice(1)}`
  return `+${digits}`
}

// Job codes are chosen by the owner, e.g. "SMITH-PENRITH". Letters, numbers and dashes only, stored in capitals.
export function cleanJobCode(input: FormDataEntryValue | string | null): string | null {
  const raw = input == null ? '' : String(input)
  const code = raw.trim().toUpperCase().replace(/[\s_]+/g, '-').replace(/[^A-Z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return code.length >= 2 && code.length <= 24 ? code : null
}

// Compare codes ignoring case, dashes and spaces ("smith penrith" == "SMITH-PENRITH").
export const compactCode = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

// "3:02pm" in Sydney time
export function fmtClock(ts: string | Date) {
  return new Date(ts).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: TZ }).replace(/\s/g, '').toLowerCase()
}

// Sydney calendar date (YYYY-MM-DD) of a timestamp
export function sydneyDateOf(ts: string | Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(ts))
}

// Parses what a worker types as a time: "4:30pm", "4.30 pm", "16:30", "4pm", "430pm".
// Without am/pm, 1–5 means afternoon (site hours) and 6–11 means morning. Returns minutes after midnight.
export function parseClockTime(input: string): number | null {
  const m = input.trim().toLowerCase().replace(/\s+/g, '').match(/^(\d{1,2})(?:[:.]?(\d{2}))?(am|pm|a|p)?$/)
  if (!m) return null
  let h = Number(m[1])
  const min = m[2] ? Number(m[2]) : 0
  if (min > 59) return null
  const ap = m[3]?.[0]
  if (ap) {
    if (h < 1 || h > 12) return null
    if (ap === 'p' && h !== 12) h += 12
    if (ap === 'a' && h === 12) h = 0
  } else if (h > 23) {
    return null
  } else if (h >= 1 && h <= 5) {
    h += 12
  }
  return h * 60 + min
}

// "7am-3:30pm", "7 to 3.30", "7:00 - 15:30"
export function parseTimeRange(input: string): { start: number; end: number } | null {
  const parts = input.split(/\s*(?:-|–|—|\bto\b|\btill\b|\buntil\b)\s*/i).filter(Boolean)
  if (parts.length !== 2) return null
  const start = parseClockTime(parts[0])
  const end = parseClockTime(parts[1])
  if (start == null || end == null || end <= start) return null
  return { start, end }
}

// Minutes after midnight on a Sydney date -> ISO timestamp
export function sydneyTimeOn(date: string, minutes: number) {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0')
  const mm = String(minutes % 60).padStart(2, '0')
  return sydneyLocalToISO(`${date}T${hh}:${mm}`)
}
