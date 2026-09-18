import { FormEvent, useEffect, useState } from 'react'
import { Plus, X, Trash2, Calculator, AlertTriangle, Pencil } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Can } from '../components/Can'
import { useUnit, UNITS } from '../lib/UnitContext'
import { supabase } from '../lib/supabaseClient'
import { useOpenOnQueryParam } from '../lib/useOpenOnQueryParam'
import { useUndo } from '../lib/UndoContext'
import { PACKAGE_COST_CATEGORIES, type PackageCostCategory } from '../types'

interface PackageRow {
  id: string
  name: string
  description: string | null
  base_price: number
  weekday_price: number | null
  weekend_price: number | null
  unit_id: string | null
  guest_limit: number | null
  duration_hours: number | null
  included_items: string | null
}

interface ExtraRow {
  id: string
  name: string
  price: number
}

interface CostItem {
  id: string
  category: PackageCostCategory
  amount: number
}

const MARGEM_ALERTA = 25 // %

function currency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

export function Packages() {
  const { selectedUnit, unitDbIds } = useUnit()
  const { scheduleDelete } = useUndo()
  const [packages, setPackages] = useState<PackageRow[]>([])
  const [extras, setExtras] = useState<ExtraRow[]>([])
  const [costsByPackage, setCostsByPackage] = useState<Record<string, CostItem[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showPackageForm, setShowPackageForm] = useState(false)
  const [editingPackageId, setEditingPackageId] = useState<string | null>(null)
  useOpenOnQueryParam('novo', () => openNewPackage())
  const [pkgName, setPkgName] = useState('')
  const [pkgDesc, setPkgDesc] = useState('')
  const [pkgPreco, setPkgPreco] = useState('')
  const [pkgPrecoSemana, setPkgPrecoSemana] = useState('')
  const [pkgPrecoFds, setPkgPrecoFds] = useState('')
  const [pkgUnidade, setPkgUnidade] = useState('todas')
  const [pkgLimite, setPkgLimite] = useState('')
  const [pkgDuracao, setPkgDuracao] = useState('')
  const [pkgItens, setPkgItens] = useState('')

  const [showExtraForm, setShowExtraForm] = useState(false)
  const [extraName, setExtraName] = useState('')
  const [extraPreco, setExtraPreco] = useState('')

  const [fichaPackageId, setFichaPackageId] = useState<string | null>(null)
  const [custoCategoria, setCustoCategoria] = useState<PackageCostCategory>(PACKAGE_COST_CATEGORIES[0])
  const [custoCategoriaOutro, setCustoCategoriaOutro] = useState('')
  const [custoValor, setCustoValor] = useState('')

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    const [{ data: pkgs, error: pkgErr }, { data: extraData, error: extraErr }, { data: costData }] = await Promise.all([
      supabase.from('packages').select('id, name, description, base_price, weekday_price, weekend_price, unit_id, guest_limit, duration_hours, included_items').eq('active', true).order('name'),
      supabase.from('extra_items').select('id, name, price').order('name'),
      supabase.from('package_costs').select('*'),
    ])

    if (pkgErr || extraErr) {
      setError('Não foi possível carregar os pacotes.')
    }

    setPackages(
      (pkgs ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        base_price: Number(p.base_price),
        weekday_price: p.weekday_price != null ? Number(p.weekday_price) : null,
        weekend_price: p.weekend_price != null ? Number(p.weekend_price) : null,
        unit_id: p.unit_id,
        guest_limit: p.guest_limit,
        duration_hours: p.duration_hours != null ? Number(p.duration_hours) : null,
        included_items: p.included_items,
      })),
    )
    setExtras((extraData ?? []).map((e) => ({ id: e.id, name: e.name, price: Number(e.price) })))

    const grouped: Record<string, CostItem[]> = {}
    for (const c of costData ?? []) {
      const list = grouped[c.package_id] ?? []
      list.push({ id: c.id, category: c.category, amount: Number(c.amount) })
      grouped[c.package_id] = list
    }
    setCostsByPackage(grouped)
    setLoading(false)
  }

  function openNewPackage() {
    setEditingPackageId(null)
    setPkgName('')
    setPkgDesc('')
    setPkgPreco('')
    setPkgPrecoSemana('')
    setPkgPrecoFds('')
    setPkgUnidade('todas')
    setPkgLimite('')
    setPkgDuracao('')
    setPkgItens('')
    setShowPackageForm(true)
  }

  function openEditPackage(p: PackageRow) {
    setEditingPackageId(p.id)
    setPkgName(p.name)
    setPkgDesc(p.description ?? '')
    setPkgPreco(String(p.base_price))
    setPkgPrecoSemana(p.weekday_price != null ? String(p.weekday_price) : '')
    setPkgPrecoFds(p.weekend_price != null ? String(p.weekend_price) : '')
    setPkgUnidade(p.unit_id ? dbIdToSlug[p.unit_id] ?? 'todas' : 'todas')
    setPkgLimite(p.guest_limit != null ? String(p.guest_limit) : '')
    setPkgDuracao(p.duration_hours != null ? String(p.duration_hours) : '')
    setPkgItens(p.included_items ?? '')
    setShowPackageForm(true)
  }

  async function handleSavePackage(e: FormEvent) {
    e.preventDefault()
    const temPrecoPorDia = pkgPrecoSemana && pkgPrecoFds
    const preco = temPrecoPorDia ? Number(pkgPrecoSemana) : Number(pkgPreco)
    if (!pkgName.trim() || !preco) return
    const unitId = pkgUnidade === 'todas' ? null : unitDbIds[pkgUnidade]?.unitId ?? null
    const payload = {
      name: pkgName.trim(),
      description: pkgDesc.trim() || null,
      base_price: preco,
      weekday_price: pkgPrecoSemana ? Number(pkgPrecoSemana) : null,
      weekend_price: pkgPrecoFds ? Number(pkgPrecoFds) : null,
      unit_id: unitId,
      guest_limit: pkgLimite ? Number(pkgLimite) : null,
      duration_hours: pkgDuracao ? Number(pkgDuracao) : null,
      included_items: pkgItens.trim() || null,
    }

    const query = editingPackageId
      ? supabase.from('packages').update(payload).eq('id', editingPackageId)
      : supabase.from('packages').insert(payload)
    const { data, error } = await query.select().single()

    if (error) {
      setError('Não foi possível salvar o pacote.')
      return
    }

    const saved: PackageRow = {
      id: data.id,
      name: data.name,
      description: data.description,
      base_price: Number(data.base_price),
      weekday_price: data.weekday_price != null ? Number(data.weekday_price) : null,
      weekend_price: data.weekend_price != null ? Number(data.weekend_price) : null,
      unit_id: data.unit_id,
      guest_limit: data.guest_limit,
      duration_hours: data.duration_hours != null ? Number(data.duration_hours) : null,
      included_items: data.included_items,
    }
    setPackages((prev) => (editingPackageId ? prev.map((p) => (p.id === editingPackageId ? saved : p)) : [...prev, saved]))
    setShowPackageForm(false)
  }

  async function handleAddExtra(e: FormEvent) {
    e.preventDefault()
    const preco = Number(extraPreco)
    if (!extraName.trim() || !preco) return
    const { data, error } = await supabase.from('extra_items').insert({ name: extraName.trim(), price: preco }).select().single()
    if (error) {
      setError('Não foi possível salvar o item extra.')
      return
    }
    setExtras((prev) => [...prev, { id: data.id, name: data.name, price: Number(data.price) }])
    setExtraName('')
    setExtraPreco('')
    setShowExtraForm(false)
  }

  function handleRemovePackage(id: string) {
    const pkg = packages.find((p) => p.id === id)
    if (!pkg) return
    let deactivatedInstead = false
    setPackages((prev) => prev.filter((p) => p.id !== id))
    scheduleDelete({
      label: `Pacote "${pkg.name}" removido`,
      commit: async () => {
        const { error: deleteError } = await supabase.from('packages').delete().eq('id', id)
        if (deleteError) {
          // Provavelmente esse pacote já foi usado em alguma reserva ou proposta
          // (o banco impede apagar de vez pra não perder o histórico) — em vez de
          // travar, desativa o pacote: some da lista, mas o que já foi gerado continua intacto.
          deactivatedInstead = true
          await supabase.from('packages').update({ active: false }).eq('id', id)
        }
      },
      undo: async () => {
        if (deactivatedInstead) {
          await supabase.from('packages').update({ active: true }).eq('id', id)
        } else {
          await supabase.from('packages').insert(pkg)
        }
        setPackages((prev) => [...prev, pkg])
      },
    })
  }

  function handleRemoveExtra(id: string) {
    const extra = extras.find((e) => e.id === id)
    if (!extra) return
    setExtras((prev) => prev.filter((e) => e.id !== id))
    scheduleDelete({
      label: `Item extra "${extra.name}" removido`,
      commit: async () => {
        await supabase.from('extra_items').delete().eq('id', id)
      },
      undo: async () => {
        await supabase.from('extra_items').insert(extra)
        setExtras((prev) => [...prev, extra])
      },
    })
  }

  async function handleAddCost(e: FormEvent) {
    e.preventDefault()
    if (!fichaPackageId) return
    const valor = Number(custoValor)
    if (!valor) return
    const categoria = custoCategoria === 'Outros' ? custoCategoriaOutro.trim() || 'Outros' : custoCategoria
    const { data, error } = await supabase
      .from('package_costs')
      .insert({ package_id: fichaPackageId, category: categoria, amount: valor })
      .select()
      .single()
    if (error) {
      setError('Não foi possível lançar o custo.')
      return
    }
    setCostsByPackage((prev) => ({
      ...prev,
      [fichaPackageId]: [...(prev[fichaPackageId] ?? []), { id: data.id, category: data.category, amount: Number(data.amount) }],
    }))
    setCustoValor('')
    setCustoCategoriaOutro('')
  }

  function handleRemoveCost(costId: string) {
    if (!fichaPackageId) return
    const pkgId = fichaPackageId
    const cost = (costsByPackage[pkgId] ?? []).find((c) => c.id === costId)
    if (!cost) return
    setCostsByPackage((prev) => ({
      ...prev,
      [pkgId]: (prev[pkgId] ?? []).filter((c) => c.id !== costId),
    }))
    scheduleDelete({
      label: `Custo "${cost.category}" removido`,
      commit: async () => {
        await supabase.from('package_costs').delete().eq('id', costId)
      },
      undo: async () => {
        await supabase.from('package_costs').insert({ id: costId, package_id: pkgId, category: cost.category, amount: cost.amount })
        setCostsByPackage((prev) => ({ ...prev, [pkgId]: [...(prev[pkgId] ?? []), cost] }))
      },
    })
  }

  const dbIdToSlug: Record<string, string> = {}
  for (const slug of Object.keys(unitDbIds)) dbIdToSlug[unitDbIds[slug].unitId] = slug

  const filteredPackages =
    selectedUnit === 'todas' ? packages : packages.filter((p) => !p.unit_id || dbIdToSlug[p.unit_id] === selectedUnit)

  const fichaPackage = packages.find((p) => p.id === fichaPackageId) ?? null
  const fichaCosts = fichaPackageId ? costsByPackage[fichaPackageId] ?? [] : []
  const fichaTotalCusto = fichaCosts.reduce((s, c) => s + c.amount, 0)
  const fichaLucro = fichaPackage ? fichaPackage.base_price - fichaTotalCusto : 0
  const fichaMargem = fichaPackage && fichaPackage.base_price > 0 ? (fichaLucro / fichaPackage.base_price) * 100 : 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Pacotes e itens</h1>
        <p className="text-sm text-muted mt-1">Base para montar orçamentos rapidamente</p>
      </div>

      {error && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5">{error}</div>}

      <Card
        title="Pacotes"
        action={
          <Can permission="action:pacotes.criar_editar">
            <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={openNewPackage}>
              <Plus className="w-3.5 h-3.5" /> Novo pacote
            </Button>
          </Can>
        }
      >
        {loading ? (
          <p className="text-sm text-muted py-4 text-center">Carregando...</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {filteredPackages.map((p) => {
              const custos = costsByPackage[p.id] ?? []
              const totalCusto = custos.reduce((s, c) => s + c.amount, 0)
              const margem = p.base_price > 0 ? ((p.base_price - totalCusto) / p.base_price) * 100 : 0
              const unidadeNome = p.unit_id ? UNITS.find((u) => u.id === dbIdToSlug[p.unit_id!])?.name : null
              return (
                <div key={p.id} className="border border-line rounded-lg p-4 relative group">
                  <div className="absolute top-2 right-2 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Can permission="action:pacotes.criar_editar">
                      <button onClick={() => openEditPackage(p)} className="text-muted hover:text-purple" aria-label="Editar pacote">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </Can>
                    <Can permission="action:pacotes.excluir">
                      <button onClick={() => handleRemovePackage(p.id)} className="text-muted hover:text-danger" aria-label="Remover pacote">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </Can>
                  </div>
                  <p className="font-display font-semibold">{p.name}</p>
                  {unidadeNome && <p className="text-xs text-purple font-medium mt-0.5">{unidadeNome}</p>}
                  <p className="text-xs text-muted mt-1">{p.description}</p>
                  {(p.guest_limit || p.duration_hours) && (
                    <p className="text-xs text-muted mt-1">
                      {p.guest_limit ? `Até ${p.guest_limit} convidados` : ''}
                      {p.guest_limit && p.duration_hours ? ' · ' : ''}
                      {p.duration_hours ? `${p.duration_hours}h de duração` : ''}
                    </p>
                  )}
                  {p.weekday_price != null && p.weekend_price != null ? (
                    <p className="text-sm font-semibold mt-3">
                      Seg-qui: {currency(p.weekday_price)} <br /> Sex-dom: {currency(p.weekend_price)}
                    </p>
                  ) : (
                    <p className="text-lg font-semibold mt-3">{currency(p.base_price)}</p>
                  )}
                  {custos.length > 0 && (
                    <div className="flex items-center gap-1.5 mt-1">
                      <Badge tone={margem < MARGEM_ALERTA ? 'danger' : 'teal'}>margem {margem.toFixed(0)}%</Badge>
                      {margem < MARGEM_ALERTA && <AlertTriangle className="w-3.5 h-3.5 text-danger" />}
                    </div>
                  )}
                  <button
                    onClick={() => setFichaPackageId(p.id)}
                    className="flex items-center gap-1.5 text-xs text-purple font-medium mt-3"
                  >
                    <Calculator className="w-3.5 h-3.5" /> Ficha técnica de custo
                  </button>
                </div>
              )
            })}
            {filteredPackages.length === 0 && <p className="text-sm text-muted">Nenhum pacote cadastrado ainda.</p>}
          </div>
        )}
      </Card>

      <Card
        title="Itens extras"
        action={
          <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={() => setShowExtraForm(true)}>
            <Plus className="w-3.5 h-3.5" /> Novo item
          </Button>
        }
      >
        <table className="w-full text-sm">
          <tbody className="divide-y divide-line">
            {extras.map((e) => (
              <tr key={e.id}>
                <td className="py-2.5">{e.name}</td>
                <td className="py-2.5 text-right font-medium">{currency(e.price)}</td>
                <td className="py-2.5 text-right w-8">
                  <button onClick={() => handleRemoveExtra(e.id)} className="text-muted hover:text-danger" aria-label="Remover item">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
            {extras.length === 0 && (
              <tr>
                <td colSpan={3} className="py-4 text-center text-muted">
                  Nenhum item extra cadastrado ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {showPackageForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setShowPackageForm(false)} />
          <div className="relative w-full max-w-md bg-surface rounded-card p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-display font-semibold">{editingPackageId ? 'Editar pacote' : 'Novo pacote'}</h2>
              <button onClick={() => setShowPackageForm(false)} className="text-muted hover:text-ink">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSavePackage} className="space-y-3">
              <div>
                <label className="block text-xs text-muted mb-1">Nome do pacote</label>
                <input
                  type="text"
                  required
                  value={pkgName}
                  onChange={(e) => setPkgName(e.target.value)}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                  placeholder="Ex: Diamante"
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Descrição</label>
                <textarea
                  value={pkgDesc}
                  onChange={(e) => setPkgDesc(e.target.value)}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                  rows={3}
                  placeholder="O que está incluso"
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Preço padrão (sem variar por dia da semana)</label>
                <input
                  type="number"
                  value={pkgPreco}
                  onChange={(e) => setPkgPreco(e.target.value)}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                  placeholder="0,00"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted mb-1">Preço seg-qui (opcional)</label>
                  <input
                    type="number"
                    value={pkgPrecoSemana}
                    onChange={(e) => setPkgPrecoSemana(e.target.value)}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                    placeholder="0,00"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Preço sex-dom (opcional)</label>
                  <input
                    type="number"
                    value={pkgPrecoFds}
                    onChange={(e) => setPkgPrecoFds(e.target.value)}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                    placeholder="0,00"
                  />
                </div>
              </div>
              <p className="text-xs text-muted -mt-2">
                Se preencher os dois preços por dia, eles têm prioridade sobre o preço padrão na hora de fechar a
                reserva.
              </p>
              <div>
                <label className="block text-xs text-muted mb-1">Unidade</label>
                <select value={pkgUnidade} onChange={(e) => setPkgUnidade(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm">
                  <option value="todas">Disponível para qualquer unidade</option>
                  {UNITS.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted mb-1">Limite de convidados</label>
                  <input
                    type="number"
                    min={0}
                    value={pkgLimite}
                    onChange={(e) => setPkgLimite(e.target.value)}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                    placeholder="Ex: 40"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Duração (horas)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    value={pkgDuracao}
                    onChange={(e) => setPkgDuracao(e.target.value)}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                    placeholder="Ex: 4"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Itens inclusos (usado no contrato)</label>
                <textarea
                  value={pkgItens}
                  onChange={(e) => setPkgItens(e.target.value)}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                  rows={3}
                  placeholder="Ex: Docinhos, salgados, refrigerante, bolo..."
                />
              </div>
              <Button type="submit" className="w-full justify-center mt-2">
                {editingPackageId ? 'Salvar alterações' : 'Salvar pacote'}
              </Button>
            </form>
          </div>
        </div>
      )}

      {showExtraForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setShowExtraForm(false)} />
          <div className="relative w-full max-w-md bg-surface rounded-card p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-display font-semibold">Novo item extra</h2>
              <button onClick={() => setShowExtraForm(false)} className="text-muted hover:text-ink">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddExtra} className="space-y-3">
              <div>
                <label className="block text-xs text-muted mb-1">Nome do item</label>
                <input
                  type="text"
                  required
                  value={extraName}
                  onChange={(e) => setExtraName(e.target.value)}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                  placeholder="Ex: Cabine de fotos"
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Preço</label>
                <input
                  type="number"
                  required
                  value={extraPreco}
                  onChange={(e) => setExtraPreco(e.target.value)}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                  placeholder="0,00"
                />
              </div>
              <Button type="submit" className="w-full justify-center mt-2">
                Salvar item
              </Button>
            </form>
          </div>
        </div>
      )}

      {fichaPackage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setFichaPackageId(null)} />
          <div className="relative w-full max-w-lg bg-surface rounded-card p-6 shadow-xl">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-display font-semibold">Ficha técnica — {fichaPackage.name}</h2>
              <button onClick={() => setFichaPackageId(null)} className="text-muted hover:text-ink">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-muted mb-4">Preço de venda: {currency(fichaPackage.base_price)}</p>

            <table className="w-full text-sm mb-3">
              <tbody className="divide-y divide-line">
                {fichaCosts.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2">{c.category}</td>
                    <td className="py-2 text-danger">{currency(c.amount)}</td>
                    <td className="py-2 text-right">
                      <button onClick={() => handleRemoveCost(c.id)} className="text-muted hover:text-danger">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
                {fichaCosts.length === 0 && (
                  <tr><td colSpan={3} className="py-3 text-center text-muted">Nenhum custo lançado.</td></tr>
                )}
              </tbody>
            </table>

            <form onSubmit={handleAddCost} className="flex flex-wrap gap-2 mb-4">
              <select value={custoCategoria} onChange={(e) => setCustoCategoria(e.target.value as PackageCostCategory)} className="border border-line rounded-lg px-3 py-1.5 text-sm">
                {PACKAGE_COST_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              {custoCategoria === 'Outros' && (
                <input
                  value={custoCategoriaOutro}
                  onChange={(e) => setCustoCategoriaOutro(e.target.value)}
                  placeholder="Qual categoria?"
                  className="w-32 border border-line rounded-lg px-3 py-1.5 text-sm"
                />
              )}
              <input type="number" value={custoValor} onChange={(e) => setCustoValor(e.target.value)} placeholder="Valor" className="w-28 border border-line rounded-lg px-3 py-1.5 text-sm" />
              <Button type="submit" className="text-xs px-3 py-1.5"><Plus className="w-3.5 h-3.5" /> Lançar</Button>
            </form>

            <div className="pt-3 border-t border-line flex items-center justify-between">
              <div>
                <p className="text-xs text-muted">Custo total: {currency(fichaTotalCusto)}</p>
                <p className="text-xs text-muted">Lucro bruto estimado: {currency(fichaLucro)}</p>
              </div>
              <div className="text-right">
                <Badge tone={fichaMargem < MARGEM_ALERTA ? 'danger' : 'teal'}>Margem {fichaMargem.toFixed(1)}%</Badge>
                {fichaMargem < MARGEM_ALERTA && (
                  <p className="text-xs text-danger mt-1 flex items-center gap-1 justify-end">
                    <AlertTriangle className="w-3 h-3" /> Margem abaixo de {MARGEM_ALERTA}%
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
