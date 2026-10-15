import Anthropic from '@anthropic-ai/sdk'

// BrushBooks can use Claude (Anthropic) or Kimi (Moonshot AI). Set AI_PROVIDER to choose;
// if it isn't set, Kimi is used when MOONSHOT_API_KEY is present, otherwise Claude.
export type Provider = 'anthropic' | 'kimi'
export const aiProvider = (): Provider =>
  process.env.AI_PROVIDER === 'anthropic' || process.env.AI_PROVIDER === 'kimi'
    ? process.env.AI_PROVIDER
    : process.env.MOONSHOT_API_KEY ? 'kimi' : 'anthropic'

// Which Claude model does each job. Haiku is the cheapest; Sonnet is used where a mistake would cost more.
export const AI_MODELS = {
  // Reading supplier invoices and receipt photos (many per week)
  receipts: 'claude-haiku-5-5',
  // The "Ask AI" assistant
  assistant: 'claude-haiku-5-5',
  // Reading a quote PDF once per job (the quote total, hours and materials budget everything else)
  quotes: 'claude-sonnet-5-5',
} as const
export type AiTask = keyof typeof AI_MODELS

// Kimi models: one for text and tools, one that can see photos. Override with KIMI_MODEL / KIMI_VISION_MODEL.
const KIMI_URL = process.env.KIMI_BASE_URL ?? 'https://api.moonshot.ai/v1'
// kimi-k2.6 reads photos too; with "thinking" off it answers in a second or two and uses far fewer tokens
const kimiModel = () => process.env.KIMI_MODEL ?? 'kimi-k2.6'
const kimiVisionModel = () => process.env.KIMI_VISION_MODEL ?? kimiModel()

let anthropicClient: Anthropic | null = null
export const anthropic = () => (anthropicClient ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }))

// True when the AI account has run out of money, so the app can say so plainly
export const isOutOfCredit = (e: unknown) =>
  e instanceof Error && /credit balance|insufficient|exceeded_current_quota|suspended|balance/i.test(e.message)

export type AiFile = { name: string; contentType: string; data: Buffer }

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
const isPdf = (f: AiFile) => f.contentType.toLowerCase() === 'application/pdf' || /\.pdf$/i.test(f.name)
const isImage = (f: AiFile) => (IMAGE_TYPES as readonly string[]).includes(f.contentType.toLowerCase())

// ---------- Kimi (OpenAI-style API) ----------

export async function kimi(path: string, init: RequestInit) {
  const res = await fetch(`${KIMI_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.MOONSHOT_API_KEY}`, ...(init.headers ?? {}) },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Kimi ${res.status}: ${text.slice(0, 500)}`)
  return text ? JSON.parse(text) : null
}

export type KimiMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null | { type: string; text?: string; image_url?: { url: string } }[]
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
  name?: string
}

export async function kimiChat(body: { messages: KimiMessage[]; tools?: unknown[]; vision?: boolean; maxTokens?: number }) {
  const res = await kimi('/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: body.vision ? kimiVisionModel() : kimiModel(),
      messages: body.messages,
      ...(body.tools ? { tools: body.tools } : {}),
      max_tokens: body.maxTokens ?? 4096,
      thinking: { type: 'disabled' },
    }),
  })
  return res.choices?.[0]?.message as KimiMessage | undefined
}

// Same as kimiChat, but hands over the reply's words as they arrive (onText), so the owner sees the answer being written.
// Returns the whole message at the end, including any tool calls.
export async function kimiChatStream(
  body: { messages: KimiMessage[]; tools?: unknown[]; maxTokens?: number },
  onText: (text: string) => void,
): Promise<KimiMessage> {
  const res = await fetch(`${KIMI_URL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.MOONSHOT_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: kimiModel(),
      messages: body.messages,
      ...(body.tools ? { tools: body.tools } : {}),
      max_tokens: body.maxTokens ?? 4096,
      thinking: { type: 'disabled' },
      stream: true,
    }),
  })
  if (!res.ok || !res.body) throw new Error(`Kimi ${res.status}: ${(await res.text()).slice(0, 500)}`)

  let content = ''
  const calls: { id: string; type: 'function'; function: { name: string; arguments: string } }[] = []
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
      const data = line.startsWith('data:') ? line.slice(5).trim() : ''
      if (!data || data === '[DONE]') continue
      let chunk
      try {
        chunk = JSON.parse(data)
      } catch {
        continue
      }
      const delta = chunk.choices?.[0]?.delta ?? {}
      if (typeof delta.content === 'string' && delta.content) {
        content += delta.content
        onText(delta.content)
      }
      for (const tc of delta.tool_calls ?? []) {
        const i = tc.index ?? calls.length
        calls[i] ??= { id: '', type: 'function', function: { name: '', arguments: '' } }
        if (tc.id) calls[i].id = tc.id
        if (tc.function?.name) calls[i].function.name += tc.function.name
        if (tc.function?.arguments) calls[i].function.arguments += tc.function.arguments
      }
    }
  }
  const toolCalls = calls.filter(Boolean)
  return { role: 'assistant', content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }
}

// Kimi reads PDFs by uploading them and getting the text back
async function kimiPdfText(file: AiFile) {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(file.data)], { type: 'application/pdf' }), file.name)
  form.append('purpose', 'file-extract')
  const uploaded = await kimi('/files', { method: 'POST', body: form })
  try {
    const res = await fetch(`${KIMI_URL}/files/${uploaded.id}/content`, { headers: { Authorization: `Bearer ${process.env.MOONSHOT_API_KEY}` } })
    if (!res.ok) throw new Error(`Kimi ${res.status}: ${(await res.text()).slice(0, 300)}`)
    return await res.text()
  } finally {
    await kimi(`/files/${uploaded.id}`, { method: 'DELETE' }).catch(() => null)
  }
}

// ---------- Reading a document (invoice, receipt photo, quote) ----------

// Sends a file plus instructions to the AI and returns its text reply
export async function readDocument(task: AiTask, file: AiFile, prompt: string, maxTokens = 4096): Promise<string> {
  if (aiProvider() === 'kimi') {
    if (isImage(file)) {
      const url = `data:${file.contentType.toLowerCase()};base64,${file.data.toString('base64')}`
      const msg = await kimiChat({
        vision: true,
        maxTokens,
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url } }, { type: 'text', text: prompt }] }],
      })
      return typeof msg?.content === 'string' ? msg.content : ''
    }
    const text = isPdf(file) ? await kimiPdfText(file) : file.data.toString('utf8')
    const msg = await kimiChat({
      maxTokens,
      messages: [{ role: 'user', content: `Document "${file.name}":\n${text.slice(0, 60000)}\n\n${prompt}` }],
    })
    return typeof msg?.content === 'string' ? msg.content : ''
  }

  const blocks: Anthropic.Messages.ContentBlockParam[] = []
  if (isPdf(file)) {
    blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.data.toString('base64') } })
  } else if (isImage(file)) {
    blocks.push({ type: 'image', source: { type: 'base64', media_type: file.contentType.toLowerCase() as (typeof IMAGE_TYPES)[number], data: file.data.toString('base64') } })
  } else {
    blocks.push({ type: 'text', text: `File "${file.name}":\n${file.data.toString('utf8').slice(0, 60000)}` })
  }
  blocks.push({ type: 'text', text: prompt })
  const msg = await anthropic().messages.create({ model: AI_MODELS[task], max_tokens: maxTokens, messages: [{ role: 'user', content: blocks }] })
  return msg.content.filter((c) => c.type === 'text').map((c) => (c as Anthropic.Messages.TextBlock).text).join('\n')
}

// Pulls the JSON object out of an AI reply (they sometimes wrap it in words or ```json fences)
export function parseJsonReply<T>(text: string): T | null {
  try {
    return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as T
  } catch {
    return null
  }
}
