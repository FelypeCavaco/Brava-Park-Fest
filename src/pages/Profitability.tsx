import { FormEvent, useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Plus, Trash2, X, Trophy } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { useUnit } from '../lib/UnitContext'
import { supabase } from '../lib/supabaseClient'
import { useUndo } from '../lib/UndoContext'

interface Festa {
  id: string
  unitId: string
  cliente: string
  data: string
  valorContrato: number
}

interface CostItem {
  id: string
  description: string
  amount: number
}

function currency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

export function Profitability() {
  const { selectedUnit, unitDbIds } = useUnit()
  const { scheduleDelete } = useUndo()
  const [festas, setFestas] = useState<Festa[]>([])
  const [costsByFesta, setCostsByFesta] = useState<Record<string, CostItem[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selected, setSelected] = useState<Festa | null>(null)
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    const [{ data: reservationsData, error: resErr }, { data: costsData }] = await Promise.all([
      supabase
        .from('reservations')
        .select('id, unit_id, event_date, final_value, client:clients(name)')
        .neq('status', 'cancelada')
        .order('event_date', { ascending: false }),
      supabase.from('reservation_costs').select('*'),
    ])

    if (resErr) {
      setError('Não foi possível carregar as festas.')
      setLoading(false)
      return
    }

    setFestas(
      (reservationsData ?? []).map((r: any) => ({
        id: r.id,
        unitId: r.unit_id,
        cliente: r.client?.name ?? '—',
        data: format(parseISO(r.event_date), 'dd/MM/yyyy'),
        valorContrato: Number(r.final_value) || 0,
      })),
    )

    const grouped: Record<string, CostItem[]> = {}
    for (const c of costsData ?? []) {
      const list = grouped[c.reservation_id] ?? []
      list.push({ id: c.id, description: c.description, amount: Number(c.amount) })
      grouped[c.reservation_id] = list
    }
    setCostsByFesta(grouped)
    setLoading(false)
  }

  const filteredFestas = useMemo(() => {
    if (selectedUnit === 'todas') return festas
    const unitId = unitDbIds[selectedUnit]?.unitId
    return festas.filter((f) => f.unitId === unitId)
  }, [festas, selectedUnit, unitDbIds])

  const rows = useMemo(
    () =>
      filteredFestas.map((f) => {
        const custos = costsByFesta[f.id] ?? []
        const totalCustos = custos.reduce((s, c) => s + c.amount, 0)
        const lucro = f.valorContrato - totalCustos
        const margem = f.valorContrato > 0 ? (lucro / f.valorContrato) * 100 : 0
        return { ...f, totalCustos, lucro, margem }
      }),
    [filteredFestas, costsByFesta],
  )

  const lucroTotal = rows.reduce((s, r) => s + r.lucro, 0)
  const margemMedia = rows.length > 0 ? rows.reduce((s, r) => s + r.margem, 0) / rows.length : 0
  const maisLucrativa = rows.length > 0 ? rows.reduce((a, b) => (b.lucro > a.lucro ? b : a)) : null

  const selectedCosts = selected ? costsByFesta[selected.id] ?? [] : []
  const selectedTotalCustos = selectedCosts.reduce((s, c) => s + c.amount, 0)
  const selectedLucro = selected ? selected.valorContrato - selectedTotalCustos : 0

  async function handleAddCost(e: FormEvent) {
    e.preventDefault()
    if (!selected) return
    const value = Number(amount)
    if (!value || !description.trim()) return

    const { data, error } = await supabase
      .from('reservation_costs')
      .insert({ reservation_id: selected.id, description: description.trim(), amount: value })
      .select()
      .single()

    if (error) {
      setError('Não foi possível lançar o custo.')
      return
    }

    setCostsByFesta((prev) => ({
      ...prev,
      [selected.id]: [...(prev[selected.id] ?? []), { id: data.id, description: data.description, amount: Number(data.amount) }],
    }))
    setDescription('')
    setAmount('')
  }

  function handleRemoveCost(costId: string) {
    if (!selected) return
    const festaId = selected.id
    const cost = (costsByFesta[festaId] ?? []).find((c) => c.id === costId)
    if (!cost) return
    setCostsByFesta((prev) => ({
      ...prev,
      [festaId]: (prev[festaId] ?? []).filter((c) => c.id !== costId),
    }))
    scheduleDelete({
      label: `Custo "${cost.description}" removido`,
      commit: async () => {
        await supabase.from('reservation_costs').delete().eq('id', costId)
      },
      undo: async () => {
        await supabase.from('reservation_costs').insert({ id: costId, reservation_id: festaId, description: cost.description, amount: cost.amount })
        setCostsByFesta((prev) => ({ ...prev, [festaId]: [...(prev[festaId] ?? []), cost] }))
      },
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Lucro por festa</h1>
        <p className="text-sm text-muted mt-1">Quanto cada festa realmente rendeu, descontando os custos dela</p>
      </div>

      {error && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <p className="text-xs text-muted">Lucro total do período</p>
          <p className="text-2xl font-display font-semibold mt-1 text-teal">{currency(lucroTotal)}</p>
          <p className="text-xs text-muted mt-1">{rows.length} festas</p>
        </Card>
        <Card>
          <p className="text-xs text-muted">Margem média</p>
          <p className="text-2xl font-display font-semibold mt-1">{margemMedia.toFixed(0)}%</p>
          <p className="text-xs text-muted mt-1">lucro sobre o valor do contrato</p>
        </Card>
        <Card>
          <p className="text-xs text-muted flex items-center gap-1.5">
            <Trophy className="w-3.5 h-3.5 text-orange" /> Festa mais lucrativa
          </p>
          {maisLucrativa ? (
            <>
              <p className="text-lg font-display font-semibold mt-1">{maisLucrativa.cliente}</p>
              <p className="text-xs text-muted mt-1">{currency(maisLucrativa.lucro)} de lucro</p>
            </>
          ) : (
            <p className="text-sm text-muted mt-1">Sem dados ainda</p>
          )}
        </Card>
      </div>

      <Card title="Festas e sua rentabilidade">
        {loading ? (
          <p className="text-sm text-muted py-6 text-center">Carregando...</p>
        ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-line">
              <th className="pb-3 font-medium">Cliente</th>
              <th className="pb-3 font-medium">Data</th>
              <th className="pb-3 font-medium">Valor do contrato</th>
              <th className="pb-3 font-medium">Custos</th>
              <th className="pb-3 font-medium">Lucro</th>
              <th className="pb-3 font-medium">Margem</th>
              <th className="pb-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="py-3 font-medium">{r.cliente}</td>
                <td className="py-3 text-muted">{r.data}</td>
                <td className="py-3">{currency(r.valorContrato)}</td>
                <td className="py-3 text-danger">{currency(r.totalCustos)}</td>
                <td className={`py-3 font-medium ${r.lucro >= 0 ? 'text-teal' : 'text-danger'}`}>{currency(r.lucro)}</td>
                <td className="py-3">
                  <Badge tone={r.margem >= 40 ? 'teal' : r.margem >= 20 ? 'amber' : 'danger'}>{r.margem.toFixed(0)}%</Badge>
                </td>
                <td className="py-3 text-right">
                  <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={() => setSelected(r)}>
                    Ver custos
                  </Button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-muted">
                  Nenhuma festa encontrada para esta unidade.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        )}
      </Card>

      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setSelected(null)} />
          <div className="relative w-full max-w-md bg-surface h-screen overflow-y-auto p-6 shadow-xl">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-display font-semibold">{selected.cliente}</h2>
              <button onClick={() => setSelected(null)} className="text-muted hover:text-ink">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-muted mb-4">
              {selected.data} · Contrato: {currency(selected.valorContrato)}
            </p>

            <div className="grid grid-cols-2 gap-3 mb-6">
              <Card>
                <p className="text-xs text-muted">Custos lançados</p>
                <p className="text-lg font-display font-semibold mt-1 text-danger">{currency(selectedTotalCustos)}</p>
              </Card>
              <Card>
                <p className="text-xs text-muted">Lucro desta festa</p>
                <p className={`text-lg font-display font-semibold mt-1 ${selectedLucro >= 0 ? 'text-teal' : 'text-danger'}`}>
                  {currency(selectedLucro)}
                </p>
              </Card>
            </div>

            <p className="text-sm font-semibold mb-2">Custos</p>
            <ul className="divide-y divide-line mb-4">
              {selectedCosts.map((c) => (
                <li key={c.id} className="py-2.5 flex items-center justify-between text-sm">
                  <span>{c.description}</span>
                  <div className="flex items-center gap-3">
                    <span className="font-medium">{currency(c.amount)}</span>
                    <button onClick={() => handleRemoveCost(c.id)} className="text-muted hover:text-danger" aria-label="Remover custo">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </li>
              ))}
              {selectedCosts.length === 0 && <p className="text-sm text-muted py-2">Nenhum custo lançado ainda.</p>}
            </ul>

            <form onSubmit={handleAddCost} className="space-y-2">
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex: Fotógrafo, buffet, decoração..."
                className="w-full border border-line rounded-lg px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Valor"
                  className="flex-1 border border-line rounded-lg px-3 py-2 text-sm"
                />
                <Button type="submit" className="px-3">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
