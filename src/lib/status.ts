import type { Tone } from '@/components/ui'
import type { JobNumbers, JobSummary, forecast } from './forecast'
import { fmtDate, hrs, money } from './format'

type Forecast = ReturnType<typeof forecast>

export const FINISHED = ['complete', 'invoiced', 'paid']

export function jobPill(j: JobSummary, f?: Forecast): { label: string; tone: Tone } {
  if (j.status === 'quoted') return { label: 'Quote', tone: 'brand' }
  if (j.status === 'rejected') return { label: 'Lost', tone: 'bad' }
  if (FINISHED.includes(j.status)) return { label: 'Finished', tone: 'neutral' }
  switch (f?.health) {
    case 'over': return { label: 'Over budget', tone: 'bad' }
    case 'behind': return { label: 'Slipping', tone: 'warn' }
    case 'not_started': return { label: 'Not started', tone: 'neutral' }
    case 'no_budget': return { label: 'No hours budget', tone: 'neutral' }
    default: return { label: 'On track', tone: 'good' }
  }
}

export const jobTitle = (j: { address: string | null; client_name: string | null; code: string }) => j.address || j.client_name || j.code
export const jobSubtitle = (j: { address: string | null; client_name: string | null; code: string }) =>
  [j.address ? j.client_name : null, j.code].filter(Boolean).join(' · ')

// One plain-English line that answers "how is this job going?"
export function jobSentence(j: JobSummary, nums: JobNumbers, f: Forecast): string {
  if (j.status === 'quoted') return 'Waiting for your decision on this quote.'
  if (j.status === 'rejected') return `Lost${j.rejection_reason ? `: ${j.rejection_reason}` : '.'}`
  if (FINISHED.includes(j.status)) {
    return `Finished with ${money(nums.profit)} profit${nums.margin != null ? ` (${Math.round(nums.margin * 100)}% margin)` : ''}.`
  }
  const projected = f.projectedProfit != null ? ` Likely to finish with about ${money(f.projectedProfit)} profit.` : ''
  switch (f.health) {
    case 'over':
      return `Over the hours budget by ${hrs(nums.hoursUsed - (nums.hoursBudget ?? 0))}.${projected}`
    case 'behind':
      return `Using hours faster than planned.${projected}`
    case 'not_started':
      return `Starts ${fmtDate(j.start_date)}.`
    case 'no_budget':
      return 'Add the quoted hours (Edit job details) to see if this job is on track.'
    default:
      return projected ? `On track.${projected}` : 'On track so far.'
  }
}
