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

// ISO timestamp for midnight in Sydney on the given date.
export function sydneyMidnightISO(date: string) {
  const probe = new Date(`${date}T12:00:00Z`)
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' })
    .formatToParts(probe)
    .find((p) => p.type === 'timeZoneName')?.value.replace('GMT', '') || '+10:00'
  return new Date(`${date}T00:00:00${offset}`).toISOString()
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
