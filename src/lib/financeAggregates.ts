import { supabase } from './supabaseClient'
import { monthBounds } from './monthUtils'

export interface MonthResult {
  receita: number // pagamentos recebidos no mês (bruto)
  taxasCartao: number // taxa de maquininha estimada sobre os pagamentos do mês
  despesas: number // despesas (avulsas e as geradas por despesa fixa) já pagas, pelo paid_date
  custos: number // custos de festas com evento no mês
  festas: number // festas (não canceladas) com evento no mês
  ticketMedio: number // média de final_value dessas festas
}

// Taxa por forma de pagamento — busca da tabela editável, com o padrão
// hardcoded como fallback pra quem ainda não rodou a migration 040.
async function loadFeePercentByMethod(): Promise<Record<string, number>> {
  const { data } = await supabase.from('payment_method_fees').select('payment_method, fee_percent')
  const fees: Record<string, number> = {}
  for (const row of data ?? []) fees[row.payment_method] = Number(row.fee_percent)
  return fees
}

// Calcula receita/despesas/custos/festas/ticket médio de um mês, agrupado por
// unidade (indexado pelo "slug" estável usado no front, ex: 'vila-operaria').
export async function loadMonthByUnit(monthValue: string, unitIdBySlug: Record<string, string>): Promise<Record<string, MonthResult>> {
  const { startIso, endIso } = monthBounds(monthValue)
  const result: Record<string, MonthResult> = {}
  for (const slug of Object.keys(unitIdBySlug)) result[slug] = { receita: 0, taxasCartao: 0, despesas: 0, custos: 0, festas: 0, ticketMedio: 0 }

  const slugByUnitId: Record<string, string> = {}
  for (const slug of Object.keys(unitIdBySlug)) slugByUnitId[unitIdBySlug[slug]] = slug

  const [{ data: paymentsData }, { data: reservationsData }, { data: expensesData }, feePercentByMethod] = await Promise.all([
    supabase.from('payments').select('amount, payment_date, payment_method, reservation:reservations(unit_id)').gte('payment_date', startIso).lt('payment_date', endIso),
    supabase.from('reservations').select('id, unit_id, final_value').neq('status', 'cancelada').gte('event_date', startIso).lt('event_date', endIso),
    // Só conta despesa que já foi paga de verdade este mês (pelo paid_date,
    // que é quando o dinheiro realmente saiu) — "a vencer" e "atrasado" ainda
    // não tiraram nada do caixa. Despesa fixa entra aqui também, porque ela
    // já vira um lançamento de verdade em `expenses` todo mês (ver
    // ensure_recurring_expenses_current_month) — não soma separado, senão
    // conta em dobro.
    supabase.from('expenses').select('amount, unit_id').eq('status', 'pago').gte('paid_date', startIso).lt('paid_date', endIso),
    loadFeePercentByMethod(),
  ])

  for (const p of paymentsData ?? []) {
    const slug = slugByUnitId[(p as any).reservation?.unit_id]
    if (!slug) continue
    result[slug].receita += Number(p.amount)
    if (p.payment_method) result[slug].taxasCartao += (Number(p.amount) * (feePercentByMethod[p.payment_method] ?? 0)) / 100
  }
  for (const e of expensesData ?? []) {
    const slug = slugByUnitId[e.unit_id]
    if (slug) result[slug].despesas += Number(e.amount)
  }

  const reservationIds = (reservationsData ?? []).map((r) => r.id)
  const unitByReservation: Record<string, string> = {}
  const ticketSumBySlug: Record<string, number> = {}
  for (const r of reservationsData ?? []) {
    unitByReservation[r.id] = r.unit_id
    const slug = slugByUnitId[r.unit_id]
    if (slug) {
      result[slug].festas += 1
      ticketSumBySlug[slug] = (ticketSumBySlug[slug] ?? 0) + Number(r.final_value)
    }
  }
  for (const slug of Object.keys(result)) {
    result[slug].ticketMedio = result[slug].festas > 0 ? (ticketSumBySlug[slug] ?? 0) / result[slug].festas : 0
  }

  if (reservationIds.length > 0) {
    const { data: costsData } = await supabase.from('reservation_costs').select('amount, reservation_id').in('reservation_id', reservationIds)
    for (const c of costsData ?? []) {
      const slug = slugByUnitId[unitByReservation[c.reservation_id]]
      if (slug) result[slug].custos += Number(c.amount)
    }
  }

  return result
}

// Saldo ainda esperado (final_value - pago) das festas não canceladas com
// evento dentro do mês informado, somado por unidade.
export async function loadExpectedRemainingByUnit(monthValue: string, unitIdBySlug: Record<string, string>): Promise<number> {
  const { startIso, endIso } = monthBounds(monthValue)
  const unitIds = Object.values(unitIdBySlug)
  if (unitIds.length === 0) return 0

  const { data } = await supabase
    .from('reservations')
    .select('final_value, payments(amount)')
    .in('unit_id', unitIds)
    .neq('status', 'cancelada')
    .gte('event_date', startIso)
    .lt('event_date', endIso)

  return (data ?? []).reduce((sum, r: any) => {
    const pago = (r.payments ?? []).reduce((s: number, p: any) => s + Number(p.amount), 0)
    const saldo = Number(r.final_value) - pago
    return sum + Math.max(0, saldo)
  }, 0)
}
