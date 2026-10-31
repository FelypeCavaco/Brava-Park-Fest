import { supabase } from './supabaseClient'

// Parcelas programadas (migração 075): regra de cobrança da empresa e
// situação de cada parcela, calculada no banco (os pagamentos quitam as
// parcelas em ordem de vencimento; atraso tem multa e juros de hoje).

export type StatusParcela = 'paga' | 'atrasada' | 'vence_hoje' | 'parcial' | 'a_vencer'

export interface Parcela {
  seq: number
  label: string
  vencimento: string
  valor: number
  pago: number
  aberto: number
  status: StatusParcela
  dias_atraso: number
  multa: number
  juros: number
  total_hoje: number
  paga_em: string | null
}

export interface Cronograma {
  parcelas: Parcela[]
  valor_festa: number
  soma_parcelas: number
  pago: number
  em_atraso: number
  encargos: number
  a_vencer: number
  diferenca: number
}

export interface RegraCobranca {
  billing_mode: 'livre' | 'parcelas'
  installment_down_percent: number
  installment_down_days: number
  installment_count: number
  installment_interval: 'semanal' | 'quinzenal' | 'mensal'
  installment_first_days: number
  installment_deadline_days: number
  late_fees_enabled: boolean
  late_fee_percent: number
  late_interest_percent: number
  late_grace_days: number
}

export const CAMPOS_REGRA = 'billing_mode, installment_down_percent, installment_down_days, installment_count, installment_interval, installment_first_days, installment_deadline_days, late_fees_enabled, late_fee_percent, late_interest_percent, late_grace_days'

// Regra da empresa de quem está logado (null antes da migração 075).
export async function carregarRegraCobranca(): Promise<RegraCobranca | null> {
  const { data, error } = await supabase.from('companies').select(CAMPOS_REGRA).limit(1).maybeSingle()
  if (error || !data) return null
  return {
    ...(data as RegraCobranca),
    installment_down_percent: Number(data.installment_down_percent),
    late_fee_percent: Number(data.late_fee_percent),
    late_interest_percent: Number(data.late_interest_percent),
  }
}

export async function carregarCronograma(reservationId: string): Promise<Cronograma | null> {
  const { data, error } = await supabase.rpc('festa_installments', { p_res: reservationId })
  if (error || !data) return null
  const c = data as Cronograma
  return {
    ...c,
    parcelas: (c.parcelas ?? []).map((p) => ({ ...p, valor: Number(p.valor), pago: Number(p.pago), aberto: Number(p.aberto), multa: Number(p.multa), juros: Number(p.juros), total_hoje: Number(p.total_hoje) })),
  }
}

export const STATUS_LABEL: Record<StatusParcela, string> = {
  paga: 'Paga',
  atrasada: 'Atrasada',
  vence_hoje: 'Vence hoje',
  parcial: 'Paga em parte',
  a_vencer: 'A vencer',
}

const dm = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7)

export function situacaoTexto(p: Parcela, hoje: string): string {
  if (p.status === 'paga') return p.paga_em ? `Paga em ${dm(p.paga_em)}` : 'Paga'
  if (p.status === 'atrasada') return `Atrasada há ${p.dias_atraso} ${p.dias_atraso === 1 ? 'dia' : 'dias'}`
  if (p.status === 'vence_hoje') return 'Vence hoje'
  const dias = Math.round((new Date(`${p.vencimento}T12:00:00`).getTime() - new Date(`${hoje}T12:00:00`).getTime()) / 86400000)
  const quando = dias === 1 ? 'amanhã' : `em ${dias} dias`
  return p.status === 'parcial' ? `Paga em parte · vence ${quando}` : `Vence ${quando}`
}

// Exemplo da regra (Configurações): festa de R$ 4.700 fechada hoje para daqui a ~3,5 meses.
export function exemploRegra(r: RegraCobranca, total = 4700, diasAteFesta = 110): { label: string; data: string; valor: number }[] {
  const hoje = new Date()
  hoje.setHours(12, 0, 0, 0)
  const addDias = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
  const addMeses = (d: Date, n: number) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x }
  const festa = addDias(hoje, diasAteFesta)
  const prazo = addDias(festa, -r.installment_deadline_days)
  const min = (a: Date, b: Date) => (a < b ? a : b)
  const out: { label: string; data: string; valor: number }[] = []
  const sinal = r.installment_count === 0 ? total : Math.round(total * r.installment_down_percent) / 100
  const venceSinal = min(addDias(hoje, r.installment_down_days), prazo)
  if (sinal > 0) out.push({ label: r.installment_count === 0 ? 'Pagamento único' : 'Sinal', data: venceSinal.toLocaleDateString('pt-BR'), valor: sinal })
  const resto = Math.round((total - sinal) * 100) / 100
  if (resto <= 0) return out
  const datas: string[] = []
  for (let i = 1; i <= Math.max(r.installment_count, 1); i++) {
    const base = addDias(venceSinal, r.installment_first_days)
    const d = r.installment_interval === 'semanal' ? addDias(base, 7 * (i - 1)) : r.installment_interval === 'quinzenal' ? addDias(base, 15 * (i - 1)) : addMeses(base, i - 1)
    const t = min(d, prazo).toLocaleDateString('pt-BR')
    if (!datas.includes(t)) datas.push(t)
  }
  const cada = Math.round((resto / datas.length) * 100) / 100
  datas.forEach((d, i) => out.push({ label: `${out.length + 1}ª parcela`, data: d, valor: i === datas.length - 1 ? Math.round((resto - cada * (datas.length - 1)) * 100) / 100 : cada }))
  return out
}
