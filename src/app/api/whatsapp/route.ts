import { createHmac, timingSafeEqual } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase'
import { businessDb, type BusinessDb } from '@/lib/db'
import { compactCode, fmtClock, fmtDuration, money, sydneyTimeOn, todaySydney } from '@/lib/format'
import { CALL_BOSS, closeEntry, finishTimeFor, startTimeFor, usualFinish } from '@/lib/hours'
import { isReadableInvoiceType, processInvoiceFile } from '@/lib/invoices'
import { downloadMedia, sendButtons, sendList, sendText } from '@/lib/whatsapp'
import { NextRequest, after } from 'next/server'

// Reading a receipt photo with AI can take a while
export const maxDuration = 60

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN!

type Media = { id: string; mime: string; filename?: string; caption?: string }
type Input = { kind: 'text'; value: string } | { kind: 'action'; id: string } | { kind: 'media'; media: Media }
// Everything the bot does for a worker is limited to their employer's business
type Supabase = BusinessDb
type Worker = { id: string; name: string; break_minutes: number; business_id: string }
type OpenEntry = {
  id: string; job_id: string; start_time: string
  jobs: { code: string; client_name: string | null; address: string | null; day_end: string | null } | null
}

// Meta webhook verification
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 })
  }
  return new Response('Forbidden', { status: 403 })
}

// Incoming WhatsApp messages, photos and button/list taps
export async function POST(req: NextRequest) {
  const raw = await req.text()

  // Meta signs every real webhook with the app secret. Once WHATSAPP_APP_SECRET is set, reject anything unsigned or forged.
  const appSecret = process.env.WHATSAPP_APP_SECRET
  if (appSecret) {
    const expected = Buffer.from('sha256=' + createHmac('sha256', appSecret).update(raw).digest('hex'))
    const given = Buffer.from(req.headers.get('x-hub-signature-256') ?? '')
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return new Response('Invalid signature', { status: 401 })
    }
  } else {
    console.warn('WHATSAPP_APP_SECRET is not set: webhook signatures are not being checked')
  }

  let body
  try {
    body = JSON.parse(raw)
  } catch {
    return new Response('Bad request', { status: 400 })
  }
  const msg = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]
  if (!msg) return new Response('ok', { status: 200 })

  let input: Input
  if (msg.type === 'text') {
    input = { kind: 'text', value: msg.text?.body?.trim() ?? '' }
  } else if (msg.type === 'interactive') {
    const id = msg.interactive?.button_reply?.id ?? msg.interactive?.list_reply?.id
    if (!id) return new Response('ok', { status: 200 })
    input = { kind: 'action', id }
  } else if (msg.type === 'image' || msg.type === 'document') {
    const m = msg[msg.type]
    if (!m?.id) return new Response('ok', { status: 200 })
    input = { kind: 'media', media: { id: m.id, mime: m.mime_type ?? '', filename: m.filename, caption: m.caption } }
  } else {
    return new Response('ok', { status: 200 })
  }

  const from: string = msg.from // e.g. "61412345678" (no +)
  const logBody = input.kind === 'text' ? input.value : input.kind === 'action' ? input.id : `[${msg.type}] ${input.media.caption ?? ''}`

  // Meta can deliver the same message more than once; only handle each message id once.
  const { error: dupe } = await createServiceClient()
    .from('message_log')
    .insert({ wamid: msg.id, from_number: from, body: logBody })
  if (dupe) return new Response('ok', { status: 200 })

  // Reply after responding so Meta gets its 200 quickly, without the server stopping mid-reply.
  after(() => processMessage(from, input).catch(console.error))

  return new Response('ok', { status: 200 })
}

async function getOpenEntry(supabase: Supabase, workerId: string) {
  const { data } = await supabase
    .from('time_entries')
    .select('id, job_id, start_time, jobs(code, client_name, address, day_end)')
    .eq('worker_id', workerId)
    .is('end_time', null)
    .order('start_time', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data as unknown as OpenEntry | null
}

const hoursSince = (iso: string) => ((Date.now() - new Date(iso).getTime()) / 3600000).toFixed(1)
const firstName = (w: Worker) => w.name.split(' ')[0]
const CHANGE_HOURS = ['change hours', 'change hour', 'change', 'fix hours', 'fix hour', 'fix', 'hours', 'edit hours']

async function processMessage(from: string, input: Input) {
  const phone = from.startsWith('+') ? from : `+${from}`
  const raw = createServiceClient()

  const { data: worker } = await raw
    .from('workers')
    .select('id, name, active, break_minutes, business_id')
    .eq('phone', phone)
    .maybeSingle()

  if (!worker) {
    await sendText(from, `Hi! Your number isn't registered yet. Ask your boss to add you to the system.`)
    return
  }
  if (!worker.active) {
    await sendText(from, `Your account is inactive. Contact your boss.`)
    return
  }

  const supabase = businessDb(worker.business_id)

  if (input.kind === 'media') return handleReceipt(supabase, from, worker, input.media)

  // Taps on buttons and lists
  if (input.kind === 'action') {
    if (input.id === 'signin') return sendJobList(supabase, from, worker)
    if (input.id === 'signout') return signOut(supabase, from, worker)
    // Workers can't change their own hours: old "fix time" buttons point them to the boss
    if (['finished_earlier', 'missed'].includes(input.id) || input.id.startsWith('miss:') || input.id.startsWith('late_other:')) {
      await sendText(from, CALL_BOSS)
      return
    }
    if (input.id === 'still_working') {
      await sendButtons(from, `No worries — tap Sign out when you finish.`, [{ id: 'signout', title: 'Sign out' }])
      return
    }
    if (input.id.startsWith('job:')) return signIn(supabase, from, worker, { id: input.id.slice(4) })
    if (input.id.startsWith('late_')) return confirmLateFinish(supabase, from, worker, input.id)
    return sendMenu(supabase, from, worker)
  }

  const lower = input.value.toLowerCase()

  // Typed commands still work as a backup
  if (['off', 'clock off', 'out', 'sign out', 'signout'].includes(lower)) return signOut(supabase, from, worker)

  const onMatch = input.value.match(/^on\s+(\S.*)$/i)
  if (onMatch) return signIn(supabase, from, worker, { code: onMatch[1].trim() })

  if (['status', 'where am i', '?'].includes(lower)) {
    const open = await getOpenEntry(supabase, worker.id)
    if (!open) await sendText(from, `You're not signed in right now.`)
    else await sendText(from, `You're on ${open.jobs?.code ?? 'a job'} — ${hoursSince(open.start_time)}h so far.`)
    return sendMenu(supabase, from, worker)
  }

  if (['sign in', 'signin', 'in', 'start', 'on'].includes(lower)) return sendJobList(supabase, from, worker)

  if (CHANGE_HOURS.includes(lower)) {
    await sendText(from, CALL_BOSS)
    return
  }

  // Anything else (hi, hello…) shows the menu
  return sendMenu(supabase, from, worker)
}

async function sendMenu(supabase: Supabase, from: string, worker: Worker) {
  const open = await getOpenEntry(supabase, worker.id)
  if (!open) {
    await sendButtons(from, `Hi ${firstName(worker)}! Ready to start?`, [{ id: 'signin', title: 'Sign in' }])
  } else {
    await sendButtons(from, `Hi ${firstName(worker)}! You're at ${open.jobs?.address ?? open.jobs?.code ?? 'a job'} (${hoursSince(open.start_time)}h so far).`, [
      { id: 'signout', title: 'Sign out' },
      { id: 'signin', title: 'Switch job' },
    ])
  }
}

async function activeJobs(supabase: Supabase) {
  const { data } = await supabase
    .from('jobs')
    .select('id, code, client_name, address')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(11)
  return data ?? []
}

// Workers know sites by address, so the address is the big line and the code/client sit underneath
const jobRow = (j: { code: string; client_name: string | null; address: string | null }) => ({
  title: (j.address || `${j.code} ${j.client_name ?? ''}`).trim().slice(0, 24),
  description:
    [j.code, j.client_name, j.address && j.address.length > 24 ? j.address : null].filter(Boolean).join(' · ').slice(0, 72) || undefined,
})
const siteName = (j: { code: string; address: string | null }) => (j.address ? `${j.address} (${j.code})` : j.code)

async function sendJobList(supabase: Supabase, from: string, worker: Worker) {
  const jobs = await activeJobs(supabase)
  if (!jobs.length) {
    await sendText(from, `There are no active jobs right now. Check with your boss.`)
    return
  }
  const more = jobs.length > 10 ? `\n(Showing the 10 newest. For another job, type "on" and its job code.)` : ''
  await sendList(
    from,
    `Which job site are you on, ${firstName(worker)}?${more}`,
    'Choose job',
    jobs.slice(0, 10).map((j) => ({ id: `job:${j.id}`, ...jobRow(j) })),
  )
}

async function signIn(supabase: Supabase, from: string, worker: Worker, which: { id: string } | { code: string }) {
  const { data: jobRows } = await supabase.from('jobs').select('id, code, client_name, address, status, day_start')
  const job = 'id' in which
    ? jobRows?.find((j) => j.id === which.id)
    : jobRows?.find((j) => compactCode(j.code) === compactCode(which.code))

  if (!job) {
    await sendText(from, `I couldn't find that job. Tap "Sign in" to see the active jobs.`)
    return
  }
  if (job.status !== 'active') {
    await sendText(from, `${job.code} isn't an active job any more. Tap "Sign in" to see the current jobs.`)
    return
  }

  const open = await getOpenEntry(supabase, worker.id)
  if (open && open.job_id === job.id) {
    await sendButtons(from, `You're already signed in to ${job.code}.`, [{ id: 'signout', title: 'Sign out' }])
    return
  }

  let switched = ''
  if (open) {
    const closed = await closeEntry(supabase.raw, open, new Date(), open.jobs?.day_end)
    switched = closed.flagged
      ? `You didn't sign out of ${open.jobs?.code ?? 'your last job'}, so I put ${fmtClock(closed.end)} as the finish. If that's wrong, call your boss to fix it.\n\n`
      : `Switched from ${open.jobs?.address ?? open.jobs?.code ?? 'your last job'}. `
  }

  // Up to 30 minutes before the usual start counts from the usual start (not when switching jobs mid-day)
  const { start, snapped } = open ? { start: new Date(), snapped: false } : startTimeFor(new Date(), job.day_start)
  const { error } = await supabase
    .from('time_entries')
    .insert({ worker_id: worker.id, job_id: job.id, start_time: start.toISOString(), source: 'whatsapp' })
  if (error) {
    console.error('clock-in failed', error)
    await sendText(from, `Sorry, that didn't save. Please try again.`)
    return
  }

  const startNote = snapped ? ` Your hours start from ${fmtClock(start)}.` : ''
  await sendButtons(from, `${switched}Signed in at ${siteName(job)} ✓${startNote}`, [{ id: 'signout', title: 'Sign out' }])
}

async function signOut(supabase: Supabase, from: string, worker: Worker) {
  const open = await getOpenEntry(supabase, worker.id)
  if (!open) {
    await sendButtons(from, `You're not signed in.`, [{ id: 'signin', title: 'Sign in' }])
    return
  }
  const code = open.jobs?.code ?? 'job'
  const where = open.jobs?.address ?? code
  const now = new Date()
  const longAgo = now.getTime() - new Date(open.start_time).getTime() > 16 * 3600000
  const closed = longAgo ? await closeEntry(supabase.raw, open, now, open.jobs?.day_end) : null
  if (closed?.flagged) {
    await sendText(
      from,
      `Your sign-in at ${code} was left open, so I've put ${fmtClock(closed.end)} as the finish. If that's wrong, call your boss to fix it.`,
    )
    return
  }
  // Signing out a little after the usual finish counts as the usual finish; much later, the worker confirms
  const { end, usual, late } = finishTimeFor(open.start_time, now, open.jobs?.day_end)
  const onSite = (end.getTime() - new Date(open.start_time).getTime()) / 3600000
  await supabase
    .from('time_entries')
    .update({
      end_time: end.toISOString(),
      ...(late
        ? { needs_review: true, review_reason: `Signed out at ${fmtClock(now)}, after the usual ${usual ? fmtClock(usual) : ''} finish. Waiting for the worker to confirm.` }
        : {}),
    })
    .eq('id', open.id)

  const breakNote = worker.break_minutes > 0 ? ` Your ${worker.break_minutes} min lunch break comes off automatically.` : ''
  if (late && usual) {
    await sendButtons(
      from,
      `Signed out of ${where} ✓\n\nLooks like you worked ${fmtDuration(onSite)} today (${fmtClock(open.start_time)} to ${fmtClock(end)}). Is that right?${breakNote}\n\n(A different time? Call your boss to fix it.)`,
      [
        { id: `late_ok:${open.id}`, title: `Yes, that's right` },
        { id: `late_usual:${open.id}`, title: `No, left ${fmtClock(usual)}`.slice(0, 20) },
      ],
    )
    return
  }
  await sendText(from, `Signed out of ${where} ✓ ${fmtDuration(onSite)} on site (${fmtClock(open.start_time)} to ${fmtClock(end)}).${breakNote} Good work ${firstName(worker)}! 👍`)
}

// Answers to "Looks like you worked 9h 45m today. Is that right?"
async function confirmLateFinish(supabase: Supabase, from: string, worker: Worker, action: string) {
  const [kind, entryId] = action.split(':')
  const { data: entry } = await supabase
    .from('time_entries')
    .select('id, start_time, end_time, jobs(code, address, day_end)')
    .eq('id', entryId ?? '')
    .eq('worker_id', worker.id)
    .maybeSingle()
  if (!entry?.end_time) return sendMenu(supabase, from, worker)
  const job = entry.jobs as unknown as { code: string; address: string | null; day_end: string | null } | null
  const where = job?.address ?? job?.code ?? 'the job'

  let end = entry.end_time
  if (kind === 'late_usual') {
    end = usualFinish(entry.start_time, job?.day_end) ?? entry.end_time
  }
  await supabase
    .from('time_entries')
    .update({
      end_time: end,
      needs_review: false,
      review_reason: kind === 'late_ok' ? `Worker confirmed finishing at ${fmtClock(end)}` : null,
    })
    .eq('id', entry.id)
  const hours = (new Date(end).getTime() - new Date(entry.start_time).getTime()) / 3600000
  await sendText(from, `Thanks ✓ Saved ${fmtClock(entry.start_time)} to ${fmtClock(end)} at ${where} (${fmtDuration(hours)}).`)
}

async function handleReceipt(supabase: Supabase, from: string, worker: Worker, media: Media) {
  const file = await downloadMedia(media.id)
  const name = media.filename ?? `whatsapp-receipt.${media.mime.includes('pdf') ? 'pdf' : 'jpg'}`
  if (!file || !isReadableInvoiceType(file.contentType, name)) {
    await sendText(from, `I can only read photos (JPG/PNG) or PDFs of receipts. Please try again.`)
    return
  }

  let saved
  try {
    saved = await processInvoiceFile(
      { name, contentType: file.contentType, data: file.data },
      { source: 'whatsapp', businessId: worker.business_id, hint: media.caption, submittedBy: worker.id },
    )
  } catch (e) {
    console.error('receipt failed', e)
    await sendText(from, `Sorry, I couldn't save that receipt. Please try again, or give it to your boss.`)
    return
  }

  if (!saved) {
    await sendText(from, `I couldn't read a receipt in that. Try a clear photo of the whole receipt, flat and in good light.`)
    return
  }
  const label = `${saved.supplier ?? 'Receipt'} ${money(saved.total)}`
  if (saved.duplicate) {
    await sendText(from, `Receipt saved ✓ (${label} was already in the system, so it isn't counted twice.)`)
    return
  }
  if (saved.job_id) {
    const { data: coded } = await supabase.from('jobs').select('code, address').eq('id', saved.job_id).maybeSingle()
    await sendText(from, `Receipt saved ✓ ${label} → ${coded ? siteName(coded) : 'the job'}.`)
    return
  }

  // No job code on it: put it on the job they're signed in to (or worked on today); otherwise the boss sorts it
  const job = await currentOrTodaysJob(supabase, worker.id)
  if (job) {
    await supabase
      .from('expenses')
      .update({ job_id: job.id, ...(saved.needsCheck ? {} : { status: 'approved' }) })
      .eq('id', saved.id)
      .is('job_id', null)
    await sendText(from, `Receipt saved ✓ ${label} → ${siteName(job)}.`)
    return
  }
  await sendText(from, `Receipt saved ✓ ${label}. Your boss will put it on the right job.`)
}

async function currentOrTodaysJob(supabase: Supabase, workerId: string) {
  const { data } = await supabase
    .from('time_entries')
    .select('start_time, end_time, jobs(id, code, address, status)')
    .eq('worker_id', workerId)
    .gte('start_time', sydneyTimeOn(todaySydney(), 0) ?? new Date().toISOString())
    .order('start_time', { ascending: false })
  const rows = (data ?? []) as unknown as { end_time: string | null; jobs: { id: string; code: string; address: string | null; status: string } | null }[]
  const pick = rows.find((r) => !r.end_time) ?? rows[0]
  return pick?.jobs && pick.jobs.status === 'active' ? pick.jobs : null
}
