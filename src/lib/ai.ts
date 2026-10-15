// Which Claude model does each AI job. Haiku is the cheapest; Sonnet is used where a mistake would cost more.
export const AI_MODELS = {
  // Reading supplier invoices and receipt photos (many per week)
  receipts: 'claude-haiku-5-5',
  // The "Ask AI" assistant
  assistant: 'claude-haiku-5-5',
  // Reading a quote PDF once per job (the quote total, hours and materials budget everything else)
  quotes: 'claude-sonnet-5-5',
} as const
