import { addWorkingDays, todaySydney, workingDaysBetween } from './format'

export type JobSummary = {
  id: string
  code: string
  client_name: string | null
  address: string | null
  status: string
  quote_total: number | null
  quoted_hours: number | null
  quoted_materials: number | null
  start_date: string | null
  planned_finish: string | null
  rejection_reason: string | null
  created_at: string
  employee_hours: number
  subbie_hours_logged: number
  subbie_hours_invoiced: number
  labour_cost: number
  materials_cost: number
  subbie_cost: number
  variations_total: number
  variation_hours: number
  variation_materials: number
}

export type Health = 'not_started' | 'on_track' | 'behind' | 'over' | 'no_budget' | 'no_dates'

export type JobNumbers = ReturnType<typeof jobNumbers>

const n = (v: unknown) => Number(v ?? 0)

// Subbie hours: a subbie's invoice is the hours we pay for; if they haven't invoiced yet, use what they logged.
export function jobNumbers(j: JobSummary, subbieHoursOverride?: number) {
  const subbieHours = subbieHoursOverride ?? Math.max(n(j.subbie_hours_invoiced), n(j.subbie_hours_logged))
  const hoursUsed = n(j.employee_hours) + subbieHours
  const hoursBudget = j.quoted_hours == null && !n(j.variation_hours) ? null : n(j.quoted_hours) + n(j.variation_hours)
  const materialsBudget =
    j.quoted_materials == null && !n(j.variation_materials) ? null : n(j.quoted_materials) + n(j.variation_materials)
  const income = n(j.quote_total) + n(j.variations_total)
  const labourCost = n(j.labour_cost) + n(j.subbie_cost)
  const materialsCost = n(j.materials_cost)
  const costs = labourCost + materialsCost
  const profit = income - costs
  const margin = income > 0 ? profit / income : null
  return {
    hoursUsed, hoursBudget, materialsBudget, income, labourCost, materialsCost, costs, profit, margin,
    hoursLeft: hoursBudget == null ? null : hoursBudget - hoursUsed,
    materialsLeft: materialsBudget == null ? null : materialsBudget - materialsCost,
  }
}

export function forecast(j: JobSummary, nums: JobNumbers, today = todaySydney()) {
  const { hoursUsed, hoursBudget, materialsBudget, income, labourCost, materialsCost } = nums

  let timePct: number | null = null
  let elapsedDays = 0
  if (j.start_date && j.planned_finish) {
    const total = workingDaysBetween(j.start_date, j.planned_finish)
    const end = today < j.planned_finish ? today : j.planned_finish
    elapsedDays = today < j.start_date ? 0 : workingDaysBetween(j.start_date, end)
    timePct = total > 0 ? elapsedDays / total : null
  }
  const hoursPct = hoursBudget ? hoursUsed / hoursBudget : null

  let health: Health
  if (hoursBudget == null) health = 'no_budget'
  else if (hoursUsed > hoursBudget) health = 'over'
  else if (j.start_date && today < j.start_date && hoursUsed === 0) health = 'not_started'
  else if (timePct == null) health = hoursPct != null && hoursPct > 0.9 ? 'behind' : 'no_dates'
  else health = hoursPct != null && hoursPct > timePct + 0.1 ? 'behind' : 'on_track'

  // At the current pace, how many hours will the whole job take?
  const projectedHours = timePct && timePct >= 0.1 && hoursUsed > 0 ? hoursUsed / Math.min(timePct, 1) : null

  // When will the hours budget run out at the current daily pace?
  let budgetRunsOut: string | null = null
  if (hoursBudget != null && elapsedDays > 0 && hoursUsed > 0 && j.start_date) {
    const perDay = hoursUsed / elapsedDays
    const daysForBudget = Math.ceil(hoursBudget / perDay)
    budgetRunsOut = addWorkingDays(j.start_date, daysForBudget)
  }

  // Projected profit: cost per hour so far × projected total hours, plus materials (at least the budget).
  let projectedProfit: number | null = null
  if (hoursUsed > 0 && labourCost > 0) {
    const costPerHour = labourCost / hoursUsed
    const finalHours = Math.max(projectedHours ?? 0, hoursBudget ?? 0, hoursUsed)
    const finalMaterials = Math.max(materialsBudget ?? 0, materialsCost)
    projectedProfit = income - finalHours * costPerHour - finalMaterials
  }

  return { health, timePct, hoursPct, projectedHours, budgetRunsOut, projectedProfit }
}

export const HEALTH_LABEL: Record<Health, string> = {
  not_started: 'Not started',
  on_track: 'On track',
  behind: 'Using hours too fast',
  over: 'Over hours budget',
  no_budget: 'No hours budget set',
  no_dates: 'No dates set',
}

export const HEALTH_COLOR: Record<Health, string> = {
  not_started: 'bg-gray-800 text-gray-300',
  on_track: 'bg-green-900/50 text-green-400',
  behind: 'bg-yellow-900/50 text-yellow-400',
  over: 'bg-red-900/50 text-red-400',
  no_budget: 'bg-gray-800 text-gray-400',
  no_dates: 'bg-gray-800 text-gray-400',
}
