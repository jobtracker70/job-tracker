import { createServiceClient } from '@/lib/supabase'
import { NextRequest, after } from 'next/server'

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN!
const WA_TOKEN = process.env.WHATSAPP_TOKEN!
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID!

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

// Incoming WhatsApp messages
export async function POST(req: NextRequest) {
  const body = await req.json()

  // Always return 200 quickly so Meta doesn't retry
  const entry = body?.entry?.[0]
  const change = entry?.changes?.[0]
  const value = change?.value
  const messages = value?.messages

  if (!messages?.length) return new Response('ok', { status: 200 })

  const msg = messages[0]
  if (msg.type !== 'text') return new Response('ok', { status: 200 })

  const from: string = msg.from // e.g. "61412345678" (no +)
  const text: string = msg.text?.body?.trim() ?? ''

  // Meta can deliver the same message more than once; only handle each message id once.
  const { error: dupe } = await createServiceClient()
    .from('message_log')
    .insert({ wamid: msg.id, from_number: from, body: text })
  if (dupe) return new Response('ok', { status: 200 })

  // Reply after responding so Meta gets its 200 quickly, without the server stopping mid-reply.
  after(() => processMessage(from, text).catch(console.error))

  return new Response('ok', { status: 200 })
}

async function processMessage(from: string, text: string) {
  const phone = from.startsWith('+') ? from : `+${from}`
  const lower = text.toLowerCase()
  const supabase = createServiceClient()

  // Look up worker by phone
  const { data: worker } = await supabase
    .from('workers')
    .select('id, name, active')
    .eq('phone', phone)
    .single()

  if (!worker) {
    await reply(from, `Hi! Your number isn't registered yet. Ask your boss to add you to the system.`)
    return
  }

  if (!worker.active) {
    await reply(from, `Your account is inactive. Contact your boss.`)
    return
  }

  // "off" — clock out of current job
  if (lower === 'off' || lower === 'clock off' || lower === 'out') {
    const { data: open } = await supabase
      .from('time_entries')
      .select('id, job_id, start_time, jobs(code)')
      .eq('worker_id', worker.id)
      .is('end_time', null)
      .order('start_time', { ascending: false })
      .limit(1)
      .single()

    if (!open) {
      await reply(from, `You're not clocked in. Text "on J-1001" (your job code) to clock in.`)
      return
    }

    const now = new Date().toISOString()
    await supabase.from('time_entries').update({ end_time: now }).eq('id', open.id)

    const hours = ((Date.now() - new Date(open.start_time).getTime()) / 3600000).toFixed(1)
    const code = (open.jobs as unknown as { code: string } | null)?.code ?? 'job'
    await reply(from, `Clocked off ${code} — ${hours}h logged. Good work ${worker.name.split(' ')[0]}! 👍`)
    return
  }

  // "on J-XXXX" — clock in
  const onMatch = lower.match(/^on\s+j\s*-?\s*(\d+)/i)
  if (onMatch) {
    const jobCode = `J-${onMatch[1]}`

    const { data: job } = await supabase
      .from('jobs')
      .select('id, code, client_name')
      .eq('code', jobCode)
      .single()

    if (!job) {
      await reply(from, `Job ${jobCode} not found. Check the code with your boss.`)
      return
    }

    // Close any open entry first
    const { data: open } = await supabase
      .from('time_entries')
      .select('id, job_id, jobs(code)')
      .eq('worker_id', worker.id)
      .is('end_time', null)
      .limit(1)
      .single()

    if (open && open.job_id === job.id) {
      await reply(from, `You're already clocked in to ${jobCode}. Text "off" when you're done.`)
      return
    }
    if (open) {
      const prevCode = (open.jobs as unknown as { code: string } | null)?.code ?? 'previous job'
      await supabase.from('time_entries').update({ end_time: new Date().toISOString() }).eq('id', open.id)
      await reply(from, `Switched from ${prevCode} to ${jobCode} — clocked in ✓`)
    } else {
      const clientHint = job.client_name ? ` (${job.client_name})` : ''
      await reply(from, `Clocked in to ${jobCode}${clientHint} ✓\nText "off" when you finish.`)
    }

    await supabase.from('time_entries').insert({
      worker_id: worker.id,
      job_id: job.id,
      start_time: new Date().toISOString(),
      source: 'whatsapp',
    })
    return
  }

  // "status" — show current status
  if (lower === 'status' || lower === 'where am i' || lower === '?') {
    const { data: open } = await supabase
      .from('time_entries')
      .select('start_time, jobs(code, client_name)')
      .eq('worker_id', worker.id)
      .is('end_time', null)
      .limit(1)
      .single()

    if (!open) {
      await reply(from, `You're not clocked in. Text "on J-1001" to start.`)
    } else {
      const code = (open.jobs as unknown as { code: string; client_name: string | null } | null)?.code ?? '?'
      const hours = ((Date.now() - new Date(open.start_time).getTime()) / 3600000).toFixed(1)
      await reply(from, `You're on ${code} — ${hours}h so far. Text "off" to clock out.`)
    }
    return
  }

  // Unknown message
  await reply(from,
    `Hi ${worker.name.split(' ')[0]}! Commands:\n` +
    `• "on J-1001" — clock in\n` +
    `• "off" — clock out\n` +
    `• "status" — see current job`
  )
}

async function reply(to: string, message: string) {
  await fetch(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WA_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: message },
    }),
  })
}
