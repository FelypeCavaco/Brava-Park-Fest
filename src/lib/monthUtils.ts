// Utilitários de mês usados nas telas financeiras (Financeiro, Marketing,
// Resultado do mês, Relatórios, Painel) para não repetir a mesma conta de
// "primeiro dia do mês" / "mês seguinte" em cada uma.

export function currentMonthValue() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function monthBounds(monthValue: string) {
  const [y, m] = monthValue.split('-').map(Number)
  const start = new Date(y, m - 1, 1)
  const end = new Date(y, m, 1)
  return { startIso: start.toISOString().slice(0, 10), endIso: end.toISOString().slice(0, 10) }
}

export function addMonthsToValue(monthValue: string, delta: number) {
  const [y, m] = monthValue.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function lastNMonths(n: number) {
  const months: { value: string; label: string }[] = []
  const now = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
    months.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) })
  }
  return months
}

export function daysInMonth(monthValue: string) {
  const [y, m] = monthValue.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}
