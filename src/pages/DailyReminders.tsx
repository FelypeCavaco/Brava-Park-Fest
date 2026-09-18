import { useEffect, useMemo, useState } from 'react'
import { addDays, subDays, format, parseISO, startOfDay } from 'date-fns'
import { MessageCircle, Wallet, CalendarClock, Star, BellRing } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { useUnit } from '../lib/UnitContext'
import { supabase } from '../lib/supabaseClient'
import { openWhatsApp, buildMessage, MESSAGE_TEMPLATES } from '../lib/whatsapp'
import { SendReviewModal } from '../components/SendReviewModal'

function currency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

function formatHour(t: string) {
  const [h, m] = t.split(':')
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

interface PaymentReminder {
  id: string
  unitId: string
  cliente: string
  phone: string | null
  data: string
  saldo: number
}

interface TomorrowReminder {
  id: string
  unitId: string
  cliente: string
  phone: string | null
  data: string
  horario: string
  unidadeNome: string
}

interface ReviewReminder {
  id: string
  cliente: string
  phone: string | null
  data: string
  reviewLink: string | null
  unitName: string
}

const REVIEW_REQUEST_TYPE = 'Pedido de avaliação'

export function DailyReminders() {
  const { selectedUnit, unitDbIds } = useUnit()
  const [paymentReminders, setPaymentReminders] = useState<PaymentReminder[]>([])
  const [tomorrowReminders, setTomorrowReminders] = useState<TomorrowReminder[]>([])
  const [reviewReminders, setReviewReminders] = useState<ReviewReminder[]>([])
  const [sentTodayTypes, setSentTodayTypes] = useState<Set<string>>(new Set())
  const [reviewedNames, setReviewedNames] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reviewModalEntry, setReviewModalEntry] = useState<ReviewReminder | null>(null)

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    setError(null)
    const today = todayIso()
    const in7days = format(addDays(new Date(), 7), 'yyyy-MM-dd')
    const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd')
    const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd')
    const startOfTodayIso = startOfDay(new Date()).toISOString()

    const [{ data: pendingData, error: pendingError }, { data: tomorrowData }, { data: reviewData }, { data: contactsToday }, { data: contactsReview }] =
      await Promise.all([
        supabase
          .from('reservations')
          .select('id, unit_id, event_date, final_value, client:clients(name, phone), payments(amount)')
          .neq('status', 'cancelada')
          .gte('event_date', today)
          .lte('event_date', in7days),
        supabase
          .from('reservations')
          .select('id, unit_id, event_date, start_time, client:clients(name, phone), unit:units(name)')
          .neq('status', 'cancelada')
          .eq('event_date', tomorrow),
        supabase
          .from('reservations')
          .select('id, event_date, client:clients(name, phone), unit:units(name, google_review_link)')
          .eq('event_date', yesterday)
          .neq('status', 'cancelada'),
        supabase.from('contact_history').select('type').gte('created_at', startOfTodayIso),
        supabase.from('contact_history').select('client_name').eq('type', REVIEW_REQUEST_TYPE),
      ])

    if (pendingError) setError('Não foi possível carregar os lembretes.')

    setSentTodayTypes(new Set((contactsToday ?? []).map((c) => c.type)))
    setReviewedNames(new Set((contactsReview ?? []).map((c) => c.client_name)))

    setPaymentReminders(
      (pendingData ?? [])
        .map((r: any) => {
          const pago = (r.payments ?? []).reduce((s: number, p: any) => s + Number(p.amount), 0)
          return {
            id: r.id,
            unitId: r.unit_id,
            cliente: r.client?.name ?? '—',
            phone: r.client?.phone ?? null,
            data: format(parseISO(r.event_date), 'dd/MM/yyyy'),
            saldo: Number(r.final_value) - pago,
          }
        })
        .filter((r) => r.saldo > 0.005),
    )

    setTomorrowReminders(
      (tomorrowData ?? []).map((r: any) => ({
        id: r.id,
        unitId: r.unit_id,
        cliente: r.client?.name ?? '—',
        phone: r.client?.phone ?? null,
        data: format(parseISO(r.event_date), 'dd/MM/yyyy'),
        horario: formatHour(String(r.start_time).slice(0, 5)),
        unidadeNome: r.unit?.name ?? '',
      })),
    )

    setReviewReminders(
      (reviewData ?? []).map((r: any) => ({
        id: r.id,
        cliente: r.client?.name ?? '—',
        phone: r.client?.phone ?? null,
        data: format(parseISO(r.event_date), 'dd/MM/yyyy'),
        reviewLink: r.unit?.google_review_link ?? null,
        unitName: r.unit?.name ?? '',
      })),
    )

    setLoading(false)
  }

  const visiblePaymentReminders = useMemo(() => {
    if (selectedUnit === 'todas') return paymentReminders
    const unitId = unitDbIds[selectedUnit]?.unitId
    return paymentReminders.filter((r) => r.unitId === unitId)
  }, [paymentReminders, selectedUnit, unitDbIds])

  const visibleTomorrowReminders = useMemo(() => {
    if (selectedUnit === 'todas') return tomorrowReminders
    const unitId = unitDbIds[selectedUnit]?.unitId
    return tomorrowReminders.filter((r) => r.unitId === unitId)
  }, [tomorrowReminders, selectedUnit, unitDbIds])

  async function sendPaymentReminder(r: PaymentReminder) {
    const type = `lembrete_pagamento:${r.id}:${todayIso()}`
    const message = buildMessage(MESSAGE_TEMPLATES.lembrete_pagamento, { cliente: r.cliente, valor: currency(r.saldo), data: r.data })
    openWhatsApp(r.phone, message)
    setSentTodayTypes((prev) => new Set(prev).add(type))
    await supabase.from('contact_history').insert({ client_name: r.cliente, type, channel: 'whatsapp', user_name: 'Você' })
  }

  async function sendTomorrowReminder(r: TomorrowReminder) {
    const type = `lembrete_festa:${r.id}:${todayIso()}`
    const message = buildMessage(MESSAGE_TEMPLATES.lembrete_festa, { cliente: r.cliente, data: r.data, horario: r.horario })
    openWhatsApp(r.phone, message)
    setSentTodayTypes((prev) => new Set(prev).add(type))
    await supabase.from('contact_history').insert({ client_name: r.cliente, type, channel: 'whatsapp', user_name: 'Você' })
  }


  const totalPendente = visiblePaymentReminders.length + visibleTomorrowReminders.length + reviewReminders.length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Lembretes diários</h1>
        <p className="text-sm text-muted mt-1">
          O sistema já calculou sozinho quem precisa de contato hoje — é só clicar em "Enviar" pra abrir o WhatsApp
          com a mensagem pronta.
        </p>
      </div>

      {error && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5">{error}</div>}

      {!loading && totalPendente === 0 && (
        <Card className="border-teal/30 bg-teal-light">
          <div className="flex items-center gap-3">
            <BellRing className="w-5 h-5 text-teal" />
            <p className="text-sm text-ink/80 font-medium">Tudo em dia — nenhum lembrete pendente hoje.</p>
          </div>
        </Card>
      )}

      <Card title="Pagamento pendente perto da festa" action={<Wallet className="w-4 h-4 text-muted" />}>
        {loading ? (
          <p className="text-sm text-muted py-4 text-center">Carregando...</p>
        ) : visiblePaymentReminders.length === 0 ? (
          <p className="text-sm text-muted">Nenhum saldo em aberto pras festas dos próximos 7 dias.</p>
        ) : (
          <ul className="divide-y divide-line">
            {visiblePaymentReminders.map((r) => {
              const type = `lembrete_pagamento:${r.id}:${todayIso()}`
              const already = sentTodayTypes.has(type)
              return (
                <li key={r.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{r.cliente}</p>
                    <p className="text-xs text-muted">Festa em {r.data} · saldo de {currency(r.saldo)}</p>
                  </div>
                  {already ? (
                    <Badge tone="teal">Enviado hoje</Badge>
                  ) : (
                    <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={() => sendPaymentReminder(r)}>
                      <MessageCircle className="w-3.5 h-3.5" /> Enviar
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <Card title="Festa é amanhã" action={<CalendarClock className="w-4 h-4 text-muted" />}>
        {loading ? (
          <p className="text-sm text-muted py-4 text-center">Carregando...</p>
        ) : visibleTomorrowReminders.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma festa amanhã.</p>
        ) : (
          <ul className="divide-y divide-line">
            {visibleTomorrowReminders.map((r) => {
              const type = `lembrete_festa:${r.id}:${todayIso()}`
              const already = sentTodayTypes.has(type)
              return (
                <li key={r.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{r.cliente}</p>
                    <p className="text-xs text-muted">{r.data} às {r.horario} — {r.unidadeNome}</p>
                  </div>
                  {already ? (
                    <Badge tone="teal">Enviado hoje</Badge>
                  ) : (
                    <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={() => sendTomorrowReminder(r)}>
                      <MessageCircle className="w-3.5 h-3.5" /> Enviar
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <Card title="Pedir avaliação da festa de ontem" action={<Star className="w-4 h-4 text-muted" />}>
        {loading ? (
          <p className="text-sm text-muted py-4 text-center">Carregando...</p>
        ) : reviewReminders.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma festa ontem.</p>
        ) : (
          <ul className="divide-y divide-line">
            {reviewReminders.map((r) => (
              <li key={r.id} className="py-2.5 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{r.cliente}</p>
                  <p className="text-xs text-muted">Festa em {r.data}</p>
                </div>
                {reviewedNames.has(r.cliente) ? (
                  <Badge tone="teal">Já solicitado</Badge>
                ) : (
                  <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={() => setReviewModalEntry(r)}>
                    <MessageCircle className="w-3.5 h-3.5" /> Enviar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {reviewModalEntry && (
        <SendReviewModal
          reservationId={reviewModalEntry.id}
          clienteNome={reviewModalEntry.cliente}
          phone={reviewModalEntry.phone}
          unitName={reviewModalEntry.unitName}
          googleReviewLink={reviewModalEntry.reviewLink}
          onClose={() => setReviewModalEntry(null)}
          onSent={() => {
            setReviewedNames((prev) => new Set(prev).add(reviewModalEntry.cliente))
            setReviewModalEntry(null)
          }}
        />
      )}
    </div>
  )
}
