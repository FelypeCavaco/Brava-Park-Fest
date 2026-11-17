// Relatório financeiro completo (PDF e Excel) de um período qualquer: dias, semanas,
// meses ou um intervalo de datas.
//
// Usa as mesmas contas do banco que as três visões do Financeiro
// (finance_range_views, que faz a conta de finance_month_views para qualquer
// intervalo, e finance_commitments) e lista cada lançamento do período. Assim os números do relatório batem com as telas.

import { supabase } from './supabaseClient'
import { addMonthsToValue } from './monthUtils'
import { PAYMENT_METHOD_LABEL, type PaymentMethod } from '../types'

// ---------- tipos (mesmo formato que o banco devolve) ----------

interface FestaRealizada {
  id: string; data: string; cliente: string; unit_id: string; valor_firmado: number; extras: number; consumo: number
  receita: number; recebido: number; a_receber: number; custos: number; insumos: number; itens_sem_custo: number
  consumo_finalizado: boolean; taxa: number; lucro: number; status: 'completo' | 'parcial'
}
interface Cancelamento {
  id: string; data: string; data_estimada: boolean; data_festa: string; cliente: string; unit_id: string
  pago: number; devolvido: number; multa: number; custos: number; efeito: number
}
interface ItemPonte { data: string; descricao: string; valor: number }
interface LinhaPonte { chave: string; valor: number; itens: ItemPonte[] }
interface MonthViews {
  mes: string; hoje: string; corte: string; mes_atual: boolean
  caixa: { entradas: number; acertos_recebidos: number; contas_pagas: number; custos_festas: number; saldo: number }
  resultado: {
    festas: number; receita: number; custos_lancados: number; insumos: number; taxa: number; resultado_direto: number
    despesas_gerais: number; efeito_cancelamentos: number; resultado: number; compras_estoque: number
  }
  festas: FestaRealizada[]; cancelamentos: Cancelamento[]; ponte: LinhaPonte[]; diferenca: number
}
interface Commitments {
  hoje: string; recebido: number; custos_previstos: number; reserva: number
  festas: { id: string; data: string; cliente: string; contratado: number; devido: number; recebido: number; a_receber: number; custos_previstos: number }[]
}

// origem: de onde veio a entrada (pagamento de festa, lançada à mão, multa e juros, acerto entre unidades).
export interface Lancamento { data: string; categoria: string; descricao: string; detalhe: string; valor: number; origem?: string }

export const ORIGEM_MANUAL = 'Lançada à mão'
function origemDaEntrada(kind?: string | null) {
  if (kind === 'manual') return ORIGEM_MANUAL
  if (kind === 'multa_juros') return 'Multa e juros'
  if (kind === 'acerto_unidades') return 'Acerto entre unidades'
  return 'Outra entrada'
}
export interface ContaAberta { vencimento: string; categoria: string; descricao: string; fornecedor: string; valor: number; atrasada: boolean }

export interface DadosRelatorio {
  casa: string
  unidade: string
  mesIni: string
  mesFim: string
  de: string // primeiro dia do período (aaaa-mm-dd)
  ate: string // último dia do período (aaaa-mm-dd), no máximo hoje
  agrupar: Agrupar
  periodoTexto: string
  geradoEm: string
  geradoPor: string
  meses: string[]
  caixa: MonthViews['caixa']
  resultado: MonthViews['resultado']
  porMes: { mes: string; rotulo: string; de: string; ate: string; entradas: number; saidas: number; saldo: number; resultado: number; festas: number; manuais: number }[]
  festas: (FestaRealizada & { mes: string; foraDaConta: boolean })[]
  cancelamentos: Cancelamento[]
  ponte: LinhaPonte[]
  diferenca: number
  compromissos: Commitments | null
  entradas: Lancamento[]
  saidas: Lancamento[]
  pagaCustosFesta: Lancamento[] // contas marcadas "já nos custos das festas" (não entram nos totais)
  contasAbertas: ContaAberta[]
  entradasManuais: number // entradas lançadas à mão (não entram no resultado das festas; entram no 2º cenário)
  entradasManuaisLista: Lancamento[]
  mesAtualIncluido: boolean
  corteMesAtual: string | null
  // quando o relatório separa por unidade: os mesmos números de cada unidade
  unidadesSeparadas?: { nome: string; dados: DadosRelatorio }[]
}

const n = (v: unknown) => Number(v ?? 0)
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

export function nomeMesLongo(m: string) {
  const [y, mm] = m.split('-').map(Number)
  return `${MESES[mm - 1]} de ${y}`
}
export function brl(v: number) {
  return n(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
export function dataBr(iso: string | null | undefined) {
  if (!iso) return ''
  const d = iso.slice(0, 10)
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
}
function metodo(m: string | null | undefined) {
  return m ? PAYMENT_METHOD_LABEL[m as PaymentMethod] ?? m : ''
}
function categoriaEntrada(o: { kind?: string | null; category?: string | null }) {
  if (o.category) return o.category
  if (o.kind === 'multa_juros') return 'Multa e juros'
  if (o.kind === 'acerto_unidades') return 'Acertos entre unidades'
  return 'Outras entradas'
}

async function buscarTudo<T>(montar: () => any): Promise<T[]> {
  const out: T[] = []
  for (let de = 0; de < 50000; de += 1000) {
    const { data, error } = await montar().range(de, de + 999)
    if (error) throw error
    if (!data) break
    out.push(...(data as T[]))
    if (data.length < 1000) break
  }
  return out
}

// ---------- períodos ----------

export type Agrupar = 'dia' | 'semana' | 'mes'
export interface Faixa { chave: string; rotulo: string; de: string; ate: string }

const pad2 = (v: number) => String(v).padStart(2, '0')
const isoDe = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
const dataDe = (iso: string) => new Date(`${iso}T12:00:00`)
export const hojeIso = () => isoDe(new Date())
export function somarDias(iso: string, dias: number) {
  const d = dataDe(iso)
  d.setDate(d.getDate() + dias)
  return isoDe(d)
}
export function diasEntre(de: string, ate: string) {
  return Math.round((dataDe(ate).getTime() - dataDe(de).getTime()) / 86400000) + 1
}
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const dma = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

// Segunda-feira da semana de uma data (a semana vai de segunda a domingo).
export function inicioDaSemana(iso: string) {
  const d = dataDe(iso)
  const dia = (d.getDay() + 6) % 7 // segunda = 0
  d.setDate(d.getDate() - dia)
  return isoDe(d)
}

export function montarFaixas(de: string, ate: string, agrupar: Agrupar): Faixa[] {
  const out: Faixa[] = []
  if (agrupar === 'dia') {
    for (let d = de; d <= ate; d = somarDias(d, 1)) out.push({ chave: d, rotulo: dm(d), de: d, ate: d })
  } else if (agrupar === 'semana') {
    for (let ini = de; ini <= ate; ) {
      const domingo = somarDias(inicioDaSemana(ini), 6)
      const fim = domingo < ate ? domingo : ate
      out.push({ chave: ini, rotulo: ini === fim ? dm(ini) : `${dm(ini)} a ${dm(fim)}`, de: ini, ate: fim })
      ini = somarDias(fim, 1)
    }
  } else {
    for (let ini = de; ini <= ate; ) {
      const mes = ini.slice(0, 7)
      const ultimo = `${addMonthsToValue(mes, 1)}-01`
      const fimMes = somarDias(ultimo, -1)
      const fim = fimMes < ate ? fimMes : ate
      const inteiro = ini === `${mes}-01` && fim === fimMes
      out.push({ chave: mes, rotulo: inteiro ? nomeMesLongo(mes) : `${nomeMesLongo(mes)} (${dm(ini)} a ${dm(fim)})`, de: ini, ate: fim })
      ini = somarDias(fim, 1)
    }
  }
  return out
}

// Até 31 dias: dia a dia. Até 4 meses: semana a semana. Depois: mês a mês.
export function agrupamentoAutomatico(de: string, ate: string): Agrupar {
  const dias = diasEntre(de, ate)
  return dias <= 31 ? 'dia' : dias <= 124 ? 'semana' : 'mes'
}
// No máximo 60 faixas por relatório: se o agrupamento escolhido passar disso, sobe um nível.
export function ajustarAgrupamento(de: string, ate: string, agrupar: Agrupar): Agrupar {
  const ordem: Agrupar[] = ['dia', 'semana', 'mes']
  let i = ordem.indexOf(agrupar)
  while (i < 2 && montarFaixas(de, ate, ordem[i]).length > 60) i++
  return ordem[i]
}
export const NOME_AGRUPAR: Record<Agrupar, { tabela: string; unidade: string; plural: string }> = {
  dia: { tabela: 'Dia a dia', unidade: 'dia', plural: 'dias' },
  semana: { tabela: 'Semana a semana', unidade: 'semana', plural: 'semanas' },
  mes: { tabela: 'Mês a mês', unidade: 'mês', plural: 'meses' },
}

export function textoDoPeriodo(de: string, ate: string) {
  if (de === ate) return dma(de)
  const mes = de.slice(0, 7)
  const fimDoMes = somarDias(`${addMonthsToValue(mes, 1)}-01`, -1)
  if (de === `${mes}-01` && ate === fimDoMes) return nomeMesLongo(mes)
  return `${dma(de)} a ${dma(ate)}`
}

// ---------- carregar ----------

interface OpRelatorio {
  de: string; ate: string; agrupar?: Agrupar; unitId: string | null; unidade: string; casa: string; geradoPor: string
  // para separar por unidade: as unidades (cada uma com o id do banco)
  separarPor?: { nome: string; unitId: string }[]
}

export async function carregarRelatorio(op: OpRelatorio): Promise<DadosRelatorio> {
  const hoje = hojeIso()
  let { de, ate } = op
  if (ate < de) [de, ate] = [ate, de]
  if (ate > hoje) ate = hoje // o relatório vai até hoje: dias que não chegaram ainda não têm lançamento
  if (de > ate) throw new Error('Esse período ainda não começou.')
  if (diasEntre(de, ate) > 800) throw new Error('Escolha no máximo 2 anos por relatório.')
  const agrupar = ajustarAgrupamento(de, ate, op.agrupar ?? agrupamentoAutomatico(de, ate))
  const faixas = montarFaixas(de, ate, agrupar)
  const ini = de
  const fim = somarDias(ate, 1) // exclusivo

  const chamar = async (a: string, b: string) => {
    const { data, error } = await supabase.rpc('finance_range_views', { p_from: a, p_to: b, p_unit: op.unitId })
    if (error) {
      if (/finance_range_views|schema cache|PGRST202/i.test(`${error.message} ${error.code ?? ''}`)) throw new Error('O relatório por período ainda não foi instalado no banco de dados (migração 099).')
      throw error
    }
    return data as MonthViews
  }
  // O período inteiro numa conta só (totais, ponte, festas e cancelamentos) e cada faixa à parte (só para a tabela "por período").
  const [v, viewsFaixas] = await Promise.all([
    chamar(de, ate),
    faixas.length > 1 ? Promise.all(faixas.map((f) => chamar(f.de, f.ate))) : Promise.resolve(null as MonthViews[] | null),
  ])

  const caixa = { entradas: 0, acertos_recebidos: 0, contas_pagas: 0, custos_festas: 0, saldo: 0 }
  const resultado = { festas: 0, receita: 0, custos_lancados: 0, insumos: 0, taxa: 0, resultado_direto: 0, despesas_gerais: 0, efeito_cancelamentos: 0, resultado: 0, compras_estoque: 0 }
  for (const k of Object.keys(caixa) as (keyof typeof caixa)[]) caixa[k] = n(v.caixa[k])
  for (const k of Object.keys(resultado) as (keyof typeof resultado)[]) resultado[k] = n(v.resultado[k])
  const ponte: LinhaPonte[] = (v.ponte ?? []).map((l) => ({ chave: l.chave, valor: n(l.valor), itens: (l.itens ?? []).map((it) => ({ ...it, valor: n(it.valor) })) }))
  const diferenca = n(v.diferenca)
  const festas: DadosRelatorio['festas'] = (v.festas ?? []).map((f) => ({ ...f, mes: String(f.data).slice(0, 7), foraDaConta: false }))
  const cancelamentos: Cancelamento[] = v.cancelamentos ?? []
  const corteMesAtual = ate === hoje ? hoje : null

  const porMes: DadosRelatorio['porMes'] = faixas.map((f, i) => {
    const x = viewsFaixas ? viewsFaixas[i] : v
    return {
      mes: f.chave, rotulo: f.rotulo, de: f.de, ate: f.ate,
      entradas: n(x.caixa.entradas) + n(x.caixa.acertos_recebidos),
      saidas: n(x.caixa.contas_pagas) + n(x.caixa.custos_festas),
      saldo: n(x.caixa.saldo),
      resultado: n(x.resultado.resultado),
      festas: n(x.resultado.festas),
      manuais: 0,
    }
  })

  // Festas marcadas "fora da conta" no Lucro por festa (migração 088). Se a
  // migração ainda não rodou, só não marca.
  if (festas.length > 0) {
    try {
      const ids = festas.map((f) => f.id)
      const fora = new Set<string>()
      for (let k = 0; k < ids.length; k += 150) {
        const { data, error } = await supabase.from('reservations').select('id').in('id', ids.slice(k, k + 150)).eq('profit_excluded', true)
        if (error) break
        for (const r of data ?? []) fora.add(r.id)
      }
      for (const f of festas) f.foraDaConta = fora.has(f.id)
    } catch {
      /* sem a migração 088: ninguém fica fora da conta */
    }
  }

  const { data: comp } = await supabase.rpc('finance_commitments', { p_unit: op.unitId })

  // ---------- lançamentos do período ----------
  const agoraLocal = new Date()
  const amanha = somarDias(hoje, 1)
  // Custos das festas contam até hoje (igual ao caixa): festa futura ainda não gastou.
  const limiteCustos = fim < amanha ? fim : amanha
  const porUnidade = (q: any, col = 'unit_id') => (op.unitId ? q.eq(col, op.unitId) : q)

  const [pags, outras, contas, festasCustos, abertas] = await Promise.all([
    buscarTudo<any>(() =>
      porUnidade(
        supabase.from('payments').select('id, amount, payment_date, payment_method, notes, reservation:reservations!inner(unit_id, event_date, child_name, client:clients(name))').gte('payment_date', ini).lt('payment_date', fim).order('payment_date').order('id'),
        'reservation.unit_id',
      ),
    ),
    buscarTudo<any>(() => porUnidade(supabase.from('other_incomes').select('id, amount, received_date, payment_method, description, kind, category').gte('received_date', ini).lt('received_date', fim).order('received_date').order('id'))),
    buscarTudo<any>(() => porUnidade(supabase.from('expenses').select('id, category, description, supplier, amount, paid_date, payment_method, recurring_expense_id, covers_festa_costs').eq('status', 'pago').gte('paid_date', ini).lt('paid_date', fim).order('paid_date').order('id'))),
    buscarTudo<any>(() => porUnidade(supabase.from('reservations').select('id, event_date, child_name, client:clients(name), reservation_costs(id, description, amount)').neq('status', 'cancelada').gte('event_date', ini).lt('event_date', limiteCustos).order('event_date').order('id'))),
    buscarTudo<any>(() => porUnidade(supabase.from('expenses').select('id, category, description, supplier, amount, due_date, status').in('status', ['a_vencer', 'atrasado']).order('due_date').order('id'))),
  ])

  const entradas: Lancamento[] = []
  for (const p of pags) {
    const r = p.reservation
    entradas.push({
      data: p.payment_date,
      categoria: 'Pagamentos de festas',
      descricao: `${r?.client?.name ?? 'Cliente'}${r?.child_name ? ` — festa de ${r.child_name}` : ''}${r?.event_date ? ` (${dataBr(r.event_date)})` : ''}`,
      detalhe: [metodo(p.payment_method), p.notes].filter(Boolean).join(' · '),
      valor: n(p.amount),
      origem: 'Pagamento de festa',
    })
  }
  // Entradas lançadas à mão: contam no 2º cenário do resultado (festas + entradas à mão).
  let entradasManuais = 0
  const entradasManuaisLista: Lancamento[] = []
  for (const o of outras) {
    if (o.kind === 'manual') {
      entradasManuais += n(o.amount)
      const dia = String(o.received_date).slice(0, 10)
      const pm = porMes.find((m) => dia >= m.de && dia <= m.ate)
      if (pm) pm.manuais += n(o.amount)
      entradasManuaisLista.push({ data: o.received_date, categoria: categoriaEntrada(o), descricao: o.description || categoriaEntrada(o), detalhe: metodo(o.payment_method), valor: n(o.amount), origem: ORIGEM_MANUAL })
    }
    entradas.push({ data: o.received_date, categoria: categoriaEntrada(o), descricao: o.description || categoriaEntrada(o), detalhe: metodo(o.payment_method), valor: n(o.amount), origem: origemDaEntrada(o.kind) })
  }
  const saidas: Lancamento[] = []
  const pagaCustosFesta: Lancamento[] = []
  for (const e of contas) {
    const item = {
      data: e.paid_date,
      categoria: e.category || 'Outros',
      descricao: [e.description, e.supplier].filter(Boolean).join(' — ') || 'Conta',
      detalhe: [metodo(e.payment_method), e.recurring_expense_id ? 'despesa fixa' : ''].filter(Boolean).join(' · '),
      valor: n(e.amount),
    }
    if (e.covers_festa_costs) pagaCustosFesta.push(item)
    else saidas.push(item)
  }
  for (const r of festasCustos) {
    for (const c of r.reservation_costs ?? []) {
      saidas.push({
        data: r.event_date,
        categoria: 'Custos das festas',
        descricao: `${c.description || 'Custo'} — festa de ${r.child_name || r.client?.name || 'cliente'}`,
        detalhe: 'pela data da festa',
        valor: n(c.amount),
      })
    }
  }
  entradas.sort((a, b) => a.data.localeCompare(b.data))
  saidas.sort((a, b) => a.data.localeCompare(b.data))

  const contasAbertas: ContaAberta[] = abertas.map((e) => ({
    vencimento: e.due_date,
    categoria: e.category || 'Outros',
    descricao: e.description || 'Conta',
    fornecedor: e.supplier || '',
    valor: n(e.amount),
    atrasada: e.status === 'atrasado' || e.due_date < hoje,
  }))

  const meses: string[] = []
  for (let m = de.slice(0, 7); m <= ate.slice(0, 7) && meses.length < 30; m = addMonthsToValue(m, 1)) meses.push(m)

  const dados: DadosRelatorio = {
    casa: op.casa,
    unidade: op.unidade,
    mesIni: de.slice(0, 7),
    mesFim: ate.slice(0, 7),
    de,
    ate,
    agrupar,
    periodoTexto: textoDoPeriodo(de, ate),
    geradoEm: `${dataBr(agoraLocal.toISOString())} às ${pad2(agoraLocal.getHours())}:${pad2(agoraLocal.getMinutes())}`,
    geradoPor: op.geradoPor,
    meses,
    caixa,
    resultado,
    porMes,
    festas,
    cancelamentos,
    ponte,
    diferenca,
    compromissos: (comp as Commitments) ?? null,
    entradas,
    saidas,
    pagaCustosFesta,
    contasAbertas,
    entradasManuais,
    entradasManuaisLista,
    mesAtualIncluido: corteMesAtual !== null,
    corteMesAtual,
  }

  // Separar por unidade: o mesmo relatório, uma vez para cada unidade (sem repetir a separação).
  if (op.separarPor && op.separarPor.length > 0) {
    dados.unidadesSeparadas = []
    for (const u of op.separarPor) {
      const d = await carregarRelatorio({ ...op, de, ate, agrupar, unitId: u.unitId, unidade: u.nome, separarPor: undefined })
      dados.unidadesSeparadas.push({ nome: u.nome, dados: d })
    }
  }
  return dados
}

// ---------- textos (usados no PDF e no Excel) ----------

export const PONTE_TEXTO: Record<string, { titulo: string; explica: (v: number) => string }> = {
  anterior: { titulo: 'Recebido de festas anteriores ao período', explica: (v) => `${brl(Math.abs(v))} entraram na conta no período, mas são de festas que aconteceram antes. A festa contou no resultado do mês dela, por isso esse valor sai daqui.` },
  futura: { titulo: 'Adiantado de festas futuras', explica: (v) => `${brl(Math.abs(v))} entraram na conta por festas que ainda vão acontecer. Estão no caixa, mas ainda não são resultado de nenhuma festa realizada.` },
  cancelada_recebido: { titulo: 'Recebido de festas canceladas', explica: (v) => `${brl(Math.abs(v))} entraram de festas que depois foram canceladas. No resultado, a festa cancelada conta só pela multa retida.` },
  antes: { titulo: 'Recebido antes do período', explica: (v) => `${brl(v)} das festas feitas no período foram pagos antes. A festa conta aqui, mas o dinheiro não passou pelo período, por isso é somado.` },
  depois: { titulo: 'Recebido depois do período', explica: (v) => `${brl(v)} das festas feitas no período foram pagos depois. Contam no resultado da festa, por isso são somados.` },
  a_receber: { titulo: 'Ainda a receber das festas realizadas', explica: (v) => (v >= 0 ? `Os clientes das festas realizadas ainda devem ${brl(v)}. Já contam no resultado, mas o dinheiro não entrou.` : `Os clientes pagaram ${brl(Math.abs(v))} a mais que o valor das festas.`) },
  multa: { titulo: 'Multa retida de festas canceladas', explica: (v) => `Das festas canceladas, a casa ficou com ${brl(v)} (pago − devolvido). É a parte do cancelamento que conta no resultado.` },
  custos_canceladas: { titulo: 'Custos de festas canceladas', explica: (v) => `${brl(Math.abs(v))} de custos já lançados em festas canceladas. O caixa não conta esses custos; o resultado conta.` },
  estornos: { titulo: 'Devoluções (estornos) pagas', explica: (v) => `${brl(v)} saíram em devoluções de cancelamento. O resultado conta só a multa retida, por isso o valor volta aqui.` },
  compras_estoque: { titulo: 'Compras de estoque', explica: (v) => `${brl(v)} saíram em compras de insumos. O resultado não conta a compra, e sim o que as festas consumiram (linha de insumos).` },
  insumos: { titulo: 'Insumos consumidos nas festas', explica: (v) => `As festas consumiram ${brl(Math.abs(v))} em insumos do estoque. Não é dinheiro saindo agora, mas é custo das festas.` },
  acertos_recebidos: { titulo: 'Outras entradas (lançadas à mão, acertos, multa e juros)', explica: (v) => `${brl(Math.abs(v))} entraram sem ser pagamento de festa. Não são valor de festa, por isso saem do resultado das festas.` },
  acertos_pagos: { titulo: 'Acertos entre unidades pagos', explica: (v) => `${brl(v)} saíram para a outra unidade por produtos transferidos. Não é custo de festa, por isso o valor volta aqui.` },
  taxa: { titulo: 'Taxa da maquininha (estimada)', explica: (v) => `${brl(Math.abs(v))} de taxa estimada sobre os pagamentos das festas realizadas. O caixa não desconta; o resultado desconta.` },
}

export function veredito(d: DadosRelatorio) {
  const r = d.resultado.resultado
  return { lucro: r >= 0, valor: Math.abs(r), palavra: r >= 0 ? 'LUCRO' : 'PREJUÍZO' }
}

// Segundo cenário: resultado das festas + entradas do período lançadas à mão.
export function resultadoComManuais(d: DadosRelatorio) {
  return d.resultado.resultado + d.entradasManuais
}
export function vereditoComManuais(d: DadosRelatorio) {
  const r = resultadoComManuais(d)
  return { lucro: r >= 0, valor: Math.abs(r), palavra: r >= 0 ? 'LUCRO' : 'PREJUÍZO' }
}

export function explicacaoResultado(d: DadosRelatorio): string[] {
  const r = d.resultado
  const v = veredito(d)
  const custosFestas = r.custos_lancados + r.insumos + r.taxa
  const linhas: string[] = []
  linhas.push(
    r.festas > 0
      ? `No período (${d.periodoTexto}), ${r.festas === 1 ? 'foi realizada 1 festa' : `foram realizadas ${r.festas} festas`}, que somaram ${brl(r.receita)} em valor de festa (valor firmado + extras + consumo cobrado).`
      : `No período (${d.periodoTexto}), nenhuma festa foi realizada.`,
  )
  if (r.festas > 0)
    linhas.push(
      `Os custos dessas festas foram ${brl(custosFestas)}: ${brl(r.custos_lancados)} lançados nas festas (equipe, fornecedores, despesas fixas de festa), ${brl(r.insumos)} em insumos do estoque e ${brl(r.taxa)} de taxa da maquininha. Sobraram ${brl(r.resultado_direto)} das festas${r.receita > 0 ? ` (margem de ${((r.resultado_direto / r.receita) * 100).toFixed(0)}%)` : ''}.`,
    )
  linhas.push(`Depois entram as despesas gerais da casa pagas no período (aluguel, contas, salários, comissões, marketing e outras): ${brl(r.despesas_gerais)}.`)
  if (Math.abs(r.efeito_cancelamentos) > 0.004)
    linhas.push(`Os cancelamentos tiveram efeito de ${brl(r.efeito_cancelamentos)} (multas retidas menos custos já lançados nas festas canceladas).`)
  linhas.push(
    `Resultado: ${brl(r.receita)} − ${brl(custosFestas)} − ${brl(r.despesas_gerais)}${Math.abs(r.efeito_cancelamentos) > 0.004 ? ` ${r.efeito_cancelamentos >= 0 ? '+' : '−'} ${brl(Math.abs(r.efeito_cancelamentos))}` : ''} = ${v.lucro ? 'lucro' : 'prejuízo'} de ${brl(v.valor)}.`,
  )
  const parciais = d.festas.filter((f) => f.status === 'parcial').length
  if (parciais > 0)
    linhas.push(`Atenção: ${parciais} festa${parciais === 1 ? ' está' : 's estão'} com dados incompletos (sem custos lançados, consumo não finalizado ou itens sem custo). O lucro real pode ser menor.`)
  const fora = d.festas.filter((f) => f.foraDaConta)
  if (fora.length > 0) {
    const semElas = r.resultado - fora.reduce((s, f) => s + n(f.lucro), 0)
    linhas.push(`${fora.length} festa${fora.length === 1 ? ' está marcada' : 's estão marcadas'} como "fora da conta" no Lucro por festa. Sem ${fora.length === 1 ? 'ela' : 'elas'}, o resultado seria ${brl(semElas)}.`)
  }
  linhas.push(
    d.entradasManuais > 0
      ? `Segundo cenário: ${brl(d.entradasManuais)} de entradas lançadas à mão (ex.: aluguel do espaço) entraram no período. Elas não fazem parte do resultado das festas acima (que conta só festas e despesas), mas, somadas a ele, o resultado do período fica em ${brl(resultadoComManuais(d))}.`
      : 'Segundo cenário: nenhuma entrada foi lançada à mão no período; por isso o resultado com as entradas lançadas à mão é igual ao das festas.',
  )
  if (d.mesAtualIncluido && d.corteMesAtual) linhas.push(`O mês atual entra até ${dataBr(d.corteMesAtual)}: festas e custos dos próximos dias ainda não contam.`)
  return linhas
}

export function explicacaoCaixa(d: DadosRelatorio): string {
  const c = d.caixa
  const entrou = c.entradas + c.acertos_recebidos
  const saiu = c.contas_pagas + c.custos_festas
  return `No caixa entraram ${brl(entrou)} (${brl(c.entradas)} de pagamentos de clientes e ${brl(c.acertos_recebidos)} de outras entradas) e saíram ${brl(saiu)} (${brl(c.contas_pagas)} de contas pagas e ${brl(c.custos_festas)} de custos das festas). O saldo do caixa no período foi de ${brl(c.saldo)}. O caixa mostra o dinheiro que passou pela conta, não se as festas deram lucro.`
}

export function explicacaoPonte(d: DadosRelatorio): string {
  const dif = d.resultado.resultado - d.caixa.saldo
  if (Math.abs(dif) < 0.01) return 'O saldo do caixa e o resultado são iguais no período.'
  const maior = [...d.ponte].sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor))[0]
  return `O resultado (${brl(d.resultado.resultado)}) é ${dif > 0 ? 'maior' : 'menor'} que o saldo do caixa (${brl(d.caixa.saldo)}) em ${brl(Math.abs(dif))}.${maior ? ` O maior motivo é "${(PONTE_TEXTO[maior.chave]?.titulo ?? maior.chave).toLowerCase()}" (${brl(maior.valor)}).` : ''} A tabela abaixo mostra cada diferença, uma por uma.`
}

export function somaPorCategoria(lista: Lancamento[]) {
  const m = new Map<string, { total: number; qtd: number }>()
  for (const l of lista) {
    const e = m.get(l.categoria) ?? { total: 0, qtd: 0 }
    e.total += l.valor
    e.qtd += 1
    m.set(l.categoria, e)
  }
  return [...m.entries()].map(([categoria, v]) => ({ categoria, ...v })).sort((a, b) => b.total - a.total)
}

export const GLOSSARIO: [string, string][] = [
  ['Caixa', 'O dinheiro que entrou e saiu da conta no período, pela data do pagamento. Custos das festas contam pela data da festa.'],
  ['Resultado das festas', 'Se a casa teve lucro ou prejuízo: valor das festas realizadas menos os custos delas, as despesas gerais e o efeito dos cancelamentos.'],
  ['Resultado com entradas à mão', 'O resultado das festas somado às entradas do período lançadas à mão (ex.: aluguel do espaço). É o segundo cenário: o primeiro conta só festas e despesas.'],
  ['Ponte', 'Explica, linha por linha, por que o saldo do caixa é diferente do resultado (pagamentos adiantados, a receber, compras de estoque etc.).'],
  ['Compromissos', 'O que já foi recebido de festas que ainda vão acontecer e quanto vai custar realizá-las. É dinheiro que está no caixa, mas já tem destino.'],
  ['Insumos', 'Produtos do estoque consumidos nas festas, pelo custo de compra.'],
  ['Taxa da maquininha', 'Estimativa da taxa cobrada nos pagamentos com cartão, pelas taxas cadastradas em Configurações.'],
  ['Festa parcial', 'Festa sem custos lançados, com consumo não finalizado ou com itens sem custo. O lucro dela pode estar maior do que o real.'],
  ['Fora da conta', 'Festa marcada no Lucro por festa para não entrar nos totais daquela tela (ex.: dados ainda não lançados).'],
]
