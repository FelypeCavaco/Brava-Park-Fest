import { FormEvent, useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Plus, Minus, Trash2, AlertTriangle, Pencil, ArrowLeftRight } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { useUnit, UNITS } from '../lib/UnitContext'
import { supabase } from '../lib/supabaseClient'
import { useUndo } from '../lib/UndoContext'
import { INVENTORY_CATEGORIES, type InventoryItem, type InventoryCategory } from '../types'

interface NextFesta { date: string; guests: number }

type PurchaseStatus = 'pendente' | 'em_cotacao' | 'pedido_realizado' | 'recebido' | 'cancelado'

const purchaseStatusLabel: Record<PurchaseStatus, string> = {
  pendente: 'Pendente',
  em_cotacao: 'Em cotação',
  pedido_realizado: 'Pedido realizado',
  recebido: 'Recebido',
  cancelado: 'Cancelado',
}

export function Inventory() {
  const { selectedUnit, unitDbIds, unitDbIdsLoading } = useUnit()
  const { scheduleDelete } = useUndo()
  const [items, setItems] = useState<InventoryItem[]>([])
  const [nextFestaByUnit, setNextFestaByUnit] = useState<Record<string, NextFesta>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [purchaseStatus, setPurchaseStatus] = useState<Record<string, PurchaseStatus>>({})

  const [name, setName] = useState('')
  const [category, setCategory] = useState<InventoryCategory>(INVENTORY_CATEGORIES[0])
  const [unitOfMeasure, setUnitOfMeasure] = useState('un')
  const [quantity, setQuantity] = useState('')
  const [minimumQuantity, setMinimumQuantity] = useState('')
  const [quantityPerGuest, setQuantityPerGuest] = useState('')
  const [supplier, setSupplier] = useState('')

  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)
  const [editName, setEditName] = useState('')
  const [editCategory, setEditCategory] = useState<InventoryCategory>(INVENTORY_CATEGORIES[0])
  const [editUnitOfMeasure, setEditUnitOfMeasure] = useState('')
  const [editMinimumQuantity, setEditMinimumQuantity] = useState('')
  const [editSupplier, setEditSupplier] = useState('')

  const [transferringItem, setTransferringItem] = useState<InventoryItem | null>(null)
  const [transferDestUnit, setTransferDestUnit] = useState('')
  const [transferQuantity, setTransferQuantity] = useState('')
  const [transferError, setTransferError] = useState<string | null>(null)

  useEffect(() => {
    if (!unitDbIdsLoading) loadItems()
  }, [unitDbIdsLoading, unitDbIds])

  async function loadItems() {
    setLoading(true)
    const dbIdToSlug: Record<string, string> = {}
    for (const slug of Object.keys(unitDbIds)) dbIdToSlug[unitDbIds[slug].unitId] = slug

    const today = new Date().toISOString().slice(0, 10)
    const [{ data, error }, { data: upcoming }] = await Promise.all([
      supabase.from('inventory_items').select('*').order('name'),
      supabase
        .from('reservations')
        .select('unit_id, event_date, guest_count')
        .neq('status', 'cancelada')
        .gte('event_date', today)
        .order('event_date'),
    ])

    if (error) {
      setError('Não foi possível carregar o estoque.')
      setLoading(false)
      return
    }

    // Para cada unidade, junta os convidados de todas as festas da data mais
    // próxima (pode ter mais de uma festa no mesmo dia).
    const nextByUnit: Record<string, NextFesta> = {}
    for (const r of upcoming ?? []) {
      const slug = dbIdToSlug[r.unit_id]
      if (!slug) continue
      const current = nextByUnit[slug]
      if (!current || r.event_date < current.date) {
        nextByUnit[slug] = { date: r.event_date, guests: r.guest_count ?? 0 }
      } else if (r.event_date === current.date) {
        current.guests += r.guest_count ?? 0
      }
    }
    setNextFestaByUnit(nextByUnit)

    setItems(
      (data ?? []).map((i) => ({
        id: i.id,
        unit_id: dbIdToSlug[i.unit_id] ?? '',
        name: i.name,
        category: i.category,
        unit_of_measure: i.unit_of_measure,
        quantity: Number(i.quantity),
        minimum_quantity: Number(i.minimum_quantity),
        quantity_per_guest: i.quantity_per_guest !== null ? Number(i.quantity_per_guest) : null,
        supplier: i.supplier,
      })),
    )
    setLoading(false)
  }

  function effectiveMinimum(item: InventoryItem) {
    const nextFesta = nextFestaByUnit[item.unit_id]
    if (item.quantity_per_guest == null || !nextFesta) return item.minimum_quantity
    return Math.max(item.minimum_quantity, Math.ceil(item.quantity_per_guest * nextFesta.guests * 100) / 100)
  }

  const filtered = useMemo(
    () => (selectedUnit === 'todas' ? items : items.filter((i) => i.unit_id === selectedUnit)).sort((a, b) => a.name.localeCompare(b.name)),
    [items, selectedUnit],
  )

  const VELA_REGEX = /^Vela (\d) (Azul|Rosa)$/

  // Velas numéricas viram uma gradinha compacta em vez de 20 linhas soltas —
  // o resto do estoque continua na tabela normal.
  const { velaItems, outrosItens } = useMemo(() => {
    const vela: InventoryItem[] = []
    const outros: InventoryItem[] = []
    for (const i of filtered) (VELA_REGEX.test(i.name) ? vela : outros).push(i)
    return { velaItems: vela, outrosItens: outros }
  }, [filtered])

  const velaGroupsByUnit = useMemo(() => {
    const byUnit: Record<string, { digito: number; azul?: InventoryItem; rosa?: InventoryItem }[]> = {}
    for (const item of velaItems) {
      const match = item.name.match(VELA_REGEX)
      if (!match) continue
      const digito = Number(match[1])
      const cor = match[2]
      if (!byUnit[item.unit_id]) byUnit[item.unit_id] = Array.from({ length: 10 }, (_, d) => ({ digito: d }))
      const row = byUnit[item.unit_id][digito]
      if (cor === 'Azul') row.azul = item
      else row.rosa = item
    }
    return byUnit
  }, [velaItems])

  const precisamRepor = useMemo(() => filtered.filter((i) => i.quantity < effectiveMinimum(i)), [filtered, nextFestaByUnit])

  async function adjustQuantity(id: string, delta: number) {
    const item = items.find((i) => i.id === id)
    if (!item) return
    const newQuantity = Math.max(0, Math.round((item.quantity + delta) * 100) / 100)
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, quantity: newQuantity } : i)))
    await supabase.from('inventory_items').update({ quantity: newQuantity }).eq('id', id)
  }

  async function setQuantityDirect(id: string, value: number) {
    const newQuantity = Math.max(0, value)
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, quantity: newQuantity } : i)))
    await supabase.from('inventory_items').update({ quantity: newQuantity }).eq('id', id)
  }

  async function updateQuantityPerGuest(id: string, value: number | null) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, quantity_per_guest: value } : i)))
    await supabase.from('inventory_items').update({ quantity_per_guest: value }).eq('id', id)
  }

  function handleRemove(id: string) {
    const item = items.find((i) => i.id === id)
    if (!item) return
    setItems((prev) => prev.filter((i) => i.id !== id))
    scheduleDelete({
      label: `"${item.name}" removido`,
      commit: async () => {
        await supabase.from('inventory_items').delete().eq('id', item.id)
      },
      undo: async () => {
        await supabase.from('inventory_items').insert(item)
        setItems((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)))
      },
    })
  }

  function openEditItem(item: InventoryItem) {
    setEditingItem(item)
    setEditName(item.name)
    setEditCategory(item.category)
    setEditUnitOfMeasure(item.unit_of_measure)
    setEditMinimumQuantity(String(item.minimum_quantity))
    setEditSupplier(item.supplier ?? '')
  }

  async function handleSaveEditItem(e: FormEvent) {
    e.preventDefault()
    if (!editingItem || !editName.trim()) return

    const updates = {
      name: editName.trim(),
      category: editCategory,
      unit_of_measure: editUnitOfMeasure.trim() || 'un',
      minimum_quantity: Number(editMinimumQuantity) || 0,
      supplier: editSupplier.trim() || null,
    }

    const { error } = await supabase.from('inventory_items').update(updates).eq('id', editingItem.id)
    if (error) {
      setError('Não foi possível salvar as alterações do item.')
      return
    }

    setItems((prev) => prev.map((i) => (i.id === editingItem.id ? { ...i, ...updates } : i)))
    setEditingItem(null)
  }

  function openTransferItem(item: InventoryItem) {
    setTransferringItem(item)
    setTransferDestUnit(UNITS.find((u) => u.id !== item.unit_id)?.id ?? '')
    setTransferQuantity(String(item.quantity))
    setTransferError(null)
  }

  async function handleConfirmTransfer(e: FormEvent) {
    e.preventDefault()
    if (!transferringItem) return
    const amount = Number(transferQuantity)
    if (!amount || amount <= 0) {
      setTransferError('Informe uma quantidade válida.')
      return
    }
    if (amount > transferringItem.quantity) {
      setTransferError('Essa quantidade é maior do que o disponível.')
      return
    }
    const destDbIds = unitDbIds[transferDestUnit]
    if (!destDbIds) {
      setTransferError('Não encontrei essa unidade no banco de dados ainda.')
      return
    }

    const { data: existing } = await supabase
      .from('inventory_items')
      .select('id, quantity')
      .eq('unit_id', destDbIds.unitId)
      .eq('name', transferringItem.name)
      .maybeSingle()

    const newSourceQuantity = Math.round((transferringItem.quantity - amount) * 100) / 100

    if (existing) {
      const newDestQuantity = Math.round((Number(existing.quantity) + amount) * 100) / 100
      const { error } = await supabase.from('inventory_items').update({ quantity: newDestQuantity }).eq('id', existing.id)
      if (error) {
        setTransferError('Não foi possível transferir o item.')
        return
      }
      await supabase.from('inventory_items').update({ quantity: newSourceQuantity }).eq('id', transferringItem.id)
      setItems((prev) =>
        prev.map((i) => {
          if (i.id === transferringItem.id) return { ...i, quantity: newSourceQuantity }
          if (i.id === existing.id) return { ...i, quantity: newDestQuantity }
          return i
        }),
      )
    } else {
      const { data: created, error } = await supabase
        .from('inventory_items')
        .insert({
          unit_id: destDbIds.unitId,
          name: transferringItem.name,
          category: transferringItem.category,
          unit_of_measure: transferringItem.unit_of_measure,
          quantity: amount,
          minimum_quantity: transferringItem.minimum_quantity,
          quantity_per_guest: transferringItem.quantity_per_guest,
          supplier: transferringItem.supplier,
        })
        .select()
        .single()
      if (error) {
        setTransferError('Não foi possível transferir o item.')
        return
      }
      await supabase.from('inventory_items').update({ quantity: newSourceQuantity }).eq('id', transferringItem.id)
      setItems((prev) => [
        ...prev.map((i) => (i.id === transferringItem.id ? { ...i, quantity: newSourceQuantity } : i)),
        {
          id: created.id,
          unit_id: transferDestUnit,
          name: created.name,
          category: created.category,
          unit_of_measure: created.unit_of_measure,
          quantity: Number(created.quantity),
          minimum_quantity: Number(created.minimum_quantity),
          quantity_per_guest: created.quantity_per_guest !== null ? Number(created.quantity_per_guest) : null,
          supplier: created.supplier,
        },
      ])
    }

    setTransferringItem(null)
  }

  function setStatusFor(id: string, status: PurchaseStatus) {
    setPurchaseStatus((prev) => ({ ...prev, [id]: status }))
    if (status === 'recebido') {
      const item = items.find((i) => i.id === id)
      if (item) adjustQuantity(id, Math.max(item.minimum_quantity - item.quantity, 0))
    }
  }

  async function handleAddItem(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    const unitSlug = selectedUnit === 'todas' ? UNITS[0].id : selectedUnit
    const dbIds = unitDbIds[unitSlug]
    if (!dbIds) {
      setError('Não encontrei essa unidade no banco de dados ainda.')
      return
    }

    const { data, error } = await supabase
      .from('inventory_items')
      .insert({
        unit_id: dbIds.unitId,
        name: name.trim(),
        category,
        unit_of_measure: unitOfMeasure.trim() || 'un',
        quantity: Number(quantity) || 0,
        minimum_quantity: Number(minimumQuantity) || 0,
        quantity_per_guest: quantityPerGuest ? Number(quantityPerGuest) : null,
        supplier: supplier.trim() || null,
      })
      .select()
      .single()

    if (error) {
      setError('Não foi possível cadastrar o item.')
      return
    }

    setItems((prev) => [
      ...prev,
      {
        id: data.id,
        unit_id: unitSlug,
        name: data.name,
        category: data.category,
        unit_of_measure: data.unit_of_measure,
        quantity: Number(data.quantity),
        minimum_quantity: Number(data.minimum_quantity),
        quantity_per_guest: data.quantity_per_guest !== null ? Number(data.quantity_per_guest) : null,
        supplier: data.supplier,
      },
    ])
    setName('')
    setQuantity('')
    setMinimumQuantity('')
    setQuantityPerGuest('')
    setSupplier('')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Estoque</h1>
        <p className="text-sm text-muted mt-1">Quantidade de insumos por unidade e o que precisa ser comprado</p>
      </div>

      {error && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <p className="text-xs text-muted">Itens cadastrados</p>
          <p className="text-2xl font-display font-semibold mt-1">{filtered.length}</p>
        </Card>
        <Card className={precisamRepor.length > 0 ? 'border-danger' : ''}>
          <p className="text-xs text-muted flex items-center gap-1.5">
            {precisamRepor.length > 0 && <AlertTriangle className="w-3.5 h-3.5 text-danger" />} Precisam de reposição
          </p>
          <p className={`text-2xl font-display font-semibold mt-1 ${precisamRepor.length > 0 ? 'text-danger' : ''}`}>
            {precisamRepor.length}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-muted">Categorias em uso</p>
          <p className="text-2xl font-display font-semibold mt-1">{new Set(filtered.map((i) => i.category)).size}</p>
        </Card>
      </div>

      <Card title="Lista de compras" action={<span className="text-xs text-muted">itens abaixo do estoque mínimo</span>}>
        {precisamRepor.length === 0 ? (
          <p className="text-sm text-muted">Nada precisando de reposição no momento.</p>
        ) : (
          <ul className="divide-y divide-line">
            {precisamRepor.map((i) => {
              const status = purchaseStatus[i.id] ?? 'pendente'
              const minimo = effectiveMinimum(i)
              const nextFesta = nextFestaByUnit[i.unit_id]
              return (
                <li key={i.id} className="py-2.5 flex items-center justify-between gap-3 text-sm">
                  <div>
                    <p className="font-medium">{i.name}</p>
                    <p className="text-xs text-muted">
                      Tem {i.quantity} {i.unit_of_measure} · mínimo é {minimo} {i.unit_of_measure}
                      {i.quantity_per_guest != null && nextFesta
                        ? ` (calculado para a festa de ${format(parseISO(nextFesta.date), 'dd/MM')}, ${nextFesta.guests} convidados)`
                        : ''}
                      {i.supplier ? ` · fornecedor: ${i.supplier}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge tone="danger">Comprar {Math.max(minimo - i.quantity, 0)} {i.unit_of_measure}</Badge>
                    <select
                      value={status}
                      onChange={(e) => setStatusFor(i.id, e.target.value as PurchaseStatus)}
                      className="border border-line rounded-lg px-2 py-1 text-xs"
                    >
                      {(Object.keys(purchaseStatusLabel) as PurchaseStatus[]).map((s) => (
                        <option key={s} value={s}>{purchaseStatusLabel[s]}</option>
                      ))}
                    </select>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <Card title="Cadastrar item">
        <form onSubmit={handleAddItem} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-muted mb-1">Nome do item</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Copo descartável"
              className="w-full border border-line rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Categoria</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as InventoryCategory)}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm"
            >
              {INVENTORY_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Unidade de medida</label>
            <input
              type="text"
              value={unitOfMeasure}
              onChange={(e) => setUnitOfMeasure(e.target.value)}
              placeholder="un, kg, litro, pacote..."
              className="w-full border border-line rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Quantidade atual</label>
            <input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="0"
              className="w-full border border-line rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Estoque mínimo fixo</label>
            <input
              type="number"
              value={minimumQuantity}
              onChange={(e) => setMinimumQuantity(e.target.value)}
              placeholder="0"
              className="w-full border border-line rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Quantidade por convidado (opcional)</label>
            <input
              type="number"
              step="0.01"
              value={quantityPerGuest}
              onChange={(e) => setQuantityPerGuest(e.target.value)}
              placeholder="Ex: 1 copo por convidado"
              className="w-full border border-line rounded-lg px-3 py-2 text-sm"
            />
            <p className="text-xs text-muted mt-1">
              Se preenchido, o mínimo do dia passa a ser calculado pelos convidados da próxima festa da unidade —
              o que for maior entre esse cálculo e o mínimo fixo.
            </p>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Fornecedor (opcional)</label>
            <input
              type="text"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              placeholder="Nome do fornecedor"
              className="w-full border border-line rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-end sm:col-span-2 lg:col-span-3">
            <Button type="submit">
              <Plus className="w-4 h-4" /> Adicionar item
            </Button>
          </div>
        </form>
        {selectedUnit === 'todas' && (
          <p className="text-xs text-muted mt-3">
            Como "Ambas as unidades" está selecionado, o novo item é cadastrado em {UNITS[0].name}.
          </p>
        )}
      </Card>

      {Object.keys(velaGroupsByUnit).length > 0 && (
        <Card title="Velas numéricas" action={<span className="text-xs text-muted">0 a 9, azul e rosa</span>}>
          {Object.entries(velaGroupsByUnit).map(([unitId, rows]) => (
            <div key={unitId} className="mb-4 last:mb-0">
              {selectedUnit === 'todas' && <p className="text-xs font-medium text-muted mb-2">{UNITS.find((u) => u.id === unitId)?.name}</p>}
              <div className="overflow-x-auto">
                <table className="text-sm border-collapse">
                  <thead>
                    <tr>
                      <th className="pr-2 pb-1 text-left text-xs text-muted font-medium"></th>
                      {rows.map((r) => (
                        <th key={r.digito} className="px-1 pb-1 text-center text-xs text-muted font-medium w-10">{r.digito}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(['azul', 'rosa'] as const).map((cor) => (
                      <tr key={cor}>
                        <td className="pr-2 py-1 text-xs text-muted whitespace-nowrap">{cor === 'azul' ? 'Azul' : 'Rosa'}</td>
                        {rows.map((r) => {
                          const item = r[cor]
                          return (
                            <td key={r.digito} className="px-1 py-1">
                              {item ? (
                                <input
                                  type="number"
                                  min={0}
                                  defaultValue={item.quantity}
                                  key={item.quantity}
                                  onBlur={(e) => {
                                    const value = Number(e.target.value)
                                    if (value !== item.quantity) setQuantityDirect(item.id, value)
                                  }}
                                  className={`w-10 text-center border rounded px-1 py-1 text-xs ${
                                    item.quantity < item.minimum_quantity ? 'border-danger text-danger' : 'border-line'
                                  }`}
                                />
                              ) : (
                                <span className="text-muted text-xs">—</span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          <p className="text-xs text-muted mt-2">
            Números em vermelho estão abaixo do mínimo (1 unidade). Clique no número, digite a quantidade e saia do
            campo pra salvar.
          </p>
        </Card>
      )}

      <Card title="Todos os itens">
        {loading ? (
          <p className="text-sm text-muted py-4 text-center">Carregando...</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="pb-3 font-medium">Item</th>
                <th className="pb-3 font-medium">Categoria</th>
                <th className="pb-3 font-medium">Quantidade</th>
                <th className="pb-3 font-medium">Por convidado</th>
                <th className="pb-3 font-medium">Mínimo</th>
                <th className="pb-3 font-medium">Status</th>
                <th className="pb-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {outrosItens.map((i) => {
                const minimo = effectiveMinimum(i)
                return (
                <tr key={i.id}>
                  <td className="py-3 font-medium">
                    {i.name}
                    {i.supplier && <p className="text-xs text-muted font-normal">{i.supplier}</p>}
                  </td>
                  <td className="py-3 text-muted">{i.category}</td>
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => adjustQuantity(i.id, -1)}
                        className="w-6 h-6 rounded border border-line flex items-center justify-center hover:bg-paper"
                        aria-label="Diminuir quantidade"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="w-16 text-center">
                        {i.quantity} {i.unit_of_measure}
                      </span>
                      <button
                        onClick={() => adjustQuantity(i.id, 1)}
                        className="w-6 h-6 rounded border border-line flex items-center justify-center hover:bg-paper"
                        aria-label="Aumentar quantidade"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                  <td className="py-3">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      defaultValue={i.quantity_per_guest ?? ''}
                      key={i.quantity_per_guest ?? 'none'}
                      placeholder="—"
                      onBlur={(e) => {
                        const raw = e.target.value.trim()
                        const value = raw === '' ? null : Number(raw)
                        if (value !== i.quantity_per_guest) updateQuantityPerGuest(i.id, value)
                      }}
                      className="w-20 border border-line rounded-lg px-2 py-1 text-xs"
                    />
                    <span className="text-[10px] text-muted block">{i.unit_of_measure}/convidado</span>
                  </td>
                  <td className="py-3 text-muted">
                    {minimo} {i.unit_of_measure}
                    {i.quantity_per_guest != null && <span className="text-[10px] block">(varia por convidado)</span>}
                  </td>
                  <td className="py-3">
                    {i.quantity < minimo ? (
                      <Badge tone="danger">Repor</Badge>
                    ) : (
                      <Badge tone="teal">OK</Badge>
                    )}
                  </td>
                  <td className="py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button onClick={() => openTransferItem(i)} className="text-muted hover:text-purple" aria-label="Transferir para outra unidade">
                        <ArrowLeftRight className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => openEditItem(i)} className="text-muted hover:text-purple" aria-label="Editar item">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleRemove(i.id)} className="text-muted hover:text-danger" aria-label="Remover item">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              )})}
              {outrosItens.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-muted">
                    Nenhum item cadastrado ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Card>

      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setEditingItem(null)} />
          <div className="relative w-full max-w-md bg-surface rounded-card p-6 shadow-xl">
            <h2 className="text-lg font-display font-semibold mb-4">Editar item</h2>
            <form onSubmit={handleSaveEditItem} className="space-y-3">
              <div>
                <label className="block text-xs text-muted mb-1">Nome do item</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Categoria</label>
                <select
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value as InventoryCategory)}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                >
                  {INVENTORY_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted mb-1">Unidade de medida</label>
                  <input
                    type="text"
                    value={editUnitOfMeasure}
                    onChange={(e) => setEditUnitOfMeasure(e.target.value)}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Estoque mínimo fixo</label>
                  <input
                    type="number"
                    min={0}
                    value={editMinimumQuantity}
                    onChange={(e) => setEditMinimumQuantity(e.target.value)}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Fornecedor (opcional)</label>
                <input
                  type="text"
                  value={editSupplier}
                  onChange={(e) => setEditSupplier(e.target.value)}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="button" variant="secondary" className="flex-1 justify-center" onClick={() => setEditingItem(null)}>
                  Cancelar
                </Button>
                <Button type="submit" className="flex-1 justify-center">
                  Salvar
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {transferringItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setTransferringItem(null)} />
          <div className="relative w-full max-w-md bg-surface rounded-card p-6 shadow-xl">
            <h2 className="text-lg font-display font-semibold mb-1">Transferir item</h2>
            <p className="text-sm text-muted mb-4">
              "{transferringItem.name}" — tem {transferringItem.quantity} {transferringItem.unit_of_measure} em{' '}
              {UNITS.find((u) => u.id === transferringItem.unit_id)?.name}.
            </p>
            {transferError && <div className="bg-danger-light text-danger text-sm rounded-lg px-3 py-2 mb-3">{transferError}</div>}
            <form onSubmit={handleConfirmTransfer} className="space-y-3">
              <div>
                <label className="block text-xs text-muted mb-1">Transferir para</label>
                <select
                  value={transferDestUnit}
                  onChange={(e) => setTransferDestUnit(e.target.value)}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                >
                  {UNITS.filter((u) => u.id !== transferringItem.unit_id).map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Quantidade a transferir</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  max={transferringItem.quantity}
                  value={transferQuantity}
                  onChange={(e) => setTransferQuantity(e.target.value)}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <p className="text-xs text-muted">
                Se já existir um item com esse nome na unidade de destino, a quantidade soma nele — senão, cria um
                item novo lá com os mesmos dados (categoria, unidade de medida, mínimo).
              </p>
              <div className="flex gap-2 pt-2">
                <Button type="button" variant="secondary" className="flex-1 justify-center" onClick={() => setTransferringItem(null)}>
                  Cancelar
                </Button>
                <Button type="submit" className="flex-1 justify-center">
                  Transferir
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
