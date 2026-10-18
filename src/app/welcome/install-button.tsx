'use client'

import { useEffect, useState } from 'react'

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

// "Install the app": Android and computers get the browser's install prompt; iPhones get the Share → Add to Home Screen steps
export function InstallButton({ className }: { className: string }) {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null)
  const [installed, setInstalled] = useState(false)
  const [help, setHelp] = useState<'ios' | 'other' | null>(null)

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setPrompt(e as InstallPrompt)
    }
    const onInstalled = () => setInstalled(true)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    // Already opened as the installed app
    if (window.matchMedia('(display-mode: standalone)').matches) queueMicrotask(onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  async function install() {
    if (prompt) {
      await prompt.prompt()
      setPrompt(null)
      return
    }
    setHelp(/iphone|ipad|ipod/i.test(navigator.userAgent) ? 'ios' : 'other')
  }

  if (installed) return <a href="/login" className={className}>Open the app</a>

  return (
    <div className="inline-flex flex-col items-start gap-2">
      <button type="button" onClick={install} className={className}>⬇ Install the app</button>
      {help === 'ios' && (
        <p className="text-sm text-muted max-w-xs">
          On iPhone: open this page in <strong>Safari</strong>, tap the <strong>Share</strong> button (square with an arrow), then <strong>Add to Home Screen</strong>.
        </p>
      )}
      {help === 'other' && (
        <p className="text-sm text-muted max-w-xs">
          Open your browser menu (⋮) and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.
        </p>
      )}
    </div>
  )
}
