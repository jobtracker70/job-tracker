import { getSession } from '@/lib/auth'
import { businessDb } from '@/lib/db'
import { isOutOfCredit } from '@/lib/ai'
import { streamAssistant, type AssistantEvent, type ChatMessage } from '@/lib/assistant'

// The AI can take a few seconds per step
export const maxDuration = 60

// Ask AI: streams the answer back as it's written, one JSON event per line
export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return new Response('Unauthorized', { status: 401 })
  const db = businessDb(session.businessId)
  let history: ChatMessage[]
  try {
    const body = await req.json()
    history = (Array.isArray(body?.history) ? body.history : [])
      .filter((m: ChatMessage) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.text === 'string')
  } catch {
    return new Response('Bad request', { status: 400 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: AssistantEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + '\n'))
      try {
        await streamAssistant(db, history, emit)
      } catch (e) {
        console.error('assistant failed', e)
        emit({
          type: 'text',
          text: isOutOfCredit(e)
            ? "The AI account has run out of credit, so I can't answer right now. Top it up on the AI provider's website (Billing)."
            : "Sorry, I couldn't answer that just now. Please try again in a minute.",
        })
      }
      emit({ type: 'done' })
      controller.close()
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } })
}
