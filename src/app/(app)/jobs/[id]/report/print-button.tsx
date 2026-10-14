'use client'

import { secondaryButtonClass } from '@/components/ui'

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className={`${secondaryButtonClass} print:hidden`}>
      Print / Save as PDF
    </button>
  )
}
