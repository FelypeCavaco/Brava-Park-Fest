import { FormEvent, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Star, CheckCircle2 } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'

interface ReviewLink {
  token: string
  clientName: string
  unitName: string
}

const CATEGORIES: { key: 'hot_dish_rating' | 'cake_rating' | 'sweets_rating' | 'snacks_rating' | 'service_rating'; label: string }[] = [
  { key: 'hot_dish_rating', label: 'Pratos quentes' },
  { key: 'cake_rating', label: 'Bolo' },
  { key: 'sweets_rating', label: 'Docinhos' },
  { key: 'snacks_rating', label: 'Salgadinhos' },
  { key: 'service_rating', label: 'Atendimento' },
]

function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" onClick={() => onChange(n)} aria-label={`Nota ${n}`}>
          <Star className={`w-6 h-6 ${n <= value ? 'text-orange fill-orange' : 'text-line'}`} />
        </button>
      ))}
    </div>
  )
}

export function ReviewPublic() {
  const { token } = useParams<{ token: string }>()
  const [page, setPage] = useState<ReviewLink | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [ratings, setRatings] = useState<Record<string, number>>({})
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (token) load()
  }, [token])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('review_links').select('token, client_name, unit_name').eq('token', token).maybeSingle()
    if (error || !data) {
      setNotFound(true)
      setLoading(false)
      return
    }
    setPage({ token: data.token, clientName: data.client_name, unitName: data.unit_name })
    setLoading(false)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!token) return
    setSaving(true)
    setError(null)
    const { error } = await supabase.from('party_reviews').insert({
      token,
      hot_dish_rating: ratings.hot_dish_rating || null,
      cake_rating: ratings.cake_rating || null,
      sweets_rating: ratings.sweets_rating || null,
      snacks_rating: ratings.snacks_rating || null,
      service_rating: ratings.service_rating || null,
      comment: comment.trim() || null,
    })
    setSaving(false)
    if (error) {
      setError('Não foi possível enviar sua avaliação. Tenta de novo em alguns instantes.')
      return
    }
    setSent(true)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper">
        <p className="text-sm text-muted">Carregando...</p>
      </div>
    )
  }

  if (notFound || !page) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper p-4">
        <div className="max-w-sm text-center">
          <p className="text-lg font-display font-semibold mb-2">Link não encontrado</p>
          <p className="text-sm text-muted">Confira se o endereço foi copiado certinho.</p>
        </div>
      </div>
    )
  }

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper p-4">
        <div className="max-w-sm text-center bg-surface rounded-card shadow-xl p-8">
          <CheckCircle2 className="w-10 h-10 text-teal mx-auto mb-3" />
          <p className="text-lg font-display font-semibold mb-2">Obrigado pela avaliação!</p>
          <p className="text-sm text-muted">Sua opinião é muito importante para a gente melhorar sempre.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-paper flex items-start justify-center p-4 py-10">
      <div className="w-full max-w-lg bg-surface rounded-card shadow-xl p-6 sm:p-8">
        <h1 className="text-xl font-display font-semibold mb-1">Como foi a festa?</h1>
        <p className="text-sm text-muted mb-6">
          {page.clientName} · {page.unitName}
        </p>

        {error && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5 mb-4">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          {CATEGORIES.map((c) => (
            <div key={c.key} className="flex items-center justify-between gap-3">
              <label className="text-sm font-medium">{c.label}</label>
              <StarPicker value={ratings[c.key] ?? 0} onChange={(v) => setRatings((prev) => ({ ...prev, [c.key]: v }))} />
            </div>
          ))}
          <div>
            <label className="block text-xs text-muted mb-1">Quer contar mais alguma coisa? (opcional)</label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              placeholder="Fique à vontade para escrever o que quiser"
              className="w-full border border-line rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="w-full bg-purple text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50"
          >
            {saving ? 'Enviando...' : 'Enviar avaliação'}
          </button>
        </form>
      </div>
    </div>
  )
}
