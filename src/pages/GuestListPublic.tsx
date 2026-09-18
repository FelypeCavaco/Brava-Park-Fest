import { FormEvent, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { PartyPopper, Users, Trash2, CheckCircle2 } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'

interface GuestPage {
  token: string
  unitName: string
  eventDate: string
  theme: string | null
  childName: string | null
  guestLimit: number | null
}

interface GuestEntry {
  id: string
  name: string
}

export function GuestListPublic() {
  const { token } = useParams<{ token: string }>()
  const [page, setPage] = useState<GuestPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [entries, setEntries] = useState<GuestEntry[]>([])
  const [namesText, setNamesText] = useState('')
  const [saving, setSaving] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (token) load()
  }, [token])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('guest_list_pages').select('*').eq('token', token).maybeSingle()
    if (error || !data) {
      setNotFound(true)
      setLoading(false)
      return
    }
    setPage({
      token: data.token,
      unitName: data.unit_name,
      eventDate: data.event_date,
      theme: data.theme,
      childName: data.child_name,
      guestLimit: data.guest_limit,
    })
    await loadEntries()
    setLoading(false)
  }

  async function loadEntries() {
    const { data } = await supabase.from('guest_list_entries').select('id, name').eq('token', token).order('created_at')
    setEntries((data ?? []).map((e) => ({ id: e.id, name: e.name })))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const names = namesText
      .split('\n')
      .map((n) => n.trim())
      .filter((n) => n.length > 0)
    if (names.length === 0) return

    setSaving(true)
    setError(null)
    const { error } = await supabase.from('guest_list_entries').insert(names.map((name) => ({ token, name })))
    setSaving(false)

    if (error) {
      setError('Não foi possível enviar a lista. Tenta de novo em alguns instantes.')
      return
    }

    setNamesText('')
    setSent(true)
    await loadEntries()
  }

  async function handleRemove(entryId: string) {
    const previous = entries
    setEntries((prev) => prev.filter((e) => e.id !== entryId))
    const { error } = await supabase.from('guest_list_entries').delete().eq('id', entryId)
    if (error) setEntries(previous)
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
          <p className="text-sm text-muted">Confira se o endereço foi copiado certinho, ou peça um novo link à casa de festas.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-paper flex items-start justify-center p-4 py-10">
      <div className="w-full max-w-lg bg-surface rounded-card shadow-xl p-6 sm:p-8">
        <div className="flex items-center gap-2 mb-1">
          <PartyPopper className="w-5 h-5 text-orange" />
          <h1 className="text-xl font-display font-semibold">Lista de convidados</h1>
        </div>
        <p className="text-sm text-muted mb-6">
          {page.childName ? `Festa de ${page.childName}` : 'Sua festa'}
          {page.theme ? ` — tema "${page.theme}"` : ''} · {format(parseISO(page.eventDate), 'dd/MM/yyyy')} · {page.unitName}
        </p>

        {page.guestLimit && (
          <p className="text-xs text-muted mb-4">Seu pacote inclui até {page.guestLimit} convidados.</p>
        )}

        {error && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5 mb-4">{error}</div>}

        {sent && (
          <div className="bg-teal-light text-teal text-sm rounded-lg px-4 py-2.5 mb-4 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> Lista enviada! Você pode mandar mais nomes depois, se precisar.
          </div>
        )}

        {entries.length > 0 && (
          <div className="mb-6">
            <p className="text-xs text-muted mb-2 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" /> {entries.length} convidado(s) já enviado(s)
            </p>
            <ul className="divide-y divide-line border border-line rounded-lg max-h-52 overflow-y-auto">
              {entries.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  {entry.name}
                  <button onClick={() => handleRemove(entry.id)} className="text-muted hover:text-danger" aria-label="Remover nome">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs text-muted mb-1">
              Digite um nome por linha (pode colar a lista toda de uma vez)
            </label>
            <textarea
              value={namesText}
              onChange={(e) => setNamesText(e.target.value)}
              rows={8}
              placeholder={'Ex:\nMaria Silva\nJoão Souza\nAna Pereira'}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={saving || namesText.trim().length === 0}
            className="w-full bg-purple text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50"
          >
            {saving ? 'Enviando...' : 'Enviar lista'}
          </button>
        </form>
      </div>
    </div>
  )
}
