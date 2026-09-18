import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Download, Target } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { useUnit, UNITS } from '../lib/UnitContext'
import { supabase } from '../lib/supabaseClient'
import { currentMonthValue, addMonthsToValue, monthBounds } from '../lib/monthUtils'
import { loadMonthByUnit, loadExpectedRemainingByUnit, type MonthResult } from '../lib/financeAggregates'

function currency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';')).join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function Reports() {
  const { selectedUnit, unitDbIds, unitDbIdsLoading } = useUnit()
  const [loading, setLoading] = useState(true)
  const [goals, setGoals] = useState<Record<string, number>>({})
  const [byUnit, setByUnit] = useState<Record<string, MonthResult>>({})
  const [projecao, setProjecao] = useState<{ mes: string; valor: number }[]>([])
  const [goalInput, setGoalInput] = useState('')
  const [goalUnit, setGoalUnit] = useState(UNITS[0].id)
  const [exportLog, setExportLog] = useState<{ id: string; quando: string; usuario: string }[]>([])
  const [error, setError] = useState<string | null>(null)

  const unitIds = selectedUnit === 'todas' ? UNITS.map((u) => u.id) : [selectedUnit]
  const currentMonth = currentMonthValue()

  useEffect(() => {
    if (!unitDbIdsLoading) loadAll()
  }, [unitDbIdsLoading, unitDbIds])

  async function loadAll() {
    setLoading(true)
    const unitIdBySlug: Record<string, string> = {}
    for (const u of UNITS) if (unitDbIds[u.id]) unitIdBySlug[u.id] = unitDbIds[u.id].unitId

    const { startIso } = monthBounds(currentMonth)
    const [monthData, { data: goalsData, error: goalsErr }] = await Promise.all([
      loadMonthByUnit(currentMonth, unitIdBySlug),
      supabase.from('unit_goals').select('unit_id, goal_amount').eq('month', startIso),
    ])

    if (goalsErr) setError('Não foi possível carregar as metas.')

    setByUnit(monthData)

    const slugByUnitId: Record<string, string> = {}
    for (const slug of Object.keys(unitIdBySlug)) slugByUnitId[unitIdBySlug[slug]] = slug
    const goalsBySlug: Record<string, number> = {}
    for (const g of goalsData ?? []) {
      const slug = slugByUnitId[g.unit_id]
      if (slug) goalsBySlug[slug] = Number(g.goal_amount)
    }
    setGoals(goalsBySlug)

    const proj = await Promise.all(
      [1, 2, 3, 4].map(async (i) => {
        const value = addMonthsToValue(currentMonth, i)
        const valor = await loadExpectedRemainingByUnit(value, unitIdBySlug)
        const label = new Date(`${value}-01T00:00:00`).toLocaleDateString('pt-BR', { month: 'short' })
        return { mes: label.charAt(0).toUpperCase() + label.slice(1).replace('.', ''), valor }
      }),
    )
    setProjecao(proj)
    setLoading(false)
  }

  const goalProgress = useMemo(
    () =>
      unitIds.map((id) => {
        const meta = goals[id] ?? 0
        const atual = byUnit[id]?.receita ?? 0
        const pct = meta > 0 ? Math.min(100, (atual / meta) * 100) : 0
        return { id, name: UNITS.find((u) => u.id === id)?.name ?? id, meta, atual, pct, falta: Math.max(meta - atual, 0) }
      }),
    [unitIds, goals, byUnit],
  )

  const comparativo = useMemo(
    () =>
      unitIds.map((id) => {
        const r = byUnit[id] ?? { receita: 0, taxasCartao: 0, despesas: 0, custos: 0, festas: 0, ticketMedio: 0 }
        const despesasTotais = r.taxasCartao + r.despesas + r.custos
        return {
          id,
          name: UNITS.find((u) => u.id === id)?.name ?? id,
          faturamento: r.receita,
          despesas: despesasTotais,
          lucro: r.receita - despesasTotais,
          festas: r.festas,
          ticketMedio: r.ticketMedio,
        }
      }),
    [unitIds, byUnit],
  )

  async function handleSetGoal(e: FormEvent) {
    e.preventDefault()
    const value = Number(goalInput)
    const dbIds = unitDbIds[goalUnit]
    if (!value || !dbIds) return

    const { startIso } = monthBounds(currentMonth)
    const { error } = await supabase.from('unit_goals').upsert({ unit_id: dbIds.unitId, month: startIso, goal_amount: value }, { onConflict: 'unit_id,month' })
    if (error) {
      setError('Não foi possível salvar a meta.')
      return
    }
    setGoals((prev) => ({ ...prev, [goalUnit]: value }))
    setGoalInput('')
  }

  function handleExport() {
    const rows: (string | number)[][] = [
      ['Unidade', 'Faturamento', 'Despesas', 'Lucro líquido', 'Festas realizadas', 'Ticket médio'],
      ...comparativo.map((c) => [c.name, c.faturamento, c.despesas, c.lucro, c.festas, Math.round(c.ticketMedio)]),
    ]
    downloadCsv('relatorio-brava-park-fest.csv', rows)
    setExportLog((prev) => [{ id: crypto.randomUUID(), quando: new Date().toLocaleString('pt-BR'), usuario: 'Você' }, ...prev])
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Relatórios e metas</h1>
          <p className="text-sm text-muted mt-1">Metas de faturamento, comparativo entre unidades e projeção futura</p>
        </div>
        <Button variant="secondary" onClick={handleExport}>
          <Download className="w-4 h-4" /> Exportar CSV (Excel)
        </Button>
      </div>

      {error && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5">{error}</div>}

      {loading ? (
        <Card><p className="text-sm text-muted py-6 text-center">Carregando...</p></Card>
      ) : (
        <>
          <Card title="Meta de faturamento do mês">
            <div className="space-y-4 mb-4">
              {goalProgress.map((g) => (
                <div key={g.id}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium">{g.name}</span>
                    <span className="text-muted">
                      {currency(g.atual)} de {g.meta > 0 ? currency(g.meta) : 'meta não definida'} {g.meta > 0 ? `(${g.pct.toFixed(0)}%)` : ''}
                    </span>
                  </div>
                  <div className="h-2.5 bg-paper rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${g.pct >= 100 ? 'bg-teal' : 'bg-purple'}`}
                      style={{ width: `${g.pct}%` }}
                    />
                  </div>
                  {g.meta > 0 && g.falta > 0 && <p className="text-xs text-muted mt-1">Faltam {currency(g.falta)} para bater a meta</p>}
                </div>
              ))}
            </div>

            <form onSubmit={handleSetGoal} className="flex items-end gap-3 flex-wrap pt-3 border-t border-line">
              <div>
                <label className="block text-xs text-muted mb-1">Unidade</label>
                <select value={goalUnit} onChange={(e) => setGoalUnit(e.target.value)} className="border border-line rounded-lg px-3 py-2 text-sm">
                  {UNITS.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Nova meta do mês</label>
                <input
                  type="number"
                  value={goalInput}
                  onChange={(e) => setGoalInput(e.target.value)}
                  placeholder="0,00"
                  className="border border-line rounded-lg px-3 py-2 text-sm w-40"
                />
              </div>
              <Button type="submit" className="flex items-center gap-1">
                <Target className="w-4 h-4" /> Definir meta
              </Button>
            </form>
          </Card>

          <Card title="Comparativo entre unidades — mês atual">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="pb-3 font-medium">Unidade</th>
                  <th className="pb-3 font-medium">Faturamento</th>
                  <th className="pb-3 font-medium">Despesas</th>
                  <th className="pb-3 font-medium">Lucro líquido</th>
                  <th className="pb-3 font-medium">Festas</th>
                  <th className="pb-3 font-medium">Ticket médio</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {comparativo.map((c) => (
                  <tr key={c.id}>
                    <td className="py-3 font-medium">{c.name}</td>
                    <td className="py-3">{currency(c.faturamento)}</td>
                    <td className="py-3 text-danger">{currency(c.despesas)}</td>
                    <td className={`py-3 font-medium ${c.lucro >= 0 ? 'text-teal' : 'text-danger'}`}>{currency(c.lucro)}</td>
                    <td className="py-3">{c.festas}</td>
                    <td className="py-3">{currency(c.ticketMedio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Projeção de recebimento — próximos meses">
            <p className="text-xs text-muted mb-3">
              Saldo ainda não recebido das festas já agendadas (não canceladas) em cada mês.
            </p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={projecao}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2DBEE" vertical={false} />
                <XAxis dataKey="mes" tick={{ fontSize: 12, fill: '#6E6880' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#6E6880' }} axisLine={false} tickLine={false} width={40} />
                <Tooltip formatter={(value: number) => currency(value)} contentStyle={{ borderRadius: 8, borderColor: '#E2DBEE', fontSize: 13 }} />
                <Bar dataKey="valor" name="A receber" fill="#6D28D9" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {exportLog.length > 0 && (
            <Card title="Log de exportações (LGPD)">
              <p className="text-xs text-muted mb-3">Registro de quem exportou dados e quando, para fins de proteção de dados.</p>
              <ul className="text-xs text-muted space-y-1">
                {exportLog.map((e) => (
                  <li key={e.id}>{e.quando} — {e.usuario} exportou o relatório comparativo em CSV</li>
                ))}
              </ul>
              <p className="text-xs text-muted mt-2">Esse log é só desta sessão — ainda não fica guardado no banco.</p>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
