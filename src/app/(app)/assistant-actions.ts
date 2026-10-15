'use server'

import { revalidatePath } from 'next/cache'
import { openPayload, requireAuth } from '@/lib/auth'
import { applyChange, askAssistant, type Change, type ChatMessage } from '@/lib/assistant'
import { isOutOfCredit } from '@/lib/ai'

export async function askAction(history: ChatMessage[]) {
  await requireAuth()
  try {
    return await askAssistant(history)
  } catch (e) {
    console.error('assistant failed', e)
    const noCredit = isOutOfCredit(e)
    return {
      text: noCredit
        ? "The AI account has run out of credit, so I can't answer right now. Top it up on the AI provider's website (Billing)."
        : "Sorry, I couldn't answer that just now. Please try again in a minute.",
      proposals: [],
    }
  }
}

export async function confirmAction(token: string) {
  await requireAuth()
  const payload = openPayload<{ change: Change; exp: number }>(token)
  if (!payload) return { ok: false, message: "That change couldn't be checked, so nothing was changed." }
  if (payload.exp < Date.now()) return { ok: false, message: 'That suggestion is too old. Ask again and confirm the new one.' }
  try {
    const message = await applyChange(payload.change)
    revalidatePath('/', 'layout')
    return { ok: true, message }
  } catch (e) {
    console.error('assistant change failed', e)
    return { ok: false, message: 'Sorry, that change failed, so nothing was changed.' }
  }
}
