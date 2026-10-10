import { createServiceClient } from '@/lib/supabase'
import { NextRequest, after } from 'next/server'

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN!
const WA_TOKEN = process.env.WHATSAPP_TOKEN!
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID!

type Input = { kind: 'text'; value: string } | { kind: 'action'; id: string }
type Supabase = ReturnType<typeof createServiceClient>
type Worker = { id: string; name: string }
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

// Incoming WhatsApp messages and button/list taps
export async function POST(req: NextRequest) {
  const body = await req.json()
  const msg = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]
  if (!msg) return new Response('ok', { status: 200 })

  let input: Input
  if (msg.type === 'text') {
    input = { kind: 'text', value: msg.text?.body?.trim() ?? '' }
  } else if (msg.type === 'interactive') {
    const id = msg.interactive?.button_reply?.id ?? msg.interactive?.list_reply?.id
    if (!id) return new Response('ok', { status: 200 })
    input = { kind: 'action', id }
  } else {
    return new Response('ok', { status: 200 })
  }

  const from: string = msg.from // e.g. "61412345678" (no +)

  // Meta can deliver the same message more than once; only handle each message id once.
  const { error: dupe } = await createServiceClient()
    .from('message_log')
    .insert({ wamid: msg.id, from_number: from, body: input.kind === 'text' ? input.value : input.id })
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

async function processMessage(from: string, input: Input) {
  const phone = from.startsWith('+') ? from : `+${from}`
  const supabase = createServiceClient()

  const { data: worker } = await supabase
    .from('workers')
    .select('id, name, active')
    .eq('phone', phone)
    .maybeSingle()

  if (!worker) {
    await reply(from, `Hi! Your number isn't registered yet. Ask your boss to add you to the system.`)
    return
  }
  if (!worker.active) {
    await reply(from, `Your account is inactive. Contact your boss.`)
    return
  }

  // Taps on buttons and lists
  if (input.kind === 'action') {
    if (input.id === 'signin') return sendJobList(supabase, from, worker)
    if (input.id === 'signout') return signOut(supabase, from, worker)
    if (input.id.startsWith('job:')) return signIn(supabase, from, worker, { id: input.id.slice(4) })
    return sendMenu(supabase, from, worker)
  }

  // Typed commands still work as a backup
  const lower = input.value.toLowerCase()
  if (['off', 'clock off', 'out', 'sign out', 'signout'].includes(lower)) return signOut(supabase, from, worker)

  const onMatch = lower.match(/^on\s+j\s*-?\s*(\d+)/)
  if (onMatch) return signIn(supabase, from, worker, { code: `J-${onMatch[1]}` })

  if (['status', 'where am i', '?'].includes(lower)) {
    const open = await getOpenEntry(supabase, worker.id)
    if (!open) await reply(from, `You're not signed in right now.`)
    else await reply(from, `You're on ${open.jobs?.code ?? 'a job'} — ${hoursSince(open.start_time)}h so far.`)
    return sendMenu(supabase, from, worker)
  }

  if (['sign in', 'signin', 'in', 'start', 'on'].includes(lower)) return sendJobList(supabase, from, worker)

  // Anything else (hi, hello…) shows the menu
  return sendMenu(supabase, from, worker)
}

async function sendMenu(supabase: Supabase, from: string, worker: Worker) {
  const open = await getOpenEntry(supabase, worker.id)
  if (!open) {
    await sendButtons(from, `Hi ${firstName(worker)}! Ready to start?`, [{ id: 'signin', title: 'Sign in' }])
  } else {
    await sendButtons(from, `Hi ${firstName(worker)}! You're on ${open.jobs?.code ?? 'a job'} (${hoursSince(open.start_time)}h so far).`, [
      { id: 'signout', title: 'Sign out' },
      { id: 'signin', title: 'Switch job' },
    ])
  }
}

async function sendJobList(supabase: Supabase, from: string, worker: Worker) {
  const { data: jobs } = await supabase
    .from('jobs')
    .select('id, code, client_name, address')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(11)

  if (!jobs?.length) {
    await reply(from, `There are no active jobs right now. Check with your boss.`)
    return
  }

  const shown = jobs.slice(0, 10)
  const more = jobs.length > 10 ? `\n(Showing the 10 newest. For another job, type "on" and its code, e.g. on J-1001.)` : ''
  await sendList(
    from,
    `Which job site are you on, ${firstName(worker)}?${more}`,
    'Choose job',
    shown.map((j) => ({
      id: `job:${j.id}`,
      title: `${j.code} ${j.client_name ?? ''}`.trim().slice(0, 24),
      description: (j.address ?? j.client_name ?? '').slice(0, 72) || undefined,
    })),
  )
}

async function signIn(supabase: Supabase, from: string, worker: Worker, which: { id: string } | { code: string }) {
  const query = supabase.from('jobs').select('id, code, client_name, status')
  const { data: job } = await ('id' in which ? query.eq('id', which.id) : query.eq('code', which.code)).maybeSingle()

  if (!job) {
    await reply(from, `I couldn't find that job. Tap "Sign in" to see the active jobs.`)
    return
  }
  if (job.status !== 'active') {
    await reply(from, `${job.code} isn't an active job any more. Tap "Sign in" to see the current jobs.`)
    return
  }

  const open = await getOpenEntry(supabase, worker.id)
  if (open && open.job_id === job.id) {
    await sendButtons(from, `You're already signed in to ${job.code}.`, [{ id: 'signout', title: 'Sign out' }])
    return
  }

  const now = new Date().toISOString()
  if (open) await supabase.from('time_entries').update({ end_time: now }).eq('id', open.id)

  const { error } = await supabase
    .from('time_entries')
    .insert({ worker_id: worker.id, job_id: job.id, start_time: now, source: 'whatsapp' })
  if (error) {
    console.error('clock-in failed', error)
    await reply(from, `Sorry, that didn't save. Please try again.`)
    return
  }

  const where = job.client_name ? ` (${job.client_name})` : ''
  const switched = open ? `Switched from ${open.jobs?.code ?? 'your last job'}. ` : ''
  await sendButtons(from, `${switched}Signed in to ${job.code}${where} ✓`, [{ id: 'signout', title: 'Sign out' }])
}

async function signOut(supabase: Supabase, from: string, worker: Worker) {
  const open = await getOpenEntry(supabase, worker.id)
  if (!open) {
    await sendButtons(from, `You're not signed in.`, [{ id: 'signin', title: 'Sign in' }])
    return
  }
  await supabase.from('time_entries').update({ end_time: new Date().toISOString() }).eq('id', open.id)
  await reply(from, `Signed out of ${open.jobs?.code ?? 'job'} — ${hoursSince(open.start_time)}h logged. Good work ${firstName(worker)}! 👍`)
}

async function send(to: string, payload: Record<string, unknown>) {
  const res = await fetch(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, ...payload }),
  })
  if (!res.ok) console.error('WhatsApp send failed', res.status, await res.text())
}

const reply = (to: string, message: string) => send(to, { type: 'text', text: { body: message } })

const sendButtons = (to: string, body: string, buttons: { id: string; title: string }[]) =>
  send(to, {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: { buttons: buttons.map((b) => ({ type: 'reply', reply: b })) },
    },
  })

const sendList = (to: string, body: string, buttonLabel: string, rows: { id: string; title: string; description?: string }[]) =>
  send(to, {
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: body },
      action: { button: buttonLabel, sections: [{ title: 'Active jobs', rows }] },
    },
  })
