import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus, X, CalendarClock, Bell, Repeat, Check } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { supabase } from '../lib/supabaseClient'
import { useUnit, UNITS } from '../lib/UnitContext'
import { useUndo } from '../lib/UndoContext'
import { todayIso, friendlyDbError } from '../lib/format'
import { useOpenOnQueryParam } from '../lib/useOpenOnQueryParam'
import { occurrences, horarioLabel, addDaysIso, REPEAT_LABEL, type AgendaItem, type AgendaRepeat } from '../lib/agenda'
import { Visits } from './Visits'

// Agenda: calendário com as visitas (tabela visits) e os compromissos que a
// equipe adiciona (agenda_items). Festas ficam no Mapa de reservas.

interface Evento {
  key: string
  dia: string
  hora: string // para ordenar ('' = dia inteiro)
  tipo: 'visita' | 'compromisso'
  titulo: string
  detalhe: string
  unitId: string | null
  item?: AgendaItem
  feitoPor?: string | null
  visitaResultado?: string | null
}

const SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const AVISO_DIAS = [0, 1, 2, 3, 5, 7, 15, 30]

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const pad = (n: number) => String(n).padStart(2, '0')
function localDateIso(ts: string) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function localTime(ts: string) {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface Rascunho {
  id: string | null
  title: string
  notes: string
  unit: string // '' = as duas
  starts_on: string
  all_day: boolean
  start_time: string
  end_time: string
  repeat: AgendaRepeat
  repeat_until: string
  notify: boolean
  notify_days_before: number
}

function rascunhoVazio(dia: string): Rascunho {
  return { id: null, title: '', notes: '', unit: '', starts_on: dia, all_day: true, start_time: '', end_time: '', repeat: 'nao', repeat_until: '', notify: false, notify_days_before: 0 }
}

export function Agenda() {
  const { selectedUnit, unitDbIds, unitDbIdsLoading } = useUnit()
  const { scheduleDelete } = useUndo()
  const hoje = todayIso()
  const [searchParams] = useSearchParams()
  const [aba, setAba] = useState<'calendario' | 'visitas'>(searchParams.get('aba') === 'visitas' ? 'visitas' : 'calendario')
  const [mes, setMes] = useState(hoje.slice(0, 7))
  const [diaSel, setDiaSel] = useState(hoje)
  const [itens, setItens] = useState<AgendaItem[]>([])
  const [feitos, setFeitos] = useState<Record<string, string>>({}) // `${item}|${dia}` -> quem marcou
  const [visitas, setVisitas] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<Rascunho | null>(null)
  const [saving, setSaving] = useState(false)
  const [apagando, setApagando] = useState<{ item: AgendaItem; dia: string } | null>(null)

  useOpenOnQueryParam('novo', () => setForm(rascunhoVazio(hoje)))

  const unitFilter = selectedUnit === 'todas' ? null : unitDbIds[selectedUnit]?.unitId ?? null
  const unitName = (id: string | null) => (id ? UNITS.find((u) => unitDbIds[u.id]?.unitId === id)?.name ?? '' : 'As duas unidades')

  useEffect(() => {
    if (!unitDbIdsLoading) load()
  }, [unitDbIdsLoading])

  async function load() {
    setLoading(true)
    const [{ data: it, error: e1 }, { data: dn }, { data: vs }] = await Promise.all([
      supabase.from('agenda_items').select('*').order('starts_on'),
      supabase.from('agenda_done').select('item_id, occurrence, done_by_name'),
      supabase.from('visits').select('id, client_name, unit_id, scheduled_at, responsible, result'),
    ])
    setLoading(false)
    if (e1) {
      setError(/agenda_items|schema cache|does not exist/i.test(e1.message)
        ? 'A Agenda ainda não está ativada no banco de dados (falta rodar a migração 067_agenda.sql).'
        : 'Não foi possível carregar a agenda.')
      return
    }
    setItens(((it ?? []) as any[]).map((i) => ({ ...i, skipped_dates: i.skipped_dates ?? [] })))
    const f: Record<string, string> = {}
    for (const d of dn ?? []) f[`${d.item_id}|${d.occurrence}`] = d.done_by_name ?? 'alguém'
    setFeitos(f)
    setVisitas(vs ?? [])
  }

  // Janela do calendário: da semana do dia 1 até completar 6 semanas.
  const grade = useMemo(() => {
    const primeiro = `${mes}-01`
    const dow = new Date(`${primeiro}T12:00:00Z`).getUTCDay()
    const ini = addDaysIso(primeiro, -dow)
    return Array.from({ length: 42 }, (_, i) => addDaysIso(ini, i))
  }, [mes])

  const eventosPorDia = useMemo(() => {
    const de = grade[0] < diaSel ? grade[0] : diaSel
    const ate = grade[41] > diaSel ? grade[41] : diaSel
    const map: Record<string, Evento[]> = {}
    const add = (e: Evento) => { (map[e.dia] ??= []).push(e) }
    for (const it of itens) {
      if (unitFilter && it.unit_id && it.unit_id !== unitFilter) continue
      for (const dia of occurrences(it, de, ate)) {
        add({
          key: `${it.id}|${dia}`, dia, hora: it.all_day ? '' : (it.start_time ?? '').slice(0, 5), tipo: 'compromisso',
          titulo: it.title, detalhe: horarioLabel(it), unitId: it.unit_id, item: it, feitoPor: feitos[`${it.id}|${dia}`] ?? null,
        })
      }
    }
    for (const v of visitas) {
      if (unitFilter && v.unit_id !== unitFilter) continue
      const dia = localDateIso(v.scheduled_at)
      if (dia < de || dia > ate) continue
      add({
        key: `v-${v.id}`, dia, hora: localTime(v.scheduled_at), tipo: 'visita', titulo: `Visita: ${v.client_name}`,
        detalhe: `${localTime(v.scheduled_at)}${v.responsible ? ` · com ${v.responsible}` : ''}`, unitId: v.unit_id, visitaResultado: v.result,
      })
    }
    for (const k of Object.keys(map)) map[k].sort((a, b) => (a.hora || '00:00').localeCompare(b.hora || '00:00'))
    return map
  }, [grade, diaSel, itens, visitas, feitos, unitFilter])

  function mudarMes(delta: number) {
    const [y, m] = mes.split('-').map(Number)
    const d = new Date(Date.UTC(y, m - 1 + delta, 1, 12))
    const novo = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
    setMes(novo)
    setDiaSel(novo === hoje.slice(0, 7) ? hoje : `${novo}-01`)
  }

  function editar(it: AgendaItem) {
    setForm({
      id: it.id, title: it.title, notes: it.notes ?? '',
      unit: it.unit_id ? UNITS.find((u) => unitDbIds[u.id]?.unitId === it.unit_id)?.id ?? '' : '',
      starts_on: it.starts_on, all_day: it.all_day, start_time: (it.start_time ?? '').slice(0, 5), end_time: (it.end_time ?? '').slice(0, 5),
      repeat: it.repeat, repeat_until: it.repeat_until ?? '', notify: it.notify, notify_days_before: it.notify_days_before,
    })
  }

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    if (!form.title.trim()) return setError('Escreva o que é o compromisso.')
    if (!form.all_day && !form.start_time) return setError('Informe o horário ou marque "Dia inteiro".')
    if (form.repeat !== 'nao' && form.repeat_until && form.repeat_until < form.starts_on) return setError('A repetição não pode terminar antes do primeiro dia.')
    const payload = {
      title: form.title.trim(),
      notes: form.notes.trim() || null,
      unit_id: form.unit ? unitDbIds[form.unit]?.unitId ?? null : null,
      starts_on: form.starts_on,
      all_day: form.all_day,
      start_time: form.all_day ? null : form.start_time,
      end_time: form.all_day || !form.end_time ? null : form.end_time,
      repeat: form.repeat,
      repeat_until: form.repeat === 'nao' || !form.repeat_until ? null : form.repeat_until,
      notify: form.notify,
      notify_days_before: form.notify ? form.notify_days_before : 0,
    }
    setSaving(true)
    const { error: err } = form.id
      ? await supabase.from('agenda_items').update(payload).eq('id', form.id)
      : await supabase.from('agenda_items').insert(payload)
    setSaving(false)
    if (err) return setError(friendlyDbError(err.message))
    setError(null)
    setForm(null)
    setDiaSel(form.starts_on)
    setMes(form.starts_on.slice(0, 7))
    await load()
  }

  async function marcarFeito(it: AgendaItem, dia: string, feito: boolean) {
    const { error: err } = await supabase.rpc('agenda_marcar_feito', { p_item: it.id, p_occurrence: dia, p_feito: feito })
    if (err) return setError(friendlyDbError(err.message))
    await load()
  }

  async function apagarSoEsteDia() {
    if (!apagando) return
    const { item, dia } = apagando
    setApagando(null)
    const { error: err } = await supabase.from('agenda_items').update({ skipped_dates: [...item.skipped_dates, dia] }).eq('id', item.id)
    if (err) return setError(friendlyDbError(err.message))
    await load()
  }

  function apagarTudo(item: AgendaItem) {
    setApagando(null)
    setItens((prev) => prev.filter((i) => i.id !== item.id))
    // Recriar perderia quem colocou e os dias marcados como feitos, então
    // apaga só depois dos segundos do "Desfazer".
    scheduleDelete({
      irreversible: true,
      label: `Compromisso "${item.title}" apagado`,
      commit: async () => {
        await supabase.from('agenda_items').delete().eq('id', item.id)
      },
      undo: async () => {
        setItens((prev) => [...prev, item])
      },
    })
  }

  function pedirApagar(item: AgendaItem, dia: string) {
    if (item.repeat === 'nao') {
      if (window.confirm(`Apagar o compromisso "${item.title}"?`)) apagarTudo(item)
    } else {
      setApagando({ item, dia })
    }
  }

  const doDia = eventosPorDia[diaSel] ?? []
  const [anoMes, mesNum] = [mes.slice(0, 4), Number(mes.slice(5, 7))]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Agenda</h1>
          <p className="text-sm text-muted mt-1">Visitas e compromissos da equipe. As festas ficam no Mapa de reservas.</p>
        </div>
        {aba === 'calendario' && (
          <Button onClick={() => setForm(rascunhoVazio(diaSel))}><Plus className="w-4 h-4" /> Novo compromisso</Button>
        )}
      </div>

      <div className="flex gap-1 border-b border-line">
        {([['calendario', 'Calendário'], ['visitas', 'Visitas']] as const).map(([k, l]) => (
          <button
            key={k}
            onClick={() => { setAba(k); if (k === 'calendario') load() }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${aba === k ? 'border-purple text-purple' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {l}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5 flex justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Fechar"><X className="w-4 h-4" /></button>
        </div>
      )}

      {aba === 'visitas' ? (
        <Visits embedded />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <button onClick={() => mudarMes(-1)} className="p-2 rounded-lg hover:bg-paper" aria-label="Mês anterior"><ChevronLeft className="w-4 h-4" /></button>
              <div className="text-center">
                <p className="font-semibold">{MESES[mesNum - 1]} {anoMes}</p>
                {mes !== hoje.slice(0, 7) && (
                  <button onClick={() => { setMes(hoje.slice(0, 7)); setDiaSel(hoje) }} className="text-xs text-purple">Voltar para hoje</button>
                )}
              </div>
              <button onClick={() => mudarMes(1)} className="p-2 rounded-lg hover:bg-paper" aria-label="Próximo mês"><ChevronRight className="w-4 h-4" /></button>
            </div>
            {loading ? (
              <p className="text-sm text-muted py-10 text-center">Carregando...</p>
            ) : (
              <>
                <div className="grid grid-cols-7 text-center text-[11px] font-medium text-muted mb-1">
                  {SEMANA.map((s) => <div key={s}>{s}</div>)}
                </div>
                <div className="grid grid-cols-7 gap-px bg-line rounded-lg overflow-hidden border border-line">
                  {grade.map((dia) => {
                    const evs = eventosPorDia[dia] ?? []
                    const foraDoMes = dia.slice(0, 7) !== mes
                    const sel = dia === diaSel
                    return (
                      <button
                        key={dia}
                        onClick={() => setDiaSel(dia)}
                        className={`min-h-[56px] sm:min-h-[92px] p-1 text-left align-top flex flex-col gap-0.5 ${sel ? 'bg-purple-light' : 'bg-surface hover:bg-paper'} ${foraDoMes ? 'opacity-45' : ''}`}
                      >
                        <span className={`text-xs w-6 h-6 flex items-center justify-center rounded-full ${dia === hoje ? 'bg-purple text-white font-semibold' : ''}`}>{Number(dia.slice(8, 10))}</span>
                        {/* Celular: bolinhas; telas maiores: o título */}
                        <span className="flex flex-wrap gap-0.5 sm:hidden">
                          {evs.slice(0, 4).map((e) => (
                            <span key={e.key} className={`w-1.5 h-1.5 rounded-full ${e.tipo === 'visita' ? 'bg-teal' : e.feitoPor ? 'bg-muted' : 'bg-purple'}`} />
                          ))}
                        </span>
                        <span className="hidden sm:flex flex-col gap-0.5 w-full">
                          {evs.slice(0, 3).map((e) => (
                            <span key={e.key} className={`truncate text-[11px] rounded px-1 py-0.5 ${e.tipo === 'visita' ? 'bg-teal-light text-teal' : 'bg-purple-light text-purple-dark'} ${e.feitoPor ? 'line-through opacity-60' : ''}`}>
                              {e.hora && <strong className="font-semibold">{e.hora} </strong>}{e.tipo === 'visita' ? e.titulo.replace('Visita: ', 'Visita ') : e.titulo}
                            </span>
                          ))}
                          {evs.length > 3 && <span className="text-[11px] text-muted px-1">+{evs.length - 3} mais</span>}
                        </span>
                      </button>
                    )
                  })}
                </div>
                <div className="flex flex-wrap gap-4 mt-3 text-xs text-muted">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-purple" /> Compromisso</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-teal" /> Visita</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-muted" /> Feito</span>
                </div>
              </>
            )}
          </Card>

          <Card
            title={`${diaSel === hoje ? 'Hoje · ' : ''}${dm(diaSel)} · ${SEMANA[new Date(`${diaSel}T12:00:00Z`).getUTCDay()]}`}
            action={<button onClick={() => setForm(rascunhoVazio(diaSel))} className="text-xs text-purple font-medium flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Adicionar</button>}
          >
            {doDia.length === 0 ? (
              <p className="text-sm text-muted">Nada neste dia.</p>
            ) : (
              <ul className="divide-y divide-line">
                {doDia.map((e) => (
                  <li key={e.key} className="py-3">
                    <div className="flex items-start gap-2">
                      {e.tipo === 'visita' ? <CalendarClock className="w-4 h-4 text-teal mt-0.5 shrink-0" /> : <span className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${e.feitoPor ? 'bg-muted' : 'bg-purple'}`} />}
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-medium ${e.feitoPor ? 'line-through text-muted' : ''}`}>{e.titulo}</p>
                        <p className="text-xs text-muted">{e.detalhe} · {unitName(e.unitId)}</p>
                        {e.item && (
                          <>
                            {e.item.notes && <p className="text-xs mt-1 whitespace-pre-line">{e.item.notes}</p>}
                            <div className="flex flex-wrap gap-1.5 mt-1.5">
                              {e.item.repeat !== 'nao' && <Badge><Repeat className="w-3 h-3" /> {REPEAT_LABEL[e.item.repeat]}{e.item.repeat_until ? ` até ${dm(e.item.repeat_until)}` : ''}</Badge>}
                              {e.item.notify && <Badge tone="amber"><Bell className="w-3 h-3" /> Avisa no Painel{e.item.notify_days_before ? ` ${e.item.notify_days_before} dia${e.item.notify_days_before > 1 ? 's' : ''} antes` : ' no dia'}</Badge>}
                              {e.feitoPor && <Badge tone="teal"><Check className="w-3 h-3" /> Feito por {e.feitoPor}</Badge>}
                            </div>
                            <p className="text-[11px] text-muted mt-1">Colocado por {e.item.created_by_name ?? '—'}</p>
                            <div className="flex flex-wrap gap-3 mt-2 text-xs">
                              <button onClick={() => marcarFeito(e.item!, e.dia, !e.feitoPor)} className="text-purple font-medium">{e.feitoPor ? 'Desmarcar feito' : 'Marcar como feito'}</button>
                              <button onClick={() => editar(e.item!)} className="text-muted hover:text-ink">Editar</button>
                              <button onClick={() => pedirApagar(e.item!, e.dia)} className="text-muted hover:text-danger">Apagar</button>
                            </div>
                          </>
                        )}
                        {e.tipo === 'visita' && (
                          <p className="text-[11px] text-muted mt-1">
                            {e.visitaResultado === 'virou_orcamento' ? 'Virou orçamento' : e.visitaResultado === 'nao_avancou' ? 'Não avançou' : <button onClick={() => setAba('visitas')} className="text-purple">Marcar resultado na aba Visitas</button>}
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setForm(null)} />
          <div className="relative w-full max-w-md bg-surface rounded-card p-6 shadow-xl max-h-[90vh] overflow-y-auto overscroll-contain">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-display font-semibold">{form.id ? 'Editar compromisso' : 'Novo compromisso'}</h2>
              <button onClick={() => setForm(null)} className="text-muted hover:text-ink" aria-label="Fechar"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={salvar} className="space-y-3">
              <div>
                <label className="block text-xs text-muted mb-1">O que é *</label>
                <input autoFocus required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ex: Reunião com fornecedor, manutenção do brinquedo" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted mb-1">{form.repeat === 'nao' ? 'Data' : 'Primeiro dia'}</label>
                  <input type="date" required value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value })} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Unidade</label>
                  <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="w-full border border-line rounded-lg px-3 py-2 text-sm">
                    <option value="">As duas</option>
                    {UNITS.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.all_day} onChange={(e) => setForm({ ...form, all_day: e.target.checked })} /> Dia inteiro (sem horário)
              </label>
              {!form.all_day && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-muted mb-1">Começa *</label>
                    <input type="time" required value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-muted mb-1">Termina (opcional)</label>
                    <input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted mb-1">Repetir</label>
                  <select value={form.repeat} onChange={(e) => setForm({ ...form, repeat: e.target.value as AgendaRepeat })} className="w-full border border-line rounded-lg px-3 py-2 text-sm">
                    {(Object.keys(REPEAT_LABEL) as AgendaRepeat[]).map((r) => <option key={r} value={r}>{REPEAT_LABEL[r]}</option>)}
                  </select>
                </div>
                {form.repeat !== 'nao' && (
                  <div>
                    <label className="block text-xs text-muted mb-1">Até (opcional)</label>
                    <input type="date" value={form.repeat_until} min={form.starts_on} onChange={(e) => setForm({ ...form, repeat_until: e.target.value })} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
                  </div>
                )}
              </div>
              {form.repeat === 'mensal' && Number(form.starts_on.slice(8, 10)) > 28 && (
                <p className="text-xs text-muted -mt-1">Nos meses que não têm o dia {Number(form.starts_on.slice(8, 10))}, cai no último dia do mês.</p>
              )}
              <div>
                <label className="block text-xs text-muted mb-1">Observação (opcional)</label>
                <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="bg-paper rounded-lg px-3 py-2.5 space-y-2">
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.notify} onChange={(e) => setForm({ ...form, notify: e.target.checked })} className="mt-0.5" />
                  <span>
                    Avisar no Painel
                    <span className="block text-xs text-muted">Aparece no Painel principal para todos, até alguém marcar "Feito".</span>
                  </span>
                </label>
                {form.notify && (
                  <select value={form.notify_days_before} onChange={(e) => setForm({ ...form, notify_days_before: Number(e.target.value) })} className="w-full border border-line rounded-lg px-3 py-2 text-sm">
                    {AVISO_DIAS.map((d) => <option key={d} value={d}>{d === 0 ? 'No próprio dia' : `${d} dia${d > 1 ? 's' : ''} antes`}</option>)}
                  </select>
                )}
              </div>
              {form.id && form.repeat !== 'nao' && <p className="text-xs text-muted">A alteração vale para todos os dias da repetição.</p>}
              <Button type="submit" className="w-full justify-center" disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button>
            </form>
          </div>
        </div>
      )}

      {apagando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setApagando(null)} />
          <div className="relative w-full max-w-sm bg-surface rounded-card p-6 shadow-xl space-y-3">
            <h2 className="text-lg font-display font-semibold">Apagar "{apagando.item.title}"</h2>
            <p className="text-sm text-muted">Este compromisso se repete ({REPEAT_LABEL[apagando.item.repeat].toLowerCase()}).</p>
            <Button className="w-full justify-center" onClick={apagarSoEsteDia}>Apagar só o dia {dm(apagando.dia)}</Button>
            <Button variant="secondary" className="w-full justify-center" onClick={() => apagarTudo(apagando.item)}>Apagar todos os dias</Button>
            <button onClick={() => setApagando(null)} className="w-full text-sm text-muted">Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}
