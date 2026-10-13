import { FormEvent, useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Plus, Trash2, X, Trophy, Info, AlertTriangle } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { useUnit } from '../lib/UnitContext'
import { supabase } from '../lib/supabaseClient'
import { useUndo } from '../lib/UndoContext'
import { todayIso } from '../lib/format'
import { normalizeAverages, type AverageRow } from './ConsumptionAverages'

interface Festa {
  id: string
  unitId: string
  cliente: string
  data: string
  eventDateIso: string
  convidados: number
  // Valor devido = valor firmado + extras vendidos + consumo cobrado (o mesmo
  // da Central da festa e do Resultado das festas no Financeiro).
  valorContrato: number
  valorFirmado: number
  extras: number
  consumo: number
}

interface InsumoInfo {
  custo: number
  semCusto: number
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
  // Custo dos insumos do estoque consumidos em cada festa (Consumo pós-festa) —
  // só aqui, informativo; no caixa a compra já foi contada quando foi paga.
  const [insumosByFesta, setInsumosByFesta] = useState<Record<string, InsumoInfo>>({})
  const [averages, setAverages] = useState<AverageRow[]>([])
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
    const [{ data: reservationsData, error: resErr }, { data: costsData }, { data: consData }, { data: avgData }] = await Promise.all([
      supabase
        .from('reservations')
        .select('id, unit_id, event_date, final_value, guest_count, courtesy_guests, client:clients(name), reservation_extra_items(quantity, price_snapshot), reservation_consumption(quantity, unit_price)')
        .neq('status', 'cancelada')
        .order('event_date', { ascending: false }),
      supabase.from('reservation_costs').select('*'),
      supabase.from('reservation_stock_consumption').select('reservation_id, inventory_item_id, total_cost, no_cost'),
      supabase.rpc('consumption_averages', { p_unit: null, p_limit: 10 }),
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
        eventDateIso: r.event_date,
        convidados: (r.guest_count ?? 0) + (r.courtesy_guests ?? 0),
        valorFirmado: Number(r.final_value) || 0,
        extras: (r.reservation_extra_items ?? []).reduce((s: number, x: any) => s + Number(x.quantity) * Number(x.price_snapshot), 0),
        consumo: (r.reservation_consumption ?? []).reduce((s: number, x: any) => s + Number(x.quantity) * Number(x.unit_price), 0),
        valorContrato:
          (Number(r.final_value) || 0) +
          (r.reservation_extra_items ?? []).reduce((s: number, x: any) => s + Number(x.quantity) * Number(x.price_snapshot), 0) +
          (r.reservation_consumption ?? []).reduce((s: number, x: any) => s + Number(x.quantity) * Number(x.unit_price), 0),
      })),
    )

    const grouped: Record<string, CostItem[]> = {}
    for (const c of costsData ?? []) {
      const list = grouped[c.reservation_id] ?? []
      list.push({ id: c.id, description: c.description, amount: Number(c.amount) })
      grouped[c.reservation_id] = list
    }
    setCostsByFesta(grouped)

    const insumos: Record<string, InsumoInfo> = {}
    for (const c of consData ?? []) {
      if (!c.inventory_item_id) continue
      const cur = insumos[c.reservation_id] ?? { custo: 0, semCusto: 0 }
      if (c.no_cost || c.total_cost == null) cur.semCusto += 1
      else cur.custo += Number(c.total_cost)
      insumos[c.reservation_id] = cur
    }
    setInsumosByFesta(insumos)
    setAverages(normalizeAverages(avgData as Record<string, unknown>[] | null))
    setLoading(false)
  }

  const hoje = todayIso()

  // Previsão dos insumos de uma festa futura: média real por item da unidade ×
  // convidados (ou média por festa) × custo médio atual. Só estimativa.
  function insumosPrevistos(f: Festa): number | null {
    const doUnit = averages.filter((a) => a.unit_id === f.unitId)
    if (doUnit.length === 0) return null
    return doUnit.reduce((s, a) => {
      const quantidade = a.consumption_type === 'por_convidado' ? (a.avg_per_guest ?? 0) * f.convidados : a.avg_per_festa ?? 0
      return s + quantidade * (a.current_unit_cost ?? 0)
    }, 0)
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
        const ins = insumosByFesta[f.id] ?? { custo: 0, semCusto: 0 }
        const lucro = f.valorContrato - totalCustos - ins.custo
        const margem = f.valorContrato > 0 ? (lucro / f.valorContrato) * 100 : 0
        const futura = f.eventDateIso >= hoje
        const previstos = futura ? insumosPrevistos(f) : null
        const lucroEstimado = previstos != null ? f.valorContrato - totalCustos - previstos : null
        return { ...f, totalCustos, insumos: ins.custo, semCusto: ins.semCusto, lucro, margem, futura, previstos, lucroEstimado }
      }),
    [filteredFestas, costsByFesta, insumosByFesta, averages],
  )

  const lucroTotal = rows.reduce((s, r) => s + r.lucro, 0)
  const itensSemCusto = rows.reduce((s, r) => s + r.semCusto, 0)
  const margemMedia = rows.length > 0 ? rows.reduce((s, r) => s + r.margem, 0) / rows.length : 0
  const maisLucrativa = rows.length > 0 ? rows.reduce((a, b) => (b.lucro > a.lucro ? b : a)) : null

  const selectedCosts = selected ? costsByFesta[selected.id] ?? [] : []
  const selectedTotalCustos = selectedCosts.reduce((s, c) => s + c.amount, 0)
  const selectedInsumos = selected ? insumosByFesta[selected.id] ?? { custo: 0, semCusto: 0 } : { custo: 0, semCusto: 0 }
  const selectedLucro = selected ? selected.valorContrato - selectedTotalCustos - selectedInsumos.custo : 0

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

      <p className="text-xs text-muted flex items-start gap-1.5 -mt-2">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        Lucro da festa = valor da festa (valor firmado + extras vendidos + consumo cobrado) − custos lançados na festa − insumos do estoque consumidos. É o mesmo lucro da Central da festa e do Financeiro → Resultado das festas. O custo dos insumos aparece só aqui, para medir a rentabilidade da festa. No caixa e no Resultado do mês, a compra já foi contada quando foi paga.
      </p>
      {itensSemCusto > 0 && (
        <p className="text-xs text-amber flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" /> {itensSemCusto} itens consumidos sem custo, o lucro pode estar superestimado. Defina o custo em Estoque.
        </p>
      )}

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
              <th className="pb-3 font-medium">Valor da festa</th>
              <th className="pb-3 font-medium">Custos</th>
              <th className="pb-3 font-medium">Insumos (estoque)</th>
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
                <td className="py-3">
                  {currency(r.valorContrato)}
                  {r.extras + r.consumo > 0 && (
                    <span className="block text-[11px] text-muted">
                      {currency(r.valorFirmado)} firmado{r.extras > 0 ? ` + ${currency(r.extras)} extras` : ''}{r.consumo > 0 ? ` + ${currency(r.consumo)} consumo` : ''}
                    </span>
                  )}
                </td>
                <td className="py-3 text-danger">{currency(r.totalCustos)}</td>
                <td className="py-3 text-danger">
                  {r.insumos > 0 ? currency(r.insumos) : '—'}
                  {r.semCusto > 0 && <span className="block text-[11px] text-amber">{r.semCusto} sem custo</span>}
                  {r.insumos > 0 && r.convidados > 0 && <span className="block text-[11px] text-muted">{currency(r.insumos / r.convidados)}/convidado</span>}
                </td>
                <td className={`py-3 font-medium ${r.lucro >= 0 ? 'text-teal' : 'text-danger'}`}>
                  {currency(r.lucro)}
                  {r.lucroEstimado != null && (
                    <span className="block text-[11px] font-normal text-muted" title="Estimado: valor − custos lançados − insumos previstos pelas médias de consumo">
                      estimado {currency(r.lucroEstimado)} (insumos ≈ {currency(r.previstos ?? 0)})
                    </span>
                  )}
                </td>
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
                <td colSpan={8} className="py-6 text-center text-muted">
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
              {selected.data} · Valor da festa: {currency(selected.valorContrato)}
              {selected.extras + selected.consumo > 0 && ` (${currency(selected.valorFirmado)} firmado + ${currency(selected.extras + selected.consumo)} de extras e consumo)`}
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

            <div className="mb-4 bg-paper rounded-lg px-3 py-2 text-sm">
              <div className="flex justify-between"><span>Insumos (estoque)</span><span className="font-medium text-danger">{currency(selectedInsumos.custo)}</span></div>
              {selected.convidados > 0 && selectedInsumos.custo > 0 && (
                <p className="text-xs text-muted">{currency(selectedInsumos.custo / selected.convidados)} por convidado ({selected.convidados} convidados)</p>
              )}
              {selectedInsumos.semCusto > 0 && <p className="text-xs text-amber">{selectedInsumos.semCusto} item(ns) consumido(s) sem custo</p>}
              <p className="text-[11px] text-muted mt-1">Vem do Consumo pós-festa (Central da festa). Só informativo.</p>
            </div>

            <p className="text-sm font-semibold mb-2">Custos lançados</p>
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
