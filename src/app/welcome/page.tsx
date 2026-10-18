import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { Logo, buttonClass, cardClass, secondaryButtonClass } from '@/components/ui'
import { InstallButton } from './install-button'

export const metadata: Metadata = {
  title: 'BrushBooks: know your profit on every job',
  description: 'Your crew signs in on WhatsApp, receipts get read automatically, and you see if every painting job is making money, while it is still running.',
}

const STEPS = [
  {
    n: '1',
    title: 'Your crew signs in on WhatsApp',
    text: 'They tap Sign in, pick the site, and tap Sign out at the end of the day. Nothing to install, nothing to learn.',
  },
  {
    n: '2',
    title: 'Receipts read themselves',
    text: 'Snap a receipt photo on WhatsApp or forward supplier invoices. BrushBooks reads the total, GST and every item, and puts it on the right job.',
  },
  {
    n: '3',
    title: 'See profit on every job, today',
    text: 'Hours and materials against your quote, profit so far, and a warning when a job starts slipping, before it costs you.',
  },
]

const SCREENS = [
  { src: '/screens/jobs.png', title: 'All your jobs at a glance', text: 'On track, slipping or over budget, at a glance.' },
  { src: '/screens/job.png', title: 'Every job, in plain numbers', text: 'Income, costs, profit and margin, with hours and materials against the quote.' },
  { src: '/screens/hours.png', title: 'Hours per person', text: 'Every worker, week by week, with weekend and overtime picked up for you.' },
  { src: '/screens/invoice.png', title: 'What was bought', text: 'Every receipt read line by line, so you can see exactly what went into a job.' },
]

const FEATURES = [
  ['Pay rates done properly', 'Unpaid breaks, weekend and overtime rates, and on-costs, so labour cost is real.'],
  ['Subbie checks', "Compares hours a subbie invoices with the hours they actually signed in for."],
  ['Ask AI', '"How many hours did Sam do on Harbour St?" Ask in plain words and get the answer in seconds.'],
  ['Job reports', 'Quoted vs actual for every finished job, so your next quote is sharper.'],
  ['Fair sign-out times', 'Late sign-outs are confirmed with the worker, and forgotten ones are flagged for you to check.'],
  ['Works on your phone', 'Install it like an app. No app store, always up to date.'],
]

export default function WelcomePage() {
  return (
    <div className="bg-white text-ink">
      {/* Top bar */}
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-line">
        <div className="max-w-6xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between">
          <Logo size={34} />
          <Link href="/login" className={`${buttonClass} !py-2`}>Log in</Link>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-page">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-14 md:py-20 grid md:grid-cols-2 gap-10 items-center">
          <div>
            <p className="text-brand font-semibold text-sm uppercase tracking-wide">For painting businesses</p>
            <h1 className="text-[36px] md:text-[52px] font-extrabold leading-[1.05] mt-3">Know your profit on every job.</h1>
            <p className="text-lg text-muted mt-5 max-w-xl">
              Your crew signs in on WhatsApp. Receipts get read automatically. You see if each job is making money while it&apos;s still running,
              not weeks later from your accountant.
            </p>
            <div className="flex flex-wrap items-start gap-3 mt-8">
              <InstallButton className={`${buttonClass} !px-5 !py-3 text-base`} />
              <Link href="/login" className={`${secondaryButtonClass} !px-5 !py-3 text-base`}>Log in</Link>
            </div>
            <p className="text-sm text-faint mt-4">No app for your workers to install. They already have WhatsApp.</p>
          </div>

          {/* WhatsApp chat, the way a worker sees it */}
          <div className="mx-auto w-full max-w-sm">
            <div className="rounded-[2rem] border-8 border-ink bg-[#ECE5DD] shadow-2xl overflow-hidden">
              <div className="bg-[#075E54] text-white px-4 py-3 flex items-center gap-3">
                <span className="w-9 h-9 rounded-full bg-white/20 grid place-items-center font-bold">B</span>
                <span><span className="block font-semibold leading-tight">BrushBooks</span><span className="block text-xs text-white/70">online</span></span>
              </div>
              <div className="p-3 space-y-2 text-[14px]">
                <Bubble me>hi</Bubble>
                <Bubble>Hi Sam! Ready to start?<Btn>Sign in</Btn></Bubble>
                <Bubble me>14 Oak St, Penrith</Bubble>
                <Bubble>Signed in at 14 Oak St ✓ Your hours start from 7:00am.<Btn>Sign out</Btn></Bubble>
                <Bubble me>🧾 Photo</Bubble>
                <Bubble>Receipt saved ✓ Bunnings $96.20 → 14 Oak St</Bubble>
                <Bubble me>Sign out</Bubble>
                <Bubble>Signed out ✓ 8h 30m on site. Good work Sam! 👍</Bubble>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-6xl mx-auto px-4 md:px-8 py-16">
        <h2 className="text-[28px] md:text-[36px] font-bold text-center">How it works</h2>
        <div className="grid md:grid-cols-3 gap-5 mt-10">
          {STEPS.map((s) => (
            <div key={s.n} className={`${cardClass} p-6`}>
              <span className="w-10 h-10 rounded-full bg-brand text-white font-bold grid place-items-center">{s.n}</span>
              <h3 className="text-lg font-bold mt-4">{s.title}</h3>
              <p className="text-muted mt-2">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Screenshots */}
      <section className="bg-page">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-16">
          <h2 className="text-[28px] md:text-[36px] font-bold text-center">What you see</h2>
          <p className="text-muted text-center mt-2">On your phone or computer.</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mt-10">
            {SCREENS.map((s) => (
              <figure key={s.src} className="text-center">
                <div className="rounded-[1.6rem] border-[6px] border-ink overflow-hidden shadow-xl bg-white mx-auto max-w-[260px]">
                  <Image src={s.src} alt={s.title} width={390} height={844} className="w-full h-auto" />
                </div>
                <figcaption className="mt-4">
                  <span className="block font-bold">{s.title}</span>
                  <span className="block text-sm text-muted mt-1">{s.text}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-4 md:px-8 py-16">
        <h2 className="text-[28px] md:text-[36px] font-bold text-center">Built for how painters actually work</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-10">
          {FEATURES.map(([t, d]) => (
            <div key={t} className="flex gap-3">
              <span className="text-brand text-xl leading-none mt-0.5">✓</span>
              <span><span className="block font-bold">{t}</span><span className="block text-muted text-sm mt-1">{d}</span></span>
            </div>
          ))}
        </div>
      </section>

      {/* Install */}
      <section className="bg-brand text-white">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-14 text-center">
          <h2 className="text-[28px] md:text-[36px] font-bold">Put BrushBooks on your phone</h2>
          <p className="text-white/80 mt-2 max-w-xl mx-auto">Install it from this page in a couple of taps. No app store needed. Then log in with the details we sent you.</p>
          <div className="flex flex-wrap justify-center gap-3 mt-7">
            <InstallButton className="inline-flex items-center justify-center gap-2 bg-white text-brand hover:bg-brand-tint px-5 py-3 rounded-xl font-semibold" />
            <Link href="/login" className="inline-flex items-center justify-center bg-transparent border border-white/60 hover:bg-white/10 px-5 py-3 rounded-xl font-semibold">Log in</Link>
          </div>
        </div>
      </section>

      <footer className="max-w-6xl mx-auto px-4 md:px-8 py-8 flex flex-wrap items-center justify-between gap-3 text-sm text-faint">
        <Logo size={26} />
        <span className="flex gap-5">
          <Link href="/privacy" className="hover:text-ink">Privacy</Link>
          <Link href="/login" className="hover:text-ink">Log in</Link>
        </span>
      </footer>
    </div>
  )
}

function Bubble({ me, children }: { me?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex ${me ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] rounded-lg px-3 py-2 shadow-sm ${me ? 'bg-[#DCF8C6]' : 'bg-white'}`}>{children}</div>
    </div>
  )
}

function Btn({ children }: { children: React.ReactNode }) {
  return <span className="block mt-2 -mx-3 -mb-2 border-t border-black/10 py-2 text-center text-[#027EB5] font-medium">{children}</span>
}
