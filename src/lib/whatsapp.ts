const API = 'https://graph.facebook.com/v19.0'

async function send(to: string, payload: Record<string, unknown>) {
  const res = await fetch(`${API}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, ...payload }),
  })
  if (!res.ok) console.error('WhatsApp send failed', res.status, await res.text())
  return res.ok
}

// WhatsApp wants numbers without the "+"
export const waNumber = (phone: string) => phone.replace(/^\+/, '')

export const sendText = (to: string, message: string) => send(to, { type: 'text', text: { body: message } })

export const sendButtons = (to: string, body: string, buttons: { id: string; title: string }[]) =>
  send(to, {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: { buttons: buttons.map((b) => ({ type: 'reply', reply: b })) },
    },
  })

export const sendList = (
  to: string,
  body: string,
  buttonLabel: string,
  rows: { id: string; title: string; description?: string }[],
  sectionTitle = 'Active jobs',
) =>
  send(to, {
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: body },
      action: { button: buttonLabel, sections: [{ title: sectionTitle, rows }] },
    },
  })

// Downloads a photo or document a worker sent to the bot.
export async function downloadMedia(mediaId: string) {
  const auth = { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
  const metaRes = await fetch(`${API}/${mediaId}`, { headers: auth })
  if (!metaRes.ok) {
    console.error('WhatsApp media lookup failed', metaRes.status, await metaRes.text())
    return null
  }
  const meta = (await metaRes.json()) as { url?: string; mime_type?: string }
  if (!meta.url) return null
  const fileRes = await fetch(meta.url, { headers: auth })
  if (!fileRes.ok) {
    console.error('WhatsApp media download failed', fileRes.status)
    return null
  }
  return {
    data: Buffer.from(await fileRes.arrayBuffer()),
    contentType: (meta.mime_type ?? fileRes.headers.get('content-type') ?? 'application/octet-stream').split(';')[0],
  }
}
