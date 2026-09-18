import { FormEvent, useEffect, useState } from 'react'
import { Plus, Trash2, Star, Phone } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { supabase } from '../lib/supabaseClient'
import { useOpenOnQueryParam } from '../lib/useOpenOnQueryParam'
import { useUndo } from '../lib/UndoContext'
import { SUPPLIER_SERVICE_TYPES, type Supplier, type SupplierServiceType } from '../types'

interface BookingRow {
  id: string
  supplierId: string
  label: string
  amount: number
  evaluationNote: string | null
  evaluationRating: number | null
}

function currency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

function Stars({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-muted">Sem avaliação</span>
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} className={`w-3.5 h-3.5 ${i < value ? 'text-orange fill-orange' : 'text-line'}`} />
      ))}
    </div>
  )
}

export function Suppliers() {
  const { scheduleDelete } = useUndo()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  useOpenOnQueryParam('novo', () => setShowForm(true))

  const [name, setName] = useState('')
  const [serviceType, setServiceType] = useState<SupplierServiceType>(SUPPLIER_SERVICE_TYPES[0])
  const [serviceTypeOutro, setServiceTypeOutro] = useState('')
  const [contact, setContact] = useState('')
  const [defaultPrice, setDefaultPrice] = useState('')

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    const [{ data: sup, error: supErr }, { data: bk }] = await Promise.all([
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('supplier_bookings').select('*, reservation:reservations(event_date, client:clients(name))'),
    ])

    if (supErr) setError('Não foi possível carregar os fornecedores.')

    setSuppliers((sup ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      service_type: s.service_type,
      contact: s.contact,
      default_price: s.default_price !== null ? Number(s.default_price) : null,
      rating: s.rating !== null ? Number(s.rating) : null,
      notes: s.notes,
    })))

    setBookings(
      (bk ?? []).map((b: any) => ({
        id: b.id,
        supplierId: b.supplier_id,
        label: b.reservation ? `${b.reservation.client?.name ?? '—'} — ${format(parseISO(b.reservation.event_date), 'dd/MM/yyyy')}` : 'Festa não vinculada',
        amount: Number(b.amount),
        evaluationNote: b.evaluation_note,
        evaluationRating: b.evaluation_rating,
      })),
    )
    setLoading(false)
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    const finalServiceType = serviceType === 'Outro' ? serviceTypeOutro.trim() || 'Outro' : serviceType
    const { data, error } = await supabase
      .from('suppliers')
      .insert({
        name: name.trim(),
        service_type: finalServiceType,
        contact: contact.trim() || null,
        default_price: Number(defaultPrice) || null,
      })
      .select()
      .single()

    if (error) {
      setError('Não foi possível salvar o fornecedor.')
      return
    }

    setSuppliers((prev) => [
      ...prev,
      { id: data.id, name: data.name, service_type: data.service_type, contact: data.contact, default_price: data.default_price !== null ? Number(data.default_price) : null, rating: null, notes: null },
    ])
    setName('')
    setServiceTypeOutro('')
    setContact('')
    setDefaultPrice('')
    setShowForm(false)
  }

  function handleRemove(id: string) {
    const supplier = suppliers.find((s) => s.id === id)
    if (!supplier) return
    setSuppliers((prev) => prev.filter((s) => s.id !== id))
    scheduleDelete({
      label: `"${supplier.name}" removido`,
      commit: async () => {
        await supabase.from('suppliers').delete().eq('id', id)
      },
      undo: async () => {
        await supabase.from('suppliers').insert(supplier)
        setSuppliers((prev) => [...prev, supplier])
      },
    })
  }

  function avgRating(supplierId: string) {
    const evals = bookings.filter((b) => b.supplierId === supplierId && b.evaluationRating !== null)
    if (evals.length === 0) return null
    return Math.round((evals.reduce((s, b) => s + (b.evaluationRating ?? 0), 0) / evals.length) * 10) / 10
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Fornecedores</h1>
          <p className="text-sm text-muted mt-1">Parceiros terceirizados (buffet externo, DJ, fotógrafo, decoração...)</p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4" /> Novo fornecedor
        </Button>
      </div>

      {error && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5">{error}</div>}

      <Card>
        {loading ? (
          <p className="text-sm text-muted py-4 text-center">Carregando...</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="pb-3 font-medium">Nome</th>
                <th className="pb-3 font-medium">Tipo de serviço</th>
                <th className="pb-3 font-medium">Contato</th>
                <th className="pb-3 font-medium">Preço combinado</th>
                <th className="pb-3 font-medium">Avaliação média</th>
                <th className="pb-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {suppliers.map((s) => (
                <tr key={s.id}>
                  <td className="py-3 font-medium">{s.name}</td>
                  <td className="py-3"><Badge tone="purple">{s.service_type}</Badge></td>
                  <td className="py-3 text-muted">
                    {s.contact ? (
                      <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {s.contact}</span>
                    ) : '—'}
                  </td>
                  <td className="py-3">{s.default_price ? currency(s.default_price) : '—'}</td>
                  <td className="py-3"><Stars value={avgRating(s.id)} /></td>
                  <td className="py-3 text-right">
                    <button onClick={() => handleRemove(s.id)} className="text-muted hover:text-danger" aria-label="Remover">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {suppliers.length === 0 && (
                <tr><td colSpan={6} className="py-6 text-center text-muted">Nenhum fornecedor cadastrado ainda.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Avaliações pós-evento">
        <p className="text-xs text-muted mb-3">
          Avaliação interna feita pela equipe (separada da pesquisa de satisfação do cliente/NPS). Ainda não existe
          uma tela para vincular um fornecedor a uma festa — isso é um próximo passo.
        </p>
        <ul className="divide-y divide-line">
          {bookings.map((b) => {
            const supplier = suppliers.find((s) => s.id === b.supplierId)
            return (
              <li key={b.id} className="py-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{supplier?.name} · {b.label}</p>
                  <Stars value={b.evaluationRating} />
                </div>
                {b.evaluationNote && <p className="text-xs text-muted mt-1">{b.evaluationNote}</p>}
                <p className="text-xs text-muted mt-0.5">Valor combinado: {currency(b.amount)}</p>
              </li>
            )
          })}
          {bookings.length === 0 && <p className="text-sm text-muted">Nenhuma avaliação registrada ainda.</p>}
        </ul>
      </Card>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setShowForm(false)} />
          <div className="relative w-full max-w-md bg-surface rounded-card p-6 shadow-xl">
            <h2 className="text-lg font-display font-semibold mb-4">Novo fornecedor</h2>
            <form onSubmit={handleAdd} className="space-y-3">
              <div>
                <label className="block text-xs text-muted mb-1">Nome</label>
                <input type="text" required value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Tipo de serviço</label>
                <select value={serviceType} onChange={(e) => setServiceType(e.target.value as SupplierServiceType)} className="w-full border border-line rounded-lg px-3 py-2 text-sm">
                  {SUPPLIER_SERVICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                {serviceType === 'Outro' && (
                  <input
                    type="text"
                    value={serviceTypeOutro}
                    onChange={(e) => setServiceTypeOutro(e.target.value)}
                    placeholder="Qual tipo de serviço?"
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm mt-2"
                  />
                )}
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Contato</label>
                <input type="text" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="(11) 90000-0000" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Preço combinado (opcional)</label>
                <input type="number" value={defaultPrice} onChange={(e) => setDefaultPrice(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
              </div>
              <Button type="submit" className="w-full justify-center mt-2">Salvar fornecedor</Button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
