import { FormEvent, useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Plus, Star, X, Trash2, Gift, MessageCircle, Receipt, Pencil } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Can } from '../components/Can'
import { ClientQuickCreateModal } from '../components/ClientQuickCreateModal'
import { supabase } from '../lib/supabaseClient'
import { openWhatsApp, buildMessage, MESSAGE_TEMPLATES, GOOGLE_REVIEW_LINK } from '../lib/whatsapp'
import { useOpenOnQueryParam } from '../lib/useOpenOnQueryParam'
import { useUndo } from '../lib/UndoContext'
import { PAYMENT_METHOD_LABEL, type Client, type PaymentMethod } from '../types'

function currency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

interface ClientPaymentHistoryEntry {
  id: string
  amount: number
  payment_date: string
  payment_method: PaymentMethod | null
  eventLabel: string
}

export function Clients() {
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  useOpenOnQueryParam('novo', () => setShowForm(true))
  const { scheduleDelete } = useUndo()
  const [editingClient, setEditingClient] = useState<Client | null>(null)

  const [historyClient, setHistoryClient] = useState<Client | null>(null)
  const [history, setHistory] = useState<ClientPaymentHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  useEffect(() => {
    loadClients()
  }, [])

  async function loadClients() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase.from('clients').select('*').order('name')
    if (error) {
      setError('Não foi possível carregar os clientes.')
    } else {
      setClients((data ?? []) as Client[])
    }
    setLoading(false)
  }

  function handleRemove(id: string) {
    const client = clients.find((c) => c.id === id)
    if (!client) return
    setClients((prev) => prev.filter((c) => c.id !== id))
    scheduleDelete({
      label: `"${client.name}" removido`,
      commit: async () => {
        await supabase.from('clients').delete().eq('id', id)
      },
      undo: async () => {
        await supabase.from('clients').insert(client)
        setClients((prev) => [...prev, client].sort((a, b) => a.name.localeCompare(b.name)))
      },
    })
  }

  async function applyReferralDiscount(id: string) {
    const previous = clients
    setClients((prev) => prev.map((c) => (c.id === id ? { ...c, referral_discount_status: 'aplicado' } : c)))
    const { error } = await supabase.from('clients').update({ referral_discount_status: 'aplicado' }).eq('id', id)
    if (error) {
      setError('Não foi possível aplicar o desconto.')
      setClients(previous)
    }
  }

  function sendBudget(client: Client) {
    const message = buildMessage(MESSAGE_TEMPLATES.orcamento, {
      cliente: client.name,
      data: 'combinar',
      unidade: 'nossa unidade',
      valor: 'a combinar',
    })
    openWhatsApp(client.phone, message)
  }

  function askReview(client: Client) {
    const message = buildMessage(MESSAGE_TEMPLATES.pedir_avaliacao, { cliente: client.name, link: GOOGLE_REVIEW_LINK })
    openWhatsApp(client.phone, message)
  }

  async function openHistory(client: Client) {
    setHistoryClient(client)
    setHistoryLoading(true)
    const { data } = await supabase
      .from('reservations')
      .select('id, event_date, payments(id, amount, payment_date, payment_method)')
      .eq('client_id', client.id)
    const entries: ClientPaymentHistoryEntry[] = []
    for (const r of data ?? []) {
      const eventLabel = format(parseISO(r.event_date), 'dd/MM/yyyy')
      for (const p of r.payments ?? []) {
        entries.push({ id: p.id, amount: Number(p.amount), payment_date: p.payment_date, payment_method: p.payment_method, eventLabel })
      }
    }
    entries.sort((a, b) => (a.payment_date < b.payment_date ? 1 : -1))
    setHistory(entries)
    setHistoryLoading(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Clientes</h1>
          <p className="text-sm text-muted mt-1">Cadastro, fidelidade por pontos e indicações</p>
        </div>
        <Can permission="action:clientes.criar_editar">
          <Button onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4" /> Novo cliente
          </Button>
        </Can>
      </div>

      {error && (
        <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5">{error}</div>
      )}

      <Card>
        {loading ? (
          <p className="text-sm text-muted py-6 text-center">Carregando clientes...</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="pb-3 font-medium">Nome</th>
                <th className="pb-3 font-medium">Telefone</th>
                <th className="pb-3 font-medium">Pontos</th>
                <th className="pb-3 font-medium">Indicação</th>
                <th className="pb-3 font-medium"></th>
                <th className="pb-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {clients.map((c) => {
                const referredByName = c.referred_by ? clients.find((x) => x.id === c.referred_by)?.name : null
                return (
                  <tr key={c.id}>
                    <td className="py-3 font-medium">
                      <div className="flex items-center gap-2">
                        {c.name}
                        {c.is_loyalty && <Star className="w-3.5 h-3.5 text-orange fill-orange" />}
                      </div>
                      {c.child_name && <p className="text-xs text-muted font-normal">Aniversariante: {c.child_name}</p>}
                    </td>
                    <td className="py-3 text-muted">{c.phone ?? '—'}</td>
                    <td className="py-3">
                      <span className="inline-flex items-center gap-1">
                        <Gift className="w-3.5 h-3.5 text-purple" /> {c.loyalty_points}
                      </span>
                    </td>
                    <td className="py-3">
                      {referredByName ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted">indicado por {referredByName}</span>
                          {c.referral_discount_status === 'pendente' ? (
                            <button onClick={() => applyReferralDiscount(c.id)} className="text-purple text-xs font-medium">
                              Aplicar desconto
                            </button>
                          ) : c.referral_discount_status === 'aplicado' ? (
                            <Badge tone="teal">Desconto aplicado</Badge>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-3 justify-end text-xs">
                        <button onClick={() => openHistory(c)} className="text-ink font-medium flex items-center gap-1">
                          <Receipt className="w-3.5 h-3.5" /> Pagamentos
                        </button>
                        <button onClick={() => sendBudget(c)} className="text-teal font-medium flex items-center gap-1">
                          <MessageCircle className="w-3.5 h-3.5" /> Orçamento
                        </button>
                        <button onClick={() => askReview(c)} className="text-purple font-medium flex items-center gap-1">
                          <MessageCircle className="w-3.5 h-3.5" /> Avaliação
                        </button>
                      </div>
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex items-center gap-3 justify-end">
                        <Can permission="action:clientes.criar_editar">
                          <button onClick={() => setEditingClient(c)} className="text-muted hover:text-purple" aria-label="Editar cliente">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        </Can>
                        <Can permission="action:clientes.excluir">
                          <button onClick={() => handleRemove(c.id)} className="text-muted hover:text-danger" aria-label="Remover cliente">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </Can>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {clients.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-muted">
                    Nenhum cliente cadastrado ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Card>

      {showForm && (
        <ClientQuickCreateModal
          onClose={() => setShowForm(false)}
          onCreated={(client) => {
            setClients((prev) => [...prev, client].sort((a, b) => a.name.localeCompare(b.name)))
            setShowForm(false)
          }}
        />
      )}

      {editingClient && (
        <ClientQuickCreateModal
          initialClient={editingClient}
          onClose={() => setEditingClient(null)}
          onCreated={(client) => {
            setClients((prev) => prev.map((c) => (c.id === client.id ? client : c)).sort((a, b) => a.name.localeCompare(b.name)))
            setEditingClient(null)
          }}
        />
      )}

      {historyClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setHistoryClient(null)} />
          <div className="relative w-full max-w-lg bg-surface rounded-card p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-display font-semibold">Pagamentos — {historyClient.name}</h2>
              <button onClick={() => setHistoryClient(null)} className="text-muted hover:text-ink">
                <X className="w-5 h-5" />
              </button>
            </div>
            {historyLoading ? (
              <p className="text-sm text-muted py-4 text-center">Carregando...</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-line">
                    <th className="pb-2 font-medium">Data</th>
                    <th className="pb-2 font-medium">Valor</th>
                    <th className="pb-2 font-medium">Forma</th>
                    <th className="pb-2 font-medium">Festa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td className="py-2 text-muted">{format(parseISO(h.payment_date), 'dd/MM/yyyy')}</td>
                      <td className="py-2 font-medium">{currency(h.amount)}</td>
                      <td className="py-2">{h.payment_method ? PAYMENT_METHOD_LABEL[h.payment_method] : '—'}</td>
                      <td className="py-2 text-muted">{h.eventLabel}</td>
                    </tr>
                  ))}
                  {history.length === 0 && (
                    <tr><td colSpan={4} className="py-4 text-center text-muted">Nenhum pagamento registrado ainda.</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
