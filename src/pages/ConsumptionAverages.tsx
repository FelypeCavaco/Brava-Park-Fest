import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Info, X } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { useUnit, UNITS } from '../lib/UnitContext'
import { supabase } from '../lib/supabaseClient'
import { brl, qtd, todayIso, friendlyDbError } from '../lib/format'

// Médias reais de consumo, calculadas pelo banco a partir dos consumos
// pós-festa das festas finalizadas (média ponderada: soma das quantidades ÷
// soma dos convidados). Só informação gerencial: não mexe no caixa.

export interface AverageRow {
  inventory_item_id: string
  unit_id: string
  item_name: string
  unit_of_measure: string
  consumption_type: 'por_convidado' | 'por_festa'
  festas: number
  total_qty: number
  total_guests: number
  avg_per_guest: number | null
  min_per_guest: number | null
  max_per_guest: number | null
  avg_per_festa: number | null
  total_cost: number | null
  avg_cost_per_guest: number | null
  avg_cost_per_festa: number | null
  configured_per_guest: number | null
  current_unit_cost: number | null
  current_quantity: number
}

export function normalizeAverages(data: Record<string, unknown>[] | null): AverageRow[] {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  return (data ?? []).map((r) => ({
    inventory_item_id: r.inventory_item_id as string,
    unit_id: r.unit_id as string,
    item_name: r.item_name as string,
    unit_of_measure: r.unit_of_measure as string,
    consumption_type: r.consumption_type as 'por_convidado' | 'por_festa',
    festas: Number(r.festas),
    total_qty: Number(r.total_qty),
    total_guests: Number(r.total_guests),
    avg_per_guest: n(r.avg_per_guest),
    min_per_guest: n(r.min_per_guest),
    max_per_guest: n(r.max_per_guest),
    avg_per_festa: n(r.avg_per_festa),
    total_cost: n(r.total_cost),
    avg_cost_per_guest: n(r.avg_cost_per_guest),
    avg_cost_per_festa: n(r.avg_cost_per_festa),
    configured_per_guest: n(r.configured_per_guest),
    current_unit_cost: n(r.current_unit_cost),
    current_quantity: Number(r.current_quantity ?? 0),
  }))
}

interface NextFesta { date: string; guests: number }

export function ConsumptionAverages() {
  const { selectedUnit, unitDbIds, unitDbIdsLoading } = useUnit()
  const [rows, setRows] = useState<AverageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [janela, setJanela] = useState(10)
  const [juntar, setJuntar] = useState(false)
  const [nextByUnit, setNextByUnit] = useState<Record<string, NextFesta>>({})
  const [applying, setApplying] = useState<AverageRow | null>(null)

  const slugByUnitId = useMemo(() => {
    const m: Record<string, string> = {}
    for (const slug of Object.keys(unitDbIds)) m[unitDbIds[slug].unitId] = slug
    return m
  }, [unitDbIds])

  useEffect(() => {
    if (!unitDbIdsLoading) load()
  }, [unitDbIdsLoading, unitDbIds, selectedUnit, janela])

  async function load() {
    setLoading(true)
    const unitId = selectedUnit === 'todas' ? null : unitDbIds[selectedUnit]?.unitId ?? null
    const [{ data, error: err }, { data: upcoming }] = await Promise.all([
      supabase.rpc('consumption_averages', { p_unit: unitId, p_limit: janela }),
      supabase.from('reservations').select('unit_id, event_date, guest_count, courtesy_guests').neq('status', 'cancelada').gte('event_date', todayIso()).order('event_date'),
    ])
    if (err) setError(friendlyDbError(err.message))
    setRows(normalizeAverages(data as Record<string, unknown>[] | null))
    const next: Record<string, NextFesta> = {}
    for (const r of upcoming ?? []) {
      const g = (r.guest_count ?? 0) + (r.courtesy_guests ?? 0)
      if (!next[r.unit_id]) next[r.unit_id] = { date: r.event_date, guests: g }
      else if (next[r.unit_id].date === r.event_date) next[r.unit_id].guests += g
    }
    setNextByUnit(next)
    setLoading(false)
  }

  // "Ver as duas juntas": soma quantidades, convidados e festas por item (mesmo nome e medida).
  const view = useMemo(() => {
    if (!(juntar && selectedUnit === 'todas')) return rows
    const map = new Map<string, AverageRow>()
    for (const r of rows) {
      const k = `${r.item_name}|${r.unit_of_measure}|${r.consumption_type}`
      const cur = map.get(k)
      if (!cur) {
        map.set(k, { ...r, unit_id: 'ambas' })
        continue
      }
      cur.festas += r.festas
      cur.total_qty += r.total_qty
      cur.total_guests += r.total_guests
      cur.total_cost = (cur.total_cost ?? 0) + (r.total_cost ?? 0)
      cur.min_per_guest = Math.min(cur.min_per_guest ?? Infinity, r.min_per_guest ?? Infinity)
      cur.max_per_guest = Math.max(cur.max_per_guest ?? 0, r.max_per_guest ?? 0)
      cur.current_quantity += r.current_quantity
    }
    for (const r of map.values()) {
      r.avg_per_guest = r.total_guests > 0 ? r.total_qty / r.total_guests : null
      r.avg_per_festa = r.festas > 0 ? r.total_qty / r.festas : null
      r.avg_cost_per_guest = r.total_guests > 0 && r.total_cost != null ? r.total_cost / r.total_guests : null
      r.avg_cost_per_festa = r.festas > 0 && r.total_cost != null ? r.total_cost / r.festas : null
    }
    return Array.from(map.values())
  }, [rows, juntar, selectedUnit])

  const sorted = [...view].sort((a, b) => a.item_name.localeCompare(b.item_name, 'pt-BR'))

  function diffPct(r: AverageRow) {
    if (r.consumption_type !== 'por_convidado' || r.avg_per_guest == null || !r.configured_per_guest) return null
    return ((r.avg_per_guest - r.configured_per_guest) / r.configured_per_guest) * 100
  }

  // Previsão para a próxima festa de cada unidade, com aviso quando o estoque não cobre.
  const previsao = useMemo(() => {
    const out: { unit: string; date: string; guests: number; itens: { nome: string; uom: string; precisa: number; tem: number; custo: number | null }[]; total: number }[] = []
    for (const [unitId, festa] of Object.entries(nextByUnit)) {
      const slug = slugByUnitId[unitId]
      if (!slug || (selectedUnit !== 'todas' && slug !== selectedUnit)) continue
      const itens = rows
        .filter((r) => r.unit_id === unitId)
        .map((r) => {
          const precisa = r.consumption_type === 'por_convidado' ? (r.avg_per_guest ?? 0) * festa.guests : r.avg_per_festa ?? 0
          return { nome: r.item_name, uom: r.unit_of_measure, precisa, tem: r.current_quantity, custo: r.current_unit_cost != null ? precisa * r.current_unit_cost : null }
        })
        .filter((i) => i.precisa > 0)
      out.push({ unit: slug, date: festa.date, guests: festa.guests, itens, total: itens.reduce((s, i) => s + (i.custo ?? 0), 0) })
    }
    return out
  }, [rows, nextByUnit, slugByUnitId, selectedUnit])

  async function applyAverage(r: AverageRow) {
    if (r.avg_per_guest == null) return
    const value = Math.round(r.avg_per_guest * 10000) / 10000
    const { error: err } = await supabase.from('inventory_items').update({ quantity_per_guest: value }).eq('id', r.inventory_item_id)
    if (err) setError(friendlyDbError(err.message))
    else setNotice(`${r.item_name}: consumo por convidado atualizado para ${qtd(value, 4)} ${r.unit_of_measure}. A lista de compras já usa o novo valor.`)
    setApplying(null)
    await load()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Consumo por convidado</h1>
        <p className="text-sm text-muted mt-1">Quanto de cada insumo as festas realmente gastam, para estimar compras e custos das próximas</p>
      </div>

      {error && (
        <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5 flex justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Fechar aviso"><X className="w-4 h-4" /></button>
        </div>
      )}
      {notice && (
        <div className="bg-teal-light text-teal text-sm rounded-lg px-4 py-2.5 flex justify-between gap-3">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Fechar aviso"><X className="w-4 h-4" /></button>
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-end gap-4 text-sm">
          <div>
            <label className="block text-xs text-muted mb-1">Festas na amostra (por unidade)</label>
            <select value={janela} onChange={(e) => setJanela(Number(e.target.value))} className="border border-line rounded-lg px-3 py-2 text-sm">
              {[5, 10, 20, 50].map((n) => <option key={n} value={n}>Últimas {n}</option>)}
            </select>
          </div>
          {selectedUnit === 'todas' && (
            <label className="flex items-center gap-2 pb-2">
              <input type="checkbox" checked={juntar} onChange={(e) => setJuntar(e.target.checked)} />
              Juntar as unidades
            </label>
          )}
        </div>
        <p className="text-xs text-muted mt-3 flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Entram só festas já realizadas, não canceladas, com "Consumo finalizado" e sem "Excluir das médias". Convidados = contratados + cortesias.
          Item "por convidado" que não aparece no consumo de uma festa conta como zero naquela festa. Média ponderada: soma do consumo ÷ soma dos convidados.
        </p>
      </Card>

      {previsao.map((p) => (
        <Card key={p.unit} title={`Próxima festa — ${UNITS.find((u) => u.id === p.unit)?.name} · ${p.date.split('-').reverse().join('/')} · ${p.guests} convidados`}>
          {p.itens.length === 0 ? (
            <p className="text-sm text-muted">Ainda não há médias suficientes para prever o consumo.</p>
          ) : (
            <>
              <ul className="divide-y divide-line text-sm">
                {p.itens.map((i) => (
                  <li key={i.nome} className="py-2 flex justify-between gap-3">
                    <span>
                      {i.nome}: precisa ≈ {qtd(i.precisa, 2)} {i.uom}
                      {i.custo != null && <span className="text-muted"> · {brl(i.custo)}</span>}
                    </span>
                    {i.tem < i.precisa ? (
                      <span className="text-danger text-xs flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> estoque tem só {qtd(i.tem, 2)} {i.uom}</span>
                    ) : (
                      <span className="text-teal text-xs">estoque cobre ({qtd(i.tem, 2)} {i.uom})</span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted mt-2">Custo previsto dos insumos: {brl(p.total)} (estimado pelo custo médio atual).</p>
            </>
          )}
        </Card>
      ))}

      <Card title="Médias por item">
        {loading ? (
          <p className="text-sm text-muted py-4 text-center">Carregando...</p>
        ) : sorted.length === 0 ? (
          <p className="text-sm text-muted py-4 text-center">Ainda não há consumo de festas finalizadas. Na Central da festa, aba Consumo pós-festa, use "Consumo finalizado" depois de lançar tudo.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="pb-3 font-medium">Item</th>
                  <th className="pb-3 font-medium">Média real</th>
                  <th className="pb-3 font-medium">Configurado hoje</th>
                  <th className="pb-3 font-medium">Mín / máx</th>
                  <th className="pb-3 font-medium">Amostra</th>
                  <th className="pb-3 font-medium">Custo médio</th>
                  <th className="pb-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sorted.map((r) => {
                  const porConvidado = r.consumption_type === 'por_convidado'
                  const diff = diffPct(r)
                  return (
                    <tr key={`${r.unit_id}-${r.inventory_item_id}`}>
                      <td className="py-3 font-medium">
                        {r.item_name}
                        <p className="text-xs text-muted font-normal">
                          {porConvidado ? 'por convidado' : 'por festa'}
                          {selectedUnit === 'todas' && !juntar ? ` · ${UNITS.find((u) => u.id === slugByUnitId[r.unit_id])?.name ?? ''}` : ''}
                        </p>
                      </td>
                      <td className="py-3">
                        {porConvidado ? `${qtd(r.avg_per_guest, 3)} ${r.unit_of_measure}/convidado` : `${qtd(r.avg_per_festa, 2)} ${r.unit_of_measure}/festa`}
                      </td>
                      <td className="py-3 text-muted">
                        {porConvidado ? (r.configured_per_guest != null ? `${qtd(r.configured_per_guest, 3)} ${r.unit_of_measure}` : '—') : '—'}
                        {diff != null && (
                          <p className={`text-xs ${Math.abs(diff) > 15 ? 'text-danger font-medium' : ''}`}>{diff > 0 ? '+' : ''}{diff.toFixed(0)}% de diferença</p>
                        )}
                      </td>
                      <td className="py-3 text-muted text-xs">
                        {porConvidado && r.min_per_guest != null ? `${qtd(r.min_per_guest, 3)} – ${qtd(r.max_per_guest, 3)} ${r.unit_of_measure}` : '—'}
                      </td>
                      <td className="py-3">
                        {r.festas} festa(s)
                        {r.festas < 3 && <div><Badge tone="amber">amostra pequena</Badge></div>}
                      </td>
                      <td className="py-3 text-muted">
                        {porConvidado ? (r.avg_cost_per_guest != null ? `${brl(r.avg_cost_per_guest)}/convidado` : 'sem custo') : r.avg_cost_per_festa != null ? `${brl(r.avg_cost_per_festa)}/festa` : 'sem custo'}
                      </td>
                      <td className="py-3 text-right">
                        {porConvidado && r.unit_id !== 'ambas' && r.avg_per_guest != null && (
                          <button onClick={() => setApplying(r)} className="text-xs text-purple font-medium whitespace-nowrap">Usar média real</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {applying && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setApplying(null)} />
          <div className="relative w-full max-w-md bg-surface rounded-card p-6 shadow-xl">
            <h2 className="text-lg font-display font-semibold mb-1">Usar média real</h2>
            <p className="text-sm text-muted mb-3">
              {applying.item_name}: trocar o consumo por convidado de{' '}
              {applying.configured_per_guest != null ? `${qtd(applying.configured_per_guest, 3)} ${applying.unit_of_measure}` : 'vazio'} para{' '}
              <strong className="text-ink">{qtd(applying.avg_per_guest, 3)} {applying.unit_of_measure}</strong> (média de {applying.festas} festa(s)).
            </p>
            {(() => {
              const d = diffPct(applying)
              return d != null && Math.abs(d) > 15 ? (
                <p className="text-sm bg-danger-light text-danger rounded-lg px-3 py-2 mb-3">Diferença grande: {d > 0 ? '+' : ''}{d.toFixed(0)}%. Confira se não houve festa atípica na amostra.</p>
              ) : null
            })()}
            {applying.festas < 3 && <p className="text-sm bg-amber-light text-amber rounded-lg px-3 py-2 mb-3">Amostra pequena (menos de 3 festas).</p>}
            <p className="text-xs text-muted mb-4">Esse valor alimenta a lista de compras do Estoque.</p>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" className="flex-1 justify-center" onClick={() => setApplying(null)}>Cancelar</Button>
              <Button type="button" className="flex-1 justify-center" onClick={() => applyAverage(applying)}>Confirmar</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
