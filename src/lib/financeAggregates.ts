import { supabase } from './supabaseClient'
import { monthBounds } from './monthUtils'
import { indiceDaFaixa, limitesDasFaixas, type Faixa } from './periodo'

export interface MonthResult {
  receita: number // pagamentos recebidos no mês (bruto)
  taxasCartao: number // taxa de maquininha estimada sobre os pagamentos do mês
  despesas: number // despesas (avulsas e as geradas por despesa fixa) já pagas, pelo paid_date — sem estornos
  estornos: number // devoluções de festas canceladas pagas no mês (reduzem a receita líquida)
  recuperacao: number // recebido de outra unidade por estoque transferido (reduz despesas; não é faturamento)
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
  for (const slug of Object.keys(unitIdBySlug)) result[slug] = { receita: 0, taxasCartao: 0, despesas: 0, estornos: 0, recuperacao: 0, custos: 0, festas: 0, ticketMedio: 0 }

  const slugByUnitId: Record<string, string> = {}
  for (const slug of Object.keys(unitIdBySlug)) slugByUnitId[unitIdBySlug[slug]] = slug

  const [{ data: paymentsData }, { data: reservationsData }, { data: expensesData }, feePercentByMethod, { data: incomesData }] = await Promise.all([
    supabase.from('payments').select('amount, payment_date, payment_method, reservation:reservations(unit_id)').gte('payment_date', startIso).lt('payment_date', endIso),
    supabase.from('reservations').select('id, unit_id, final_value').neq('status', 'cancelada').gte('event_date', startIso).lt('event_date', endIso),
    // Só conta despesa que já foi paga de verdade este mês (pelo paid_date,
    // que é quando o dinheiro realmente saiu) — "a vencer" e "atrasado" ainda
    // não tiraram nada do caixa. Despesa fixa entra aqui também, porque ela
    // já vira um lançamento de verdade em `expenses` todo mês (ver
    // ensure_recurring_expenses_current_month) — não soma separado, senão
    // conta em dobro.
    // Conta marcada como "paga custos já lançados nas festas" fica de fora:
    // o valor dela já está nos custos das festas (senão conta em dobro).
    supabase.from('expenses').select('amount, unit_id, category').eq('status', 'pago').eq('covers_festa_costs', false).gte('paid_date', startIso).lt('paid_date', endIso),
    loadFeePercentByMethod(),
    // Entradas que não são festa (acerto entre unidades): entram no caixa, mas
    // não no faturamento — no resultado reduzem as despesas.
    supabase.from('other_incomes').select('amount, unit_id').gte('received_date', startIso).lt('received_date', endIso),
  ])

  for (const p of paymentsData ?? []) {
    const slug = slugByUnitId[(p as any).reservation?.unit_id]
    if (!slug) continue
    result[slug].receita += Number(p.amount)
    if (p.payment_method) result[slug].taxasCartao += (Number(p.amount) * (feePercentByMethod[p.payment_method] ?? 0)) / 100
  }
  for (const e of expensesData ?? []) {
    const slug = slugByUnitId[e.unit_id]
    if (!slug) continue
    if (e.category === 'Estorno') result[slug].estornos += Number(e.amount)
    else result[slug].despesas += Number(e.amount)
  }
  for (const inc of incomesData ?? []) {
    const slug = slugByUnitId[inc.unit_id]
    if (slug) result[slug].recuperacao += Number(inc.amount)
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

// ---------------------------------------------------------------------------
// Séries para os gráficos com período escolhido (ver lib/periodo.ts): mesma
// conta de loadMonthByUnit, mas para várias faixas (dias ou meses) buscando o
// intervalo inteiro de uma vez e separando por faixa aqui.

async function buscarTudo<T>(montar: () => any): Promise<T[]> {
  const out: T[] = []
  for (let de = 0; de < 50000; de += 1000) {
    const { data, error } = await montar().range(de, de + 999)
    if (error || !data) break
    out.push(...(data as T[]))
    if (data.length < 1000) break
  }
  return out
}

// Para os gráficos: além dos totais, o valor de cada categoria de entrada e de saída.
export interface SerieResult extends MonthResult {
  entradasCat: Record<string, number>
  saidasCat: Record<string, number>
}

export const CAT_PAGAMENTOS_FESTAS = 'Pagamentos de festas'
export const CAT_CUSTOS_FESTAS = 'Custos das festas'

function categoriaDaEntrada(o: { kind?: string | null; category?: string | null; description?: string | null }) {
  if (o.category) return o.category
  if (o.kind === 'multa_juros') return 'Multa e juros'
  if (o.kind === 'acerto_unidades') return 'Acertos entre unidades'
  return 'Outras entradas'
}

function soma(m: Record<string, number>, k: string, v: number) {
  m[k] = (m[k] ?? 0) + v
}

function vazio(): SerieResult {
  return { receita: 0, taxasCartao: 0, despesas: 0, estornos: 0, recuperacao: 0, custos: 0, festas: 0, ticketMedio: 0, entradasCat: {}, saidasCat: {} }
}

export async function loadSerieByUnit(faixas: Faixa[], unitIdBySlug: Record<string, string>): Promise<Record<string, SerieResult>[]> {
  const slugs = Object.keys(unitIdBySlug)
  const result = faixas.map(() => {
    const r: Record<string, SerieResult> = {}
    for (const s of slugs) r[s] = vazio()
    return r
  })
  if (faixas.length === 0 || slugs.length === 0) return result
  const { ini, fim } = limitesDasFaixas(faixas)
  const idx = indiceDaFaixa(faixas)
  const slugByUnitId: Record<string, string> = {}
  for (const s of slugs) slugByUnitId[unitIdBySlug[s]] = s
  const unitIds = Object.values(unitIdBySlug)

  const [pagamentos, reservas, despesas, taxas, entradas] = await Promise.all([
    buscarTudo<any>(() => supabase.from('payments').select('id, amount, payment_date, payment_method, reservation:reservations!inner(unit_id)').in('reservation.unit_id', unitIds).gte('payment_date', ini).lt('payment_date', fim).order('id')),
    buscarTudo<any>(() => supabase.from('reservations').select('id, unit_id, final_value, event_date').in('unit_id', unitIds).neq('status', 'cancelada').gte('event_date', ini).lt('event_date', fim).order('id')),
    buscarTudo<any>(() => supabase.from('expenses').select('id, amount, unit_id, category, paid_date').in('unit_id', unitIds).eq('status', 'pago').eq('covers_festa_costs', false).gte('paid_date', ini).lt('paid_date', fim).order('id')),
    loadFeePercentByMethod(),
    buscarTudo<any>(() => supabase.from('other_incomes').select('id, amount, unit_id, received_date, kind, category').in('unit_id', unitIds).gte('received_date', ini).lt('received_date', fim).order('id')),
  ])

  for (const p of pagamentos) {
    const i = idx(p.payment_date)
    const slug = slugByUnitId[p.reservation?.unit_id]
    if (i < 0 || !slug) continue
    result[i][slug].receita += Number(p.amount)
    soma(result[i][slug].entradasCat, CAT_PAGAMENTOS_FESTAS, Number(p.amount))
    if (p.payment_method) result[i][slug].taxasCartao += (Number(p.amount) * (taxas[p.payment_method] ?? 0)) / 100
  }
  for (const e of despesas) {
    const i = idx(e.paid_date)
    const slug = slugByUnitId[e.unit_id]
    if (i < 0 || !slug) continue
    if (e.category === 'Estorno') result[i][slug].estornos += Number(e.amount)
    else result[i][slug].despesas += Number(e.amount)
    soma(result[i][slug].saidasCat, e.category || 'Outros', Number(e.amount))
  }
  for (const o of entradas) {
    const i = idx(o.received_date)
    const slug = slugByUnitId[o.unit_id]
    if (i >= 0 && slug) {
      result[i][slug].recuperacao += Number(o.amount)
      soma(result[i][slug].entradasCat, categoriaDaEntrada(o), Number(o.amount))
    }
  }
  const faixaDaReserva: Record<string, number> = {}
  const unidadeDaReserva: Record<string, string> = {}
  const somaTicket = faixas.map(() => ({} as Record<string, number>))
  for (const r of reservas) {
    const i = idx(r.event_date)
    const slug = slugByUnitId[r.unit_id]
    if (i < 0 || !slug) continue
    faixaDaReserva[r.id] = i
    unidadeDaReserva[r.id] = slug
    result[i][slug].festas += 1
    somaTicket[i][slug] = (somaTicket[i][slug] ?? 0) + Number(r.final_value)
  }
  result.forEach((r, i) => {
    for (const s of slugs) r[s].ticketMedio = r[s].festas > 0 ? (somaTicket[i][s] ?? 0) / r[s].festas : 0
  })
  const ids = Object.keys(faixaDaReserva)
  for (let k = 0; k < ids.length; k += 150) {
    const lote = ids.slice(k, k + 150)
    const custos = await buscarTudo<any>(() => supabase.from('reservation_costs').select('id, amount, reservation_id').in('reservation_id', lote).order('id'))
    for (const c of custos) {
      const i = faixaDaReserva[c.reservation_id]
      const slug = unidadeDaReserva[c.reservation_id]
      if (i !== undefined && slug) {
        result[i][slug].custos += Number(c.amount)
        soma(result[i][slug].saidasCat, CAT_CUSTOS_FESTAS, Number(c.amount))
      }
    }
  }
  return result
}

// Saldo ainda a receber das festas (final_value − pago), por faixa da data da festa.
export async function loadExpectedRemainingSerie(faixas: Faixa[], unitIds: string[]): Promise<number[]> {
  const out = faixas.map(() => 0)
  if (faixas.length === 0 || unitIds.length === 0) return out
  const { ini, fim } = limitesDasFaixas(faixas)
  const idx = indiceDaFaixa(faixas)
  const reservas = await buscarTudo<any>(() =>
    supabase.from('reservations').select('id, event_date, final_value, payments(amount)').in('unit_id', unitIds).neq('status', 'cancelada').gte('event_date', ini).lt('event_date', fim).order('id'),
  )
  for (const r of reservas) {
    const i = idx(r.event_date)
    if (i < 0) continue
    const pago = (r.payments ?? []).reduce((s: number, p: any) => s + Number(p.amount), 0)
    out[i] += Math.max(0, Number(r.final_value) - pago)
  }
  return out
}
