import { useEffect, useMemo, useState } from 'react'
import { differenceInCalendarMonths, differenceInCalendarDays, parseISO, format } from 'date-fns'
import { MessageCircle, Sparkles } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { supabase } from '../lib/supabaseClient'
import { openWhatsApp, buildMessage, MESSAGE_TEMPLATES } from '../lib/whatsapp'
import type { Client, ReactivationStatus } from '../types'

const statusLabel: Record<ReactivationStatus, string> = {
  nova_oportunidade: 'Nova oportunidade',
  contatado: 'Contatado',
  negociacao: 'Negociação',
  nova_reserva: 'Nova reserva',
  sem_interesse: 'Sem interesse',
}

const statusTone: Record<ReactivationStatus, 'purple' | 'teal' | 'amber' | 'danger' | 'neutral'> = {
  nova_oportunidade: 'purple',
  contatado: 'amber',
  negociacao: 'amber',
  nova_reserva: 'teal',
  sem_interesse: 'neutral',
}

function nextOccurrence(birthdayIso: string, today: Date) {
  const bday = parseISO(birthdayIso)
  let next = new Date(today.getFullYear(), bday.getMonth(), bday.getDate())
  if (differenceInCalendarDays(next, today) < 0) {
    next = new Date(today.getFullYear() + 1, bday.getMonth(), bday.getDate())
  }
  return next
}

export function Reactivation() {
  const [clients, setClients] = useState<Client[]>([])
  const [reservationYearsByClient, setReservationYearsByClient] = useState<Record<string, Set<number>>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const today = new Date()

  useEffect(() => {
    loadClients()
  }, [])

  async function loadClients() {
    setLoading(true)
    const [{ data, error }, { data: reservationsData }] = await Promise.all([
      supabase.from('clients').select('*').not('child_birthday', 'is', null),
      supabase.from('reservations').select('client_id, event_date').neq('status', 'cancelada'),
    ])
    if (error) {
      setError('Não foi possível carregar os clientes.')
      setLoading(false)
      return
    }
    setClients((data ?? []) as Client[])

    const years: Record<string, Set<number>> = {}
    for (const r of reservationsData ?? []) {
      const year = parseISO(r.event_date).getFullYear()
      if (!years[r.client_id]) years[r.client_id] = new Set()
      years[r.client_id].add(year)
    }
    setReservationYearsByClient(years)
    setLoading(false)
  }

  const candidatos = useMemo(
    () =>
      clients
        .filter((c) => c.child_birthday)
        .map((c) => {
          const proximo = nextOccurrence(c.child_birthday as string, today)
          const mesesFaltam = differenceInCalendarMonths(proximo, today)
          const mesesDesdeUltimaFesta = c.last_party_date ? differenceInCalendarMonths(today, parseISO(c.last_party_date)) : null
          const noPeriodo = mesesFaltam >= 1 && mesesFaltam <= 3
          const jaTemFesta = reservationYearsByClient[c.id]?.has(proximo.getFullYear()) ?? false
          return { client: c, proximo, mesesFaltam, mesesDesdeUltimaFesta, noPeriodo, jaTemFesta }
        })
        .sort((a, b) => a.mesesFaltam - b.mesesFaltam),
    [clients, reservationYearsByClient],
  )

  const noPeriodo = candidatos.filter((c) => c.noPeriodo && !c.jaTemFesta && c.client.reactivation_status !== 'sem_interesse')

  async function handleContact(client: Client) {
    const message = buildMessage(MESSAGE_TEMPLATES.reativacao, { cliente: client.name })
    openWhatsApp(client.phone, message)

    const newStatus = client.reactivation_status === 'nova_oportunidade' ? 'contatado' : client.reactivation_status
    const contactDate = today.toISOString().slice(0, 10)

    setClients((prev) =>
      prev.map((c) => (c.id === client.id ? { ...c, last_commercial_contact: contactDate, reactivation_status: newStatus } : c)),
    )

    await Promise.all([
      supabase.from('clients').update({ last_commercial_contact: contactDate, reactivation_status: newStatus }).eq('id', client.id),
      supabase.from('contact_history').insert({ client_name: client.name, type: 'Contato de reativação', channel: 'whatsapp', user_name: 'Você' }),
    ])
  }

  async function updateStatus(id: string, status: ReactivationStatus) {
    const previous = clients
    setClients((prev) => prev.map((c) => (c.id === id ? { ...c, reactivation_status: status } : c)))
    const { error } = await supabase.from('clients').update({ reactivation_status: status }).eq('id', id)
    if (error) {
      setClients(previous)
      setError('Não foi possível salvar o status.')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Reativação de clientes</h1>
        <p className="text-sm text-muted mt-1">Clientes cujo próximo aniversário do aniversariante está chegando</p>
      </div>

      {error && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5">{error}</div>}

      <Card className="border-purple/30 bg-purple-light">
        <div className="flex items-center gap-3">
          <Sparkles className="w-5 h-5 text-purple-dark" />
          <p className="text-sm text-purple-dark font-medium">
            {noPeriodo.length} cliente{noPeriodo.length !== 1 ? 's' : ''} {noPeriodo.length !== 1 ? 'estão' : 'está'} entrando no período ideal
            para nova abordagem
          </p>
        </div>
      </Card>

      <Card title="Clientes com criança cadastrada">
        {loading ? (
          <p className="text-sm text-muted py-6 text-center">Carregando...</p>
        ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-line">
              <th className="pb-3 font-medium">Cliente</th>
              <th className="pb-3 font-medium">Aniversariante</th>
              <th className="pb-3 font-medium">Última festa</th>
              <th className="pb-3 font-medium">Próximo aniversário</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {candidatos.map(({ client, proximo, mesesFaltam, mesesDesdeUltimaFesta, noPeriodo: dentro, jaTemFesta }) => (
              <tr key={client.id} className={jaTemFesta ? 'bg-teal-light/30' : dentro ? 'bg-purple-light/40' : ''}>
                <td className="py-3 font-medium">{client.name}</td>
                <td className="py-3 text-muted">{client.child_name}</td>
                <td className="py-3 text-muted">
                  {mesesDesdeUltimaFesta !== null ? `há ${mesesDesdeUltimaFesta} meses` : '—'}
                </td>
                <td className="py-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span>{format(proximo, 'dd/MM')}</span>
                    {jaTemFesta ? (
                      <Badge tone="teal">Festa já marcada em {proximo.getFullYear()}</Badge>
                    ) : dentro ? (
                      <Badge tone="purple">faltam {mesesFaltam} {mesesFaltam === 1 ? 'mês' : 'meses'}</Badge>
                    ) : (
                      <span className="text-xs text-muted">faltam {mesesFaltam} meses</span>
                    )}
                  </div>
                </td>
                <td className="py-3">
                  <select
                    value={client.reactivation_status}
                    onChange={(e) => updateStatus(client.id, e.target.value as ReactivationStatus)}
                    className="border border-line rounded-lg px-2 py-1 text-xs"
                  >
                    {(Object.keys(statusLabel) as ReactivationStatus[]).map((s) => (
                      <option key={s} value={s}>{statusLabel[s]}</option>
                    ))}
                  </select>
                </td>
                <td className="py-3 text-right">
                  {!jaTemFesta && (
                    <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={() => handleContact(client)}>
                      <MessageCircle className="w-3.5 h-3.5" /> Entrar em contato
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {candidatos.length === 0 && (
              <tr><td colSpan={6} className="py-6 text-center text-muted">Nenhum cliente com aniversariante cadastrado ainda.</td></tr>
            )}
          </tbody>
        </table>
        )}
        <p className="text-xs text-muted mt-3">
          Isso não manda mensagem sozinho — só avisa a equipe que é um bom momento pra entrar em contato. Clientes sem
          aniversariante cadastrado (ex: casamentos, eventos corporativos) não entram nessa lista.
        </p>
      </Card>
    </div>
  )
}
