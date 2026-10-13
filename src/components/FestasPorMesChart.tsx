import { useEffect, useMemo, useState } from 'react'
import { Bar, CartesianGrid, Legend, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card } from './ui/Card'
import { supabase } from '../lib/supabaseClient'
import { useUnit, UNITS } from '../lib/UnitContext'

// Quantidade de festas (não canceladas) em cada mês do ano escolhido, por
// unidade, com a linha do ano anterior para comparar.

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const CORES: Record<string, string> = { 'vila-operaria': '#6D28D9', 'sao-vicente': '#7CB92E' }

export function FestasPorMesChart() {
  const { selectedUnit, unitDbIds, unitDbIdsLoading } = useUnit()
  const [rows, setRows] = useState<{ event_date: string; unit_id: string }[]>([])
  const anoAtual = new Date().getFullYear()
  const [ano, setAno] = useState(anoAtual)

  useEffect(() => {
    if (unitDbIdsLoading) return
    supabase
      .from('reservations')
      .select('event_date, unit_id')
      .neq('status', 'cancelada')
      .order('event_date')
      .then(({ data }) => setRows((data ?? []) as { event_date: string; unit_id: string }[]))
  }, [unitDbIdsLoading])

  const slugById = useMemo(() => {
    const m: Record<string, string> = {}
    for (const s of Object.keys(unitDbIds)) m[unitDbIds[s].unitId] = s
    return m
  }, [unitDbIds])

  const anos = useMemo(() => {
    const set = new Set<number>([anoAtual])
    for (const r of rows) set.add(Number(r.event_date.slice(0, 4)))
    return Array.from(set).sort((a, b) => b - a)
  }, [rows, anoAtual])

  const unidades = selectedUnit === 'todas' ? UNITS.map((u) => u.id) : [selectedUnit]

  const data = useMemo(() => {
    const base = MESES.map((mes) => {
      const row: Record<string, number | string> = { mes, anterior: 0, total: 0 }
      for (const u of unidades) row[u] = 0
      return row
    })
    for (const r of rows) {
      const slug = slugById[r.unit_id]
      if (!slug || !unidades.includes(slug)) continue
      const y = Number(r.event_date.slice(0, 4))
      const m = Number(r.event_date.slice(5, 7)) - 1
      if (y === ano) {
        base[m][slug] = (base[m][slug] as number) + 1
        base[m].total = (base[m].total as number) + 1
      } else if (y === ano - 1) {
        base[m].anterior = (base[m].anterior as number) + 1
      }
    }
    return base
  }, [rows, slugById, unidades.join(','), ano])

  const totalAno = data.reduce((s, r) => s + (r.total as number), 0)
  const totalAnterior = data.reduce((s, r) => s + (r.anterior as number), 0)
  const melhorMes = data.reduce((best, r) => ((r.total as number) > (best.total as number) ? r : best), data[0])

  return (
    <Card
      title="Festas por mês"
      action={
        <select value={ano} onChange={(e) => setAno(Number(e.target.value))} aria-label="Ano" className="border border-line rounded-lg px-2 py-1 text-xs">
          {anos.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      }
    >
      <p className="text-xs text-muted mb-3">
        {totalAno} festa{totalAno === 1 ? '' : 's'} em {ano}
        {totalAnterior > 0 ? ` · ${totalAnterior} em ${ano - 1}` : ''}
        {totalAno > 0 ? ` · mês mais cheio: ${melhorMes.mes} (${melhorMes.total})` : ''}
        {' '}· não conta festas canceladas
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

