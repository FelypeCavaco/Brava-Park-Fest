import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { Search, User, PartyPopper } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'

interface ClientHit { id: string; name: string; phone: string | null }
interface FestaHit { id: string; cliente: string; data: string }

export function GlobalSearch() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [clients, setClients] = useState<ClientHit[]>([])
  const [festas, setFestas] = useState<FestaHit[]>([])

  useEffect(() => {
    loadIndex()
  }, [])

  async function loadIndex() {
    const [{ data: clientsData }, { data: reservationsData }] = await Promise.all([
      supabase.from('clients').select('id, name, phone').order('name'),
      supabase
        .from('reservations')
        .select('id, event_date, client:clients(name)')
        .neq('status', 'cancelada')
        .order('event_date', { ascending: false })
        .limit(300),
    ])
    setClients((clientsData ?? []).map((c) => ({ id: c.id, name: c.name, phone: c.phone })))
    setFestas(
      (reservationsData ?? []).map((r: any) => ({
        id: r.id,
        cliente: r.client?.name ?? '—',
        data: format(parseISO(r.event_date), 'dd/MM/yyyy'),
      })),
    )
  }

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return { clients: [] as ClientHit[], festas: [] as FestaHit[] }
    return {
      clients: clients.filter((c) => c.name.toLowerCase().includes(q) || (c.phone ?? '').includes(q)).slice(0, 5),
      festas: festas.filter((f) => f.cliente.toLowerCase().includes(q) || f.data.includes(q)).slice(0, 5),
    }
  }, [query, clients, festas])

  const hasResults = results.clients.length > 0 || results.festas.length > 0

  function goTo(path: string) {
    navigate(path)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="relative w-full max-w-sm">
      <div className="relative">
        <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Buscar cliente ou festa..."
          className="w-full border border-line rounded-lg pl-9 pr-3 py-2 text-sm bg-surface"
        />
      </div>
      {open && query.trim().length >= 2 && (
        <div className="absolute z-40 mt-1 w-full bg-surface border border-line rounded-lg shadow-lg overflow-hidden">
          {!hasResults && <p className="text-xs text-muted px-3 py-3">Nada encontrado para "{query}".</p>}
          {results.clients.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted px-3 pt-2">Clientes</p>
              {results.clients.map((c) => (
                <button
                  key={c.id}
                  onMouseDown={() => goTo('/clientes')}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-paper text-left"
                >
                  <User className="w-3.5 h-3.5 text-muted" /> {c.name}
                </button>
              ))}
            </div>
          )}
          {results.festas.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted px-3 pt-2">Festas</p>
              {results.festas.map((f) => (
                <button
                  key={f.id}
                  onMouseDown={() => goTo(`/reservas/${f.id}`)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-paper text-left"
                >
                  <PartyPopper className="w-3.5 h-3.5 text-muted" /> {f.cliente} · {f.data}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
