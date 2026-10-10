'use client'

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg font-medium text-sm print:hidden">
      Print / save as PDF
    </button>
  )
}
