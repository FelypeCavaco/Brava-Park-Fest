// Formatação em pt-BR usada nas telas de estoque, acertos e custos.

export function brl(value: number | null | undefined) {
  return (value ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function qtd(value: number | null | undefined, maxDecimals = 3) {
  return (value ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: maxDecimals })
}

// Aceita "6,5", "6.5" ou "1.234,56".
export function parseDecimal(raw: string): number | null {
  const t = raw.trim()
  if (!t) return null
  const normalized = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

export function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Mensagem de erro do banco sem o prefixo técnico (ex: "ESTOQUE_NEGATIVO: ").
export function friendlyDbError(message: string | undefined | null) {
  if (!message) return 'Não foi possível concluir.'
  return message.replace(/^[A-Z_]+: /, '')
}
