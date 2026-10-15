'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { confirmAction } from '@/app/(app)/assistant-actions'
import { buttonClass, secondaryButtonClass } from './ui'

type Proposal = { summary: string; token: string; state?: 'done' | 'cancelled' | 'failed'; result?: string }
type Msg = { role: 'user' | 'assistant'; text: string; proposals?: Proposal[]; status?: string; streaming?: boolean }

const EXAMPLES = [
  'How many hours did each person work this week?',
  'Which jobs are over budget?',
  'What did we spend at Bunnings this month?',
  "Who's on site right now?",
]

const sparkle = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 2l1.8 5.6L19.5 9.5l-5.7 1.9L12 17l-1.8-5.6L4.5 9.5l5.7-1.9L12 2zm7 11l.9 2.6 2.6.9-2.6.9L19 20l-.9-2.6-2.6-.9 2.6-.9L19 13z" />
  </svg>
)

// "Ask AI" button + chat panel, on every page of the owner's app
export function AskAI() {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [busyToken, setBusyToken] = useState<string | null>(null)
  const router = useRouter()
  const endRef = useRef<HTMLDivElement>(null)

  // Braces matter: newer browsers return a promise from scrollIntoView, which React must not get back
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, thinking, open])

  async function send(text: string) {
    const q = text.trim()
    if (!q || thinking) return
    const history = [...msgs, { role: 'user' as const, text: q }]
    setMsgs([...history, { role: 'assistant', text: '', proposals: [], streaming: true }])
    setInput('')
    setThinking(true)

    // Update the answer being written (always the last message)
    const patch = (fn: (m: Msg) => Msg) => setMsgs((cur) => cur.map((m, i) => (i === cur.length - 1 ? fn(m) : m)))
    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history: history.map((m) => ({ role: m.role, text: m.text })) }),
      })
      if (!res.ok || !res.body) throw new Error(String(res.status))
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          const e = JSON.parse(line)
          if (e.type === 'text') patch((m) => ({ ...m, text: m.text + e.text, status: undefined }))
          else if (e.type === 'status') patch((m) => ({ ...m, status: e.text }))
          else if (e.type === 'proposal') patch((m) => ({ ...m, proposals: [...(m.proposals ?? []), e.proposal] }))
        }
      }
    } catch {
      patch((m) => ({ ...m, text: m.text || "Sorry, I couldn't reach the AI just now. Check your internet and try again." }))
    } finally {
      patch((m) => ({ ...m, streaming: false, status: undefined, text: m.text.trim() || (m.proposals?.length ? '' : 'Sorry, no answer came back. Try again.') }))
      setThinking(false)
    }
  }

  async function decide(msgIndex: number, token: string, confirm: boolean) {
    const update = (patch: Partial<Proposal>) =>
      setMsgs((cur) => cur.map((m, i) => (i !== msgIndex ? m : { ...m, proposals: m.proposals?.map((p) => (p.token === token ? { ...p, ...patch } : p)) })))
    if (!confirm) return update({ state: 'cancelled', result: 'Cancelled. Nothing was changed.' })
    setBusyToken(token)
    const res = await confirmAction(token).catch(() => ({ ok: false, message: "Couldn't save just now, so nothing was changed. Try again." }))
    setBusyToken(null)
    update({ state: res.ok ? 'done' : 'failed', result: res.message })
    if (res.ok) router.refresh()
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`${open ? 'hidden' : 'flex'} print:hidden fixed z-30 right-4 bottom-20 md:bottom-6 md:right-6 items-center gap-2 bg-brand text-white font-semibold rounded-full pl-3.5 pr-4 py-3 shadow-lg hover:bg-brand-dark`}
      >
        {sparkle} Ask AI
      </button>

      {open && (
        <div className="print:hidden fixed z-40 inset-0 md:inset-auto md:right-6 md:bottom-6 md:w-[420px] md:h-[600px] md:max-h-[calc(100vh-48px)] bg-white md:rounded-2xl md:border md:border-line shadow-2xl flex flex-col">
          <div className="flex items-center justify-between px-4 h-14 border-b border-line shrink-0 pt-[env(safe-area-inset-top)]">
            <span className="flex items-center gap-2 font-bold text-brand">{sparkle} <span className="text-ink">Ask AI</span></span>
            <span className="flex items-center gap-1">
              {msgs.length > 0 && <button onClick={() => setMsgs([])} className="text-sm text-faint hover:text-ink px-2 py-1">New chat</button>}
              <button onClick={() => setOpen(false)} aria-label="Close" className="text-2xl leading-none text-faint hover:text-ink px-2">×</button>
            </span>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-page/50">
            {!msgs.length && (
              <div className="space-y-3">
                <p className="text-sm text-muted">
                  Ask about your jobs, hours and invoices, or ask me to fix something, like &ldquo;change Sam&apos;s hours on Tuesday to 7am–2pm&rdquo;.
                  I&apos;ll always ask you to confirm before changing anything.
                </p>
                <div className="flex flex-col gap-2">
                  {EXAMPLES.map((e) => (
                    <button key={e} onClick={() => send(e)} className="text-left text-sm bg-white border border-line rounded-xl px-3 py-2.5 hover:bg-brand-tint">
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {msgs.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'space-y-2'}>
                {m.role === 'assistant' && !m.text && m.streaming && <Thinking status={m.status} />}
                {(m.role === 'user' || m.text) && <div className={`max-w-[88%] whitespace-pre-wrap text-[15px] rounded-2xl px-3.5 py-2.5 ${m.role === 'user' ? 'bg-brand text-white rounded-br-md' : 'bg-white border border-line text-ink rounded-bl-md'}`}>
                  {m.role === 'assistant' ? <Formatted text={m.text} /> : m.text}
                  {m.streaming && m.text && <span className="inline-block w-1.5 h-4 ml-0.5 align-text-bottom bg-brand/60 animate-pulse" />}
                </div>}
                {m.proposals?.map((p) => (
                  <div key={p.token} className="max-w-[92%] bg-white border-2 border-brand/30 rounded-2xl p-3.5 space-y-3">
                    <p className="text-xs font-semibold text-brand uppercase tracking-wide">Change to confirm</p>
                    <p className="text-sm whitespace-pre-wrap font-medium">{p.summary}</p>
                    {p.state ? (
                      <p className={`text-sm font-semibold ${p.state === 'done' ? 'text-good' : p.state === 'failed' ? 'text-bad' : 'text-muted'}`}>{p.result}</p>
                    ) : (
                      <div className="flex gap-2">
                        <button disabled={busyToken === p.token} onClick={() => decide(i, p.token, true)} className={`${buttonClass} flex-1`}>
                          {busyToken === p.token ? 'Saving…' : 'Confirm'}
                        </button>
                        <button disabled={busyToken === p.token} onClick={() => decide(i, p.token, false)} className={`${secondaryButtonClass} flex-1`}>Cancel</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}

            <div ref={endRef} />
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); send(input) }}
            className="shrink-0 border-t border-line p-3 flex gap-2 bg-white pb-[max(0.75rem,env(safe-area-inset-bottom))] md:rounded-b-2xl"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything…"
              autoFocus
              className="flex-1 min-w-0 bg-page border border-line rounded-xl px-3.5 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
            <button disabled={thinking || !input.trim()} className={`${buttonClass} !px-4`}>Send</button>
          </form>
        </div>
      )}
    </>
  )
}

// The AI sometimes uses **bold**: show it as bold instead of asterisks
function Formatted({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part.replace(/^#+\s*/gm, ''),
      )}
    </>
  )
}

// Shows what's happening while the AI works, until the first words arrive
const STEPS = ['Looking that up…', 'Checking your jobs and hours…', 'Nearly there…']

function Thinking({ status }: { status?: string }) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 2500)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="inline-flex items-center gap-2 bg-white border border-line rounded-2xl rounded-bl-md px-3.5 py-2.5 text-muted text-sm">
      <span className="w-2 h-2 rounded-full bg-brand animate-pulse" />
      {status ?? STEPS[step]}
    </div>
  )
}
