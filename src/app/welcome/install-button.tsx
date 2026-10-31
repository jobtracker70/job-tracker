'use client'

import { useEffect, useState } from 'react'

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
type Help = 'ios' | 'ios-other' | 'inapp' | 'android' | 'desktop' | null

// Registers the service worker that makes the app installable
export function useServiceWorker() {
  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})
  }, [])
}

// "Install the app": Android and computers get the browser's own install box; everyone else gets clear steps
export function InstallButton({ className }: { className: string }) {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null)
  const [installed, setInstalled] = useState(false)
  const [help, setHelp] = useState<Help>(null)
  useServiceWorker()

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
    const ua = navigator.userAgent
    const ios = /iphone|ipad|ipod/i.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)
    const inApp = /FBAN|FBAV|Instagram|WhatsApp|Line\/|wv\)/i.test(ua)
    if (inApp) setHelp('inapp')
    else if (ios) setHelp(/CriOS|FxiOS|EdgiOS/i.test(ua) ? 'ios-other' : 'ios')
    else if (/android/i.test(ua)) setHelp('android')
    else setHelp('desktop')
  }

  if (installed) return <a href="/login" className={className}>Open the app</a>

  const steps: Record<Exclude<Help, null>, { title: string; steps: string[] }> = {
    ios: { title: 'Add BrushBooks to your iPhone', steps: ['Tap the Share button at the bottom of Safari (the square with an arrow ↑).', 'Scroll down and tap "Add to Home Screen".', 'Tap "Add". BrushBooks is now on your home screen.'] },
    'ios-other': { title: 'Open this page in Safari first', steps: ['iPhones can only add apps from Safari.', 'Copy this page’s address, open Safari, and paste it.', 'Then tap Share ↑ → "Add to Home Screen" → "Add".'] },
    inapp: { title: 'Open this page in your phone’s browser', steps: ['You’re inside another app’s browser, which can’t install apps.', 'Tap the ⋯ menu and choose "Open in Safari" or "Open in Chrome".', 'Then tap "Install the app" again.'] },
    android: { title: 'Install on Android', steps: ['Open the Chrome menu (⋮, top right).', 'Tap "Install app" or "Add to Home screen".', 'Tap "Install". BrushBooks is now with your apps.'] },
    desktop: { title: 'Install on this computer', steps: ['In Chrome or Edge, click the install icon at the right end of the address bar (a screen with an arrow).', 'Or open the browser menu (⋮) and choose "Install BrushBooks" / "Cast, save and share → Install page as app".', 'Safari on Mac: File → "Add to Dock".'] },
  }

  return (
    <>
      <button type="button" onClick={install} className={className}>⬇ Install the app</button>
      {help && (
        <div className="fixed inset-0 z-50 bg-black/50 grid place-items-center p-4" onClick={() => setHelp(null)}>
          <div className="bg-white text-ink rounded-3xl p-6 max-w-sm w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-bold">{steps[help].title}</h3>
            <ol className="mt-4 space-y-3">
              {steps[help].steps.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-7 h-7 shrink-0 rounded-full bg-brand text-white font-bold grid place-items-center text-sm">{i + 1}</span>
                  <span className="text-[15px] leading-snug pt-0.5">{s}</span>
                </li>
              ))}
            </ol>
            <button type="button" onClick={() => setHelp(null)} className="mt-6 w-full bg-brand text-white font-semibold rounded-xl py-3">Got it</button>
          </div>
        </div>
      )}
    </>
  )
}
