import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, X, LayoutGrid, ChevronLeft, ChevronRight, MessageCircle, Trash2 } from 'lucide-react'
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isToday,
  addMonths,
  subMonths,
  format,
  parseISO,
} from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Can } from '../components/Can'
import { ClientQuickCreateModal } from '../components/ClientQuickCreateModal'
import { useUnit, UNITS } from '../lib/UnitContext'
import { supabase } from '../lib/supabaseClient'
import { openWhatsApp, buildMessage, MESSAGE_TEMPLATES } from '../lib/whatsapp'
import { useOpenOnQueryParam } from '../lib/useOpenOnQueryParam'
import { useUndo } from '../lib/UndoContext'
import { packagePriceForDate, type ReservationStatus, type DiscountType } from '../types'

const statusTone: Record<ReservationStatus, 'purple' | 'orange' | 'teal' | 'amber' | 'danger'> = {
  orcamento: 'orange',
  confirmada: 'teal',
  sinal_pago: 'amber',
  quitada: 'teal',
  cancelada: 'danger',
}

const statusLabel: Record<ReservationStatus, string> = {
  orcamento: 'Orçamento',
  confirmada: 'Confirmada',
  sinal_pago: 'Sinal pago',
  quitada: 'Quitada',
  cancelada: 'Cancelada',
}

// Cor sólida por status, usada nas pastilhas de nome dentro do calendário
// (o Badge padrão usa fundo claro, que fica pouco legível em células pequenas)
const statusDot: Record<ReservationStatus, string> = {
  orcamento: 'bg-orange',
  confirmada: 'bg-teal',
  sinal_pago: 'bg-amber',
  quitada: 'bg-teal',
  cancelada: 'bg-danger',
}

interface Reservation {
  id: string
  unidade: string
  data: string
  horario: string
  cliente: string
  status: ReservationStatus
  tipoEvento: string
  convidados: number
  valorTotal: number
}

const EVENT_TYPES = ['Aniversário infantil', 'Debutante', 'Casamento', 'Corporativo', 'Outro']

const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

interface WaitlistEntry {
  id: string
  unidade: string
  clientId: string
  cliente: string
  phone: string | null
  dataDesejada: string
  dataDesejadaIso: string
  notes: string | null
}

function formatHour(t: string) {
  const [h, m] = t.split(':')
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`
}

export function Reservations() {
  const navigate = useNavigate()
  const { selectedUnit, unitDbIds, unitDbIdsLoading } = useUnit()
  const { scheduleDelete } = useUndo()
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [clients, setClients] = useState<{ id: string; name: string; child_name: string | null; child_birthday: string | null }[]>([])
  const [packages, setPackages] = useState<
    { id: string; name: string; base_price: number; weekday_price: number | null; weekend_price: number | null; guest_limit: number | null; unit_id: string | null }[]
  >([])
  const [view, setView] = useState<'calendario' | 'lista' | 'hoje'>('calendario')
  const [selected, setSelected] = useState<Reservation | null>(null)
  const [currentMonth, setCurrentMonth] = useState(() => new Date())
  const [showForm, setShowForm] = useState(false)
  const [showQuickClient, setShowQuickClient] = useState(false)
  useOpenOnQueryParam('novo', () => setShowForm(true))
  const [saving, setSaving] = useState(false)

  const [waitlistEntries, setWaitlistEntries] = useState<WaitlistEntry[]>([])
  const [waitlistClienteId, setWaitlistClienteId] = useState('')
  const [waitlistUnidade, setWaitlistUnidade] = useState(selectedUnit === 'todas' ? UNITS[0].id : selectedUnit)
  const [waitlistData, setWaitlistData] = useState('')
  const [waitlistNotes, setWaitlistNotes] = useState('')
  const [savingWaitlist, setSavingWaitlist] = useState(false)

  const [formClienteId, setFormClienteId] = useState('')
  const [formUnidade, setFormUnidade] = useState(selectedUnit === 'todas' ? UNITS[0].id : selectedUnit)
  const [formData, setFormData] = useState('2026-09-07')
  const [formInicio, setFormInicio] = useState('14:00')
  const [formFim, setFormFim] = useState('19:00')
  const [formStatus, setFormStatus] = useState<ReservationStatus>('orcamento')
  const [formTipoEvento, setFormTipoEvento] = useState(EVENT_TYPES[0])
  const [formTipoEventoOutro, setFormTipoEventoOutro] = useState('')
  const [formConvidados, setFormConvidados] = useState('')
  const [formValor, setFormValor] = useState('')
  const [formPacoteId, setFormPacoteId] = useState('')
  const [formChildName, setFormChildName] = useState('')
  const [formChildAge, setFormChildAge] = useState('')
  const [formTema, setFormTema] = useState('')
  const [formPratoQuente, setFormPratoQuente] = useState('')
  const [formSaborBolo, setFormSaborBolo] = useState('')
  const [formDescontoTipo, setFormDescontoTipo] = useState<DiscountType | ''>('')
  const [formDescontoValor, setFormDescontoValor] = useState('')
  const [formCortesia, setFormCortesia] = useState('')
  const [outrosAniversariantes, setOutrosAniversariantes] = useState<{ name: string; age: string }[]>([])

  useEffect(() => {
    if (showForm) {
      setFormUnidade(selectedUnit === 'todas' ? UNITS[0].id : selectedUnit)
      loadClients()
      loadPackages()
    }
  }, [showForm, selectedUnit])

  async function loadPackages() {
    const { data, error } = await supabase
      .from('packages')
      .select('id, name, base_price, weekday_price, weekend_price, guest_limit, unit_id')
      .eq('active', true)
      .order('name')
    if (error) {
      setError('Não foi possível carregar os pacotes.')
      return
    }
    setPackages(
      (data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        base_price: Number(p.base_price),
        weekday_price: p.weekday_price != null ? Number(p.weekday_price) : null,
        weekend_price: p.weekend_price != null ? Number(p.weekend_price) : null,
        guest_limit: p.guest_limit,
        unit_id: p.unit_id,
      })),
    )
  }

  useEffect(() => {
    if (!unitDbIdsLoading) loadReservations()
  }, [unitDbIdsLoading, unitDbIds])

  useEffect(() => {
    loadClients()
  }, [])

  useEffect(() => {
    if (!unitDbIdsLoading) loadWaitlist()
  }, [unitDbIdsLoading, unitDbIds])

  async function loadClients() {
    const { data } = await supabase.from('clients').select('id, name, child_name, child_birthday').order('name')
    setClients(data ?? [])
  }

  // Nome do aniversariante já vem do cadastro do cliente — evita digitar de
  // novo e ficar diferente do que está lá (a idade é recalculada à parte,
  // pelo efeito abaixo, com base na data do evento).
  function handleClienteChange(clienteId: string, clientOverride?: { child_name: string | null }) {
    setFormClienteId(clienteId)
    const client = clientOverride ?? clients.find((c) => c.id === clienteId)
    setFormChildName(client?.child_name ?? '')
  }

  async function loadWaitlist() {
    const unitIdToSlug: Record<string, string> = {}
    for (const slug of Object.keys(unitDbIds)) unitIdToSlug[unitDbIds[slug].unitId] = slug

    const { data, error } = await supabase
      .from('waitlist')
      .select('id, client_id, desired_date, notes, client:clients(name, phone), space:spaces(unit_id)')
      .order('desired_date')

    if (error) return

    setWaitlistEntries(
      (data ?? []).map((w: any) => ({
        id: w.id,
        unidade: unitIdToSlug[w.space?.unit_id] ?? '',
        clientId: w.client_id,
        cliente: w.client?.name ?? '—',
        phone: w.client?.phone ?? null,
        dataDesejada: format(parseISO(w.desired_date), 'dd/MM/yyyy'),
        dataDesejadaIso: w.desired_date,
        notes: w.notes,
      })),
    )
  }

  async function handleAddWaitlist(e: FormEvent) {
    e.preventDefault()
    if (!waitlistClienteId || !waitlistData) return
    const dbIds = unitDbIds[waitlistUnidade]
    if (!dbIds) {
      setError('Não encontrei essa unidade no banco de dados ainda.')
      return
    }
    setSavingWaitlist(true)
    const { data, error } = await supabase
      .from('waitlist')
      .insert({ client_id: waitlistClienteId, space_id: dbIds.spaceId, desired_date: waitlistData, notes: waitlistNotes.trim() || null })
      .select('id, desired_date, notes, client:clients(name, phone)')
      .single()
    setSavingWaitlist(false)

    if (error) {
      setError('Não foi possível adicionar à lista de espera.')
      return
    }

    setWaitlistEntries((prev) => [
      ...prev,
      {
        id: data.id,
        unidade: waitlistUnidade,
        clientId: waitlistClienteId,
        cliente: (data.client as any)?.name ?? '—',
        phone: (data.client as any)?.phone ?? null,
        dataDesejada: format(parseISO(data.desired_date), 'dd/MM/yyyy'),
        dataDesejadaIso: data.desired_date,
        notes: data.notes,
      },
    ])
    setWaitlistClienteId('')
    setWaitlistData('')
    setWaitlistNotes('')
  }

  function handleRemoveWaitlist(id: string) {
    const entry = waitlistEntries.find((w) => w.id === id)
    if (!entry) return
    setWaitlistEntries((prev) => prev.filter((w) => w.id !== id))
    scheduleDelete({
      label: `"${entry.cliente}" removido da lista de espera`,
      commit: async () => {
        await supabase.from('waitlist').delete().eq('id', id)
      },
      undo: async () => {
        await supabase.from('waitlist').insert({
          id,
          client_id: entry.clientId,
          space_id: unitDbIds[entry.unidade]?.spaceId,
          desired_date: entry.dataDesejadaIso,
          notes: entry.notes,
        })
        setWaitlistEntries((prev) => [...prev, entry])
      },
    })
  }

  async function handleNotifyWaitlist(w: WaitlistEntry) {
    const unidadeNome = UNITS.find((u) => u.id === w.unidade)?.name ?? ''
    const message = buildMessage(MESSAGE_TEMPLATES.vaga_disponivel, { cliente: w.cliente, data: w.dataDesejada, unidade: unidadeNome })
    openWhatsApp(w.phone, message)
    await supabase.from('contact_history').insert({ client_name: w.cliente, type: 'Aviso de vaga (lista de espera)', channel: 'whatsapp', user_name: 'Você' })
  }

  async function loadReservations() {
    setLoading(true)
    setError(null)

    const dbIdToSlug: Record<string, string> = {}
    for (const slug of Object.keys(unitDbIds)) dbIdToSlug[unitDbIds[slug].unitId] = slug

    const { data, error } = await supabase
      .from('reservations')
      .select('id, event_date, start_time, end_time, status, event_type, guest_count, total_value, unit_id, client:clients(name)')
      .order('event_date')

    if (error) {
      setError('Não foi possível carregar as reservas.')
      setLoading(false)
      return
    }

    const mapped: Reservation[] = (data ?? []).map((r: any) => ({
      id: r.id,
      unidade: dbIdToSlug[r.unit_id] ?? '',
      data: format(parseISO(r.event_date), 'dd/MM/yyyy'),
      horario: `${formatHour(String(r.start_time).slice(0, 5))}–${formatHour(String(r.end_time).slice(0, 5))}`,
      cliente: r.client?.name ?? '—',
      status: r.status,
      tipoEvento: r.event_type ?? 'Outro',
      convidados: r.guest_count ?? 0,
      valorTotal: Number(r.total_value) || 0,
    }))
    setReservations(mapped)
    setLoading(false)
  }

  function resetForm() {
    setFormClienteId('')
    setFormStatus('orcamento')
    setFormTipoEvento(EVENT_TYPES[0])
    setFormTipoEventoOutro('')
    setFormConvidados('')
    setFormValor('')
    setFormPacoteId('')
    setFormChildName('')
    setFormChildAge('')
    setFormTema('')
    setFormPratoQuente('')
    setFormSaborBolo('')
    setFormDescontoTipo('')
    setFormDescontoValor('')
    setFormCortesia('')
    setOutrosAniversariantes([])
  }

  const pacotesDaUnidade = useMemo(() => {
    const dbIds = unitDbIds[formUnidade]
    return packages.filter((p) => !p.unit_id || p.unit_id === dbIds?.unitId)
  }, [packages, unitDbIds, formUnidade])

  function handlePacoteChange(pacoteId: string) {
    setFormPacoteId(pacoteId)
    const pacote = packages.find((p) => p.id === pacoteId)
    if (pacote) {
      setFormValor(String(packagePriceForDate(pacote, formData)))
      if (pacote.guest_limit != null) setFormConvidados(String(pacote.guest_limit))
    }
  }

  // Se a data mudar depois de já ter escolhido um pacote, o preço se ajusta
  // sozinho (segunda a quinta x sexta a domingo).
  useEffect(() => {
    if (!formPacoteId) return
    const pacote = packages.find((p) => p.id === formPacoteId)
    if (pacote) setFormValor(String(packagePriceForDate(pacote, formData)))
  }, [formData, formPacoteId, packages])

  // Mesma ideia: se a data do evento mudar depois de já ter escolhido o
  // cliente, a idade que a criança vai fazer se recalcula sozinha.
  useEffect(() => {
    const client = clients.find((c) => c.id === formClienteId)
    if (!client?.child_birthday) {
      setFormChildAge('')
      return
    }
    const birthYear = parseISO(client.child_birthday).getFullYear()
    const eventYear = new Date(`${formData}T00:00:00`).getFullYear()
    setFormChildAge(String(Math.max(0, eventYear - birthYear)))
  }, [formData, formClienteId, clients])

  async function handleAddReservation(e: FormEvent) {
    e.preventDefault()
    if (!formClienteId) return
    const dbIds = unitDbIds[formUnidade]
    if (!dbIds) {
      setError('Não encontrei essa unidade no banco de dados ainda.')
      return
    }

    const totalValue = Number(formValor) || 0
    const descontoValor = Number(formDescontoValor) || 0
    let finalValue = totalValue
    if (formDescontoTipo === 'percentual') finalValue = totalValue * (1 - descontoValor / 100)
    else if (formDescontoTipo === 'valor_fixo') finalValue = totalValue - descontoValor

    const eventType = formTipoEvento === 'Outro' ? formTipoEventoOutro.trim() || 'Outro' : formTipoEvento

    setSaving(true)

    const { data: conflitos, error: conflitoError } = await supabase
      .from('reservations')
      .select('id')
      .eq('unit_id', dbIds.unitId)
      .eq('event_date', formData)
      .neq('status', 'cancelada')
      .limit(1)
    if (conflitoError) {
      setSaving(false)
      setError('Não foi possível verificar se já existe festa nessa data. Tente de novo.')
      return
    }
    if ((conflitos ?? []).length > 0) {
      setSaving(false)
      setError('Já existe uma festa não cancelada nesta data, nesta unidade. Só é possível ter duas festas no mesmo dia se uma delas estiver cancelada.')
      return
    }

    const { data: novaReserva, error } = await supabase.from('reservations').insert({
      client_id: formClienteId,
      unit_id: dbIds.unitId,
      space_id: dbIds.spaceId,
      package_id: formPacoteId || null,
      event_date: formData,
      start_time: formInicio,
      end_time: formFim,
      status: formStatus,
      event_type: eventType,
      guest_count: Number(formConvidados) || 0,
      total_value: totalValue,
      child_name: formChildName.trim() || null,
      child_age: formChildAge ? Number(formChildAge) : null,
      theme: formTema.trim() || null,
      hot_dish_flavors: formPratoQuente.trim() || null,
      cake_flavor: formSaborBolo.trim() || null,
      discount_type: formDescontoTipo || null,
      discount_value: formDescontoTipo ? descontoValor : null,
      final_value: Math.round(finalValue * 100) / 100,
      courtesy_guests: formCortesia ? Number(formCortesia) : null,
    }).select('id').single()
    setSaving(false)

    if (error) {
      setError(`Não foi possível salvar a reserva. Detalhe: ${error.message}`)
      return
    }

    const kidsValidos = outrosAniversariantes.filter((k) => k.name.trim())
    if (kidsValidos.length > 0 && novaReserva) {
      await supabase.from('reservation_birthday_kids').insert(
        kidsValidos.map((k) => ({ reservation_id: novaReserva.id, name: k.name.trim(), age: k.age ? Number(k.age) : null })),
      )
    }

    await loadReservations()
    resetForm()
    setShowForm(false)
  }

  const filtered = useMemo(
    () => (selectedUnit === 'todas' ? reservations : reservations.filter((r) => r.unidade === selectedUnit)),
    [reservations, selectedUnit],
  )

  const waitlist = useMemo(
    () => (selectedUnit === 'todas' ? waitlistEntries : waitlistEntries.filter((w) => w.unidade === selectedUnit)),
    [waitlistEntries, selectedUnit],
  )

  // Datas ocupadas (unidade + dia) por alguma festa não cancelada — usado
  // pra avisar quando a data que alguém da lista de espera queria vagou.
  const datasOcupadas = useMemo(() => {
    const set = new Set<string>()
    for (const r of reservations) {
      if (r.status !== 'cancelada') set.add(`${r.unidade}|${r.data}`)
    }
    return set
  }, [reservations])

  const hojeBr = format(new Date(), 'dd/MM/yyyy')
  const agendaHoje = useMemo(() => filtered.filter((r) => r.data === hojeBr), [filtered, hojeBr])

  const visibleRows = view === 'hoje' ? agendaHoje : filtered

  // Agrupa as reservas filtradas por data (mesma string "dd/MM/yyyy"), para
  // desenhar embaixo de cada dia do calendário
  const reservationsByDate = useMemo(() => {
    const map = new Map<string, Reservation[]>()
    for (const r of filtered) {
      const list = map.get(r.data) ?? []
      list.push(r)
      map.set(r.data, list)
    }
    return map
  }, [filtered])

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth)
    const monthEnd = endOfMonth(currentMonth)
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 })
    const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 })
    return eachDayOfInterval({ start: gridStart, end: gridEnd })
  }, [currentMonth])

  const monthLabel = format(currentMonth, 'MMMM \'de\' yyyy', { locale: ptBR })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Mapa de reservas</h1>
          <p className="text-sm text-muted mt-1">Todas as festas agendadas, por unidade e data</p>
        </div>
        <Can permission="action:reservas.nova_reserva">
          <Button onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4" /> Nova reserva
          </Button>
        </Can>
      </div>

      {error && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5">{error}</div>}

      <div className="flex items-center justify-end flex-wrap gap-3">
        <div className="flex gap-2 text-sm">
          <button
            onClick={() => setView('calendario')}
            className={`px-3 py-1.5 rounded-lg border transition-colors ${
              view === 'calendario' ? 'bg-ink text-white border-ink' : 'bg-surface text-ink border-line hover:bg-paper'
            }`}
          >
            Calendário
          </button>
          <button
            onClick={() => setView('lista')}
            className={`px-3 py-1.5 rounded-lg border transition-colors ${
              view === 'lista' ? 'bg-ink text-white border-ink' : 'bg-surface text-ink border-line hover:bg-paper'
            }`}
          >
            Lista
          </button>
          <button
            onClick={() => setView('hoje')}
            className={`px-3 py-1.5 rounded-lg border transition-colors ${
              view === 'hoje' ? 'bg-ink text-white border-ink' : 'bg-surface text-ink border-line hover:bg-paper'
            }`}
          >
            Agenda de hoje
          </button>
        </div>
      </div>

      {loading ? (
        <Card>
          <p className="text-sm text-muted py-6 text-center">Carregando reservas...</p>
        </Card>
      ) : (
        <>
          {view === 'calendario' && (
            <Card>
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
                  className="p-1.5 rounded-lg border border-line hover:bg-paper transition-colors"
                  aria-label="Mês anterior"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <p className="font-display font-semibold capitalize">{monthLabel}</p>
                <button
                  onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
                  className="p-1.5 rounded-lg border border-line hover:bg-paper transition-colors"
                  aria-label="Próximo mês"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-7 gap-px bg-line rounded-lg overflow-hidden border border-line">
                {WEEKDAY_LABELS.map((w) => (
                  <div key={w} className="bg-paper text-center text-[11px] font-medium text-muted py-2">
                    {w}
                  </div>
                ))}
                {calendarDays.map((day) => {
                  const dateKey = format(day, 'dd/MM/yyyy')
                  const dayReservations = reservationsByDate.get(dateKey) ?? []
                  const inMonth = isSameMonth(day, currentMonth)
                  const today = isToday(day)

                  return (
                    <div
                      key={dateKey}
                      className={`min-h-[92px] p-1.5 bg-surface flex flex-col gap-1 ${!inMonth ? 'opacity-40' : ''}`}
                    >
                      <span
                        className={`text-xs w-5 h-5 flex items-center justify-center rounded-full ${
                          today ? 'bg-purple text-white font-semibold' : 'text-muted'
                        }`}
                      >
                        {format(day, 'd')}
                      </span>
                      <div className="flex flex-col gap-1">
                        {dayReservations.slice(0, 3).map((r) => (
                          <button
                            key={r.id}
                            onClick={() => setSelected(r)}
                            title={`${r.cliente} · ${statusLabel[r.status]}`}
                            className="w-full flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-paper hover:bg-line/60 text-left truncate transition-colors"
                          >
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot[r.status]}`} />
                            <span className="truncate">{r.cliente}</span>
                          </button>
                        ))}
                        {dayReservations.length > 3 && (
                          <span className="text-[10px] text-muted px-1.5">+{dayReservations.length - 3} mais</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="flex items-center gap-4 mt-4 pt-3 border-t border-line text-xs text-muted flex-wrap">
                {(Object.keys(statusLabel) as ReservationStatus[]).map((s) => (
                  <span key={s} className="flex items-center gap-1.5">
                    <span className={`w-2.5 h-2.5 rounded-full inline-block ${statusDot[s]}`} /> {statusLabel[s]}
                  </span>
                ))}
              </div>
            </Card>
          )}

          {view !== 'calendario' && (
            <Card>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-line">
                    <th className="pb-3 font-medium">Data</th>
                    <th className="pb-3 font-medium">Horário</th>
                    <th className="pb-3 font-medium">Cliente</th>
                    <th className="pb-3 font-medium">Unidade</th>
                    <th className="pb-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {visibleRows.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => setSelected(r)}
                      className="cursor-pointer hover:bg-paper/60 transition-colors"
                    >
                      <td className="py-3">{r.data}</td>
                      <td className="py-3 text-muted">{r.horario}</td>
                      <td className="py-3 font-medium">{r.cliente}</td>
                      <td className="py-3">{UNITS.find((u) => u.id === r.unidade)?.name ?? r.unidade}</td>
                      <td className="py-3">
                        <Badge tone={statusTone[r.status]}>{statusLabel[r.status]}</Badge>
                      </td>
                    </tr>
                  ))}
                  {visibleRows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-muted">
                        Nenhuma reserva encontrada.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}

      <Card title="Lista de espera">
        {waitlist.length === 0 ? (
          <p className="text-sm text-muted">Nenhum cliente na lista de espera no momento.</p>
        ) : (
          <ul className="divide-y divide-line mb-4">
            {waitlist.map((w) => {
              const vagou = !datasOcupadas.has(`${w.unidade}|${w.dataDesejada}`)
              return (
                <li key={w.id} className={`py-3 flex items-center justify-between gap-3 text-sm ${vagou ? 'bg-teal-light/40 -mx-4 px-4 rounded-lg' : ''}`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium">{w.cliente}</p>
                      {vagou && <Badge tone="teal">Vaga disponível!</Badge>}
                    </div>
                    <p className="text-xs text-muted">
                      Quer uma data em {w.dataDesejada}
                      {selectedUnit === 'todas' && ` — ${UNITS.find((u) => u.id === w.unidade)?.name ?? ''}`}
                    </p>
                    {w.notes && <p className="text-xs text-muted italic">{w.notes}</p>}
                  </div>
                  <Can permission="action:reservas.lista_espera">
                    <div className="flex items-center gap-2 shrink-0">
                      <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={() => handleNotifyWaitlist(w)}>
                        <MessageCircle className="w-3.5 h-3.5" /> Avisar cliente
                      </Button>
                      <button onClick={() => handleRemoveWaitlist(w.id)} className="text-muted hover:text-danger" aria-label="Remover da lista de espera">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </Can>
                </li>
              )
            })}
          </ul>
        )}

        <Can permission="action:reservas.lista_espera">
          <form onSubmit={handleAddWaitlist} className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-3 border-t border-line">
            <select
              required
              value={waitlistClienteId}
              onChange={(e) => setWaitlistClienteId(e.target.value)}
              className="border border-line rounded-lg px-3 py-2 text-sm"
            >
              <option value="" disabled>Escolha um cliente...</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select value={waitlistUnidade} onChange={(e) => setWaitlistUnidade(e.target.value)} className="border border-line rounded-lg px-3 py-2 text-sm">
              {UNITS.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            <input
              type="date"
              required
              value={waitlistData}
              onChange={(e) => setWaitlistData(e.target.value)}
              className="border border-line rounded-lg px-3 py-2 text-sm"
            />
            <input
              type="text"
              value={waitlistNotes}
              onChange={(e) => setWaitlistNotes(e.target.value)}
              placeholder="Observação (opcional)"
              className="border border-line rounded-lg px-3 py-2 text-sm"
            />
            <Button type="submit" className="sm:col-span-2 justify-center" disabled={savingWaitlist || clients.length === 0}>
              <Plus className="w-4 h-4" /> {savingWaitlist ? 'Adicionando...' : 'Adicionar à lista de espera'}
            </Button>
          </form>
        </Can>
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
            <p className="text-sm text-muted mb-3">{UNITS.find((u) => u.id === selected.unidade)?.name}</p>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="border border-line rounded-lg p-3">
                <p className="text-xs text-muted">Data e horário</p>
                <p className="text-sm font-medium mt-0.5">{selected.data}</p>
                <p className="text-sm font-medium">{selected.horario}</p>
              </div>
              <div className="border border-line rounded-lg p-3">
                <p className="text-xs text-muted">Tema da festa</p>
                <p className="text-sm font-medium mt-0.5">{selected.tipoEvento}</p>
                <p className="text-xs text-muted mt-1">{selected.convidados} convidados</p>
              </div>
            </div>

            <Badge tone={statusTone[selected.status]}>{statusLabel[selected.status]}</Badge>

            <div className="mt-6">
              <button
                onClick={() => navigate(`/reservas/${selected.id}`)}
                className="w-full flex items-center gap-3 p-4 border border-purple/30 bg-purple-light rounded-lg text-left hover:bg-purple-light/70 transition-colors"
              >
                <div className="w-10 h-10 rounded-lg bg-purple flex items-center justify-center shrink-0">
                  <LayoutGrid className="w-5 h-5 text-white" strokeWidth={1.75} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-purple-dark">Abrir Central da festa</p>
                  <p className="text-xs text-muted">Financeiro, consumo, checklist, equipe e estoque num só lugar</p>
                </div>
              </button>
              <p className="text-xs text-muted mt-2">
                A Central da Festa ainda usa dados de exemplo — é a próxima peça que vamos ligar ao banco de dados.
              </p>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setShowForm(false)} />
          <div className="relative w-full max-w-md bg-surface rounded-card p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-display font-semibold">Nova reserva</h2>
              <button onClick={() => setShowForm(false)} className="text-muted hover:text-ink">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddReservation} className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs text-muted">Cliente</label>
                  <button
                    type="button"
                    onClick={() => setShowQuickClient(true)}
                    className="text-xs text-purple font-medium flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> Cadastrar novo cliente
                  </button>
                </div>
                <select
                  required
                  value={formClienteId}
                  onChange={(e) => handleClienteChange(e.target.value)}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                >
                  <option value="" disabled>Escolha um cliente...</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {clients.length === 0 && (
                  <p className="text-xs text-danger mt-1">
                    Nenhum cliente cadastrado ainda — clique em "Cadastrar novo cliente" acima.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs text-muted mb-1">Unidade</label>
                <select
                  value={formUnidade}
                  onChange={(e) => setFormUnidade(e.target.value)}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                >
                  {UNITS.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-muted mb-1">Data do evento</label>
                <input
                  type="date"
                  value={formData}
                  onChange={(e) => setFormData(e.target.value)}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted mb-1">Início</label>
                  <input
                    type="time"
                    value={formInicio}
                    onChange={(e) => setFormInicio(e.target.value)}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Fim</label>
                  <input
                    type="time"
                    value={formFim}
                    onChange={(e) => setFormFim(e.target.value)}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-muted mb-1">Pacote (opcional)</label>
                <select
                  value={formPacoteId}
                  onChange={(e) => handlePacoteChange(e.target.value)}
                  disabled={pacotesDaUnidade.length === 0}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm disabled:bg-paper disabled:text-muted"
                >
                  <option value="">Sem pacote definido</option>
                  {pacotesDaUnidade.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.guest_limit ? ` — até ${p.guest_limit} convidados` : ''}
                      {' — '}
                      {packagePriceForDate(p, formData).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}
                    </option>
                  ))}
                </select>
                {pacotesDaUnidade.length === 0 && (
                  <p className="text-xs text-muted mt-1">Nenhum pacote cadastrado para esta unidade ainda.</p>
                )}
                {formPacoteId && packages.find((p) => p.id === formPacoteId)?.weekend_price != null && (
                  <p className="text-xs text-muted mt-1">
                    Preço já ajustado pelo dia da semana da data escolhida (segunda a quinta x sexta a domingo).
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted mb-1">Tipo de evento</label>
                  <select
                    value={formTipoEvento}
                    onChange={(e) => setFormTipoEvento(e.target.value)}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                  >
                    {EVENT_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  {formTipoEvento === 'Outro' && (
                    <input
                      type="text"
                      value={formTipoEventoOutro}
                      onChange={(e) => setFormTipoEventoOutro(e.target.value)}
                      placeholder="Qual tipo de evento?"
                      className="w-full border border-line rounded-lg px-3 py-2 text-sm mt-2"
                    />
                  )}
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Convidados{formPacoteId ? ' (definido pelo pacote)' : ''}</label>
                  <input
                    type="number"
                    min={0}
                    value={formConvidados}
                    onChange={(e) => setFormConvidados(e.target.value)}
                    placeholder="0"
                    disabled={!!formPacoteId}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm disabled:bg-paper disabled:text-muted"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted mb-1">Aniversariante (opcional)</label>
                  <input
                    type="text"
                    value={formChildName}
                    onChange={(e) => setFormChildName(e.target.value)}
                    placeholder="Nome"
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Idade que irá fazer</label>
                  <input
                    type="number"
                    min={0}
                    value={formChildAge}
                    onChange={(e) => setFormChildAge(e.target.value)}
                    placeholder="Anos"
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {outrosAniversariantes.map((kid, i) => (
                <div key={i} className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={kid.name}
                    onChange={(e) =>
                      setOutrosAniversariantes((prev) => prev.map((k, idx) => (idx === i ? { ...k, name: e.target.value } : k)))
                    }
                    placeholder="Nome do outro aniversariante"
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                  />
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={0}
                      value={kid.age}
                      onChange={(e) =>
                        setOutrosAniversariantes((prev) => prev.map((k, idx) => (idx === i ? { ...k, age: e.target.value } : k)))
                      }
                      placeholder="Anos"
                      className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setOutrosAniversariantes((prev) => prev.filter((_, idx) => idx !== i))}
                      className="text-muted hover:text-danger shrink-0"
                      aria-label="Remover aniversariante"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setOutrosAniversariantes((prev) => [...prev, { name: '', age: '' }])}
                className="text-xs text-purple font-medium flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Adicionar outro aniversariante
              </button>

              <div>
                <label className="block text-xs text-muted mb-1">Tema da festa (opcional)</label>
                <input
                  type="text"
                  value={formTema}
                  onChange={(e) => setFormTema(e.target.value)}
                  placeholder="Ex: Dinossauro"
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs text-muted mb-1">Sabores do prato quente (opcional)</label>
                <input
                  type="text"
                  value={formPratoQuente}
                  onChange={(e) => setFormPratoQuente(e.target.value)}
                  placeholder="Ex: Linguiça blumenau/Carne seca/Empadão de frango"
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                />
                <p className="text-xs text-muted mt-1">O número de pratos varia com o plano — separe os sabores com "/".</p>
              </div>

              <div>
                <label className="block text-xs text-muted mb-1">Sabor do bolo (opcional)</label>
                <input
                  type="text"
                  value={formSaborBolo}
                  onChange={(e) => setFormSaborBolo(e.target.value)}
                  placeholder="Ex: Chocolate com morango"
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted mb-1">Valor total{formPacoteId ? ' (preço do pacote)' : ''}</label>
                  <input
                    type="number"
                    min={0}
                    value={formValor}
                    onChange={(e) => setFormValor(e.target.value)}
                    placeholder="0,00"
                    disabled={!!formPacoteId}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm disabled:bg-paper disabled:text-muted"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Status</label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as ReservationStatus)}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                  >
                    {(Object.keys(statusLabel) as ReservationStatus[]).map((s) => (
                      <option key={s} value={s}>{statusLabel[s]}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted mb-1">Desconto (opcional)</label>
                  <select
                    value={formDescontoTipo}
                    onChange={(e) => setFormDescontoTipo(e.target.value as DiscountType | '')}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">Sem desconto</option>
                    <option value="percentual">Percentual (%)</option>
                    <option value="valor_fixo">Valor fixo (R$)</option>
                  </select>
                </div>
                {formDescontoTipo && (
                  <div>
                    <label className="block text-xs text-muted mb-1">Valor do desconto</label>
                    <input
                      type="number"
                      min={0}
                      value={formDescontoValor}
                      onChange={(e) => setFormDescontoValor(e.target.value)}
                      placeholder={formDescontoTipo === 'percentual' ? 'Ex: 10' : 'Ex: 100,00'}
                      className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs text-muted mb-1">Convidados de cortesia (opcional)</label>
                <input
                  type="number"
                  min={0}
                  value={formCortesia}
                  onChange={(e) => setFormCortesia(e.target.value)}
                  placeholder="Ex: 10 (promoção, além do limite do pacote)"
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                />
                <p className="text-xs text-muted mt-1">
                  Só preencha se houver alguma promoção dando convidados extras de graça — isso aparece
                  automaticamente no contrato quando gerado.
                </p>
              </div>

              <Button type="submit" className="w-full justify-center mt-2" disabled={saving || clients.length === 0}>
                {saving ? 'Salvando...' : 'Salvar reserva'}
              </Button>
            </form>
          </div>
        </div>
      )}

      {showQuickClient && (
        <ClientQuickCreateModal
          onClose={() => setShowQuickClient(false)}
          onCreated={(client) => {
            setClients((prev) => [...prev, client].sort((a, b) => a.name.localeCompare(b.name)))
            handleClienteChange(client.id, client)
            setShowQuickClient(false)
          }}
        />
      )}
    </div>
  )
}
