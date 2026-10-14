import Link from 'next/link'
import { notFound } from 'next/navigation'
import { fmtDate, hrs, money, moneyCents, sydneyDateOf, workingDaysBetween } from '@/lib/format'
import { isSubbieType, loadJob, peopleOnJob, weekLabel } from '@/lib/job-data'
import { fmtQty, itemsOf, totalItems } from '@/lib/items'
import { cardClass } from '@/components/ui'
import { jobSubtitle, jobTitle } from '@/lib/status'
import { PrintButton } from './print-button'

export const dynamic = 'force-dynamic'

const pct = (n: number | null) => (n == null || !Number.isFinite(n) ? '—' : `${n > 0 ? '+' : ''}${Math.round(n * 100)}%`)
const signedMoney = (n: number) => `${n > 0 ? '+' : ''}${money(n)}`
const signedHrs = (n: number) => `${n > 0 ? '+' : ''}${hrs(n)}`

export default async function JobReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await loadJob(id)
  if (!data) notFound()
  const { j, job, entries, expenses, variations, subbieRows, nums } = data
  const finished = ['complete', 'invoiced', 'paid'].includes(j.status)

  // ---------- Dates ----------
  const days = [...new Set(entries.map((e) => e.work_day))].sort()
  const actualStart = days[0] ?? null
  const lastEnd = entries.reduce<string | null>((latest, e) => {
    const t = e.end_time ?? e.start_time
    return !latest || t > latest ? t : latest
  }, null)
  const actualFinish = lastEnd ? sydneyDateOf(lastEnd) : null
  const plannedDays = j.start_date && j.planned_finish ? workingDaysBetween(j.start_date, j.planned_finish) : null
  const daysWorked = days.length
  const personDays = new Set(entries.map((e) => `${e.worker_id}|${e.work_day}`)).size

  // ---------- Labour by person ----------
  type PersonRow = { name: string; type: string; days: Set<string>; paid: number; weekend: number; overtime: number; cost: number; shifts: number }
  const people = new Map<string, PersonRow>()
  for (const e of entries) {
    const p = people.get(e.worker_id) ?? { name: e.worker_name, type: e.worker_type, days: new Set(), paid: 0, weekend: 0, overtime: 0, cost: 0, shifts: 0 }
    p.days.add(e.work_day)
    p.paid += Number(e.paid_hours)
    if (e.is_weekend) p.weekend += Number(e.paid_hours)
    p.overtime += Number(e.overtime_hours)
    p.cost += Number(e.cost)
    p.shifts++
    people.set(e.worker_id, p)
  }
  const personRows = [...people.values()].sort((a, b) => b.paid - a.paid)
  const employeeRows = personRows.filter((p) => !isSubbieType(p.type))
  const employeeHours = employeeRows.reduce((s, p) => s + p.paid, 0)
  const employeeCost = employeeRows.reduce((s, p) => s + p.cost, 0)
  const weekendHours = personRows.reduce((s, p) => s + p.weekend, 0)
  const overtimeHours = personRows.reduce((s, p) => s + p.overtime, 0)
  const noRateShifts = entries.filter((e) => !isSubbieType(e.worker_type) && !e.has_rate).length

  // ---------- Hours vs quote ----------
  const hoursBudget = nums.hoursBudget
  const hoursUsed = nums.hoursUsed
  const hoursDiff = hoursBudget == null ? null : hoursUsed - hoursBudget
  const hoursDiffPct = hoursBudget ? hoursUsed / hoursBudget - 1 : null
  const costPerHour = hoursUsed > 0 ? nums.labourCost / hoursUsed : null

  // ---------- Materials ----------
  const counted = expenses.filter((x) => x.status !== 'rejected')
  const materials = counted.filter((x) => x.category !== 'subbie')
  const bySupplier = new Map<string, { count: number; spent: number; credits: number }>()
  for (const x of materials) {
    const key = x.supplier ?? 'Unknown'
    const r = bySupplier.get(key) ?? { count: 0, spent: 0, credits: 0 }
    r.count++
    if (Number(x.amount_ex_gst) < 0) r.credits += Number(x.amount_ex_gst)
    else r.spent += Number(x.amount_ex_gst)
    bySupplier.set(key, r)
  }
  const supplierRows = [...bySupplier.entries()].sort((a, b) => b[1].spent - a[1].spent)
  const creditsTotal = materials.reduce((s, x) => s + Math.min(0, Number(x.amount_ex_gst)), 0)
  const materialsBudget = nums.materialsBudget
  const materialsDiff = materialsBudget == null ? null : nums.materialsCost - materialsBudget
  const materialsDiffPct = materialsBudget ? nums.materialsCost / materialsBudget - 1 : null
  const photoReceipts = counted.filter((x) => x.source === 'whatsapp').length
  const bought = totalItems(materials)
  const weekly = peopleOnJob(entries)
  const allWeeks = [...new Set(weekly.flatMap((p) => p.weeks.map((w) => w.week)))].sort()

  // ---------- Subbies ----------
  const subbieCost = Number(j.subbie_cost)
  const subbieMismatchHours = subbieRows.filter((r) => !r.fixed && r.invoiced > 0).reduce((s, r) => s + (r.invoiced - r.logged), 0)

  // ---------- Profit ----------
  const income = nums.income
  const totalCost = nums.costs
  const profit = income - totalCost
  const margin = income > 0 ? profit / income : null
  // What the job would have made if hours and materials had come in exactly as quoted (at the actual cost per hour)
  const expectedProfit =
    costPerHour != null && hoursBudget != null
      ? income - hoursBudget * costPerHour - (materialsBudget ?? nums.materialsCost)
      : null
  const expectedMargin = expectedProfit != null && income > 0 ? expectedProfit / income : null

  // ---------- Things to check ----------
  const toReview = entries.filter((e) => e.needs_review).length
  const workerFixed = entries.filter((e) => e.review_reason?.toLowerCase().includes('worker')).length
  const pendingInvoices = expenses.filter((x) => x.status === 'pending').length
  const possibleDupes = expenses.filter((x) => x.note?.startsWith('Possible duplicate')).length
  const openShifts = entries.filter((e) => !e.end_time).length

  // ---------- Findings ----------
  const findings: { tone: 'good' | 'bad' | 'info'; text: string }[] = []
  if (hoursDiff != null && hoursBudget && !finished) {
    findings.push(
      hoursDiff > 0.5
        ? { tone: 'bad', text: `Already ${hrs(hoursDiff)} over the ${hrs(hoursBudget)} quoted, and the job isn't finished.` }
        : { tone: 'info', text: `So far ${hrs(hoursUsed)} of the ${hrs(hoursBudget)} quoted hours used (${Math.round((hoursUsed / hoursBudget) * 100)}%).` },
    )
  } else if (hoursDiff != null && hoursBudget) {
    if (hoursDiff > 0.5) {
      findings.push({
        tone: 'bad',
        text: `Took ${hrs(hoursDiff)} (${pct(hoursDiffPct)}) more than the ${hrs(hoursBudget)} quoted${costPerHour ? ` — about ${money(hoursDiff * costPerHour)} of extra labour` : ''}.`,
      })
    } else if (hoursDiff < -0.5) {
      findings.push({ tone: 'good', text: `Finished ${hrs(-hoursDiff)} (${pct(hoursDiffPct)}) under the ${hrs(hoursBudget)} quoted.` })
    } else {
      findings.push({ tone: 'good', text: `Hours came in right on the quote (${hrs(hoursUsed)} of ${hrs(hoursBudget)}).` })
    }
  } else {
    findings.push({ tone: 'info', text: 'No labour hours on the quote, so hours can’t be compared. Add quoted hours under "Edit job details".' })
  }
  if (materialsDiff != null && materialsBudget && !finished) {
    findings.push(
      materialsDiff > 1
        ? { tone: 'bad', text: `Materials already ${money(materialsDiff)} over the quote.` }
        : { tone: 'info', text: `So far ${money(nums.materialsCost)} of the ${money(materialsBudget)} materials budget spent.` },
    )
  } else if (materialsDiff != null && materialsBudget) {
    if (materialsDiff > 1) findings.push({ tone: 'bad', text: `Materials cost ${money(materialsDiff)} (${pct(materialsDiffPct)}) more than quoted.` })
    else if (materialsDiff < -1) findings.push({ tone: 'good', text: `Materials came in ${money(-materialsDiff)} (${pct(materialsDiffPct)}) under the quote.` })
    else findings.push({ tone: 'good', text: 'Materials came in on the quote.' })
  }
  if (hoursDiff != null && hoursDiff > 0.5 && !variations.some((v) => Number(v.hours) > 0)) {
    findings.push({ tone: 'bad', text: 'Hours went over but no variation was added — was any extra work done that wasn’t charged?' })
  }
  if (variations.length) {
    findings.push({ tone: 'info', text: `${variations.length} variation${variations.length > 1 ? 's' : ''} added ${money(Number(j.variations_total))} to the job.` })
  }
  if (weekendHours > 0.1) findings.push({ tone: 'info', text: `${hrs(weekendHours)} worked on weekends (charged at weekend rates where set).` })
  if (overtimeHours > 0.1) findings.push({ tone: 'info', text: `${hrs(overtimeHours)} of overtime (paid at overtime rates where set).` })
  if (Math.abs(subbieMismatchHours) >= 0.5) {
    findings.push({
      tone: subbieMismatchHours > 0 ? 'bad' : 'info',
      text: subbieMismatchHours > 0
        ? `Subbies invoiced ${hrs(subbieMismatchHours)} more than they signed in for on WhatsApp.`
        : `Subbies invoiced ${hrs(-subbieMismatchHours)} fewer than they signed in for.`,
    })
  }
  if (creditsTotal < 0) findings.push({ tone: 'good', text: `${money(-creditsTotal)} came back from returns/credits.` })
  if (margin != null) {
    findings.push({
      tone: margin >= 0.3 ? 'good' : margin >= 0.15 ? 'info' : 'bad',
      text: `${finished ? 'Final margin' : 'Margin so far'} ${Math.round(margin * 100)}%${expectedMargin != null ? ` (would have been ${Math.round(expectedMargin * 100)}% if it ran exactly to quote)` : ''}.`,
    })
  }

  const tone = { good: 'text-good', bad: 'text-bad', info: 'text-ink' }
  const dot = { good: '✓', bad: '!', info: '•' }

  return (
    <div className="space-y-6 print:text-black">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={`/jobs/${id}`} className="text-brand text-sm font-medium hover:underline print:hidden">← Back to job</Link>
          <p className="text-muted text-sm mt-3">{jobTitle(j)} · {jobSubtitle(j)}</p>
          <p className="text-sm font-semibold mt-3 text-muted">{finished ? 'Final job report' : 'Job still running · numbers so far'}</p>
          <h1 className={`text-[26px] md:text-[32px] font-bold leading-tight mt-1 ${profit >= 0 ? '' : 'text-bad'}`}>
            {profit >= 0 ? '✓ ' : '! '}
            {finished
              ? profit >= 0 ? `Made ${money(profit)} profit` : `Lost ${money(-profit)}`
              : profit >= 0 ? `${money(profit)} ahead so far` : `${money(-profit)} behind so far`}
            {margin != null && ` (${Math.round(margin * 100)}% margin)`}
          </h1>
          <p className="text-faint text-sm mt-1">All money is ex GST. Labour includes on-costs, unpaid breaks, weekend and overtime rates.</p>
        </div>
        <PrintButton />
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Box label="Income" value={money(income)} sub={`Quote ${money(Number(j.quote_total ?? 0))} + variations ${money(Number(j.variations_total))}`} />
        <Box label="Total cost" value={money(totalCost)} sub={`Labour ${money(employeeCost)} · Subbies ${money(subbieCost)} · Materials ${money(nums.materialsCost)}`} />
        <Box label="Profit" value={money(profit)} tone={profit >= 0 ? 'green' : 'red'} sub={expectedProfit != null ? `${signedMoney(profit - expectedProfit)} vs quote` : undefined} />
        <Box
          label={finished ? 'Margin' : 'Margin so far'}
          value={margin == null ? '—' : `${Math.round(margin * 100)}%`}
          tone={margin == null ? undefined : margin >= 0.3 ? 'green' : margin >= 0.15 ? 'yellow' : 'red'}
          sub={expectedMargin != null ? `${Math.round(expectedMargin * 100)}% if run to quote` : undefined}
        />
      </div>

      {/* Findings */}
      <Section title="What happened on this job">
        <ul className="space-y-2">
          {findings.map((f, i) => (
            <li key={i} className={`flex gap-3 ${tone[f.tone]}`}>
              <span className="font-bold w-4 shrink-0">{dot[f.tone]}</span>
              <span>{f.text}</span>
            </li>
          ))}
        </ul>
        {finished && hoursUsed > 0 && (
          <p className="mt-4 text-sm bg-brand-tint border border-brand/15 rounded-xl px-4 py-3 text-ink">
            <strong>Quoting tip:</strong> this job actually took <strong>{hrs(hoursUsed)}</strong> of labour
            {nums.materialsCost > 0 && <> and <strong>{money(nums.materialsCost)}</strong> of materials</>}
            {costPerHour != null && <> at about <strong>{money(costPerHour)}/hour</strong> all-in</>}. Use these numbers for the next similar job.
          </p>
        )}
      </Section>

      {/* Quoted vs actual */}
      <Section title="Quoted vs actual">
        <Table
          head={['', 'Quoted', 'Actual', 'Difference']}
          rows={[
            ['Labour hours', hoursBudget == null ? '—' : hrs(hoursBudget), hrs(hoursUsed), hoursDiff == null ? '—' : `${signedHrs(hoursDiff)} (${pct(hoursDiffPct)})`],
            ['Materials', materialsBudget == null ? '—' : money(materialsBudget), money(nums.materialsCost), materialsDiff == null ? '—' : `${signedMoney(materialsDiff)} (${pct(materialsDiffPct)})`],
            ['Income', money(Number(j.quote_total ?? 0)), money(income), signedMoney(Number(j.variations_total))],
            ['Profit', expectedProfit == null ? '—' : money(expectedProfit), money(profit), expectedProfit == null ? '—' : signedMoney(profit - expectedProfit)],
            ['Working days', plannedDays == null ? '—' : String(plannedDays), String(daysWorked), plannedDays == null ? '—' : `${daysWorked - plannedDays > 0 ? '+' : ''}${daysWorked - plannedDays}`],
          ]}
          note="Quoted hours and materials include variations. 'Quoted' profit uses the actual cost per hour, to show what the job would have made if it ran exactly to the quote."
        />
      </Section>

      {/* Hours per person per week */}
      <Section title="Hours by person, week by week">
        {!weekly.length ? (
          <p className="text-faint text-sm">No hours recorded.</p>
        ) : (
          <>
            <Table
              head={['Person', ...allWeeks.map((w) => weekLabel(w)), 'Total']}
              rows={weekly.map((p) => [
                `${p.name}${isSubbieType(p.type) ? ' (subbie)' : ''}`,
                ...allWeeks.map((wk) => {
                  const w = p.weeks.find((x) => x.week === wk)
                  return w ? `${hrs(w.hours)} · ${w.days}d` : '—'
                }),
                hrs(p.hours),
              ])}
              foot={[
                'Crew total',
                ...allWeeks.map((wk) => hrs(weekly.reduce((s, p) => s + (p.weeks.find((x) => x.week === wk)?.hours ?? 0), 0))),
                hrs(weekly.reduce((s, p) => s + p.hours, 0)),
              ]}
              note="Paid hours (unpaid breaks taken off) and days on site. Weeks run Monday to Sunday."
            />
            <p className="text-sm mt-3 print:hidden">
              {weekly.map((p, i) => (
                <span key={p.workerId}>
                  {i > 0 && ' · '}
                  <Link href={`/jobs/${id}/people/${p.workerId}`} className="text-brand font-medium">{p.name}&apos;s shifts</Link>
                </span>
              ))}
            </p>
          </>
        )}
      </Section>

      {/* What was bought */}
      <Section title="What was bought">
        {!bought.length ? (
          <p className="text-faint text-sm">No item lists on this job&apos;s invoices yet.</p>
        ) : (
          <Table
            head={['Item', 'Total qty', 'Spent']}
            rows={bought.map((b) => [`${b.description}${b.times > 1 ? ` (${b.times} invoices)` : ''}`, fmtQty(b.qty), moneyCents(b.amount)])}
            note="Added up across every materials invoice on this job, with returns taken off. Prices as printed on the invoices."
          />
        )}
        <Link href={`/jobs/${id}/invoices`} className="inline-block mt-3 text-brand text-sm font-semibold print:hidden">See each invoice →</Link>
      </Section>

      {/* Each invoice */}
      <Section title="Each invoice" collapsed>
        {!counted.length ? (
          <p className="text-faint text-sm">No invoices.</p>
        ) : (
          <div className="space-y-4">
            {counted.map((x) => (
              <div key={x.id} className="border-b border-line last:border-0 pb-4 last:pb-0">
                <div className="flex justify-between gap-3">
                  <Link href={`/inbox/${x.id}`} className="font-semibold hover:text-brand">
                    {x.supplier ?? 'Unknown'} <span className="text-muted font-normal">· {fmtDate(x.expense_date)}{x.invoice_number ? ` · #${x.invoice_number}` : ''}</span>
                  </Link>
                  <span className={`font-semibold ${x.is_credit ? 'text-good' : ''}`}>{moneyCents(Number(x.amount_ex_gst))}</span>
                </div>
                {itemsOf(x.line_items).length > 0 && (
                  <ul className="text-sm text-muted mt-1 space-y-0.5">
                    {itemsOf(x.line_items).map((i, k) => (
                      <li key={k}>{fmtQty(i.qty ?? 1)} × {i.description}{i.amount != null ? ` — ${moneyCents(i.amount)}` : ''}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Dates */}
      <Section title="Dates & crew" collapsed>
        <Table
          head={['', 'Planned', 'Actual']}
          rows={[
            ['Start', fmtDate(j.start_date), fmtDate(actualStart)],
            ['Finish', fmtDate(j.planned_finish), fmtDate(actualFinish)],
            ['Days on site', plannedDays == null ? '—' : String(plannedDays), String(daysWorked)],
          ]}
        />
        <p className="text-sm text-muted mt-3">
          {personDays} person-days on site{daysWorked ? `, average crew of ${(personDays / daysWorked).toFixed(1)}` : ''}
          {daysWorked ? `, ${hrs(hoursUsed / daysWorked)} of labour per day` : ''}.
          {job.completed_at && <> Marked finished {fmtDate(job.completed_at.slice(0, 10))}.</>}
        </p>
      </Section>

      {/* Labour */}
      <Section title="Labour by person" collapsed>
        {!personRows.length ? (
          <p className="text-faint text-sm">No hours recorded.</p>
        ) : (
          <Table
            head={['Person', 'Days', 'Shifts', 'Paid hours', 'Weekend', 'Overtime', 'Cost']}
            rows={personRows.map((p) => [
              `${p.name}${isSubbieType(p.type) ? ' (subbie)' : ''}`,
              String(p.days.size),
              String(p.shifts),
              hrs(p.paid),
              p.weekend ? hrs(p.weekend) : '—',
              p.overtime ? hrs(p.overtime) : '—',
              isSubbieType(p.type) ? 'see subbies' : money(p.cost),
            ])}
            foot={['Employees total', '', '', hrs(employeeHours), '', '', money(employeeCost)]}
          />
        )}
        {costPerHour != null && <p className="text-sm text-muted mt-3">All-in labour cost (employees + subbies): {money(costPerHour)} per hour.</p>}
      </Section>

      {/* Subbies */}
      {subbieRows.length > 0 && (
        <Section title="Subbies" collapsed>
          <Table
            head={['Subbie', 'Type', 'Signed in', 'Invoiced hours', 'Difference', 'Invoiced (ex GST)']}
            rows={subbieRows.map((r) => [
              r.name,
              r.fixed ? 'Fixed price' : 'Hourly',
              hrs(r.logged),
              r.fixed ? '—' : r.invoiced ? hrs(r.invoiced) : 'not yet',
              r.fixed || !r.invoiced ? '—' : signedHrs(r.invoiced - r.logged),
              money(r.amount),
            ])}
            foot={['Total', '', '', '', '', money(subbieCost)]}
          />
        </Section>
      )}

      {/* Materials */}
      <Section title="Materials by supplier" collapsed>
        {!supplierRows.length ? (
          <p className="text-faint text-sm">No materials invoices.</p>
        ) : (
          <Table
            head={['Supplier', 'Invoices', 'Spent', 'Credits/returns', 'Net']}
            rows={supplierRows.map(([name, r]) => [name, String(r.count), money(r.spent), r.credits ? money(r.credits) : '—', money(r.spent + r.credits)])}
            foot={['Total', String(materials.length), '', creditsTotal ? money(creditsTotal) : '—', money(nums.materialsCost)]}
          />
        )}
        {photoReceipts > 0 && <p className="text-sm text-muted mt-3">{photoReceipts} receipt{photoReceipts > 1 ? 's' : ''} sent in by workers on WhatsApp.</p>}
      </Section>

      {/* Variations */}
      {variations.length > 0 && (
        <Section title="Variations" collapsed>
          <Table
            head={['Variation', 'Charged', 'Extra hours', 'Extra materials']}
            rows={variations.map((v) => [v.description ?? '', money(Number(v.amount)), hrs(Number(v.hours)), money(Number(v.materials))])}
            foot={['Total', money(Number(j.variations_total)), hrs(Number(j.variation_hours)), money(Number(j.variation_materials))]}
          />
        </Section>
      )}

      {/* Data checks */}
      <Section title="Before you trust these numbers" collapsed>
        <ul className="text-sm space-y-1.5">
          <Check ok={toReview === 0} text={toReview ? `${toReview} shift(s) still need checking (forgotten sign-outs)` : 'No shifts waiting to be checked'} href={`/hours?job=${id}`} />
          <Check ok={openShifts === 0} text={openShifts ? `${openShifts} shift(s) still open (someone is signed in)` : 'Nobody still signed in'} />
          <Check ok={pendingInvoices === 0} text={pendingInvoices ? `${pendingInvoices} invoice(s) waiting in "Check these"` : 'No invoices waiting to be checked'} href="/inbox" />
          <Check ok={possibleDupes === 0} text={possibleDupes ? `${possibleDupes} possible duplicate invoice(s)` : 'No possible duplicate invoices'} href="/inbox" />
          <Check ok={noRateShifts === 0} text={noRateShifts ? `${noRateShifts} shift(s) by workers with no pay rate (costed at $0)` : 'Every worker has a pay rate'} href="/workers" />
          {workerFixed > 0 && <Check ok text={`${workerFixed} shift time(s) were corrected by workers on WhatsApp`} href={`/hours?job=${id}`} />}
        </ul>
      </Section>
    </div>
  )
}

function Box({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'green' | 'red' | 'yellow' }) {
  const color = tone === 'green' ? 'text-good' : tone === 'red' ? 'text-bad' : tone === 'yellow' ? 'text-warn' : ''
  return (
    <div className={`${cardClass} p-4 print:shadow-none`}>
      <p className="text-muted text-sm">{label}</p>
      <p className={`text-xl md:text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-faint text-xs mt-0.5">{sub}</p>}
    </div>
  )
}

function Section({ title, children, collapsed = false }: { title: string; children: React.ReactNode; collapsed?: boolean }) {
  if (collapsed) {
    return (
      <details className={`${cardClass} group break-inside-avoid print:shadow-none`} open={false}>
        <summary className="flex items-center justify-between px-5 py-4 cursor-pointer font-bold">
          {title}
          <span className="text-faint font-normal transition group-open:rotate-90">›</span>
        </summary>
        <div className="px-5 pb-5">{children}</div>
      </details>
    )
  }
  return (
    <section className="break-inside-avoid">
      <h2 className="text-lg font-bold mb-3">{title}</h2>
      <div className={`${cardClass} p-5 print:shadow-none`}>{children}</div>
    </section>
  )
}

function Table({ head, rows, foot, note }: { head: string[]; rows: string[][]; foot?: string[]; note?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-muted">
            {head.map((h, i) => <th key={i} className={`py-2 pr-4 font-medium ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line last:border-0">
              {r.map((c, k) => <td key={k} className={`py-2.5 pr-4 ${k === 0 ? 'text-left font-medium' : 'text-right'}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
        {foot && (
          <tfoot>
            <tr className="border-t-2 border-line font-bold">
              {foot.map((c, k) => <td key={k} className={`py-2.5 pr-4 ${k === 0 ? 'text-left' : 'text-right'}`}>{c}</td>)}
            </tr>
          </tfoot>
        )}
      </table>
      {note && <p className="text-xs text-faint mt-2">{note}</p>}
    </div>
  )
}

function Check({ ok, text, href }: { ok: boolean; text: string; href?: string }) {
  return (
    <li className={`flex gap-2 ${ok ? 'text-ink' : 'text-warn font-medium'}`}>
      <span className="w-4">{ok ? '✓' : '!'}</span>
      {href && !ok ? <Link href={href} className="underline">{text}</Link> : <span>{text}</span>}
    </li>
  )
}
