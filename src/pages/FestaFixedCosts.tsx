import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { useUnit, UNITS } from '../lib/UnitContext'
import { supabase } from '../lib/supabaseClient'

interface FixedCost {
  id: string
  description: string
  amount: number
  unitId: string | null
}

function currency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function parseAmount(raw: string) {
  // "1.250,50" → 1250.5 ; "600,00" → 600 ; "600.5" → 600.5
  const t = raw.trim()
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export function FestaFixedCosts() {
  const { unitDbIds } = useUnit()
  const [costs, setCosts] = useState<FixedCost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [unitSlug, setUnitSlug] = useState('ambas')
  const [saving, setSaving] = useState(false)

  const [editing, setEditing] = useState<FixedCost | null>(null)
  const [editDescription, setEditDescription] = useState('')
  const [editAmount, setEditAmount] = useState('')
  const [editUnitSlug, setEditUnitSlug] = useState('ambas')
  const [deleting, setDeleting] = useState<FixedCost | null>(null)

  const slugByDbId = useMemo(() => {
    const map: Record<string, string> = {}
    for (const slug of Object.keys(unitDbIds)) map[unitDbIds[slug].unitId] = slug
    return map
  }, [unitDbIds])

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('festa_fixed_costs').select('*').order('created_at')
    if (error) setError('Não foi possível carregar os valores fixos.')
    setCosts((data ?? []).map((c) => ({ id: c.id, description: c.description, amount: Number(c.amount), unitId: c.unit_id })))
    setLoading(false)
  }

  function unitLabel(unitId: string | null) {
    if (!unitId) return 'Todas as unidades'
    return UNITS.find((u) => u.id === slugByDbId[unitId])?.name ?? '—'
  }

  function dbUnitId(slug: string) {
    return slug === 'ambas' ? null : unitDbIds[slug]?.unitId ?? null
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const value = parseAmount(amount)
    if (!description.trim() || value === null) {
      setError('Preencha o que é e o valor (ex: 600 ou 600,00).')
      return
    }
    setSaving(true)
    const { data, error } = await supabase
      .from('festa_fixed_costs')
      .insert({ description: description.trim(), amount: value, unit_id: dbUnitId(unitSlug) })
      .select()
      .single()
    if (error || !data) {
      setSaving(false)
      setError('Não foi possível cadastrar o valor fixo.')
      return
    }
    const { data: applied } = await supabase.rpc('apply_festa_fixed_cost', { p_fixed_cost_id: data.id })
    setSaving(false)
    setCosts((prev) => [...prev, { id: data.id, description: data.description, amount: Number(data.amount), unitId: data.unit_id }])
    setNotice(`"${data.description}" cadastrado e lançado em ${applied ?? 0} festa(s) de hoje em diante.`)
    setDescription('')
    setAmount('')
  }

  function openEdit(cost: FixedCost) {
    setEditing(cost)
    setEditDescription(cost.description)
    setEditAmount(String(cost.amount).replace('.', ','))
    setEditUnitSlug(cost.unitId ? slugByDbId[cost.unitId] ?? 'ambas' : 'ambas')
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    const value = parseAmount(editAmount)
    if (!editDescription.trim() || value === null) return
    const unitId = dbUnitId(editUnitSlug)
    const { error } = await supabase.rpc('update_festa_fixed_cost', {
      p_id: editing.id,
      p_description: editDescription.trim(),
      p_amount: value,
      p_unit_id: unitId,
    })
    if (error) {
      setError('Não foi possível salvar a alteração.')
      return
    }
    setCosts((prev) => prev.map((c) => (c.id === editing.id ? { ...c, description: editDescription.trim(), amount: value, unitId } : c)))
    setNotice(`"${editDescription.trim()}" atualizado nas festas de hoje em diante.`)
    setEditing(null)
  }

  async function handleConfirmDelete() {
    if (!deleting) return
    const target = deleting
    setDeleting(null)
    const { error } = await supabase.rpc('delete_festa_fixed_cost', { p_id: target.id })
    if (error) {
      setError('Não foi possível excluir o valor fixo.')
      return
    }
    setCosts((prev) => prev.filter((c) => c.id !== target.id))
    setNotice(`"${target.description}" excluído e retirado das festas de hoje em diante.`)
  }

  const totalsByUnit = UNITS.map((u) => {
    const dbId = unitDbIds[u.id]?.unitId
    const total = costs.filter((c) => !c.unitId || c.unitId === dbId).reduce((s, c) => s + c.amount, 0)
    return { name: u.name, total }
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Valores de despesa fixa das festas</h1>
        <p className="text-sm text-muted mt-1">
          Custos que toda festa tem. O que você cadastrar aqui entra sozinho nos custos de cada festa (aba Financeiro da
          Central da festa).
        </p>
      </div>

      {error && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5">{error}</div>}
      {notice && (
        <div className="bg-teal-light text-teal text-sm rounded-lg px-4 py-2.5 flex items-center justify-between gap-3">
          {notice}
          <button onClick={() => setNotice(null)} className="font-medium shrink-0">Ok</button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {totalsByUnit.map((t) => (
          <Card key={t.name}>
            <p className="text-xs text-muted">Cada festa em {t.name} recebe</p>
            <p className="text-2xl font-display font-semibold mt-1">{currency(t.total)}</p>
            <p className="text-xs text-muted mt-1">em custos fixos automáticos</p>
          </Card>
        ))}
      </div>

      <Card title="Cadastrar valor fixo">
        <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-[1fr_140px_200px_auto] gap-3 items-end">
          <div>
            <label className="block text-xs text-muted mb-1" htmlFor="ffc-desc">O que é</label>
            <input id="ffc-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex: Decoração" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1" htmlFor="ffc-amount">Valor (R$)</label>
            <input id="ffc-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="600,00" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1" htmlFor="ffc-unit">Vale para</label>
            <select id="ffc-unit" value={unitSlug} onChange={(e) => setUnitSlug(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm">
              <option value="ambas">Todas as unidades</option>
              {UNITS.map((u) => (
                <option key={u.id} value={u.id}>Só {u.name}</option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={saving}>
            <Plus className="w-4 h-4" /> {saving ? 'Lançando...' : 'Cadastrar'}
          </Button>
        </form>
        <p className="text-xs text-muted mt-3">
          Ao cadastrar, o valor já entra em todas as festas de hoje em diante (as que já passaram não mudam) e em toda
          festa nova. Na festa ele vira um custo normal: dá pra apagar ou ajustar só naquela festa.
        </p>
      </Card>

      <Card title="Valores cadastrados">
        {loading ? (
          <p className="text-sm text-muted py-4 text-center">Carregando...</p>
        ) : costs.length === 0 ? (
          <p className="text-sm text-muted">Nenhum valor fixo cadastrado ainda.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="pb-3 font-medium">O que é</th>
                <th className="pb-3 font-medium">Valor por festa</th>
                <th className="pb-3 font-medium">Vale para</th>
                <th className="pb-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {costs.map((c) => (
                <tr key={c.id}>
                  <td className="py-3 font-medium">{c.description}</td>
                  <td className="py-3 tabular-nums">{currency(c.amount)}</td>
                  <td className="py-3 text-muted">{unitLabel(c.unitId)}</td>
                  <td className="py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button onClick={() => openEdit(c)} className="text-muted hover:text-purple" aria-label="Editar">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setDeleting(c)} className="text-muted hover:text-danger" aria-label="Excluir">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setEditing(null)} />
          <div className="relative w-full max-w-sm bg-surface rounded-card p-6 shadow-xl">
            <h2 className="text-lg font-display font-semibold mb-1">Editar valor fixo</h2>
            <p className="text-sm text-muted mb-4">A mudança vale para as festas de hoje em diante. As que já passaram não mudam.</p>
            <form onSubmit={handleSaveEdit} className="space-y-3">
              <div>
                <label className="block text-xs text-muted mb-1" htmlFor="ffc-edit-desc">O que é</label>
                <input id="ffc-edit-desc" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1" htmlFor="ffc-edit-amount">Valor (R$)</label>
                <input id="ffc-edit-amount" inputMode="decimal" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1" htmlFor="ffc-edit-unit">Vale para</label>
                <select id="ffc-edit-unit" value={editUnitSlug} onChange={(e) => setEditUnitSlug(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm">
                  <option value="ambas">Todas as unidades</option>
                  {UNITS.map((u) => (
                    <option key={u.id} value={u.id}>Só {u.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2 pt-1">
                <Button type="button" variant="secondary" className="flex-1 justify-center" onClick={() => setEditing(null)}>Cancelar</Button>
                <Button type="submit" className="flex-1 justify-center">Salvar</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setDeleting(null)} />
          <div className="relative w-full max-w-sm bg-surface rounded-card p-6 shadow-xl">
            <h2 className="text-lg font-display font-semibold mb-1">Excluir "{deleting.description}"?</h2>
            <p className="text-sm text-muted mb-4">
              Ele sai das festas de hoje em diante e para de entrar nas festas novas. As festas que já passaram continuam
              com esse custo.
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1 justify-center" onClick={() => setDeleting(null)}>Cancelar</Button>
              <Button className="flex-1 justify-center !bg-none !bg-danger" onClick={handleConfirmDelete}>Excluir</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
