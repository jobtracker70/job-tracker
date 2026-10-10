import { createHmac, timingSafeEqual } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase'
import { compactCode, fmtClock, money, parseClockTime, parseTimeRange, sydneyDateOf, sydneyTimeOn, todaySydney } from '@/lib/format'
import { askForFinishTime, closeEntry } from '@/lib/hours'
import { isReadableInvoiceType, processInvoiceFile } from '@/lib/invoices'
import { downloadMedia, sendButtons, sendList, sendText } from '@/lib/whatsapp'
import { NextRequest, after } from 'next/server'

// Reading a receipt photo with AI can take a while
export const maxDuration = 60

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN!

type Media = { id: string; mime: string; filename?: string; caption?: string }
type Input = { kind: 'text'; value: string } | { kind: 'action'; id: string } | { kind: 'media'; media: Media }
type Supabase = ReturnType<typeof createServiceClient>
type Worker = { id: string; name: string; break_minutes: number }
type OpenEntry = { id: string; job_id: string; start_time: string; jobs: { code: string; client_name: string | null } | null }

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
    .select('id, job_id, start_time, jobs(code, client_name)')
    .eq('worker_id', workerId)
    .is('end_time', null)
    .order('start_time', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data as unknown as OpenEntry | null
}

const hoursSince = (iso: string) => ((Date.now() - new Date(iso).getTime()) / 3600000).toFixed(1)
const firstName = (w: Worker) => w.name.split(' ')[0]
const fmtH = (h: number) => (Math.round(h * 10) / 10).toString()
const COMMANDS = ['hi', 'hello', 'hey', 'menu', 'sign in', 'signin', 'in', 'start', 'on', 'off', 'out', 'sign out', 'signout', 'clock off', 'status', '?', 'where am i']

async function processMessage(from: string, input: Input) {
  const phone = from.startsWith('+') ? from : `+${from}`
  const supabase = createServiceClient()

  const { data: worker } = await supabase
    .from('workers')
    .select('id, name, active, break_minutes')
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

  if (input.kind === 'media') return handleReceipt(supabase, from, worker, input.media)

  // Taps on buttons and lists
  if (input.kind === 'action') {
    if (input.id === 'signin') return sendJobList(supabase, from, worker)
    if (input.id === 'signout') return signOut(supabase, from, worker)
    if (input.id === 'finished_earlier') return askFinishedEarlier(supabase, from, worker)
    if (input.id === 'still_working') {
      await sendButtons(from, `No worries — tap Sign out when you finish.`, [{ id: 'signout', title: 'Sign out' }])
      return
    }
    if (input.id === 'missed') return sendMissedJobList(supabase, from, worker)
    if (input.id.startsWith('miss:')) return askMissedHours(supabase, from, worker, input.id.slice(5))
    if (input.id.startsWith('job:')) return signIn(supabase, from, worker, { id: input.id.slice(4) })
    if (input.id.startsWith('rcpt:')) {
      const [, expenseId, jobId] = input.id.split(':')
      return assignReceipt(supabase, from, worker, expenseId, jobId)
    }
    return sendMenu(supabase, from, worker)
  }

  const lower = input.value.toLowerCase()

  // Is the bot waiting for a time from this worker (finish time, or missed hours)?
  const { data: state } = await supabase.from('bot_state').select('*').eq('worker_id', worker.id).maybeSingle()
  if (state) {
    const fresh = Date.now() - new Date(state.created_at).getTime() < 24 * 3600000
    if (!fresh || COMMANDS.includes(lower)) {
      await supabase.from('bot_state').delete().eq('worker_id', worker.id)
    } else {
      return handleTimeReply(supabase, from, worker, state, input.value)
    }
  }

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

  // Anything else (hi, hello…) shows the menu
  return sendMenu(supabase, from, worker)
}

const RECEIPT_TIP = '📷 Bought materials? Send a photo of the receipt here.'

async function sendMenu(supabase: Supabase, from: string, worker: Worker) {
  const open = await getOpenEntry(supabase, worker.id)
  if (!open) {
    await sendButtons(from, `Hi ${firstName(worker)}! Ready to start?\n\n${RECEIPT_TIP}`, [
      { id: 'signin', title: 'Sign in' },
      { id: 'missed', title: 'Add missed hours' },
    ])
  } else {
    await sendButtons(
      from,
      `Hi ${firstName(worker)}! You're on ${open.jobs?.code ?? 'a job'} (${hoursSince(open.start_time)}h so far).\n\n${RECEIPT_TIP}`,
      [
        { id: 'signout', title: 'Sign out' },
        { id: 'finished_earlier', title: 'Finished earlier' },
        { id: 'signin', title: 'Switch job' },
      ],
    )
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

const jobRow = (j: { code: string; client_name: string | null; address: string | null }) => ({
  title: `${j.code} ${j.client_name ?? ''}`.trim().slice(0, 24),
  description: (j.address ?? j.client_name ?? '').slice(0, 72) || undefined,
})

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
  const { data: jobRows } = await supabase.from('jobs').select('id, code, client_name, status')
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
    const closed = await closeEntry(supabase, open)
    if (closed.flagged) await askForFinishTime(supabase, worker.id, open.id)
    switched = closed.flagged
      ? `You didn't sign out of ${open.jobs?.code ?? 'your last job'}, so I put ${fmtClock(closed.end)} as the finish. Reply with the real finish time (e.g. 4:30pm) to fix it.\n\n`
      : `Switched from ${open.jobs?.code ?? 'your last job'}. `
  }

  const { error } = await supabase
    .from('time_entries')
    .insert({ worker_id: worker.id, job_id: job.id, start_time: new Date().toISOString(), source: 'whatsapp' })
  if (error) {
    console.error('clock-in failed', error)
    await sendText(from, `Sorry, that didn't save. Please try again.`)
    return
  }

  const where = job.client_name ? ` (${job.client_name})` : ''
  await sendButtons(from, `${switched}Signed in to ${job.code}${where} ✓`, [{ id: 'signout', title: 'Sign out' }])
}

async function signOut(supabase: Supabase, from: string, worker: Worker) {
  const open = await getOpenEntry(supabase, worker.id)
  if (!open) {
    await sendButtons(from, `You're not signed in.`, [{ id: 'signin', title: 'Sign in' }])
    return
  }
  const closed = await closeEntry(supabase, open)
  const code = open.jobs?.code ?? 'job'
  if (closed.flagged) {
    await askForFinishTime(supabase, worker.id, open.id)
    await sendText(
      from,
      `Your sign-in at ${code} was left open, so I've put ${fmtClock(closed.end)} as the finish. Reply with the time you really finished (e.g. 4:30pm) to fix it.`,
    )
    return
  }
  const breakNote = worker.break_minutes > 0 ? ` Your ${worker.break_minutes} min lunch break comes off automatically.` : ''
  await sendText(from, `Signed out of ${code} — ${fmtH(closed.hours)}h on site.${breakNote} Good work ${firstName(worker)}! 👍`)
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
      { source: 'whatsapp', hint: media.caption, submittedBy: worker.id },
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
    await sendText(from, `${label} was already added before, so I haven't counted it twice. 👍`)
    return
  }
  if (saved.job_id) {
    const { data: job } = await supabase.from('jobs').select('code').eq('id', saved.job_id).maybeSingle()
    await sendText(from, `Got it ✓ ${label} added to ${job?.code ?? 'the job'}.`)
    return
  }

  // No job code on it: ask which job, with the job they're signed in to first
  const open = await getOpenEntry(supabase, worker.id)
  const jobs = await activeJobs(supabase)
  const ordered = [...jobs].sort((a, b) => (a.id === open?.job_id ? -1 : b.id === open?.job_id ? 1 : 0)).slice(0, 10)
  if (!ordered.length) {
    await sendText(from, `Got it: ${label}. There are no active jobs, so your boss will sort out which job it belongs to.`)
    return
  }
  await sendList(
    from,
    `Got it: ${label}. Which job is it for?`,
    'Choose job',
    ordered.map((j) => ({ id: `rcpt:${saved.id}:${j.id}`, ...jobRow(j) })),
  )
}

async function assignReceipt(supabase: Supabase, from: string, worker: Worker, expenseId: string, jobId: string) {
  const { data: job } = await supabase.from('jobs').select('id, code, status').eq('id', jobId).maybeSingle()
  if (!job || job.status !== 'active') {
    await sendText(from, `That job isn't active any more. Your boss will sort out this receipt.`)
    return
  }
  // Only the worker who sent the receipt can choose its job, and only while it's still waiting
  const { data, error } = await supabase
    .from('expenses')
    .update({ job_id: job.id, status: 'approved' })
    .eq('id', expenseId)
    .eq('submitted_by', worker.id)
    .is('job_id', null)
    .is('note', null)
    .select('supplier, total')
    .maybeSingle()
  if (error || !data) {
    // Possible duplicates stay for the boss to check
    await supabase.from('expenses').update({ job_id: job.id }).eq('id', expenseId).eq('submitted_by', worker.id).is('job_id', null)
    await sendText(from, `Thanks — noted for ${job.code}. Your boss will double-check this one.`)
    return
  }
  await sendText(from, `Added ✓ ${data.supplier ?? 'Receipt'} ${money(Number(data.total))} to ${job.code}.`)
}

async function askFinishedEarlier(supabase: Supabase, from: string, worker: Worker) {
  const open = await getOpenEntry(supabase, worker.id)
  if (!open) {
    await sendButtons(from, `You're not signed in right now.`, [{ id: 'missed', title: 'Add missed hours' }])
    return
  }
  await askForFinishTime(supabase, worker.id, open.id)
  await sendText(from, `What time did you finish at ${open.jobs?.code ?? 'the job'}? Reply like 3:30pm.`)
}

async function sendMissedJobList(supabase: Supabase, from: string, worker: Worker) {
  const jobs = await activeJobs(supabase)
  if (!jobs.length) {
    await sendText(from, `There are no active jobs right now. Check with your boss.`)
    return
  }
  await sendList(
    from,
    `Forgot to sign in today, ${firstName(worker)}? Pick the job, then tell me your start and finish times.`,
    'Choose job',
    jobs.slice(0, 10).map((j) => ({ id: `miss:${j.id}`, ...jobRow(j) })),
  )
}

async function askMissedHours(supabase: Supabase, from: string, worker: Worker, jobId: string) {
  const { data: job } = await supabase.from('jobs').select('id, code, status').eq('id', jobId).maybeSingle()
  if (!job || job.status !== 'active') {
    await sendText(from, `That job isn't active any more.`)
    return
  }
  await supabase
    .from('bot_state')
    .upsert({ worker_id: worker.id, kind: 'missed_hours', job_id: job.id, entry_id: null, created_at: new Date().toISOString() })
  await sendText(from, `What time did you start and finish at ${job.code} today? Reply like 7am-3:30pm.`)
}

type BotState = { kind: 'finish_time' | 'missed_hours'; entry_id: string | null; job_id: string | null }

async function handleTimeReply(supabase: Supabase, from: string, worker: Worker, state: BotState, text: string) {
  const done = () => supabase.from('bot_state').delete().eq('worker_id', worker.id)
  const now = Date.now()

  if (state.kind === 'finish_time') {
    const { data: entry } = await supabase
      .from('time_entries')
      .select('id, start_time, jobs(code)')
      .eq('id', state.entry_id ?? '')
      .eq('worker_id', worker.id)
      .maybeSingle()
    if (!entry) {
      await done()
      return sendMenu(supabase, from, worker)
    }
    const minutes = parseClockTime(text)
    if (minutes == null) {
      await sendText(from, `Sorry, I didn't get that time. Reply like 4:30pm (or "menu" to cancel).`)
      return
    }
    const end = sydneyTimeOn(sydneyDateOf(entry.start_time), minutes)
    const startMs = new Date(entry.start_time).getTime()
    const endMs = end ? new Date(end).getTime() : NaN
    if (!end || endMs <= startMs || endMs > now + 5 * 60000 || endMs - startMs > 16 * 3600000) {
      await sendText(from, `That doesn't fit — you signed in at ${fmtClock(entry.start_time)}. Reply with your finish time that day, e.g. 4:30pm.`)
      return
    }
    await supabase
      .from('time_entries')
      .update({
        end_time: end,
        needs_review: false,
        review_reason: `Finish time sent by worker on WhatsApp: ${fmtClock(end)}`,
      })
      .eq('id', entry.id)
    await done()
    const code = (entry.jobs as unknown as { code: string } | null)?.code ?? 'the job'
    await sendText(from, `Thanks ✓ Finish time at ${code} set to ${fmtClock(end)} — ${fmtH((endMs - startMs) / 3600000)}h on site.`)
    return
  }

  // Missed hours: a start–finish range for today
  const range = parseTimeRange(text)
  if (!range) {
    await sendText(from, `Sorry, I didn't get that. Reply with start and finish like 7am-3:30pm (or "menu" to cancel).`)
    return
  }
  const today = todaySydney()
  const start = sydneyTimeOn(today, range.start)
  const end = sydneyTimeOn(today, range.end)
  if (!start || !end || new Date(end).getTime() > now + 5 * 60000) {
    await sendText(from, `Those times are in the future. Reply with today's start and finish, e.g. 7am-3:30pm.`)
    return
  }
  const { data: overlapping } = await supabase
    .from('time_entries')
    .select('start_time, end_time')
    .eq('worker_id', worker.id)
    .lt('start_time', end)
    .or(`end_time.is.null,end_time.gt."${start}"`)
  if (overlapping?.length) {
    const o = overlapping[0]
    await sendText(
      from,
      `That overlaps hours you already have today (${fmtClock(o.start_time)}–${o.end_time ? fmtClock(o.end_time) : 'now'}). Ask your boss to fix it.`,
    )
    await done()
    return
  }
  const { data: job } = await supabase.from('jobs').select('code').eq('id', state.job_id ?? '').maybeSingle()
  const { error } = await supabase.from('time_entries').insert({
    worker_id: worker.id,
    job_id: state.job_id,
    start_time: start,
    end_time: end,
    source: 'whatsapp',
    review_reason: 'Added by worker on WhatsApp (forgot to sign in)',
  })
  await done()
  if (error) {
    console.error('missed hours failed', error)
    await sendText(from, `Sorry, that didn't save. Please ask your boss to add it.`)
    return
  }
  await sendText(from, `Added ✓ ${fmtClock(start)}–${fmtClock(end)} at ${job?.code ?? 'the job'} today.`)
}
