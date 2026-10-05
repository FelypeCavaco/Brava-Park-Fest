import { FormEvent, useEffect, useMemo, useState } from 'react'
import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { useUnit, UNITS } from '../lib/UnitContext'
import { supabase } from '../lib/supabaseClient'

interface FixedCost {
  id: string
  description: string
  amount: number
  unitId: string | null
  packageAmounts: Record<string, number>
}

interface PackageLite {
  id: string
  name: string
  unitId: string | null
}

function currency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// "1.250,50" → 1250.5 ; "600,00" → 600 ; "600.5" → 600.5
function parseAmount(raw: string) {
  const t = raw.trim()
  if (t === '') return null
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function toInput(v: number) {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function FestaFixedCosts() {
  const { unitDbIds } = useUnit()
  const [costs, setCosts] = useState<FixedCost[]>([])
  const [packages, setPackages] = useState<PackageLite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  // formulário (criar e editar usam o mesmo)
  const [formOpen, setFormOpen] = useState(false)
  const [formId, setFormId] = useState<string | null>(null)
  const [formDescription, setFormDescription] = useState('')
  const [formAmount, setFormAmount] = useState('')
  const [formUnitSlug, setFormUnitSlug] = useState('ambas')
  const [formPackageAmounts, setFormPackageAmounts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
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
    const [{ data: fc, error }, { data: overrides }, { data: pkgs }] = await Promise.all([
      supabase.from('festa_fixed_costs').select('*').order('created_at'),
      supabase.from('festa_fixed_cost_package_amounts').select('fixed_cost_id, package_id, amount'),
      supabase.from('packages').select('id, name, unit_id').eq('active', true).order('name'),
    ])
    if (error) setError('Não foi possível carregar as despesas fixas.')
    const byCost: Record<string, Record<string, number>> = {}
    for (const o of overrides ?? []) {
      if (!byCost[o.fixed_cost_id]) byCost[o.fixed_cost_id] = {}
      byCost[o.fixed_cost_id][o.package_id] = Number(o.amount)
    }
    setCosts(
      (fc ?? []).map((c) => ({
        id: c.id,
        description: c.description,
        amount: Number(c.amount),
        unitId: c.unit_id,
        packageAmounts: byCost[c.id] ?? {},
      })),
    )
    setPackages((pkgs ?? []).map((p) => ({ id: p.id, name: p.name, unitId: p.unit_id })))
    setLoading(false)
  }

  function unitLabel(unitId: string | null) {
    if (!unitId) return 'Todas as unidades'
    return UNITS.find((u) => u.id === slugByDbId[unitId])?.name ?? '—'
  }

  function dbUnitId(slug: string) {
    return slug === 'ambas' ? null : unitDbIds[slug]?.unitId ?? null
  }

  // Planos que recebem a despesa, agrupados por unidade.
  function packagesForUnit(unitId: string | null) {
    return UNITS.map((u) => {
      const dbId = unitDbIds[u.id]?.unitId
      return {
        unitName: u.name,
        unitDbId: dbId,
        packages: packages.filter((p) => (unitId ? p.unitId === unitId : true) && (!p.unitId || p.unitId === dbId)),
      }
    }).filter((g) => (unitId ? g.unitDbId === unitId : true) && g.packages.length > 0)
  }

  function openCreate() {
    setFormId(null)
    setFormDescription('')
    setFormAmount('')
    setFormUnitSlug('ambas')
    setFormPackageAmounts({})
    setFormOpen(true)
  }

  function openEdit(cost: FixedCost) {
    setFormId(cost.id)
    setFormDescription(cost.description)
    setFormAmount(toInput(cost.amount))
    setFormUnitSlug(cost.unitId ? slugByDbId[cost.unitId] ?? 'ambas' : 'ambas')
    setFormPackageAmounts(Object.fromEntries(Object.entries(cost.packageAmounts).map(([k, v]) => [k, toInput(v)])))
    setFormOpen(true)
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const value = parseAmount(formAmount)
    if (!formDescription.trim() || value === null) {
      setError('Preencha o que é e o valor padrão (ex: 600 ou 600,00).')
      return
    }
    const unitId = dbUnitId(formUnitSlug)
    const allowedPackages = new Set(packagesForUnit(unitId).flatMap((g) => g.packages.map((p) => p.id)))
    const packageAmounts: Record<string, number> = {}
    for (const [pkgId, raw] of Object.entries(formPackageAmounts)) {
      if (!allowedPackages.has(pkgId)) continue
      const v = parseAmount(raw)
      if (v !== null) packageAmounts[pkgId] = v
    }

    setSaving(true)
    const { data: savedId, error } = await supabase.rpc('save_festa_fixed_cost', {
      p_id: formId,
      p_description: formDescription.trim(),
      p_amount: value,
      p_unit_id: unitId,
      p_package_amounts: packageAmounts,
    })
    setSaving(false)
    if (error || !savedId) {
      setError('Não foi possível salvar a despesa fixa.')
      return
    }
    const saved: FixedCost = { id: savedId as string, description: formDescription.trim(), amount: value, unitId, packageAmounts }
    setCosts((prev) => (formId ? prev.map((c) => (c.id === formId ? saved : c)) : [...prev, saved]))
    setNotice(
      formId
        ? `"${saved.description}" atualizado nas festas de hoje em diante.`
        : `"${saved.description}" cadastrado e lançado nas festas de hoje em diante.`,
    )
    setFormOpen(false)
  }

  async function handleConfirmDelete() {
    if (!deleting) return
    const target = deleting
    setDeleting(null)
    const { error } = await supabase.rpc('delete_festa_fixed_cost', { p_id: target.id })
    if (error) {
      setError('Não foi possível excluir a despesa fixa.')
      return
    }
    setCosts((prev) => prev.filter((c) => c.id !== target.id))
    setNotice(`"${target.description}" excluído e retirado das festas de hoje em diante.`)
  }

  // Total de despesas fixas que cada plano recebe, por unidade.
  const totalsByUnit = UNITS.map((u) => {
    const dbId = unitDbIds[u.id]?.unitId
    const unitCosts = costs.filter((c) => !c.unitId || c.unitId === dbId)
    const unitPackages = packages.filter((p) => p.unitId === dbId)
    const perPackage = unitPackages.map((p) => ({
      name: p.name,
      total: unitCosts.reduce((s, c) => s + (c.packageAmounts[p.id] ?? c.amount), 0),
    }))
    const base = unitCosts.reduce((s, c) => s + c.amount, 0)
    const values = perPackage.length ? perPackage.map((p) => p.total) : [base]
    return { name: u.name, min: Math.min(...values), max: Math.max(...values), perPackage }
  })

  const formUnitId = dbUnitId(formUnitSlug)
  const formDefault = parseAmount(formAmount)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Valores de despesa fixa das festas</h1>
          <p className="text-sm text-muted mt-1 max-w-2xl">
            Custos que toda festa tem. O que você cadastrar aqui entra sozinho nos custos de cada festa (aba Financeiro da
            Central da festa). Dá pra ter um valor diferente por plano — por exemplo docinhos, salgados e bolo, que
            aumentam com o número de convidados.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4" /> Nova despesa fixa
        </Button>
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
            <p className="text-2xl font-display font-semibold mt-1 tabular-nums">
              {t.min === t.max ? currency(t.min) : `${currency(t.min)} a ${currency(t.max)}`}
            </p>
            <p className="text-xs text-muted mt-1">em despesas fixas, conforme o plano</p>
            {t.perPackage.length > 0 && costs.length > 0 && (
              <details className="mt-3">
                <summary className="text-xs text-purple font-medium cursor-pointer">Ver por plano</summary>
                <ul className="mt-2 space-y-1 text-xs">
                  {t.perPackage.map((p) => (
                    <li key={p.name} className="flex justify-between gap-3">
                      <span className="text-muted">{p.name}</span>
                      <span className="tabular-nums font-medium">{currency(p.total)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Card>
        ))}
      </div>

      <Card title="Despesas cadastradas">
        {loading ? (
          <p className="text-sm text-muted py-4 text-center">Carregando...</p>
        ) : costs.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma despesa fixa cadastrada ainda. Clique em "Nova despesa fixa".</p>
        ) : (
          <ul className="divide-y divide-line">
            {costs.map((c) => {
              const overrideCount = Object.keys(c.packageAmounts).length
              const isOpen = expanded === c.id
              return (
                <li key={c.id} className="py-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{c.description}</p>
                      <p className="text-xs text-muted">
                        {unitLabel(c.unitId)} · padrão {currency(c.amount)}
                        {overrideCount > 0 && ` · valor próprio em ${overrideCount} plano(s)`}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {overrideCount > 0 && (
                        <button onClick={() => setExpanded(isOpen ? null : c.id)} className="text-xs text-purple font-medium flex items-center gap-1">
                          Valores por plano <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                        </button>
                      )}
                      <button onClick={() => openEdit(c)} className="text-muted hover:text-purple" aria-label="Editar">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setDeleting(c)} className="text-muted hover:text-danger" aria-label="Excluir">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {isOpen && (
                    <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs bg-paper rounded-lg p-3">
                      {packagesForUnit(c.unitId).flatMap((g) =>
                        g.packages.map((p) => (
                          <li key={p.id} className="flex justify-between gap-3">
                            <span className="text-muted">{p.name}{!c.unitId ? ` (${g.unitName})` : ''}</span>
                            <span className={`tabular-nums ${p.id in c.packageAmounts ? 'font-semibold' : 'text-muted'}`}>
                              {currency(c.packageAmounts[p.id] ?? c.amount)}
                            </span>
                          </li>
                        )),
                      )}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setFormOpen(false)} />
          <div className="relative w-full max-w-xl bg-surface rounded-card p-6 shadow-xl max-h-[92vh] overflow-y-auto">
            <h2 className="text-lg font-display font-semibold mb-1">{formId ? 'Editar despesa fixa' : 'Nova despesa fixa'}</h2>
            <p className="text-sm text-muted mb-4">
              {formId
                ? 'A mudança vale para as festas de hoje em diante. As que já passaram não mudam.'
                : 'Entra em todas as festas de hoje em diante e em toda festa nova.'}
            </p>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-3">
                <div>
                  <label className="block text-xs text-muted mb-1" htmlFor="ffc-desc">O que é</label>
                  <input id="ffc-desc" value={formDescription} onChange={(e) => setFormDescription(e.target.value)} placeholder="Ex: Docinhos" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1" htmlFor="ffc-amount">Valor padrão (R$)</label>
                  <input id="ffc-amount" inputMode="decimal" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} placeholder="600,00" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-muted mb-1" htmlFor="ffc-unit">Vale para</label>
                <select id="ffc-unit" value={formUnitSlug} onChange={(e) => setFormUnitSlug(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm">
                  <option value="ambas">Todas as unidades</option>
                  {UNITS.map((u) => (
                    <option key={u.id} value={u.id}>Só {u.name}</option>
                  ))}
                </select>
              </div>

              <div className="border-t border-line pt-4">
                <p className="text-sm font-semibold">Valor por plano (opcional)</p>
                <p className="text-xs text-muted mb-3">
                  Preencha só os planos que têm valor diferente. Plano em branco usa o valor padrão
                  {formDefault !== null ? ` (${currency(formDefault)})` : ''}.
                </p>
                <div className="space-y-4">
                  {packagesForUnit(formUnitId).map((g) => (
                    <div key={g.unitName}>
                      <p className="text-[11px] uppercase tracking-wide text-muted font-semibold mb-1.5">{g.unitName}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                        {g.packages.map((p) => (
                          <label key={p.id} className="flex items-center justify-between gap-2 text-sm">
                            <span className="truncate">{p.name}</span>
                            <input
                              inputMode="decimal"
                              value={formPackageAmounts[p.id] ?? ''}
                              onChange={(e) => setFormPackageAmounts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                              placeholder={formDefault !== null ? toInput(formDefault) : 'padrão'}
                              className="w-24 border border-line rounded-lg px-2 py-1 text-sm text-right tabular-nums"
                              aria-label={`Valor para ${p.name}`}
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <Button type="button" variant="secondary" className="flex-1 justify-center" onClick={() => setFormOpen(false)}>Cancelar</Button>
                <Button type="submit" className="flex-1 justify-center" disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button>
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
              Ela sai das festas de hoje em diante e para de entrar nas festas novas. As festas que já passaram continuam
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
