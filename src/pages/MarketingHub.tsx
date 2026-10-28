// Página Marketing: junta Tráfego e CAC e o Funil de conversão e acrescenta
// as análises para a equipe de marketing (ocupação, perfil das festas,
// financeiro voltado a vendas, clientes) e alertas automáticos.
// Tudo é calculado na tela a partir dos dados existentes — só leitura.
import { ReactNode, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { addDays, addMonths, differenceInCalendarDays, format, getDay, parseISO, startOfMonth } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { AlertTriangle, Lightbulb } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card } from '../components/ui/Card'
import { useAuth } from '../lib/AuthContext'
import { useUnit, UNITS } from '../lib/UnitContext'
import { supabase } from '../lib/supabaseClient'
import { brl, todayIso } from '../lib/format'
import { CLIENT_SOURCE_LABEL } from '../types'
import { Marketing } from './Marketing'
import { Funnel } from './Funnel'

// Mesmas cores das unidades nos outros gráficos do sistema.
const COR_UNIDADE: Record<string, string> = { 'vila-operaria': '#6D28D9', 'sao-vicente': '#7CB92E' }
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const DIAS_LONGO = ['domingos', 'segundas', 'terças', 'quartas', 'quintas', 'sextas', 'sábados']
const FECHADA = ['confirmada', 'sinal_pago', 'quitada']

interface Festa {
  id: string; unitId: string; slug: string; eventDate: string; startTime: string; cadastro: string; status: string
  tipo: string; convidados: number; idade: number | null; valorCheio: number; valorFirmado: number; devido: number
  pago: number; primeiroPagamento: string | null; tema: string | null; pacote: string | null
  canceladaEm: string | null; motivoCancelamento: string | null; devolvido: number
  extras: { nome: string; valor: number }[]; consumo: number
  clienteId: string | null; cliente: string; origem: string | null; bairro: string | null; cidade: string | null
}
interface Cliente { id: string; name: string; source: string | null; created_at: string; child_name: string | null; child_birthday: string | null; referred_by: string | null }
interface Visita { unit_id: string; scheduled_at: string; result: string | null; no_advance_reason: string | null; client_name: string }
interface Proposta { unit_id: string; status: string; decline_reason: string | null; created_at: string; client_name: string; total_value: number }

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)
const dm = (iso: string) => format(parseISO(iso), 'dd/MM')
const origemLabel = (s: string | null) => (s ? CLIENT_SOURCE_LABEL[s] ?? s : 'Não informado')

function contar<T>(lista: T[], chave: (x: T) => string | null | undefined) {
  const m = new Map<string, number>()
  for (const x of lista) {
    const k = (chave(x) ?? '').trim()
    if (!k) continue
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
}

function Tabela({ cab, linhas, vazio }: { cab: string[]; linhas: ReactNode[][]; vazio?: string }) {
  if (linhas.length === 0) return <p className="text-sm text-muted">{vazio ?? 'Sem dados no período.'}</p>
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-muted border-b border-line">{cab.map((c, i) => <th key={i} className={`pb-2 font-medium ${i > 0 ? 'text-right' : ''}`}>{c}</th>)}</tr>
      </thead>
      <tbody>
        {linhas.map((l, i) => (
          <tr key={i} className="border-b border-line last:border-0">{l.map((c, j) => <td key={j} className={`py-1.5 ${j > 0 ? 'text-right whitespace-nowrap' : ''}`}>{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  )
}

function Num({ titulo, valor, legenda }: { titulo: string; valor: string; legenda: string }) {
  return (
    <Card>
      <p className="text-xs text-muted">{titulo}</p>
      <p className="text-xl font-display font-semibold mt-1">{valor}</p>
      <p className="text-[11px] text-muted mt-1 leading-snug">{legenda}</p>
    </Card>
  )
}

type Aba = 'resumo' | 'ocupacao' | 'perfil' | 'financeiro' | 'clientes' | 'trafego' | 'funil'

export function MarketingHub() {
  const { can } = useAuth()
  const { selectedUnit, unitDbIds, unitDbIdsLoading } = useUnit()
  const [aba, setAba] = useState<Aba>(() => {
    const v = new URLSearchParams(window.location.search).get('aba') as Aba | null
    return v ?? 'resumo'
  })
  const [meses, setMeses] = useState(12)
  const [loading, setLoading] = useState(true)
  const [festas, setFestas] = useState<Festa[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [visitas, setVisitas] = useState<Visita[]>([])
  const [propostas, setPropostas] = useState<Proposta[]>([])
  const [semExtras, setSemExtras] = useState(false)

  const slugById = useMemo(() => {
    const m: Record<string, string> = {}
    for (const s of Object.keys(unitDbIds)) m[unitDbIds[s].unitId] = s
    return m
  }, [unitDbIds])

  useEffect(() => {
    if (unitDbIdsLoading) return
    ;(async () => {
      setLoading(true)
      const [r, c, v, p] = await Promise.all([
        supabase
          .from('reservations')
          .select('id, unit_id, event_date, start_time, created_at, status, event_type, guest_count, child_age, total_value, final_value, theme, cancelled_at, cancellation_reason, refund_amount, package:packages(name), client:clients(id, name, source, neighborhood, city), payments(amount, payment_date), reservation_extra_items(quantity, price_snapshot, extra_item:extra_items(name)), reservation_consumption(quantity, unit_price)'),
        supabase.from('clients').select('id, name, source, created_at, child_name, child_birthday, referred_by'),
        supabase.from('visits').select('unit_id, scheduled_at, result, no_advance_reason, client_name'),
        supabase.from('proposals').select('unit_id, status, decline_reason, created_at, client_name, total_value'),
      ])
      let dados = r.data as any[] | null
      if (r.error) {
        // Sem acesso aos extras/consumo da festa: carrega sem eles.
        setSemExtras(true)
        const r2 = await supabase
          .from('reservations')
          .select('id, unit_id, event_date, start_time, created_at, status, event_type, guest_count, child_age, total_value, final_value, theme, cancelled_at, cancellation_reason, refund_amount, package:packages(name), client:clients(id, name, source, neighborhood, city), payments(amount, payment_date)')
        dados = r2.data as any[] | null
      }
      setFestas(
        (dados ?? []).map((x) => {
          const extras = (x.reservation_extra_items ?? []).map((e: any) => ({ nome: e.extra_item?.name ?? 'Extra', valor: Number(e.quantity) * Number(e.price_snapshot) }))
          const consumo = (x.reservation_consumption ?? []).reduce((s: number, e: any) => s + Number(e.quantity) * Number(e.unit_price), 0)
          const pagamentos = (x.payments ?? []) as { amount: number; payment_date: string }[]
          const firmado = Number(x.final_value) || 0
          return {
            id: x.id, unitId: x.unit_id, slug: slugById[x.unit_id] ?? '', eventDate: x.event_date, startTime: String(x.start_time ?? '').slice(0, 5),
            cadastro: format(new Date(x.created_at), 'yyyy-MM-dd'), status: x.status, tipo: x.event_type ?? 'Outro',
            convidados: Number(x.guest_count) || 0, idade: x.child_age != null ? Number(x.child_age) : null,
            valorCheio: Number(x.total_value) || firmado, valorFirmado: firmado,
            devido: firmado + extras.reduce((s: number, e: { valor: number }) => s + e.valor, 0) + consumo,
            pago: pagamentos.reduce((s, y) => s + Number(y.amount), 0),
            primeiroPagamento: pagamentos.map((y) => y.payment_date).sort()[0] ?? null,
            tema: x.theme, pacote: x.package?.name ?? null,
            canceladaEm: x.cancelled_at ? format(new Date(x.cancelled_at), 'yyyy-MM-dd') : null,
            motivoCancelamento: x.cancellation_reason ?? null, devolvido: Number(x.refund_amount) || 0,
            extras, consumo,
            clienteId: x.client?.id ?? null, cliente: x.client?.name ?? '—', origem: x.client?.source ?? null,
            bairro: x.client?.neighborhood ?? null, cidade: x.client?.city ?? null,
          } as Festa
        }),
      )
      setClientes((c.data ?? []) as Cliente[])
      setVisitas((v.data ?? []) as Visita[])
      setPropostas(((p.data ?? []) as any[]).map((x) => ({ ...x, total_value: Number(x.total_value) || 0 })))
      setLoading(false)
    })()
  }, [unitDbIdsLoading, slugById])

  const hoje = todayIso()
  const inicio = format(startOfMonth(addMonths(parseISO(hoje), -(meses - 1))), 'yyyy-MM-dd')
  const unidades = selectedUnit === 'todas' ? UNITS.map((u) => u.id) : [selectedUnit]
  const nomeUnidade = (slug: string) => UNITS.find((u) => u.id === slug)?.name ?? slug
  const daUnidade = (f: { slug: string }) => unidades.includes(f.slug)
  const unitIdsSel = unidades.map((s) => unitDbIds[s]?.unitId).filter(Boolean) as string[]

  // Festas que valem como "vendidas": não canceladas e já com pagamento (confirmada/quitada).
  const ativas = useMemo(() => festas.filter((f) => f.status !== 'cancelada' && daUnidade(f)), [festas, selectedUnit])
  const fechadas = useMemo(() => ativas.filter((f) => FECHADA.includes(f.status)), [ativas])
  // Festas com data dentro do período (perfil e financeiro).
  const noPeriodo = useMemo(() => fechadas.filter((f) => f.eventDate >= inicio && f.eventDate <= hoje), [fechadas, inicio, hoje])
  // Vendas do período: cadastradas no período (antecedência, conversão).
  const vendidasNoPeriodo = useMemo(() => fechadas.filter((f) => f.cadastro >= inicio), [fechadas, inicio])

  // ---------- Ocupação ----------
  function ocupacaoMes(slug: string, mesIso: string) {
    const ini = parseISO(mesIso)
    const fim = addMonths(ini, 1)
    const dias = differenceInCalendarDays(fim, ini)
    const n = festas.filter((f) => f.slug === slug && f.status !== 'cancelada' && f.eventDate >= mesIso && f.eventDate < format(fim, 'yyyy-MM-dd')).length
    return { n, dias, pct: pct(n, dias) }
  }
  const mesesGrafico = useMemo(() => {
    const out: string[] = []
    for (let i = -(meses - 1); i <= 3; i++) out.push(format(startOfMonth(addMonths(parseISO(hoje), i)), 'yyyy-MM-dd'))
    return out
  }, [meses, hoje])
  const dadosOcupacao = mesesGrafico.map((m) => {
    const row: Record<string, string | number> = { mes: format(parseISO(m), 'MMM/yy', { locale: ptBR }) }
    for (const s of unidades) row[s] = ocupacaoMes(s, m).pct
    return row
  })

  function ocupacaoDiaSemana(slug: string, de: string, ate: string) {
    const totais = Array(7).fill(0)
    const ocupados = Array(7).fill(0)
    for (let d = parseISO(de); format(d, 'yyyy-MM-dd') <= ate; d = addDays(d, 1)) totais[getDay(d)]++
    for (const f of festas) if (f.slug === slug && f.status !== 'cancelada' && f.eventDate >= de && f.eventDate <= ate) ocupados[getDay(parseISO(f.eventDate))]++
    return totais.map((t, i) => ({ dia: DIAS[i], n: ocupados[i], total: t, pct: pct(ocupados[i], t) }))
  }
  const dadosDiaSemana = DIAS.map((d, i) => {
    const row: Record<string, string | number> = { dia: d }
    for (const s of unidades) row[s] = ocupacaoDiaSemana(s, inicio, hoje)[i].pct
    return row
  })

  const datasLivres = useMemo(() => {
    const out: Record<string, string[]> = {}
    for (const s of unidades) {
      const ocupadas = new Set(festas.filter((f) => f.slug === s && f.status !== 'cancelada').map((f) => f.eventDate))
      const lista: string[] = []
      for (let i = 1; i <= 60; i++) {
        const d = addDays(parseISO(hoje), i)
        const iso = format(d, 'yyyy-MM-dd')
        if ([5, 6, 0].includes(getDay(d)) && !ocupadas.has(iso)) lista.push(iso)
      }
      out[s] = lista
    }
    return out
  }, [festas, selectedUnit, hoje])

  const antecedencias = vendidasNoPeriodo.map((f) => Math.max(0, differenceInCalendarDays(parseISO(f.eventDate), parseISO(f.cadastro))))
  const antecedenciaMedia = antecedencias.length ? Math.round(antecedencias.reduce((s, x) => s + x, 0) / antecedencias.length) : 0
  const faixasAntecedencia = [
    ['Menos de 30 dias', antecedencias.filter((x) => x < 30).length],
    ['30 a 90 dias', antecedencias.filter((x) => x >= 30 && x < 90).length],
    ['90 a 180 dias', antecedencias.filter((x) => x >= 90 && x < 180).length],
    ['Mais de 180 dias', antecedencias.filter((x) => x >= 180).length],
  ] as const

  const horarios = [
    ['Manhã (antes das 12h)', ativas.filter((f) => f.eventDate >= inicio && f.startTime && f.startTime < '12:00').length],
    ['Tarde (12h às 17h)', ativas.filter((f) => f.eventDate >= inicio && f.startTime >= '12:00' && f.startTime < '17:00').length],
    ['Noite (17h ou depois)', ativas.filter((f) => f.eventDate >= inicio && f.startTime >= '17:00').length],
  ] as const

  const sazonalidade = useMemo(() => {
    const porMes = Array(12).fill(0)
    for (const f of ativas) porMes[Number(f.eventDate.slice(5, 7)) - 1]++
    return porMes
  }, [ativas])

  // ---------- Clientes / conversão ----------
  const clientesComFesta = useMemo(() => {
    const m = new Map<string, Festa[]>()
    for (const f of festas.filter(daUnidade)) if (f.clienteId) m.set(f.clienteId, [...(m.get(f.clienteId) ?? []), f])
    return m
  }, [festas, selectedUnit])

  const conversaoPorOrigem = useMemo(() => {
    const grupos = new Map<string, { clientes: number; fecharam: number; faturamento: number; diasAteFechar: number[] }>()
    for (const c of clientes.filter((x) => format(new Date(x.created_at), 'yyyy-MM-dd') >= inicio)) {
      const k = c.source ?? '__sem__'
      const g = grupos.get(k) ?? { clientes: 0, fecharam: 0, faturamento: 0, diasAteFechar: [] }
      g.clientes++
      const fs = (clientesComFesta.get(c.id) ?? []).filter((f) => FECHADA.includes(f.status))
      if (fs.length > 0) {
        g.fecharam++
        g.faturamento += fs.reduce((s, f) => s + f.devido, 0)
        const primeiro = fs.map((f) => f.primeiroPagamento ?? f.cadastro).sort()[0]
        g.diasAteFechar.push(Math.max(0, differenceInCalendarDays(parseISO(primeiro), new Date(c.created_at))))
      }
      grupos.set(k, g)
    }
    return Array.from(grupos.entries()).map(([k, g]) => ({ origem: k === '__sem__' ? null : k, ...g, taxa: pct(g.fecharam, g.clientes) })).sort((a, b) => b.clientes - a.clientes)
  }, [clientes, clientesComFesta, inicio])

  const segmentos = useMemo(() => {
    let realizaram = 0, futura = 0, soOrcamento = 0, recorrentes = 0, semFesta = 0
    for (const c of clientes) {
      const fs = clientesComFesta.get(c.id) ?? []
      const fech = fs.filter((f) => FECHADA.includes(f.status))
      if (fech.some((f) => f.eventDate < hoje)) realizaram++
      if (fech.some((f) => f.eventDate >= hoje)) futura++
      if (fech.length === 0 && fs.some((f) => f.status === 'orcamento')) soOrcamento++
      if (fech.length >= 2) recorrentes++
      if (fs.length === 0) semFesta++
    }
    const naoFecharam = visitas.filter((v) => unitIdsSel.includes(v.unit_id) && v.result === 'nao_avancou').length
    const propostasAbertas = propostas.filter((p) => unitIdsSel.includes(p.unit_id) && p.status === 'enviada').length
    return { realizaram, futura, soOrcamento, recorrentes, semFesta, naoFecharam, propostasAbertas }
  }, [clientes, clientesComFesta, visitas, propostas, hoje, selectedUnit])

  const motivosPerda = useMemo(() => {
    const vis = contar(visitas.filter((v) => unitIdsSel.includes(v.unit_id) && v.result === 'nao_avancou' && v.scheduled_at.slice(0, 10) >= inicio), (v) => v.no_advance_reason)
    const prop = contar(propostas.filter((p) => unitIdsSel.includes(p.unit_id) && p.status === 'recusada' && p.created_at.slice(0, 10) >= inicio), (p) => p.decline_reason)
    const canc = contar(festas.filter((f) => daUnidade(f) && f.status === 'cancelada' && (f.canceladaEm ?? f.eventDate) >= inicio), (f) => f.motivoCancelamento)
    return { vis, prop, canc }
  }, [visitas, propostas, festas, inicio, selectedUnit])

  const indicadores = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of clientes) if (c.referred_by) m.set(c.referred_by, (m.get(c.referred_by) ?? 0) + 1)
    return Array.from(m.entries()).map(([id, n]) => ({ nome: clientes.find((c) => c.id === id)?.name ?? '—', n })).sort((a, b) => b.n - a.n).slice(0, 10)
  }, [clientes])

  const aniversariosChegando = useMemo(() => {
    const out: { cliente: string; crianca: string | null; data: string }[] = []
    for (const c of clientes) {
      if (!c.child_birthday) continue
      const nasc = parseISO(c.child_birthday)
      let prox = new Date(parseISO(hoje).getFullYear(), nasc.getMonth(), nasc.getDate())
      if (format(prox, 'yyyy-MM-dd') < hoje) prox = new Date(prox.getFullYear() + 1, nasc.getMonth(), nasc.getDate())
      const dias = differenceInCalendarDays(prox, parseISO(hoje))
      if (dias < 30 || dias > 90) continue
      const temFesta = (clientesComFesta.get(c.id) ?? []).some((f) => f.status !== 'cancelada' && f.eventDate >= hoje)
      if (!temFesta) out.push({ cliente: c.name, crianca: c.child_name, data: format(prox, 'yyyy-MM-dd') })
    }
    return out.sort((a, b) => a.data.localeCompare(b.data))
  }, [clientes, clientesComFesta, hoje])

  // ---------- Financeiro ----------
  const ticketPorPacote = useMemo(() => {
    const m = new Map<string, { n: number; soma: number }>()
    for (const f of noPeriodo) {
      const k = f.pacote ?? 'Sem pacote'
      const g = m.get(k) ?? { n: 0, soma: 0 }
      g.n++
      g.soma += f.devido
      m.set(k, g)
    }
    return Array.from(m.entries()).map(([k, g]) => ({ pacote: k, n: g.n, ticket: g.soma / g.n })).sort((a, b) => b.n - a.n)
  }, [noPeriodo])
  const extrasPorItem = contar(noPeriodo.flatMap((f) => f.extras.map((e) => ({ ...e }))), (e) => e.nome).map(([nome, n]) => ({
    nome, n, valor: noPeriodo.flatMap((f) => f.extras).filter((e) => e.nome === nome).reduce((s, e) => s + e.valor, 0),
  })).sort((a, b) => b.valor - a.valor)
  const totalExtras = noPeriodo.reduce((s, f) => s + f.extras.reduce((t, e) => t + e.valor, 0), 0)
  const totalConsumo = noPeriodo.reduce((s, f) => s + f.consumo, 0)
  const faturamento = noPeriodo.reduce((s, f) => s + f.devido, 0)
  const comDesconto = noPeriodo.filter((f) => f.valorCheio - f.valorFirmado > 0.009)
  const totalDesconto = comDesconto.reduce((s, f) => s + (f.valorCheio - f.valorFirmado), 0)
  const valorCheioTotal = noPeriodo.reduce((s, f) => s + f.valorCheio, 0)
  const inadimplentes = fechadas.filter((f) => f.eventDate < hoje && f.devido - f.pago > 0.009)
  const canceladasPeriodo = festas.filter((f) => daUnidade(f) && f.status === 'cancelada' && (f.canceladaEm ?? f.eventDate) >= inicio)
  const multaRetida = canceladasPeriodo.reduce((s, f) => s + Math.max(0, f.pago - f.devolvido), 0)

  // ---------- Alertas automáticos ----------
  const alertas = useMemo(() => {
    const out: { tipo: 'alerta' | 'dica'; texto: ReactNode }[] = []
    // Ocupação dos fins de semana nos próximos 3 meses
    for (const s of unidades) {
      for (let i = 0; i < 3; i++) {
        const mes = startOfMonth(addMonths(parseISO(hoje), i))
        const fim = addMonths(mes, 1)
        for (const dia of [6, 0, 5]) {
          let total = 0, ocup = 0
          for (let d = mes; d < fim; d = addDays(d, 1)) {
            const iso = format(d, 'yyyy-MM-dd')
            if (getDay(d) !== dia || iso <= hoje) continue
            total++
            if (festas.some((f) => f.slug === s && f.status !== 'cancelada' && f.eventDate === iso)) ocup++
          }
          if (total >= 2 && pct(ocup, total) < 50) {
            out.push({ tipo: 'alerta', texto: <>{DIAS_LONGO[dia].charAt(0).toUpperCase() + DIAS_LONGO[dia].slice(1)} de {format(mes, 'MMMM', { locale: ptBR })} em {nomeUnidade(s)} estão com <strong>{pct(ocup, total)}% de ocupação</strong> ({ocup} de {total} datas). Bom momento para promoção.</> })
          }
        }
      }
    }
    // Conversão por origem
    const validas = conversaoPorOrigem.filter((g) => g.origem && g.clientes >= 3)
    if (validas.length >= 2) {
      const ord = [...validas].sort((a, b) => b.taxa - a.taxa)
      const melhor = ord[0], pior = ord[ord.length - 1]
      if (melhor.taxa - pior.taxa >= 15) {
        out.push({ tipo: 'dica', texto: <>Clientes vindos de <strong>{origemLabel(melhor.origem)}</strong> fecham {melhor.taxa}% ({melhor.fecharam} de {melhor.clientes}); os de <strong>{origemLabel(pior.origem)}</strong>, só {pior.taxa}% ({pior.fecharam} de {pior.clientes}).</> })
      }
    }
    const semOrigem = conversaoPorOrigem.find((g) => !g.origem)
    if (semOrigem && semOrigem.clientes > 0) {
      out.push({ tipo: 'dica', texto: <>{semOrigem.clientes} cliente(s) cadastrado(s) no período estão sem origem ("como conheceu a gente"). Agora o campo é obrigatório, mas os antigos não entram na análise por canal.</> })
    }
    // Orçamentos parados
    const parados = festas.filter((f) => daUnidade(f) && f.status === 'orcamento' && f.pago <= 0 && f.eventDate >= hoje && differenceInCalendarDays(parseISO(hoje), parseISO(f.cadastro)) > 5)
    if (parados.length > 0) out.push({ tipo: 'alerta', texto: <><strong>{parados.length} orçamento(s) parado(s)</strong> há mais de 5 dias sem pagamento: {parados.slice(0, 5).map((f) => f.cliente).join(', ')}{parados.length > 5 ? '…' : ''}.</> })
    const propParadas = propostas.filter((p) => unitIdsSel.includes(p.unit_id) && p.status === 'enviada' && differenceInCalendarDays(parseISO(hoje), parseISO(p.created_at.slice(0, 10))) > 5)
    if (propParadas.length > 0) out.push({ tipo: 'alerta', texto: <><strong>{propParadas.length} proposta(s) enviada(s)</strong> há mais de 5 dias sem resposta: {propParadas.slice(0, 5).map((p) => p.client_name).join(', ')}{propParadas.length > 5 ? '…' : ''}.</> })
    // Aniversários chegando
    if (aniversariosChegando.length > 0) out.push({ tipo: 'dica', texto: <><strong>{aniversariosChegando.length} cliente(s)</strong> com criança fazendo aniversário em 1 a 3 meses e sem festa marcada. <Link to="/reativacao" className="text-purple underline">Abrir Reativação</Link>.</> })
    // Inadimplência
    if (inadimplentes.length > 0) out.push({ tipo: 'alerta', texto: <><strong>{inadimplentes.length} festa(s) já realizada(s)</strong> ainda com saldo em aberto: {brl(inadimplentes.reduce((s, f) => s + f.devido - f.pago, 0))}.</> })
    // Descontos
    if (valorCheioTotal > 0 && pct(totalDesconto, valorCheioTotal) >= 5) out.push({ tipo: 'dica', texto: <>Descontos somaram <strong>{brl(totalDesconto)}</strong> ({pct(totalDesconto, valorCheioTotal)}% do valor cheio) nas festas do período.</> })
    // Antecedência
    if (antecedencias.length >= 5) {
      const curtas = antecedencias.filter((x) => x < 30).length
      if (pct(curtas, antecedencias.length) >= 40) out.push({ tipo: 'dica', texto: <>{pct(curtas, antecedencias.length)}% das festas foram fechadas com menos de 30 dias de antecedência: campanhas de "última hora" podem funcionar.</> })
    }
    return out
  }, [festas, propostas, conversaoPorOrigem, aniversariosChegando, inadimplentes, totalDesconto, valorCheioTotal, antecedencias, hoje, selectedUnit])

  const abas: [Aba, string][] = [
    ['resumo', 'Resumo e alertas'],
    ['ocupacao', 'Ocupação e calendário'],
    ['perfil', 'Perfil das festas'],
    ['financeiro', 'Financeiro de vendas'],
    ['clientes', 'Clientes e canais'],
    ['trafego', 'Tráfego e CAC'],
    ...(can('page:funil') ? ([['funil', 'Funil de conversão']] as [Aba, string][]) : []),
  ]
  const usaPeriodo = !['trafego', 'funil'].includes(aba)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Marketing</h1>
          <p className="text-sm text-muted mt-1">Ocupação, perfil das festas, vendas, canais e alertas para a equipe de marketing</p>
        </div>
        {usaPeriodo && (
          <label className="text-sm flex items-center gap-2">
            <span className="text-muted">Período</span>
            <select value={meses} onChange={(e) => setMeses(Number(e.target.value))} className="h-9 rounded-lg border border-line bg-surface px-2 text-sm">
              {[3, 6, 12, 24].map((m) => <option key={m} value={m}>Últimos {m} meses</option>)}
            </select>
          </label>
        )}
      </div>

      <div className="flex flex-wrap rounded-xl border border-line bg-surface p-1 gap-1" role="tablist">
        {abas.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={aba === k} onClick={() => setAba(k)} className={`px-3 h-9 rounded-lg text-sm font-medium ${aba === k ? 'bg-purple text-white' : 'text-ink/70 hover:bg-paper'}`}>
            {label}
          </button>
        ))}
      </div>

      {aba === 'trafego' && <Marketing />}
      {aba === 'funil' && <Funnel />}

      {usaPeriodo && loading && <Card><p className="text-sm text-muted py-6 text-center">Carregando...</p></Card>}

      {usaPeriodo && !loading && (
        <>
          {semExtras && <p className="text-xs text-amber">Seu perfil não tem acesso aos extras e ao consumo das festas: esses valores ficam de fora.</p>}

          {aba === 'resumo' && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Num titulo="Festas vendidas" valor={String(vendidasNoPeriodo.length)} legenda="Festas cadastradas no período que já têm pagamento (não canceladas)." />
                <Num titulo="Ticket médio" valor={brl(noPeriodo.length ? faturamento / noPeriodo.length : 0)} legenda="Valor médio das festas realizadas no período (contrato + extras + consumo)." />
                <Num titulo="Antecedência média" valor={`${antecedenciaMedia} dias`} legenda="Entre o cadastro da festa e a data dela, nas vendas do período." />
                <Num titulo="Ocupação do período" valor={`${pct(festas.filter((f) => daUnidade(f) && f.status !== 'cancelada' && f.eventDate >= inicio && f.eventDate <= hoje).length, Math.max(1, differenceInCalendarDays(parseISO(hoje), parseISO(inicio)) + 1) * unidades.length)}%`} legenda="Dias com festa ÷ dias do período (uma festa por dia por unidade)." />
              </div>
              <Card title="Alertas e ideias automáticas">
                {alertas.length === 0 ? (
                  <p className="text-sm text-muted">Nada para destacar agora.</p>
                ) : (
                  <ul className="space-y-2">
                    {alertas.map((a, i) => (
                      <li key={i} className={`text-sm rounded-lg px-3 py-2 flex items-start gap-2 ${a.tipo === 'alerta' ? 'bg-amber-light' : 'bg-purple-light/50'}`}>
                        {a.tipo === 'alerta' ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber" /> : <Lightbulb className="w-4 h-4 mt-0.5 shrink-0 text-purple" />}
                        <span>{a.texto}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card title="Comparativo entre as unidades">
                  <Tabela
                    cab={['', ...UNITS.map((u) => u.name)]}
                    linhas={[
                      ['Festas realizadas no período', ...UNITS.map((u) => String(festas.filter((f) => f.slug === u.id && FECHADA.includes(f.status) && f.eventDate >= inicio && f.eventDate <= hoje).length))],
                      ['Ticket médio', ...UNITS.map((u) => { const fs = festas.filter((f) => f.slug === u.id && FECHADA.includes(f.status) && f.eventDate >= inicio && f.eventDate <= hoje); return brl(fs.length ? fs.reduce((s, f) => s + f.devido, 0) / fs.length : 0) })],
                      ['Convidados por festa', ...UNITS.map((u) => { const fs = festas.filter((f) => f.slug === u.id && FECHADA.includes(f.status) && f.eventDate >= inicio && f.eventDate <= hoje); return String(fs.length ? Math.round(fs.reduce((s, f) => s + f.convidados, 0) / fs.length) : 0) })],
                      ['Já vendidas para os próximos 3 meses', ...UNITS.map((u) => String(festas.filter((f) => f.slug === u.id && FECHADA.includes(f.status) && f.eventDate > hoje && f.eventDate < format(addMonths(parseISO(hoje), 3), 'yyyy-MM-dd')).length))],
                    ]}
                  />
                </Card>
                <Card title="Aniversários chegando (1 a 3 meses, sem festa marcada)">
                  <Tabela cab={['Cliente', 'Criança', 'Aniversário']} linhas={aniversariosChegando.slice(0, 12).map((a) => [a.cliente, a.crianca ?? '—', dm(a.data)])} vazio="Nenhum no momento." />
                  {aniversariosChegando.length > 12 && <p className="text-[11px] text-muted mt-2">+ {aniversariosChegando.length - 12} — veja todos em <Link to="/reativacao" className="text-purple underline">Reativação</Link>.</p>}
                </Card>
              </div>
            </>
          )}

          {aba === 'ocupacao' && (
            <>
              <Card title="Ocupação por mês (inclui os próximos 3 meses)">
                <p className="text-[11px] text-muted mb-2">% dos dias do mês com festa em cada unidade (uma festa por dia).</p>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={dadosOcupacao} barGap={2}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2DBEE" vertical={false} />
                    <XAxis dataKey="mes" tick={{ fontSize: 11, fill: '#6E6880' }} axisLine={false} tickLine={false} />
                    <YAxis unit="%" tick={{ fontSize: 11, fill: '#6E6880' }} axisLine={false} tickLine={false} width={40} />
                    <Tooltip formatter={(v: number) => `${v}%`} contentStyle={{ borderRadius: 8, borderColor: '#E2DBEE', fontSize: 13 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {unidades.map((s) => <Bar key={s} dataKey={s} name={nomeUnidade(s)} fill={COR_UNIDADE[s] ?? '#6D28D9'} radius={[4, 4, 0, 0]} />)}
                  </BarChart>
                </ResponsiveContainer>
              </Card>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card title="Ocupação por dia da semana (no período)">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={dadosDiaSemana} barGap={2}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2DBEE" vertical={false} />
                      <XAxis dataKey="dia" tick={{ fontSize: 11, fill: '#6E6880' }} axisLine={false} tickLine={false} />
                      <YAxis unit="%" tick={{ fontSize: 11, fill: '#6E6880' }} axisLine={false} tickLine={false} width={40} />
                      <Tooltip formatter={(v: number) => `${v}%`} contentStyle={{ borderRadius: 8, borderColor: '#E2DBEE', fontSize: 13 }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      {unidades.map((s) => <Bar key={s} dataKey={s} name={nomeUnidade(s)} fill={COR_UNIDADE[s] ?? '#6D28D9'} radius={[4, 4, 0, 0]} />)}
                    </BarChart>
                  </ResponsiveContainer>
                  <Tabela cab={['Dia', ...unidades.map(nomeUnidade)]} linhas={DIAS.map((d, i) => [d, ...unidades.map((s) => { const o = ocupacaoDiaSemana(s, inicio, hoje)[i]; return `${o.pct}% (${o.n} de ${o.total})` })])} />
                </Card>
                <Card title="Datas livres de sexta a domingo (próximos 60 dias)">
                  <p className="text-[11px] text-muted mb-2">Onde vale fazer promoção.</p>
                  {unidades.map((s) => (
                    <div key={s} className="mb-3">
                      <p className="text-sm font-semibold">{nomeUnidade(s)} · {datasLivres[s]?.length ?? 0} datas</p>
                      <p className="text-sm text-muted">{(datasLivres[s] ?? []).map((d) => `${DIAS[getDay(parseISO(d))]} ${dm(d)}`).join(' · ') || 'Nenhuma: tudo ocupado.'}</p>
                    </div>
                  ))}
                </Card>
                <Card title="Antecedência de reserva">
                  <p className="text-sm mb-2">Média: <strong>{antecedenciaMedia} dias</strong> entre o cadastro e a festa (vendas do período).</p>
                  <Tabela cab={['Antecedência', 'Festas', '%']} linhas={faixasAntecedencia.map(([l, n]) => [l, String(n), `${pct(n, antecedencias.length)}%`])} />
                </Card>
                <Card title="Horário das festas (no período)">
                  <Tabela cab={['Horário de início', 'Festas']} linhas={horarios.map(([l, n]) => [l, String(n)])} />
                </Card>
                <Card title="Sazonalidade: festas por mês do ano (todo o histórico)">
                  <Tabela cab={['Mês', 'Festas']} linhas={sazonalidade.map((n, i) => [format(new Date(2026, i, 1), 'MMMM', { locale: ptBR }), String(n)])} />
                  <p className="text-[11px] text-muted mt-2">Mais forte: {format(new Date(2026, sazonalidade.indexOf(Math.max(...sazonalidade)), 1), 'MMMM', { locale: ptBR })} · mais fraco: {format(new Date(2026, sazonalidade.indexOf(Math.min(...sazonalidade)), 1), 'MMMM', { locale: ptBR })}.</p>
                </Card>
              </div>
            </>
          )}

          {aba === 'perfil' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card title="Tipo de evento"><Tabela cab={['Tipo', 'Festas', '%']} linhas={contar(noPeriodo, (f) => f.tipo).map(([k, n]) => [k, String(n), `${pct(n, noPeriodo.length)}%`])} /></Card>
              <Card title="Idade do aniversariante">
                <Tabela
                  cab={['Faixa', 'Festas', '%']}
                  linhas={([['Até 2 anos', 0, 2], ['3 a 5 anos', 3, 5], ['6 a 8 anos', 6, 8], ['9 a 12 anos', 9, 12], ['13 anos ou mais', 13, 200]] as [string, number, number][])
                    .map(([l, a, b]) => { const n = noPeriodo.filter((f) => f.idade != null && f.idade >= a && f.idade <= b).length; return [l, String(n), `${pct(n, noPeriodo.length)}%`] })
                    .concat([['Sem idade informada', String(noPeriodo.filter((f) => f.idade == null).length), '']])}
                />
              </Card>
              <Card title="Convidados">
                <p className="text-sm">Média de <strong>{noPeriodo.length ? Math.round(noPeriodo.reduce((s, f) => s + f.convidados, 0) / noPeriodo.length) : 0} convidados</strong> por festa no período.</p>
              </Card>
              <Card title="Pacotes mais vendidos"><Tabela cab={['Pacote', 'Festas', 'Ticket médio']} linhas={ticketPorPacote.slice(0, 12).map((p) => [p.pacote, String(p.n), brl(p.ticket)])} /></Card>
              <Card title="Temas mais pedidos"><Tabela cab={['Tema', 'Festas']} linhas={contar(noPeriodo, (f) => f.tema?.toLowerCase().replace(/^\w/, (c) => c.toUpperCase())).slice(0, 12).map(([k, n]) => [k, String(n)])} /></Card>
              <Card title="De onde vêm os clientes (bairro e cidade)">
                <Tabela cab={['Bairro', 'Festas']} linhas={contar(noPeriodo, (f) => f.bairro).slice(0, 10).map(([k, n]) => [k, String(n)])} vazio="Bairro não informado nos cadastros." />
                <div className="mt-3"><Tabela cab={['Cidade', 'Festas']} linhas={contar(noPeriodo, (f) => f.cidade).slice(0, 6).map(([k, n]) => [k, String(n)])} vazio="Cidade não informada nos cadastros." /></div>
              </Card>
            </div>
          )}

          {aba === 'financeiro' && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Num titulo="Faturamento das festas" valor={brl(faturamento)} legenda={`${noPeriodo.length} festas realizadas no período (contrato + extras + consumo).`} />
                <Num titulo="Extras e consumo" valor={brl(totalExtras + totalConsumo)} legenda={`${pct(totalExtras + totalConsumo, faturamento)}% do faturamento: mostra onde há espaço para vender mais.`} />
                <Num titulo="Descontos concedidos" valor={brl(totalDesconto)} legenda={`${comDesconto.length} festa(s) com desconto · ${pct(totalDesconto, valorCheioTotal)}% do valor cheio.`} />
                <Num titulo="Cancelamentos" valor={String(canceladasPeriodo.length)} legenda={`Multa retida: ${brl(multaRetida)}.`} />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card title="Ticket médio por unidade">
                  <Tabela cab={['Unidade', 'Festas', 'Ticket médio']} linhas={unidades.map((s) => { const fs = noPeriodo.filter((f) => f.slug === s); return [nomeUnidade(s), String(fs.length), brl(fs.length ? fs.reduce((t, f) => t + f.devido, 0) / fs.length : 0)] })} />
                </Card>
                <Card title="Ticket médio por pacote"><Tabela cab={['Pacote', 'Festas', 'Ticket médio']} linhas={ticketPorPacote.map((p) => [p.pacote, String(p.n), brl(p.ticket)])} /></Card>
                <Card title="Receita de extras vendidos">
                  <Tabela cab={['Extra', 'Vendas', 'Receita']} linhas={extrasPorItem.map((e) => [e.nome, String(e.n), brl(e.valor)])} vazio="Nenhum extra vendido nas festas do período." />
                  <p className="text-[11px] text-muted mt-2">Consumo cobrado à parte (ex.: chopp): {brl(totalConsumo)}.</p>
                </Card>
                <Card title="Inadimplência (festas já realizadas com saldo em aberto)">
                  <Tabela cab={['Cliente', 'Festa', 'Em aberto']} linhas={inadimplentes.slice(0, 15).map((f) => [<Link key={f.id} to={`/reservas/${f.id}`} className="text-purple hover:underline">{f.cliente}</Link>, dm(f.eventDate), brl(f.devido - f.pago)])} vazio="Nenhuma festa realizada com saldo em aberto." />
                </Card>
              </div>
            </>
          )}

          {aba === 'clientes' && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Num titulo="Já fizeram festa" valor={String(segmentos.realizaram)} legenda={`${segmentos.recorrentes} voltaram e fizeram 2 ou mais.`} />
                <Num titulo="Festa futura fechada" valor={String(segmentos.futura)} legenda="Clientes com festa paga ainda por acontecer." />
                <Num titulo="Só pediram orçamento" valor={String(segmentos.soOrcamento)} legenda={`Festa em orçamento sem pagamento · + ${segmentos.propostasAbertas} proposta(s) enviada(s) sem resposta.`} />
                <Num titulo="Visitaram e não fecharam" valor={String(segmentos.naoFecharam)} legenda="Visitas marcadas como &quot;não avançou&quot;." />
              </div>
              <Card title="Conversão por canal (clientes cadastrados no período)">
                <Tabela
                  cab={['Como conheceu', 'Clientes', 'Fecharam', 'Conversão', 'Faturamento', 'Dias até fechar']}
                  linhas={conversaoPorOrigem.map((g) => [
                    origemLabel(g.origem), String(g.clientes), String(g.fecharam), `${g.taxa}%`, brl(g.faturamento),
                    g.diasAteFechar.length ? `${[...g.diasAteFechar].sort((a, b) => a - b)[Math.floor(g.diasAteFechar.length / 2)]} dias` : '—',
                  ])}
                />
                <p className="text-[11px] text-muted mt-2">"Dias até fechar" = mediana entre o cadastro do cliente e o primeiro pagamento. O gasto com tráfego por canal não é separado no sistema (só o total do mês, na aba Tráfego e CAC).</p>
              </Card>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card title="Por que não fecharam (visitas)"><Tabela cab={['Motivo', 'Vezes']} linhas={motivosPerda.vis.slice(0, 8).map(([k, n]) => [k, String(n)])} vazio="Sem motivos registrados." /></Card>
                <Card title="Propostas recusadas"><Tabela cab={['Motivo', 'Vezes']} linhas={motivosPerda.prop.slice(0, 8).map(([k, n]) => [k, String(n)])} vazio="Sem motivos registrados." /></Card>
                <Card title="Motivos de cancelamento"><Tabela cab={['Motivo', 'Vezes']} linhas={motivosPerda.canc.slice(0, 8).map(([k, n]) => [k, String(n)])} vazio="Sem cancelamentos no período." /></Card>
              </div>
              <Card title="Clientes que mais indicam">
                <Tabela cab={['Cliente', 'Indicações']} linhas={indicadores.map((x) => [x.nome, String(x.n)])} vazio="Nenhuma indicação registrada (campo &quot;Indicado por&quot; no cadastro do cliente)." />
              </Card>
            </>
          )}
        </>
      )}
    </div>
  )
}
