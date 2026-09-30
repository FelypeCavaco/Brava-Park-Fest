import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { Search, User, PartyPopper } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'

interface ClientHit { id: string; name: string; phone: string | null; haystack: string; phoneDigits: string }
interface FestaHit { id: string; cliente: string; aniversariante: string | null; data: string; haystack: string }

// Ignora acentos e maiúsculas: "theo" acha "Théo", "sao" acha "São".
function normalize(text: string) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function GlobalSearch() {
  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [clients, setClients] = useState<ClientHit[]>([])
  const [festas, setFestas] = useState<FestaHit[]>([])

  useEffect(() => {
    loadIndex()
  }, [])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function loadIndex() {
    const [{ data: clientsData }, { data: reservationsData }] = await Promise.all([
      supabase.from('clients').select('id, name, phone, child_name').order('name'),
      supabase
        .from('reservations')
        .select('id, event_date, child_name, client:clients(name)')
        .neq('status', 'cancelada')
        .order('event_date', { ascending: false }),
    ])
    setClients(
      (clientsData ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        haystack: normalize(`${c.name} ${c.child_name ?? ''}`),
        phoneDigits: (c.phone ?? '').replace(/\D/g, ''),
      })),
    )
    setFestas(
      (reservationsData ?? []).map((r: any) => {
        const cliente = r.client?.name ?? '—'
        const data = format(parseISO(r.event_date), 'dd/MM/yyyy')
        return {
          id: r.id,
          cliente,
          aniversariante: r.child_name,
          data,
          haystack: normalize(`${cliente} ${r.child_name ?? ''} ${data}`),
        }
      }),
    )
  }

  const results = useMemo(() => {
    const q = normalize(query.trim())
    if (q.length < 2) return { clients: [] as ClientHit[], festas: [] as FestaHit[] }
    const tokens = q.split(/\s+/).filter(Boolean)
    const digits = q.replace(/\D/g, '')
    const matches = (haystack: string) => tokens.every((t) => haystack.includes(t))
    return {
      clients: clients.filter((c) => matches(c.haystack) || (digits.length >= 4 && c.phoneDigits.includes(digits))).slice(0, 6),
      festas: festas.filter((f) => matches(f.haystack)).slice(0, 6),
    }
  }, [query, clients, festas])

  const hasResults = results.clients.length > 0 || results.festas.length > 0

  function goTo(path: string) {
    setOpen(false)
    setQuery('')
    navigate(path)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') setOpen(false)
    if (e.key !== 'Enter') return
    if (results.festas[0]) goTo(`/reservas/${results.festas[0].id}`)
    else if (results.clients[0]) goTo(`/clientes?ver=${results.clients[0].id}`)
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-sm z-40">
      <div className="relative">
        <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => {
            setOpen(true)
            // recarrega a cada vez que a busca é usada, pra achar também quem
            // foi cadastrado depois que a página abriu
            loadIndex()
          }}
          onKeyDown={handleKeyDown}
          placeholder="Buscar cliente, aniversariante ou festa..."
          className="w-full border border-line rounded-lg pl-9 pr-3 py-2 text-sm bg-surface"
        />
      </div>
      {open && query.trim().length >= 2 && (
        <div className="absolute z-50 mt-1 w-full bg-surface border border-line rounded-lg shadow-lg overflow-hidden max-h-[70vh] overflow-y-auto">
          {!hasResults && <p className="text-xs text-muted px-3 py-3">Nada encontrado para "{query}".</p>}
          {results.festas.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted px-3 pt-2">Festas</p>
              {results.festas.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => goTo(`/reservas/${f.id}`)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-paper text-left"
                >
                  <PartyPopper className="w-3.5 h-3.5 text-muted shrink-0" />
                  <span className="min-w-0 truncate">
                    {f.cliente} · {f.data}
                    {f.aniversariante && <span className="text-muted"> · {f.aniversariante}</span>}
                  </span>
                </button>
              ))}
            </div>
          )}
          {results.clients.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted px-3 pt-2">Clientes</p>
              {results.clients.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => goTo(`/clientes?ver=${c.id}`)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-paper text-left"
                >
                  <User className="w-3.5 h-3.5 text-muted shrink-0" />
                  <span className="min-w-0 truncate">
                    {c.name}
                    {c.phone && <span className="text-muted"> · {c.phone}</span>}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
