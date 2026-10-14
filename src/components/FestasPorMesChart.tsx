import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Bar, CartesianGrid, Legend, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card } from './ui/Card'
import { supabase } from '../lib/supabaseClient'
import { useUnit, UNITS } from '../lib/UnitContext'

// Festas por mês, por unidade, com a linha do ano anterior para comparar.
// Dois modos:
//   • "Realizadas": pelo mês da festa (não conta canceladas).
//   • "Fechadas": pelo mês em que a festa foi cadastrada (vendas do mês),
//     contando todas as cadastradas — inclusive as que ainda estão em
//     orçamento e as que depois foram canceladas (aparecem no resumo).

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const CORES: Record<string, string> = { 'vila-operaria': '#6D28D9', 'sao-vicente': '#7CB92E' }

type Modo = 'realizadas' | 'fechadas'
interface Linha { event_date: string; created_at: string; unit_id: string; status: string }

export function FestasPorMesChart() {
  const { selectedUnit, unitDbIds, unitDbIdsLoading } = useUnit()
  const [rows, setRows] = useState<Linha[]>([])
  const anoAtual = new Date().getFullYear()
  const [ano, setAno] = useState(anoAtual)
  const [modo, setModo] = useState<Modo>('realizadas')

  useEffect(() => {
    if (unitDbIdsLoading) return
    supabase
      .from('reservations')
      .select('event_date, created_at, unit_id, status')
      .order('event_date')
      .then(({ data }) => setRows((data ?? []) as Linha[]))
  }, [unitDbIdsLoading])

  const slugById = useMemo(() => {
    const m: Record<string, string> = {}
    for (const s of Object.keys(unitDbIds)) m[unitDbIds[s].unitId] = s
    return m
  }, [unitDbIds])

  // Data que define o mês de cada festa no modo escolhido (cadastro no fuso
  // de quem está usando, que é o de Brasília).
  const datas = useMemo(
    () =>
      rows
        .filter((r) => modo === 'fechadas' || r.status !== 'cancelada')
        .map((r) => ({ ...r, ref: modo === 'realizadas' ? r.event_date : format(new Date(r.created_at), 'yyyy-MM-dd') })),
    [rows, modo],
  )

  const anos = useMemo(() => {
    const set = new Set<number>([anoAtual])
    for (const r of datas) set.add(Number(r.ref.slice(0, 4)))
    return Array.from(set).sort((a, b) => b - a)
  }, [datas, anoAtual])

  const unidades = selectedUnit === 'todas' ? UNITS.map((u) => u.id) : [selectedUnit]

  const { data, canceladas, orcamento } = useMemo(() => {
    const base = MESES.map((mes) => {
      const row: Record<string, number | string> = { mes, anterior: 0, total: 0 }
      for (const u of unidades) row[u] = 0
      return row
    })
    let canc = 0
    let orc = 0
    for (const r of datas) {
      const slug = slugById[r.unit_id]
      if (!slug || !unidades.includes(slug)) continue
      const y = Number(r.ref.slice(0, 4))
      const m = Number(r.ref.slice(5, 7)) - 1
      if (y === ano) {
        base[m][slug] = (base[m][slug] as number) + 1
        base[m].total = (base[m].total as number) + 1
        if (r.status === 'cancelada') canc++
        if (r.status === 'orcamento') orc++
      } else if (y === ano - 1) {
        base[m].anterior = (base[m].anterior as number) + 1
      }
    }
    return { data: base, canceladas: canc, orcamento: orc }
  }, [datas, slugById, unidades.join(','), ano])

  const totalAno = data.reduce((s, r) => s + (r.total as number), 0)
  const totalAnterior = data.reduce((s, r) => s + (r.anterior as number), 0)
  const melhorMes = data.reduce((best, r) => ((r.total as number) > (best.total as number) ? r : best), data[0])

  return (
    <Card
      title={modo === 'realizadas' ? 'Festas por mês — realizadas' : 'Festas por mês — fechadas (vendas)'}
      action={
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-line p-0.5" role="tablist">
            {([
              ['realizadas', 'Realizadas no mês'],
              ['fechadas', 'Fechadas no mês'],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={modo === k}
                onClick={() => setModo(k)}
                className={`px-2.5 h-7 rounded-md text-xs font-medium ${modo === k ? 'bg-purple text-white' : 'text-ink/70 hover:bg-paper'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <select value={ano} onChange={(e) => setAno(Number(e.target.value))} aria-label="Ano" className="border border-line rounded-lg px-2 py-1 text-xs">
            {anos.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      }
    >
      <p className="text-xs text-muted mb-3">
        {totalAno} festa{totalAno === 1 ? '' : 's'} {modo === 'realizadas' ? 'realizadas' : 'fechadas'} em {ano}
        {totalAnterior > 0 ? ` · ${totalAnterior} em ${ano - 1}` : ''}
        {totalAno > 0 ? ` · mês ${modo === 'realizadas' ? 'mais cheio' : 'que mais vendeu'}: ${melhorMes.mes} (${melhorMes.total})` : ''}
        {modo === 'realizadas'
          ? ' · conta pelo mês da festa, sem as canceladas'
          : ` · conta pelo mês em que a festa foi cadastrada, de qualquer data${canceladas > 0 ? ` · ${canceladas} depois cancelada${canceladas === 1 ? '' : 's'}` : ''}${orcamento > 0 ? ` · ${orcamento} ainda em orçamento` : ''}`}
      </p>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E2DBEE" vertical={false} />
          <XAxis dataKey="mes" tick={{ fontSize: 12, fill: '#6E6880' }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#6E6880' }} axisLine={false} tickLine={false} width={30} />
          <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#E2DBEE', fontSize: 13 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {unidades.map((u) => (
            <Bar key={u} dataKey={u} name={UNITS.find((x) => x.id === u)?.name ?? u} stackId="festas" fill={CORES[u] ?? '#6D28D9'} radius={[3, 3, 0, 0]} />
          ))}
          {totalAnterior > 0 && <Line type="monotone" dataKey="anterior" name={`${ano - 1} (total)`} stroke="#F2900C" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 2 }} />}
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  )
}
