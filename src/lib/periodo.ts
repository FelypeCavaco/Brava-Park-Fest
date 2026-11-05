// Período dos gráficos: o mesmo seletor em todas as telas.
//   • "meses": compara os últimos N meses (ou os próximos N, nos gráficos de previsão).
//   • "mes":   um mês só, dia a dia.
//   • "datas": de uma data até outra — dia a dia até 62 dias, mês a mês acima disso.
// Gráficos que só existem por mês (ex: gasto com tráfego, que é lançado por
// mês) usam granularidade "mensal": aí "um mês" mostra só aquele mês e
// "datas" mostra os meses do intervalo.

import { addMonthsToValue, currentMonthValue } from './monthUtils'

export type ModoPeriodo = 'meses' | 'mes' | 'datas'
export type TipoGrafico = 'barras' | 'linhas'

export interface Periodo {
  modo: ModoPeriodo
  qtdMeses: number
  mes: string // 'YYYY-MM'
  de: string // 'YYYY-MM-DD'
  ate: string // 'YYYY-MM-DD' (inclusive)
}

export interface Faixa {
  chave: string
  rotulo: string
  ini: string // inclusive
  fim: string // exclusive
  mes?: string // 'YYYY-MM' quando a faixa é um mês inteiro
}

export interface OpcoesFaixas {
  granularidade?: 'auto' | 'mensal'
  futuro?: boolean // "meses" = próximos N meses (a partir do mês que vem)
  aFrente?: number // "meses" = inclui também N meses depois do atual
}

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

export function isoHoje() {
  const d = new Date()
  return iso(d)
}
function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function dataDe(s: string) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function maisDias(s: string, n: number) {
  const d = dataDe(s)
  d.setDate(d.getDate() + n)
  return iso(d)
}
export function diasEntre(a: string, b: string) {
  return Math.round((dataDe(b).getTime() - dataDe(a).getTime()) / 86400000)
}

export function periodoPadrao(qtdMeses = 6): Periodo {
  const mes = currentMonthValue()
  return { modo: 'meses', qtdMeses, mes, de: `${mes}-01`, ate: isoHoje() }
}

function faixaMes(m: string, comAno: boolean): Faixa {
  const [y, mm] = m.split('-').map(Number)
  return {
    chave: m,
    rotulo: comAno ? `${MESES[mm - 1]}/${String(y).slice(2)}` : MESES[mm - 1],
    ini: `${m}-01`,
    fim: `${addMonthsToValue(m, 1)}-01`,
    mes: m,
  }
}

function mesesEntre(a: string, b: string) {
  const out: string[] = []
  for (let m = a; m <= b && out.length < 240; m = addMonthsToValue(m, 1)) out.push(m)
  return out
}

function rotularMeses(lista: string[]) {
  const anos = new Set(lista.map((m) => m.slice(0, 4)))
  const comAno = anos.size > 1 || (lista[0] ?? '').slice(0, 4) !== String(new Date().getFullYear())
  return lista.map((m) => faixaMes(m, comAno))
}

function dias(de: string, ateIncl: string): Faixa[] {
  const out: Faixa[] = []
  for (let d = de; d <= ateIncl && out.length < 400; d = maisDias(d, 1)) {
    out.push({ chave: d, rotulo: `${d.slice(8, 10)}/${d.slice(5, 7)}`, ini: d, fim: maisDias(d, 1) })
  }
  return out
}

export function faixasDoPeriodo(p: Periodo, op: OpcoesFaixas = {}): Faixa[] {
  const mensal = op.granularidade === 'mensal'
  const atual = currentMonthValue()
  if (p.modo === 'meses') {
    const n = Math.max(1, Math.min(36, p.qtdMeses))
    if (op.futuro) return rotularMeses(Array.from({ length: n }, (_, i) => addMonthsToValue(atual, i + 1)))
    const ultimo = addMonthsToValue(atual, op.aFrente ?? 0)
    return rotularMeses(mesesEntre(addMonthsToValue(atual, -(n - 1)), ultimo))
  }
  if (p.modo === 'mes') {
    if (mensal) return rotularMeses([p.mes])
    const [y, m] = p.mes.split('-').map(Number)
    return dias(`${p.mes}-01`, iso(new Date(y, m, 0)))
  }
  let de = p.de || `${atual}-01`
  let ate = p.ate || isoHoje()
  if (ate < de) [de, ate] = [ate, de]
  if (!mensal && diasEntre(de, ate) <= 62) return dias(de, ate)
  // mês a mês, cortando o primeiro e o último mês nas datas escolhidas
  const lista = rotularMeses(mesesEntre(de.slice(0, 7), ate.slice(0, 7)))
  if (mensal) return lista
  return lista.map((f, i) => ({
    ...f,
    ini: i === 0 ? de : f.ini,
    fim: i === lista.length - 1 ? maisDias(ate, 1) : f.fim,
    mes: (i === 0 && de.slice(8) !== '01') || i === lista.length - 1 ? undefined : f.mes,
  }))
}

// Texto curto do período, para títulos ("últimos 6 meses", "novembro de 2026"…).
export function descreverPeriodo(p: Periodo, op: OpcoesFaixas = {}) {
  if (p.modo === 'meses') {
    if (op.futuro) return `próximos ${p.qtdMeses} meses`
    return `últimos ${p.qtdMeses} meses${op.aFrente ? ` e próximos ${op.aFrente}` : ''}`
  }
  if (p.modo === 'mes') {
    const [y, m] = p.mes.split('-').map(Number)
    const nome = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    return op.granularidade === 'mensal' ? nome : `${nome}, dia a dia`
  }
  const f = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`
  const [a, b] = p.de <= p.ate ? [p.de, p.ate] : [p.ate, p.de]
  return `de ${f(a)} a ${f(b)}`
}

// Acha a faixa de uma data ('YYYY-MM-DD' ou timestamp ISO). Faixas em ordem.
export function indiceDaFaixa(faixas: Faixa[]) {
  const porChave = new Map(faixas.map((f, i) => [f.chave, i]))
  return (data: string | null | undefined): number => {
    if (!data) return -1
    const d = data.slice(0, 10)
    const direto = porChave.get(d) ?? porChave.get(d.slice(0, 7))
    if (direto !== undefined && faixas[direto].ini <= d && d < faixas[direto].fim) return direto
    for (let i = 0; i < faixas.length; i++) if (faixas[i].ini <= d && d < faixas[i].fim) return i
    return -1
  }
}

export function limitesDasFaixas(faixas: Faixa[]) {
  return { ini: faixas[0]?.ini ?? isoHoje(), fim: faixas[faixas.length - 1]?.fim ?? isoHoje() }
}
