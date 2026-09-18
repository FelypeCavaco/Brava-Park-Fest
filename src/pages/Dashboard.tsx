import { useEffect, useMemo, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { addDays, format, parseISO, differenceInCalendarDays, differenceInCalendarMonths } from 'date-fns'
import { AlertTriangle, Sparkles } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { DashboardMascot } from '../components/mascot/DashboardMascot'
import { QuickActionsBar } from '../components/layout/QuickActionsBar'
import { useUnit, UNITS } from '../lib/UnitContext'
import { supabase } from '../lib/supabaseClient'
import { currentMonthValue, monthBounds, lastNMonths, daysInMonth } from '../lib/monthUtils'
import { loadMonthByUnit, loadExpectedRemainingByUnit, type MonthResult } from '../lib/financeAggregates'

const CLOSED_STATUSES = ['confirmada', 'sinal_pago', 'quitada']

function currency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

interface SaldoPendente {
  id: string
  cliente: string
  data: string
  eventDateIso: string
  saldo: number
}

interface AtividadeEntry {
  id: string
  usuario: string
  acao: string
  quando: string
}

interface PendenciaFesta {
  id: string
  cliente: string
  data: string
  diasRestantes: number
  faltando: string[]
}

interface ReativacaoProxima {
  id: string
  cliente: string
  childName: string
  mesesFaltam: number
}

interface ContaAPagar {
  id: string
  descricao: string
  fornecedor: string | null
  valor: number
  vencimento: string
  diasParaVencer: number
  vencida: boolean
}

// Mesma lógica da tela de Reativação: próxima ocorrência do aniversário da
// criança a partir de hoje (já rolando pro ano que vem se já passou este ano).
function nextBirthdayOccurrence(birthdayIso: string, today: Date) {
  const bday = parseISO(birthdayIso)
  let next = new Date(today.getFullYear(), bday.getMonth(), bday.getDate())
  if (differenceInCalendarDays(next, today) < 0) {
    next = new Date(today.getFullYear() + 1, bday.getMonth(), bday.getDate())
  }
  return next
}

export function Dashboard() {
  const { selectedUnit, unitDbIds, unitDbIdsLoading } = useUnit()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const acessoNegado = searchParams.get('acesso_negado') === '1'
  const [loading, setLoading] = useState(true)
  const [byUnit, setByUnit] = useState<Record<string, MonthResult>>({})
  const [previstoByUnit, setPrevistoByUnit] = useState<Record<string, number>>({})
  const [festasConfirmadasByUnit, setFestasConfirmadasByUnit] = useState<Record<string, number>>({})
  const [ocupacaoByUnit, setOcupacaoByUnit] = useState<Record<string, number>>({})
  const [cacByUnit, setCacByUnit] = useState<Record<string, number>>({})
  const [faturamentoMensal, setFaturamentoMensal] = useState<Record<string, string | number>[]>([])
  const [saldosPendentes, setSaldosPendentes] = useState<SaldoPendente[]>([])
  const [atividade, setAtividade] = useState<AtividadeEntry[]>([])
  const [goalsByUnit, setGoalsByUnit] = useState<Record<string, number>>({})
  const [pendenciasFesta, setPendenciasFesta] = useState<PendenciaFesta[]>([])
  const [reativacoesProximas, setReativacoesProximas] = useState<ReativacaoProxima[]>([])
  const [contasAPagar, setContasAPagar] = useState<ContaAPagar[]>([])

  const unitIds = selectedUnit === 'todas' ? UNITS.map((u) => u.id) : [selectedUnit]
  const unitLabel = selectedUnit === 'todas' ? 'Ambas as unidades' : UNITS.find((u) => u.id === selectedUnit)?.name

  useEffect(() => {
    if (!unitDbIdsLoading) loadAll()
  }, [unitDbIdsLoading, unitDbIds])

  async function loadAll() {
    setLoading(true)
    // Garante que as despesas fixas do mês já viraram lançamento pendente,
    // mesmo que ninguém tenha aberto o Financeiro ainda este mês.
    await supabase.rpc('ensure_recurring_expenses_current_month')
    const unitIdBySlug: Record<string, string> = {}
    for (const u of UNITS) if (unitDbIds[u.id]) unitIdBySlug[u.id] = unitDbIds[u.id].unitId
    const slugByUnitId: Record<string, string> = {}
    for (const slug of Object.keys(unitIdBySlug)) slugByUnitId[unitIdBySlug[slug]] = slug

    const currentMonth = currentMonthValue()
    const { startIso, endIso } = monthBounds(currentMonth)

    const [monthData, { data: confirmedData }, { data: allMonthReservations }, { data: spendData }, { data: goalsData }] = await Promise.all([
      loadMonthByUnit(currentMonth, unitIdBySlug),
      supabase.from('reservations').select('id, unit_id').in('status', CLOSED_STATUSES).gte('event_date', startIso).lt('event_date', endIso),
      supabase.from('reservations').select('unit_id, event_date').neq('status', 'cancelada').gte('event_date', startIso).lt('event_date', endIso),
      supabase.from('marketing_spend').select('amount, unit_id').eq('month', startIso),
      supabase.from('unit_goals').select('unit_id, goal_amount').eq('month', startIso),
    ])
    setByUnit(monthData)

    const goalsBySlug: Record<string, number> = {}
    for (const g of goalsData ?? []) {
      const slug = slugByUnitId[g.unit_id]
      if (slug) goalsBySlug[slug] = Number(g.goal_amount)
    }
    setGoalsByUnit(goalsBySlug)

    const confirmadasBySlug: Record<string, number> = {}
    for (const r of confirmedData ?? []) {
      const slug = slugByUnitId[r.unit_id]
      if (slug) confirmadasBySlug[slug] = (confirmadasBySlug[slug] ?? 0) + 1
    }
    setFestasConfirmadasByUnit(confirmadasBySlug)

    const datesBySlug: Record<string, Set<string>> = {}
    for (const r of allMonthReservations ?? []) {
      const slug = slugByUnitId[r.unit_id]
      if (!slug) continue
      if (!datesBySlug[slug]) datesBySlug[slug] = new Set()
      datesBySlug[slug].add(r.event_date)
    }
    const totalDays = daysInMonth(currentMonth)
    const ocupacao: Record<string, number> = {}
    for (const slug of Object.keys(unitIdBySlug)) ocupacao[slug] = ((datesBySlug[slug]?.size ?? 0) / totalDays) * 100
    setOcupacaoByUnit(ocupacao)

    const spendBySlug: Record<string, number> = {}
    for (const s of spendData ?? []) {
      const slug = slugByUnitId[s.unit_id]
      if (slug) spendBySlug[slug] = (spendBySlug[slug] ?? 0) + Number(s.amount)
    }
    const cac: Record<string, number> = {}
    for (const slug of Object.keys(unitIdBySlug)) {
      const fechadas = confirmadasBySlug[slug] ?? 0
      cac[slug] = fechadas > 0 ? (spendBySlug[slug] ?? 0) / fechadas : 0
    }
    setCacByUnit(cac)

    const previsto: Record<string, number> = {}
    for (const slug of Object.keys(unitIdBySlug)) {
      previsto[slug] = await loadExpectedRemainingByUnit(currentMonth, { [slug]: unitIdBySlug[slug] })
    }
    setPrevistoByUnit(previsto)

    const months = lastNMonths(6)
    const history = await Promise.all(
      months.map(async ({ value, label }) => {
        const data = await loadMonthByUnit(value, unitIdBySlug)
        const entry: any = { mes: label }
        for (const slug of Object.keys(unitIdBySlug)) entry[slug] = data[slug]?.receita ?? 0
        return entry
      }),
    )
    setFaturamentoMensal(history)

    const in7days = format(addDays(new Date(), 7), 'yyyy-MM-dd')
    const today = format(new Date(), 'yyyy-MM-dd')
    const { data: upcoming } = await supabase
      .from('reservations')
      .select('id, event_date, unit_id, final_value, client:clients(name), payments(amount)')
      .in('unit_id', Object.values(unitIdBySlug))
      .neq('status', 'cancelada')
      .gte('event_date', today)
      .lte('event_date', in7days)
      .order('event_date')

    setSaldosPendentes(
      (upcoming ?? [])
        .map((r: any) => {
          const pago = (r.payments ?? []).reduce((s: number, p: any) => s + Number(p.amount), 0)
          return {
            id: r.id,
            cliente: r.client?.name ?? '—',
            data: format(parseISO(r.event_date), 'dd/MM'),
            eventDateIso: r.event_date,
            saldo: Number(r.final_value) - pago,
          }
        })
        .filter((r) => r.saldo > 0.005),
    )

    const in14days = format(addDays(new Date(), 14), 'yyyy-MM-dd')
    const { data: proximasFestas } = await supabase
      .from('reservations')
      .select('id, event_date, theme, child_name, child_age, hot_dish_flavors, cake_flavor, unit_id, client:clients(name)')
      .in('unit_id', Object.values(unitIdBySlug))
      .neq('status', 'cancelada')
      .gte('event_date', today)
      .lte('event_date', in14days)
      .order('event_date')

    setPendenciasFesta(
      (proximasFestas ?? [])
        .map((r: any) => {
          const faltando: string[] = []
          if (!r.theme) faltando.push('tema')
          if (!r.child_name) faltando.push('nome do aniversariante')
          if (r.child_age == null) faltando.push('idade')
          if (!r.hot_dish_flavors) faltando.push('sabor do prato quente')
          if (!r.cake_flavor) faltando.push('sabor do bolo')
          return {
            id: r.id,
            cliente: r.client?.name ?? '—',
            data: format(parseISO(r.event_date), 'dd/MM'),
            diasRestantes: differenceInCalendarDays(parseISO(r.event_date), new Date()),
            faltando,
          }
        })
        .filter((p) => p.faltando.length > 0),
    )

    const [{ data: reactivationClients }, { data: allReservations }] = await Promise.all([
      supabase.from('clients').select('id, name, child_name, child_birthday').not('child_birthday', 'is', null).neq('reactivation_status', 'sem_interesse'),
      supabase.from('reservations').select('client_id, event_date').neq('status', 'cancelada'),
    ])
    const reservationYearsByClient: Record<string, Set<number>> = {}
    for (const r of allReservations ?? []) {
      const year = parseISO(r.event_date).getFullYear()
      if (!reservationYearsByClient[r.client_id]) reservationYearsByClient[r.client_id] = new Set()
      reservationYearsByClient[r.client_id].add(year)
    }
    const hojeReativacao = new Date()
    setReativacoesProximas(
      (reactivationClients ?? [])
        .map((c) => {
          const proximo = nextBirthdayOccurrence(c.child_birthday as string, hojeReativacao)
          const mesesFaltam = differenceInCalendarMonths(proximo, hojeReativacao)
          const jaTemFesta = reservationYearsByClient[c.id]?.has(proximo.getFullYear()) ?? false
          return { id: c.id, cliente: c.name, childName: c.child_name ?? '', mesesFaltam, jaTemFesta }
        })
        .filter((c) => [1, 2, 3].includes(c.mesesFaltam) && !c.jaTemFesta)
        .sort((a, b) => a.mesesFaltam - b.mesesFaltam),
    )

    const { data: expensesData } = await supabase
      .from('expenses')
      .select('id, description, supplier, amount, due_date, unit_id')
      .in('status', ['a_vencer', 'atrasado'])
      .lte('due_date', in14days)
      .in('unit_id', Object.values(unitIdBySlug))
    setContasAPagar(
      (expensesData ?? [])
        .map((e) => ({
          id: e.id,
          descricao: e.description ?? e.supplier ?? 'Despesa',
          fornecedor: e.supplier,
          valor: Number(e.amount),
          vencimento: format(parseISO(e.due_date), 'dd/MM'),
          diasParaVencer: differenceInCalendarDays(parseISO(e.due_date), new Date()),
          vencida: e.due_date < today,
        }))
        .sort((a, b) => a.diasParaVencer - b.diasParaVencer),
    )

    const { data: auditData } = await supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(10)
    setAtividade(
      (auditData ?? []).map((a) => ({
        id: a.id,
        usuario: 'Alguém da equipe',
        acao: `${a.action} ${a.entity}`,
        quando: new Date(a.created_at).toLocaleString('pt-BR'),
      })),
    )

    setLoading(false)
  }

  const stats = useMemo(() => {
    let faturamentoRecebido = 0
    let faturamentoPrevisto = 0
    let festasConfirmadas = 0
    let ocupacaoSum = 0
    let cacSum = 0
    let ticketSum = 0
    for (const id of unitIds) {
      faturamentoRecebido += byUnit[id]?.receita ?? 0
      faturamentoPrevisto += previstoByUnit[id] ?? 0
      festasConfirmadas += festasConfirmadasByUnit[id] ?? 0
      ocupacaoSum += ocupacaoByUnit[id] ?? 0
      cacSum += cacByUnit[id] ?? 0
      ticketSum += byUnit[id]?.ticketMedio ?? 0
    }
    return {
      faturamentoRecebido,
      faturamentoPrevisto,
      festasConfirmadas,
      taxaOcupacao: unitIds.length > 0 ? ocupacaoSum / unitIds.length : 0,
      cacMedio: unitIds.length > 0 ? cacSum / unitIds.length : 0,
      ticketMedio: unitIds.length > 0 ? ticketSum / unitIds.length : 0,
    }
  }, [unitIds, byUnit, previstoByUnit, festasConfirmadasByUnit, ocupacaoByUnit, cacByUnit])

  const goalProgress = useMemo(
    () =>
      unitIds.map((id) => {
        const meta = goalsByUnit[id] ?? 0
        const atual = byUnit[id]?.receita ?? 0
        const pct = meta > 0 ? Math.min(100, (atual / meta) * 100) : 0
        return { id, name: UNITS.find((u) => u.id === id)?.name ?? id, meta, atual, pct, falta: Math.max(meta - atual, 0) }
      }),
    [unitIds, goalsByUnit, byUnit],
  )

  return (
    <div className="space-y-6">
      <DashboardMascot />
      {acessoNegado && (
        <div className="bg-amber-light text-amber text-sm rounded-lg px-4 py-2.5 flex items-center justify-between gap-3">
          Seu perfil não tem acesso a essa página.
          <button onClick={() => setSearchParams({}, { replace: true })} className="text-amber font-medium shrink-0">
            Ok
          </button>
        </div>
      )}
      <div>
        <h1 className="text-2xl font-semibold">Painel</h1>
        <p className="text-sm text-muted mt-1">{unitLabel} · mês atual</p>
      </div>

      <div>
        <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Ações rápidas</p>
        <QuickActionsBar size="large" />
      </div>

      {loading ? (
        <Card><p className="text-sm text-muted py-6 text-center">Carregando...</p></Card>
      ) : (
        <>
          {pendenciasFesta.length > 0 && (
            <Card className="border-amber/40 bg-amber-light">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-4 h-4 text-amber" />
                <p className="text-sm font-medium text-ink/80">
                  {pendenciasFesta.length} festa{pendenciasFesta.length > 1 ? 's' : ''} nos próximos 14 dias com detalhe pendente
                </p>
              </div>
              <ul className="divide-y divide-amber/20">
                {pendenciasFesta.map((p) => (
                  <li key={p.id} className="py-2.5 flex items-center justify-between gap-3">
                    <button onClick={() => navigate(`/reservas/${p.id}`)} className="text-left min-w-0">
                      <p className="text-sm font-medium truncate">{p.cliente} — {p.data}</p>
                      <p className="text-xs text-muted">
                        Falta: {p.faltando.join(', ')}
                      </p>
                    </button>
                    <Badge tone={p.diasRestantes <= 3 ? 'danger' : 'amber'}>
                      {p.diasRestantes === 0 ? 'É hoje' : p.diasRestantes === 1 ? 'Amanhã' : `${p.diasRestantes} dias`}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {contasAPagar.length > 0 && (
            <Card className={contasAPagar.some((c) => c.vencida) ? 'border-danger/50 bg-danger-light' : 'border-amber/40 bg-amber-light'}>
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className={`w-4 h-4 ${contasAPagar.some((c) => c.vencida) ? 'text-danger' : 'text-amber'}`} />
                <p className="text-sm font-medium text-ink/80">
                  {contasAPagar.length} conta{contasAPagar.length > 1 ? 's' : ''} a pagar nos próximos 14 dias
                </p>
              </div>
              <ul className="divide-y divide-line/60">
                {contasAPagar.map((c) => (
                  <li key={c.id} className="py-2.5 flex items-center justify-between gap-3">
                    <button onClick={() => navigate('/financeiro')} className="text-left min-w-0">
                      <p className="text-sm font-medium truncate">{c.descricao}{c.fornecedor ? ` — ${c.fornecedor}` : ''}</p>
                      <p className="text-xs text-muted">{currency(c.valor)} · vence {c.vencimento}</p>
                    </button>
                    <Badge tone={c.vencida ? 'danger' : 'amber'}>
                      {c.vencida ? 'Venceu' : c.diasParaVencer === 0 ? 'Vence hoje' : c.diasParaVencer === 1 ? 'Vence amanhã' : `${c.diasParaVencer} dias`}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {reativacoesProximas.length > 0 && (
            <Card className="border-purple/30 bg-purple-light">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-purple-dark" />
                <p className="text-sm font-medium text-purple-dark">
                  {reativacoesProximas.length} cliente{reativacoesProximas.length > 1 ? 's' : ''} com aniversário da criança chegando — bom momento para reativação
                </p>
              </div>
              <ul className="divide-y divide-purple/10">
                {reativacoesProximas.map((r) => (
                  <li key={r.id} className="py-2 flex items-center justify-between gap-3">
                    <button onClick={() => navigate('/reativacao')} className="text-left min-w-0">
                      <p className="text-sm font-medium truncate">{r.cliente}{r.childName ? ` — ${r.childName}` : ''}</p>
                    </button>
                    <Badge tone="purple">faltam {r.mesesFaltam} {r.mesesFaltam === 1 ? 'mês' : 'meses'}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Meta de faturamento do mês">
            <div className="space-y-4">
              {goalProgress.map((g) => (
                <div key={g.id}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium">{g.name}</span>
                    <span className="text-muted">
                      {currency(g.atual)} de {g.meta > 0 ? currency(g.meta) : 'meta não definida'}{' '}
                      {g.meta > 0 ? `(${g.pct.toFixed(0)}%)` : ''}
                    </span>
                  </div>
                  <div className="h-2.5 bg-paper rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${g.pct >= 100 ? 'bg-teal' : 'bg-purple'}`}
                      style={{ width: `${g.meta > 0 ? g.pct : 0}%` }}
                    />
                  </div>
                  {g.meta > 0 && g.falta > 0 && <p className="text-xs text-muted mt-1">Faltam {currency(g.falta)} para bater a meta</p>}
                </div>
              ))}
              {goalProgress.every((g) => g.meta === 0) && (
                <p className="text-sm text-muted">
                  Nenhuma meta definida ainda pra este mês — defina em "Relatórios e metas".
                </p>
              )}
            </div>
          </Card>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <p className="text-xs text-muted">Faturamento recebido</p>
              <p className="text-2xl font-display font-semibold mt-1">{currency(stats.faturamentoRecebido)}</p>
              <p className="text-xs text-muted mt-1">Ainda a receber: {currency(stats.faturamentoPrevisto)}</p>
            </Card>
            <Card>
              <p className="text-xs text-muted">Festas confirmadas</p>
              <p className="text-2xl font-display font-semibold mt-1">{stats.festasConfirmadas}</p>
              <p className="text-xs text-muted mt-1">neste mês</p>
            </Card>
            <Card>
              <p className="text-xs text-muted">Ocupação dos espaços</p>
              <p className="text-2xl font-display font-semibold mt-1">{Math.round(stats.taxaOcupacao)}%</p>
              <p className="text-xs text-muted mt-1">datas vendidas no mês</p>
            </Card>
            <Card>
              <p className="text-xs text-muted">CAC / Ticket médio</p>
              <p className="text-2xl font-display font-semibold mt-1">
                {currency(stats.cacMedio)} <span className="text-muted text-base font-sans">/ {currency(stats.ticketMedio)}</span>
              </p>
              <p className="text-xs text-muted mt-1">custo por cliente fechado</p>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card title="Faturamento recebido por unidade — últimos 6 meses" className="lg:col-span-2">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={faturamentoMensal}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2DBEE" vertical={false} />
                  <XAxis dataKey="mes" tick={{ fontSize: 12, fill: '#6E6880' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: '#6E6880' }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip
                    formatter={(value: number) => currency(value)}
                    contentStyle={{ borderRadius: 8, borderColor: '#E2DBEE', fontSize: 13 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="vila-operaria" name="Vila Operária" fill="#6D28D9" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="sao-vicente" name="São Vicente" fill="#7CB92E" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card title="Saldo em aberto (próximos 7 dias)">
              <ul className="divide-y divide-line">
                {saldosPendentes.map((p) => (
                  <li key={p.id} className="py-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{p.cliente}</p>
                      <p className="text-xs text-muted">Festa em {p.data}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">{currency(p.saldo)}</p>
                      <Badge tone="amber">saldo devedor</Badge>
                    </div>
                  </li>
                ))}
                {saldosPendentes.length === 0 && <p className="text-sm text-muted py-2">Nada em aberto essa semana.</p>}
              </ul>
            </Card>
          </div>

          <Card title="Atividade recente">
            <ul className="divide-y divide-line text-sm">
              {atividade.map((a) => (
                <li key={a.id} className="py-2.5 flex items-center justify-between">
                  <span>
                    <strong className="font-medium">{a.usuario}</strong> {a.acao}
                  </span>
                  <span className="text-xs text-muted shrink-0 ml-3">{a.quando}</span>
                </li>
              ))}
              {atividade.length === 0 && (
                <p className="text-sm text-muted py-2">
                  Nenhuma atividade registrada ainda — o registro automático de ações (quem fez o quê) é um passo futuro.
                </p>
              )}
            </ul>
          </Card>
        </>
      )}
    </div>
  )
}
