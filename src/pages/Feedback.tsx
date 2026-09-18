import { FormEvent, useEffect, useMemo, useState } from 'react'
import { subDays, format, parseISO } from 'date-fns'
import { Plus, Trash2, Smile, Meh, Frown, MessageCircle, Sparkles } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { supabase } from '../lib/supabaseClient'
import { useUndo } from '../lib/UndoContext'
import { SendReviewModal } from '../components/SendReviewModal'

interface NpsResponse {
  id: string
  cliente: string
  nota: number
  comentario: string
  data: string
}

interface PostEventEntry {
  id: string
  cliente: string
  phone: string | null
  data: string
  reviewLink: string | null
  unitName: string
  status: 'pendente' | 'solicitado'
}

interface PartyReviewEntry {
  id: string
  cliente: string
  hotDish: number | null
  cake: number | null
  sweets: number | null
  snacks: number | null
  service: number | null
  comment: string | null
  createdAt: string
}

const REVIEW_CATEGORIES: { key: keyof Pick<PartyReviewEntry, 'hotDish' | 'cake' | 'sweets' | 'snacks' | 'service'>; label: string }[] = [
  { key: 'hotDish', label: 'Pratos quentes' },
  { key: 'cake', label: 'Bolo' },
  { key: 'sweets', label: 'Docinhos' },
  { key: 'snacks', label: 'Salgadinhos' },
  { key: 'service', label: 'Atendimento' },
]

const REVIEW_REQUEST_TYPE = 'Pedido de avaliação'

function classify(nota: number): 'promotor' | 'neutro' | 'detrator' {
  if (nota >= 9) return 'promotor'
  if (nota >= 7) return 'neutro'
  return 'detrator'
}

function average(values: (number | null)[]) {
  const nums = values.filter((v): v is number => v != null)
  if (nums.length === 0) return null
  return nums.reduce((s, v) => s + v, 0) / nums.length
}

export function Feedback() {
  const { scheduleDelete } = useUndo()
  const [responses, setResponses] = useState<NpsResponse[]>([])
  const [postEvent, setPostEvent] = useState<PostEventEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cliente, setCliente] = useState('')
  const [nota, setNota] = useState('10')
  const [comentario, setComentario] = useState('')
  const [reviewModalEntry, setReviewModalEntry] = useState<PostEventEntry | null>(null)
  const [partyReviews, setPartyReviews] = useState<PartyReviewEntry[]>([])

  useEffect(() => {
    loadResponses()
    loadPostEvent()
    loadPartyReviews()
  }, [])

  async function loadResponses() {
    setLoading(true)
    const { data, error } = await supabase.from('nps_responses').select('*').order('created_at', { ascending: false })
    if (error) {
      setError('Não foi possível carregar as respostas.')
      setLoading(false)
      return
    }
    setResponses(
      (data ?? []).map((r) => ({
        id: r.id,
        cliente: r.client_name,
        nota: r.score,
        comentario: r.comment ?? '',
        data: format(parseISO(r.created_at), 'dd/MM/yyyy'),
      })),
    )
    setLoading(false)
  }

  async function loadPostEvent() {
    const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd')
    const [{ data: reservationsData }, { data: contacts }] = await Promise.all([
      supabase
        .from('reservations')
        .select('id, event_date, client:clients(name, phone), unit:units(name, google_review_link)')
        .eq('event_date', yesterday)
        .neq('status', 'cancelada'),
      supabase.from('contact_history').select('client_name').eq('type', REVIEW_REQUEST_TYPE),
    ])
    const requested = new Set((contacts ?? []).map((c) => c.client_name))
    setPostEvent(
      (reservationsData ?? []).map((r: any) => ({
        id: r.id,
        cliente: r.client?.name ?? '—',
        phone: r.client?.phone ?? null,
        data: format(parseISO(r.event_date), 'dd/MM/yyyy'),
        reviewLink: r.unit?.google_review_link ?? null,
        unitName: r.unit?.name ?? '',
        status: requested.has(r.client?.name) ? 'solicitado' : 'pendente',
      })),
    )
  }

  async function loadPartyReviews() {
    const { data } = await supabase
      .from('party_reviews')
      .select('id, hot_dish_rating, cake_rating, sweets_rating, snacks_rating, service_rating, comment, created_at, review_links(client_name)')
      .order('created_at', { ascending: false })
    setPartyReviews(
      (data ?? []).map((r: any) => ({
        id: r.id,
        cliente: r.review_links?.client_name ?? '—',
        hotDish: r.hot_dish_rating,
        cake: r.cake_rating,
        sweets: r.sweets_rating,
        snacks: r.snacks_rating,
        service: r.service_rating,
        comment: r.comment,
        createdAt: format(parseISO(r.created_at), 'dd/MM/yyyy'),
      })),
    )
  }

  const pendentes = postEvent.filter((p) => p.status === 'pendente')

  const mediasPorCategoria = useMemo(
    () => REVIEW_CATEGORIES.map((c) => ({ ...c, media: average(partyReviews.map((r) => r[c.key])) })),
    [partyReviews],
  )

  const stats = useMemo(() => {
    const total = responses.length
    const promotores = responses.filter((r) => classify(r.nota) === 'promotor').length
    const detratores = responses.filter((r) => classify(r.nota) === 'detrator').length
    const nps = total > 0 ? Math.round(((promotores - detratores) / total) * 100) : 0
    return { total, promotores, detratores, neutros: total - promotores - detratores, nps }
  }, [responses])

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!cliente.trim()) return
    const { data, error } = await supabase
      .from('nps_responses')
      .insert({ client_name: cliente.trim(), score: Number(nota), comment: comentario.trim() || null })
      .select()
      .single()
    if (error) {
      setError('Não foi possível registrar a resposta.')
      return
    }
    setResponses((prev) => [
      { id: data.id, cliente: data.client_name, nota: data.score, comentario: data.comment ?? '', data: format(parseISO(data.created_at), 'dd/MM/yyyy') },
      ...prev,
    ])
    setCliente('')
    setNota('10')
    setComentario('')
  }

  function handleRemove(id: string) {
    const response = responses.find((r) => r.id === id)
    if (!response) return
    setResponses((prev) => prev.filter((r) => r.id !== id))
    scheduleDelete({
      label: `Resposta de "${response.cliente}" removida`,
      commit: async () => {
        await supabase.from('nps_responses').delete().eq('id', id)
      },
      undo: async () => {
        await supabase.from('nps_responses').insert({ id, client_name: response.cliente, score: response.nota, comment: response.comentario || null })
        setResponses((prev) => [response, ...prev])
      },
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Satisfação dos clientes (NPS)</h1>
        <p className="text-sm text-muted mt-1">Registre a nota que o cliente deu depois da festa</p>
      </div>

      {error && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5">{error}</div>}

      <Card className="border-purple/30 bg-purple-light">
        <div className="flex items-center gap-3 mb-3">
          <Sparkles className="w-5 h-5 text-purple-dark" />
          <p className="text-sm text-purple-dark font-medium">
            {pendentes.length} festa{pendentes.length !== 1 ? 's' : ''} de ontem aguardando pedido de avaliação
          </p>
        </div>
        <ul className="divide-y divide-line/60">
          {postEvent.map((p) => (
            <li key={p.id} className="py-2.5 flex items-center justify-between text-sm">
              <div>
                <p className="font-medium">{p.cliente}</p>
                <p className="text-xs text-muted">Festa em {p.data}</p>
              </div>
              {p.status === 'solicitado' ? (
                <Badge tone="teal">Já solicitado</Badge>
              ) : (
                <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={() => setReviewModalEntry(p)}>
                  <MessageCircle className="w-3.5 h-3.5" /> Enviar pedido
                </Button>
              )}
            </li>
          ))}
          {postEvent.length === 0 && <p className="text-sm text-muted py-2">Nenhuma festa ontem.</p>}
        </ul>
        <p className="text-xs text-muted mt-3">
          O sistema identifica sozinho quais festas foram ontem — o envio da mensagem (já com o link de avaliação do
          Google) continua sendo um clique seu, não é automático de verdade ainda.
        </p>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <p className="text-xs text-muted">NPS</p>
          <p className={`text-2xl font-display font-semibold mt-1 ${stats.nps >= 50 ? 'text-teal' : stats.nps >= 0 ? 'text-amber' : 'text-danger'}`}>
            {stats.nps}
          </p>
          <p className="text-xs text-muted mt-1">{stats.total} respostas</p>
        </Card>
        <Card>
          <p className="text-xs text-muted flex items-center gap-1"><Smile className="w-3.5 h-3.5 text-teal" /> Promotores</p>
          <p className="text-2xl font-display font-semibold mt-1">{stats.promotores}</p>
          <p className="text-xs text-muted mt-1">nota 9 ou 10</p>
        </Card>
        <Card>
          <p className="text-xs text-muted flex items-center gap-1"><Meh className="w-3.5 h-3.5 text-amber" /> Neutros</p>
          <p className="text-2xl font-display font-semibold mt-1">{stats.neutros}</p>
          <p className="text-xs text-muted mt-1">nota 7 ou 8</p>
        </Card>
        <Card>
          <p className="text-xs text-muted flex items-center gap-1"><Frown className="w-3.5 h-3.5 text-danger" /> Detratores</p>
          <p className="text-2xl font-display font-semibold mt-1">{stats.detratores}</p>
          <p className="text-xs text-muted mt-1">nota até 6</p>
        </Card>
      </div>

      <Card title="Avaliações detalhadas (formulário pós-festa)">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-4">
          {mediasPorCategoria.map((c) => (
            <div key={c.key}>
              <p className="text-xs text-muted">{c.label}</p>
              <p className="text-xl font-display font-semibold mt-1">{c.media != null ? c.media.toFixed(1) : '—'}</p>
              <p className="text-xs text-muted">{c.media != null ? 'de 5' : 'sem dados'}</p>
            </div>
          ))}
        </div>
        {partyReviews.filter((r) => r.comment).length > 0 ? (
          <ul className="divide-y divide-line">
            {partyReviews
              .filter((r) => r.comment)
              .map((r) => (
                <li key={r.id} className="py-2.5">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{r.cliente}</p>
                    <span className="text-xs text-muted">{r.createdAt}</span>
                  </div>
                  <p className="text-sm text-muted mt-0.5">{r.comment}</p>
                </li>
              ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nenhum comentário no formulário de avaliação ainda.</p>
        )}
      </Card>

      <Card title="Registrar resposta">
        <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <input
            type="text"
            required
            value={cliente}
            onChange={(e) => setCliente(e.target.value)}
            placeholder="Nome do cliente"
            className="sm:col-span-2 border border-line rounded-lg px-3 py-2 text-sm"
          />
          <select value={nota} onChange={(e) => setNota(e.target.value)} className="border border-line rounded-lg px-3 py-2 text-sm">
            {Array.from({ length: 11 }, (_, i) => i).map((n) => (
              <option key={n} value={n}>
                Nota {n}
              </option>
            ))}
          </select>
          <Button type="submit">
            <Plus className="w-4 h-4" /> Registrar
          </Button>
          <input
            type="text"
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
            placeholder="Comentário do cliente (opcional)"
            className="sm:col-span-4 border border-line rounded-lg px-3 py-2 text-sm"
          />
        </form>
      </Card>

      <Card title="Respostas recebidas">
        {loading ? (
          <p className="text-sm text-muted py-4 text-center">Carregando...</p>
        ) : responses.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma resposta registrada ainda.</p>
        ) : (
          <ul className="divide-y divide-line">
            {responses.map((r) => (
              <li key={r.id} className="py-3 flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm">{r.cliente}</p>
                    <Badge tone={classify(r.nota) === 'promotor' ? 'teal' : classify(r.nota) === 'neutro' ? 'amber' : 'danger'}>
                      Nota {r.nota}
                    </Badge>
                    <span className="text-xs text-muted">{r.data}</span>
                  </div>
                  {r.comentario && <p className="text-xs text-muted mt-1">{r.comentario}</p>}
                </div>
                <button onClick={() => handleRemove(r.id)} className="text-muted hover:text-danger shrink-0" aria-label="Remover">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
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
            setPostEvent((prev) => prev.map((p) => (p.id === reviewModalEntry.id ? { ...p, status: 'solicitado' } : p)))
            setReviewModalEntry(null)
          }}
        />
      )}
    </div>
  )
}
