import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { Card } from './ui/Card'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import { useUnit, UNITS, allUnitsLabel } from '../lib/UnitContext'
import { todayIso, friendlyDbError } from '../lib/format'
import { diasParaAvisar, horarioLabel, quandoLabel, type AgendaItem } from '../lib/agenda'
import { useCompany } from '../lib/CompanyContext'

// Painel: compromissos da Agenda marcados com "Avisar no Painel". Aparecem
// para todos os usuários (mesmo quem não abre a Agenda) até alguém marcar
// "Feito".

interface Linha {
  key: string
  item: AgendaItem
  dia: string
}

export function AgendaNotices() {
  const { can } = useAuth()
  const { brand } = useCompany()
  const navigate = useNavigate()
  const { selectedUnit, unitDbIds, unitDbIdsLoading } = useUnit()
  const [itens, setItens] = useState<(AgendaItem & { done_dates: string[] })[]>([])
  const [error, setError] = useState<string | null>(null)
  const hoje = todayIso()

  useEffect(() => {
    load()
    const aoVoltar = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', aoVoltar)
    const timer = window.setInterval(aoVoltar, 60000)
    return () => {
      document.removeEventListener('visibilitychange', aoVoltar)
      window.clearInterval(timer)
    }
  }, [])

  async function load() {
    const { data, error: err } = await supabase.rpc('agenda_painel')
    // Antes da migração 067 a função não existe: simplesmente não mostra nada.
    if (err) return
    setItens(((data ?? []) as any[]).map((i) => ({ ...i, notify: true, skipped_dates: i.skipped_dates ?? [], done_dates: i.done_dates ?? [] })))
  }

  const unitFilter = selectedUnit === 'todas' ? null : unitDbIds[selectedUnit]?.unitId ?? null
  const linhas = useMemo(() => {
    const out: Linha[] = []
    for (const it of itens) {
      if (unitFilter && it.unit_id && it.unit_id !== unitFilter) continue
      for (const dia of diasParaAvisar(it, it.done_dates, hoje)) out.push({ key: `${it.id}|${dia}`, item: it, dia })
    }
    return out.sort((a, b) => a.dia.localeCompare(b.dia))
  }, [itens, unitFilter, hoje])

  async function feito(l: Linha) {
    const { error: err } = await supabase.rpc('agenda_marcar_feito', { p_item: l.item.id, p_occurrence: l.dia, p_feito: true })
    if (err) return setError(friendlyDbError(err.message))
    setItens((prev) => prev.map((i) => (i.id === l.item.id ? { ...i, done_dates: [...i.done_dates, l.dia] } : i)))
  }

  // Agenda desligada para a empresa (painel da plataforma): sem avisos.
  if (brand.disabledModules.includes('agenda') || unitDbIdsLoading || linhas.length === 0) return null
  const unitName = (id: string | null) => (id ? UNITS.find((u) => unitDbIds[u.id]?.unitId === id)?.name ?? '' : allUnitsLabel())

  return (
    <Card title={`Agenda · ${linhas.length} aviso${linhas.length > 1 ? 's' : ''}`} className="border-amber/40">
      {error && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5 mb-2">{error}</div>}
      <ul className="divide-y divide-line">
        {linhas.map((l) => {
          const atrasado = l.dia < hoje
          return (
            <li key={l.key} className="py-3 flex flex-wrap gap-3 items-center">
              <span className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${atrasado ? 'bg-danger-light text-danger' : 'bg-amber-light text-amber'}`}>
                <Bell className="w-4 h-4" />
              </span>
              <div className="flex-1 min-w-[200px]">
                <p className="text-sm"><strong className="font-semibold">{l.item.title}</strong> — <span className={atrasado ? 'text-danger' : ''}>{quandoLabel(l.dia, hoje)}</span></p>
                <p className="text-xs text-muted">
                  {horarioLabel(l.item)} · {unitName(l.item.unit_id)} · colocado por {l.item.created_by_name ?? '—'}
                </p>
                {l.item.notes && <p className="text-xs mt-0.5 text-ink/80">{l.item.notes}</p>}
              </div>
              <div className="flex gap-2">
                {can('page:visitas') && (
                  <button onClick={() => navigate('/visitas')} className="text-xs border border-line rounded-lg px-2.5 py-1.5">Abrir agenda</button>
                )}
                <button onClick={() => feito(l)} className="text-xs bg-purple-light text-purple-dark font-semibold rounded-lg px-2.5 py-1.5">Feito</button>
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
