import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, CalendarClock, X } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { useUnit, UNITS, SPACES_BY_UNIT } from '../lib/UnitContext'
import { supabase } from '../lib/supabaseClient'
import { useUndo } from '../lib/UndoContext'

interface VisitRow {
  id: string
  unitSlug: string
  cliente: string
  espaco: string
  dataHora: string // yyyy-MM-ddTHH:mm, para o input datetime-local
  responsavel: string
  resultado: 'virou_orcamento' | 'nao_avancou' | null
  noAdvanceReason: string | null
}

const resultLabel: Record<string, string> = {
  virou_orcamento: 'Virou orçamento',
  nao_avancou: 'Não avançou',
}

function toLocalInputValue(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function Visits() {
  const { selectedUnit, unitDbIds, unitDbIdsLoading } = useUnit()
  const { scheduleDelete } = useUndo()
  const [visits, setVisits] = useState<VisitRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [cliente, setCliente] = useState('')
  const [unitSlug, setUnitSlug] = useState(UNITS[0].id)
  const [dataHora, setDataHora] = useState(() => toLocalInputValue(new Date().toISOString()))
  const [responsavel, setResponsavel] = useState('')
  const [reasonModalId, setReasonModalId] = useState<string | null>(null)
  const [reasonInput, setReasonInput] = useState('')

  useEffect(() => {
    if (!unitDbIdsLoading) loadVisits()
  }, [unitDbIdsLoading, unitDbIds])

  async function loadVisits() {
    setLoading(true)
    const dbIdToSlug: Record<string, string> = {}
    for (const slug of Object.keys(unitDbIds)) dbIdToSlug[unitDbIds[slug].unitId] = slug

    const { data, error } = await supabase.from('visits').select('*').order('scheduled_at')
    if (error) {
      setError('Não foi possível carregar as visitas.')
      setLoading(false)
      return
    }
    setVisits(
      (data ?? []).map((v) => ({
        id: v.id,
        unitSlug: dbIdToSlug[v.unit_id] ?? '',
        cliente: v.client_name,
        espaco: v.space_name ?? '',
        dataHora: toLocalInputValue(v.scheduled_at),
        responsavel: v.responsible ?? '',
        resultado: v.result as VisitRow['resultado'],
        noAdvanceReason: v.no_advance_reason ?? null,
      })),
    )
    setLoading(false)
  }

  const filtered = useMemo(
    () =>
      (selectedUnit === 'todas' ? visits : visits.filter((v) => v.unitSlug === selectedUnit)).sort((a, b) =>
        a.dataHora < b.dataHora ? -1 : 1,
      ),
    [visits, selectedUnit],
  )

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!cliente.trim() || !dataHora) return
    const dbIds = unitDbIds[unitSlug]
    if (!dbIds) {
      setError('Não encontrei essa unidade no banco de dados ainda.')
      return
    }

    const { data, error } = await supabase
      .from('visits')
      .insert({
        client_name: cliente.trim(),
        unit_id: dbIds.unitId,
        space_name: SPACES_BY_UNIT[unitSlug]?.[0] ?? '',
        scheduled_at: new Date(dataHora).toISOString(),
        responsible: responsavel.trim() || 'Você',
      })
      .select()
      .single()

    if (error) {
      setError('Não foi possível agendar a visita.')
      return
    }

    setVisits((prev) => [
      ...prev,
      { id: data.id, unitSlug, cliente: data.client_name, espaco: data.space_name ?? '', dataHora: toLocalInputValue(data.scheduled_at), responsavel: data.responsible ?? '', resultado: null, noAdvanceReason: null },
    ])
    setCliente('')
    setResponsavel('')
  }

  function handleRemove(id: string) {
    const visit = visits.find((v) => v.id === id)
    if (!visit) return
    setVisits((prev) => prev.filter((v) => v.id !== id))
    scheduleDelete({
      label: `Visita de "${visit.cliente}" removida`,
      commit: async () => {
        await supabase.from('visits').delete().eq('id', id)
      },
      undo: async () => {
        await supabase.from('visits').insert({
          id,
          client_name: visit.cliente,
          unit_id: unitDbIds[visit.unitSlug]?.unitId,
          space_name: visit.espaco || null,
          scheduled_at: new Date(visit.dataHora).toISOString(),
          responsible: visit.responsavel || null,
          result: visit.resultado,
          no_advance_reason: visit.noAdvanceReason,
        })
        setVisits((prev) => [...prev, visit])
      },
    })
  }

  async function setResult(id: string, resultado: VisitRow['resultado'], reason: string | null = null) {
    const previous = visits
    setVisits((prev) => prev.map((v) => (v.id === id ? { ...v, resultado, noAdvanceReason: reason } : v)))
    const { error } = await supabase.from('visits').update({ result: resultado, no_advance_reason: reason }).eq('id', id)
    if (error) {
      setVisits(previous)
      setError('Não foi possível salvar o resultado da visita.')
    }
  }

  function openReasonModal(id: string) {
    setReasonInput('')
    setReasonModalId(id)
  }

  function handleConfirmReason(e: FormEvent) {
    e.preventDefault()
    if (!reasonModalId) return
    setResult(reasonModalId, 'nao_avancou', reasonInput.trim() || null)
    setReasonModalId(null)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Agenda de visitas</h1>
        <p className="text-sm text-muted mt-1">Antes de fechar contrato, o cliente costuma visitar o espaço</p>
      </div>

      {error && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5">{error}</div>}

      <Card title="Agendar visita">
        <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <input
            type="text"
            required
            value={cliente}
            onChange={(e) => setCliente(e.target.value)}
            placeholder="Nome do cliente"
            className="border border-line rounded-lg px-3 py-2 text-sm"
          />
          <select
            value={unitSlug}
            onChange={(e) => setUnitSlug(e.target.value)}
            className="border border-line rounded-lg px-3 py-2 text-sm"
          >
            {UNITS.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          <input
            type="datetime-local"
            value={dataHora}
            onChange={(e) => setDataHora(e.target.value)}
            className="border border-line rounded-lg px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={responsavel}
              onChange={(e) => setResponsavel(e.target.value)}
              placeholder="Responsável"
              className="border border-line rounded-lg px-3 py-2 text-sm flex-1"
            />
            <Button type="submit"><Plus className="w-4 h-4" /></Button>
          </div>
        </form>
      </Card>

      <Card title="Visitas agendadas">
        {loading ? (
          <p className="text-sm text-muted py-6 text-center">Carregando...</p>
        ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-line">
              <th className="pb-3 font-medium">Cliente</th>
              <th className="pb-3 font-medium">Data e hora</th>
              <th className="pb-3 font-medium">Unidade</th>
              <th className="pb-3 font-medium">Responsável</th>
              <th className="pb-3 font-medium">Resultado</th>
              <th className="pb-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {filtered.map((v) => (
              <tr key={v.id}>
                <td className="py-3 font-medium flex items-center gap-1.5">
                  <CalendarClock className="w-3.5 h-3.5 text-muted" /> {v.cliente}
                </td>
                <td className="py-3 text-muted">{new Date(v.dataHora).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td className="py-3">{UNITS.find((u) => u.id === v.unitSlug)?.name ?? v.unitSlug}</td>
                <td className="py-3 text-muted">{v.responsavel}</td>
                <td className="py-3">
                  {v.resultado ? (
                    <div>
                      <Badge tone={v.resultado === 'virou_orcamento' ? 'teal' : 'neutral'}>{resultLabel[v.resultado]}</Badge>
                      {v.noAdvanceReason && <p className="text-xs text-muted mt-1 italic">{v.noAdvanceReason}</p>}
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={() => setResult(v.id, 'virou_orcamento')} className="text-teal text-xs font-medium">Virou orçamento</button>
                      <button onClick={() => openReasonModal(v.id)} className="text-muted text-xs font-medium">Não avançou</button>
                    </div>
                  )}
                </td>
                <td className="py-3 text-right">
                  <button onClick={() => handleRemove(v.id)} className="text-muted hover:text-danger" aria-label="Remover">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="py-6 text-center text-muted">Nenhuma visita agendada.</td></tr>
            )}
          </tbody>
        </table>
        )}
      </Card>

      {reasonModalId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setReasonModalId(null)} />
          <div className="relative w-full max-w-sm bg-surface rounded-card p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-display font-semibold">Por que não avançou?</h2>
              <button onClick={() => setReasonModalId(null)} className="text-muted hover:text-ink">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleConfirmReason} className="space-y-3">
              <textarea
                autoFocus
                value={reasonInput}
                onChange={(e) => setReasonInput(e.target.value)}
                rows={3}
                placeholder="Ex: achou o valor alto, fechou com outro espaço, sem retorno..."
                className="w-full border border-line rounded-lg px-3 py-2 text-sm"
              />
              <Button type="submit" className="w-full justify-center">Salvar</Button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
