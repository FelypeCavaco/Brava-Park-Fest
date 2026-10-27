import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { Plus, Minus, Trash2, AlertTriangle, Pencil, ArrowLeftRight, ShoppingCart, History, X, Info } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Can } from '../components/Can'
import { StockPurchaseModal, type StockPurchasePrefill } from '../components/StockPurchaseModal'
import { useUnit, UNITS } from '../lib/UnitContext'
import { supabase } from '../lib/supabaseClient'
import { useUndo } from '../lib/UndoContext'
import { brl, qtd, parseDecimal, friendlyDbError, todayIso } from '../lib/format'
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

const ADJUST_REASONS = ['Perda', 'Quebra', 'Vencimento', 'Contagem', 'Outro'] as const

const MOVEMENT_LABEL: Record<string, string> = {
  compra: 'Compra',
  compra_ajuste: 'Compra editada',
  compra_excluida: 'Compra excluída',
  consumo: 'Consumo pós-festa',
  consumo_ajuste: 'Consumo editado',
  consumo_desfeito: 'Consumo desfeito',
  ajuste_entrada: 'Ajuste (entrada)',
  ajuste_saida: 'Ajuste (saída)',
  custo_inicial: 'Custo definido',
  transferencia_saida: 'Transferência (saída)',
  transferencia_entrada: 'Transferência (entrada)',
  cadastro: 'Cadastro do item',
}

interface Movement {
  id: string
  kind: string
  quantity: number
  value: number
  reason: string | null
  expense_id: string | null
  created_by_name: string | null
  created_at: string
}

function unitCost(i: InventoryItem) {
  if (!i.has_cost) return null
  return i.quantity > 0 ? i.total_value / i.quantity : i.last_unit_cost
}

export function Inventory() {
  const { selectedUnit, unitDbIds, unitDbIdsLoading } = useUnit()
  const { scheduleDelete } = useUndo()
  const [searchParams, setSearchParams] = useSearchParams()
  const [items, setItems] = useState<InventoryItem[]>([])
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({})
  const [nextFestaByUnit, setNextFestaByUnit] = useState<Record<string, NextFesta>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [purchaseStatus, setPurchaseStatus] = useState<Record<string, PurchaseStatus>>({})

  const [name, setName] = useState('')
  const [category, setCategory] = useState<InventoryCategory>(INVENTORY_CATEGORIES[0])
  const [unitOfMeasure, setUnitOfMeasure] = useState('un')
  const [quantity, setQuantity] = useState('')
  const [initialCost, setInitialCost] = useState('')
  const [minimumQuantity, setMinimumQuantity] = useState('')
  const [quantityPerGuest, setQuantityPerGuest] = useState('')
  const [supplier, setSupplier] = useState('')

  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)
  const [editName, setEditName] = useState('')
  const [editCategory, setEditCategory] = useState<InventoryCategory>(INVENTORY_CATEGORIES[0])
  const [editUnitOfMeasure, setEditUnitOfMeasure] = useState('')
  const [editMinimumQuantity, setEditMinimumQuantity] = useState('')
  const [editSupplier, setEditSupplier] = useState('')
  const [editConsumptionType, setEditConsumptionType] = useState<'por_convidado' | 'por_festa'>('por_convidado')
  const [editNotifyShopping, setEditNotifyShopping] = useState(true)
  const [notifyShopping, setNotifyShopping] = useState(true)

  const [transferringItem, setTransferringItem] = useState<InventoryItem | null>(null)
  const [transferDestUnit, setTransferDestUnit] = useState('')
  const [transferQuantity, setTransferQuantity] = useState('')
  const [transferError, setTransferError] = useState<string | null>(null)
  const [transferZeroConfirm, setTransferZeroConfirm] = useState(false)
  const [transferring, setTransferring] = useState(false)
  const [transferDueDate, setTransferDueDate] = useState(todayIso())

  // Ajuste para baixo: pede o motivo antes de gravar.
  const [pendingAdjust, setPendingAdjust] = useState<{ item: InventoryItem; newQuantity: number } | null>(null)
  const [adjustReason, setAdjustReason] = useState<string>('Contagem')
  const [adjustOther, setAdjustOther] = useState('')

  const [costItem, setCostItem] = useState<InventoryItem | null>(null)
  const [costValue, setCostValue] = useState('')
  const [costError, setCostError] = useState<string | null>(null)
  const [costReason, setCostReason] = useState('')

  const [historyItem, setHistoryItem] = useState<InventoryItem | null>(null)
  const [movements, setMovements] = useState<Movement[]>([])

  const [purchaseModal, setPurchaseModal] = useState<{ expenseId: string | null; prefill: StockPurchasePrefill | null } | null>(null)

  useEffect(() => {
    if (!unitDbIdsLoading) loadItems()
  }, [unitDbIdsLoading, unitDbIds])

  // Atalhos: /estoque?entrada=1 abre a Entrada de compra; ?compra=<id> abre a edição.
  useEffect(() => {
    const compra = searchParams.get('compra')
    if (compra) setPurchaseModal({ expenseId: compra, prefill: null })
    else if (searchParams.get('entrada')) setPurchaseModal({ expenseId: null, prefill: null })
  }, [searchParams])

  async function loadItems() {
    setLoading(true)
    const dbIdToSlug: Record<string, string> = {}
    for (const slug of Object.keys(unitDbIds)) dbIdToSlug[unitDbIds[slug].unitId] = slug

    const today = new Date().toISOString().slice(0, 10)
    const [{ data, error }, { data: upcoming }] = await Promise.all([
      supabase.from('inventory_items').select('*').order('name'),
      supabase.from('reservations').select('unit_id, event_date, guest_count').neq('status', 'cancelada').gte('event_date', today).order('event_date'),
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
      if (!current || r.event_date < current.date) nextByUnit[slug] = { date: r.event_date, guests: r.guest_count ?? 0 }
      else if (r.event_date === current.date) current.guests += r.guest_count ?? 0
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
        total_value: Number(i.total_value ?? 0),
        has_cost: !!i.has_cost,
        last_unit_cost: i.last_unit_cost != null ? Number(i.last_unit_cost) : null,
        consumption_type: i.consumption_type ?? 'por_convidado',
        notify_shopping: i.notify_shopping !== false,
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
    () => (selectedUnit === 'todas' ? [...items] : items.filter((i) => i.unit_id === selectedUnit)).sort((a, b) => a.name.localeCompare(b.name)),
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
      if (!byUnit[item.unit_id]) byUnit[item.unit_id] = Array.from({ length: 10 }, (_, d) => ({ digito: d }))
      const row = byUnit[item.unit_id][digito]
      if (match[2] === 'Azul') row.azul = item
      else row.rosa = item
    }
    return byUnit
  }, [velaItems])

  // Só os itens marcados para avisar entram na Lista de compras.
  const precisamRepor = useMemo(() => filtered.filter((i) => i.notify_shopping && i.quantity < effectiveMinimum(i)), [filtered, nextFestaByUnit])
  const valorEmEstoque = useMemo(() => filtered.reduce((s, i) => s + i.total_value, 0), [filtered])
  const semCusto = useMemo(() => filtered.filter((i) => !i.has_cost && i.quantity > 0).length, [filtered])

  // ---------- Ajuste manual (+/− e digitação) ----------
  async function applyAdjust(item: InventoryItem, newQuantity: number, reason: string | null) {
    const { error: rpcError } = await supabase.rpc('adjust_stock', { p_item: item.id, p_new_quantity: newQuantity, p_reason: reason })
    if (rpcError) setError(friendlyDbError(rpcError.message))
    await loadItems()
  }

  function requestAdjust(item: InventoryItem, newQuantity: number) {
    const q = Math.max(0, Math.round(newQuantity * 1000) / 1000)
    clearDraft(item.id)
    if (q === item.quantity) return
    if (q > item.quantity) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, quantity: q } : i)))
      applyAdjust(item, q, 'Ajuste manual (entrada)')
    } else {
      setAdjustReason('Contagem')
      setAdjustOther('')
      setPendingAdjust({ item, newQuantity: q })
    }
  }

  // +/− anda de número inteiro em número inteiro: de 6,5 o "+" vai pra 7 (não
  // 7,5) e o "−" vai pra 6. Valores quebrados continuam podendo ser digitados.
  function stepQuantity(item: InventoryItem, direction: 1 | -1) {
    const q = item.quantity
    const next = direction > 0 ? (Number.isInteger(q) ? q + 1 : Math.ceil(q)) : Number.isInteger(q) ? q - 1 : Math.floor(q)
    requestAdjust(item, Math.max(0, next))
  }

  function clearDraft(id: string) {
    setQtyDrafts((prev) => {
      const { [id]: _, ...rest } = prev
      return rest
    })
  }

  function commitTyped(item: InventoryItem) {
    const raw = qtyDrafts[item.id]
    if (raw === undefined) return
    const parsed = parseDecimal(raw)
    if (parsed === null || parsed < 0) return clearDraft(item.id)
    requestAdjust(item, parsed)
  }

  async function confirmPendingAdjust(e: FormEvent) {
    e.preventDefault()
    if (!pendingAdjust) return
    const reason = adjustReason === 'Outro' ? adjustOther.trim() : adjustReason
    if (!reason) return
    const { item, newQuantity } = pendingAdjust
    setPendingAdjust(null)
    await applyAdjust(item, newQuantity, reason)
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
        await supabase.from('inventory_items').insert({
          id: item.id,
          unit_id: unitDbIds[item.unit_id]?.unitId,
          name: item.name,
          category: item.category,
          unit_of_measure: item.unit_of_measure,
          quantity: item.quantity,
          minimum_quantity: item.minimum_quantity,
          quantity_per_guest: item.quantity_per_guest,
          supplier: item.supplier,
          total_value: item.total_value,
          has_cost: item.has_cost,
          last_unit_cost: item.last_unit_cost,
          consumption_type: item.consumption_type,
          notify_shopping: item.notify_shopping,
        })
        await loadItems()
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
    setEditConsumptionType(item.consumption_type)
    setEditNotifyShopping(item.notify_shopping)
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
      consumption_type: editConsumptionType,
      notify_shopping: editNotifyShopping,
    }
    const { error } = await supabase.from('inventory_items').update(updates).eq('id', editingItem.id)
    if (error) {
      setError('Não foi possível salvar as alterações do item.')
      return
    }
    setItems((prev) => prev.map((i) => (i.id === editingItem.id ? { ...i, ...updates } : i)))
    setEditingItem(null)
  }

  // ---------- Transferência (com acerto entre unidades) ----------
  function openTransferItem(item: InventoryItem) {
    setTransferringItem(item)
    setTransferDestUnit(UNITS.find((u) => u.id !== item.unit_id)?.id ?? '')
    setTransferQuantity(String(item.quantity).replace('.', ','))
    setTransferError(null)
    setTransferZeroConfirm(false)
    setTransferDueDate(todayIso())
  }

  async function handleConfirmTransfer(e: FormEvent, allowZero = false) {
    e.preventDefault()
    if (!transferringItem || transferring) return
    const amount = parseDecimal(transferQuantity)
    if (!amount || amount <= 0) return setTransferError('Informe uma quantidade válida.')
    if (amount > transferringItem.quantity) return setTransferError('Essa quantidade é maior do que o disponível.')
    const destDbIds = unitDbIds[transferDestUnit]
    if (!destDbIds) return setTransferError('Não encontrei essa unidade no banco de dados ainda.')

    setTransferring(true)
    const { data, error: rpcError } = await supabase.rpc('transfer_stock', {
      p_item: transferringItem.id,
      p_dest_unit: destDbIds.unitId,
      p_quantity: amount,
      p_allow_zero: allowZero,
      p_due_date: transferDueDate,
    })
    setTransferring(false)
    if (rpcError) {
      if (rpcError.message.includes('SEM_CUSTO')) {
        setTransferZeroConfirm(true)
        setTransferError(null)
        return
      }
      setTransferError(friendlyDbError(rpcError.message))
      return
    }
    const r = data as { amount: number; status: string; from_unit: string; to_unit: string; item: string; quantity: number; unit_of_measure: string }
    setTransferringItem(null)
    setNotice(
      r.status === 'pendente'
        ? `Transferência registrada. ${qtd(r.quantity)} ${r.unit_of_measure} de ${r.item} foram de ${r.from_unit} para ${r.to_unit}. Já está no Financeiro de ${r.to_unit} como conta a pagar de ${brl(r.amount)} (vence ${transferDueDate.split('-').reverse().join('/')}). Quando ela for marcada como paga, o recebimento entra sozinho em ${r.from_unit}.`
        : `Transferência registrada. ${qtd(r.quantity)} ${r.unit_of_measure} de ${r.item} foram de ${r.from_unit} para ${r.to_unit}, sem valor (o item estava sem custo).`,
    )
    await loadItems()
  }

  // ---------- Custo inicial ----------
  function openCost(item: InventoryItem) {
    setCostItem(item)
    const atual = unitCost(item)
    setCostValue(item.has_cost && atual != null ? String(Math.round(atual * 100) / 100).replace('.', ',') : '')
    setCostReason('')
    setCostError(null)
  }

  async function handleSaveCost(e: FormEvent) {
    e.preventDefault()
    if (!costItem) return
    const v = parseDecimal(costValue)
    if (v === null || v < 0) return setCostError('Informe um custo unitário válido.')
    const { error: rpcError } = await supabase.rpc('set_initial_stock_cost', { p_item: costItem.id, p_unit_cost: v, p_reason: costReason.trim() || null })
    if (rpcError) return setCostError(friendlyDbError(rpcError.message))
    setCostItem(null)
    await loadItems()
  }

  // ---------- Histórico do item ----------
  async function openHistory(item: InventoryItem) {
    setHistoryItem(item)
    setMovements([])
    const { data } = await supabase
      .from('inventory_movements')
      .select('id, kind, quantity, value, reason, expense_id, created_by_name, created_at')
      .eq('inventory_item_id', item.id)
      .order('created_at', { ascending: false })
      .limit(100)
    setMovements((data ?? []).map((m) => ({ ...m, quantity: Number(m.quantity), value: Number(m.value) })))
  }

  function setStatusFor(item: InventoryItem, status: PurchaseStatus) {
    setPurchaseStatus((prev) => ({ ...prev, [item.id]: status }))
    // Recebeu a compra: lança pela Entrada de compra (com valor), já com o item e a quantidade que faltava.
    if (status === 'recebido') {
      const falta = Math.max(effectiveMinimum(item) - item.quantity, 0)
      setPurchaseModal({ expenseId: null, prefill: { itemId: item.id, quantity: Math.ceil(falta * 100) / 100 } })
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
        quantity: parseDecimal(quantity) ?? 0,
        minimum_quantity: Number(minimumQuantity) || 0,
        quantity_per_guest: quantityPerGuest ? Number(quantityPerGuest) : null,
        consumption_type: quantityPerGuest ? 'por_convidado' : 'por_festa',
        notify_shopping: notifyShopping,
        supplier: supplier.trim() || null,
      })
      .select()
      .single()
    if (error) {
      setError('Não foi possível cadastrar o item.')
      return
    }
    const cost = parseDecimal(initialCost)
    if (cost !== null && cost >= 0) {
      const { error: costErr } = await supabase.rpc('set_initial_stock_cost', { p_item: data.id, p_unit_cost: cost })
      if (costErr) setError(`Item cadastrado, mas o custo não foi salvo: ${friendlyDbError(costErr.message)}`)
    }
    setName('')
    setQuantity('')
    setInitialCost('')
    setMinimumQuantity('')
    setQuantityPerGuest('')
    setSupplier('')
    await loadItems()
  }

  function closePurchaseModal() {
    setPurchaseModal(null)
    if (searchParams.get('compra') || searchParams.get('entrada')) setSearchParams({}, { replace: true })
  }

  function quantityInput(i: InventoryItem, compact = false) {
    return (
      <input
        type="text"
        inputMode="decimal"
        value={qtyDrafts[i.id] ?? qtd(i.quantity, 2)}
        onChange={(e) => setQtyDrafts((prev) => ({ ...prev, [i.id]: e.target.value }))}
        onBlur={() => commitTyped(i)}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        onFocus={(e) => e.target.select()}
        aria-label={`Quantidade de ${i.name}`}
        className={compact
          ? `w-10 text-center border rounded px-1 py-1 text-xs ${i.quantity < i.minimum_quantity ? 'border-danger text-danger' : 'border-line'}`
          : 'w-14 text-center border border-line rounded px-1 py-0.5 text-sm'}
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Estoque</h1>
          <p className="text-sm text-muted mt-1">Quantidade e valor dos insumos por unidade, e o que precisa ser comprado</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/consumo-por-convidado" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-paper border border-line hover:bg-line/40">
            Consumo por convidado
          </Link>
          <Button onClick={() => setPurchaseModal({ expenseId: null, prefill: null })}>
            <ShoppingCart className="w-4 h-4" /> Entrada de compra
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5 flex justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Fechar aviso"><X className="w-4 h-4" /></button>
        </div>
      )}
      {notice && (
        <div className="bg-teal-light text-teal text-sm rounded-lg px-4 py-3 flex justify-between gap-3">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Fechar aviso"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <p className="text-xs text-muted">Itens cadastrados</p>
          <p className="text-2xl font-display font-semibold mt-1">{filtered.length}</p>
        </Card>
        <Card className={precisamRepor.length > 0 ? 'border-danger' : ''}>
          <p className="text-xs text-muted flex items-center gap-1.5">
            {precisamRepor.length > 0 && <AlertTriangle className="w-3.5 h-3.5 text-danger" />} Precisam de reposição
          </p>
          <p className={`text-2xl font-display font-semibold mt-1 ${precisamRepor.length > 0 ? 'text-danger' : ''}`}>{precisamRepor.length}</p>
        </Card>
        <Card>
          <p className="text-xs text-muted">Valor em estoque</p>
          <p className="text-2xl font-display font-semibold mt-1">{brl(valorEmEstoque)}</p>
          <p className="text-[11px] text-muted mt-0.5">pelo custo médio de cada item</p>
        </Card>
        <Card className={semCusto > 0 ? 'border-amber' : ''}>
          <p className="text-xs text-muted">Itens sem custo</p>
          <p className={`text-2xl font-display font-semibold mt-1 ${semCusto > 0 ? 'text-amber' : ''}`}>{semCusto}</p>
          <p className="text-[11px] text-muted mt-0.5">use "Definir custo" na tabela</p>
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
                      Tem {qtd(i.quantity)} {i.unit_of_measure} · mínimo é {qtd(minimo)} {i.unit_of_measure}
                      {i.quantity_per_guest != null && nextFesta ? ` (calculado para a festa de ${format(parseISO(nextFesta.date), 'dd/MM')}, ${nextFesta.guests} convidados)` : ''}
                      {i.supplier ? ` · fornecedor: ${i.supplier}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge tone="danger">Comprar {qtd(Math.max(minimo - i.quantity, 0))} {i.unit_of_measure}</Badge>
                    <select value={status} onChange={(e) => setStatusFor(i, e.target.value as PurchaseStatus)} className="border border-line rounded-lg px-2 py-1 text-xs" aria-label="Situação da compra">
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
        <p className="text-xs text-muted mt-2">Ao marcar "Recebido", abre a Entrada de compra já com o item, para lançar com o valor pago.</p>
      </Card>

      <Card title="Cadastrar item">
        <form onSubmit={handleAddItem} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-muted mb-1">Nome do item</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Copo descartável" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Categoria</label>
            <select value={category} onChange={(e) => setCategory(e.target.value as InventoryCategory)} className="w-full border border-line rounded-lg px-3 py-2 text-sm">
              {INVENTORY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Unidade de medida</label>
            <input type="text" value={unitOfMeasure} onChange={(e) => setUnitOfMeasure(e.target.value)} placeholder="un, kg, litro, pacote..." className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Fornecedor (opcional)</label>
            <input type="text" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Nome do fornecedor" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Quantidade atual</label>
            <input type="text" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Custo unitário (opcional)</label>
            <input type="text" inputMode="decimal" value={initialCost} onChange={(e) => setInitialCost(e.target.value)} placeholder="R$ por unidade" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Estoque mínimo fixo</label>
            <input type="number" value={minimumQuantity} onChange={(e) => setMinimumQuantity(e.target.value)} placeholder="0" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Quantidade por convidado (opcional)</label>
            <input type="number" step="0.01" value={quantityPerGuest} onChange={(e) => setQuantityPerGuest(e.target.value)} placeholder="Ex: 1 copo por convidado" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
            <label className="flex items-center gap-2 text-xs mt-2 cursor-pointer">
              <input type="checkbox" checked={notifyShopping} onChange={(e) => setNotifyShopping(e.target.checked)} />
              Avisar na Lista de compras quando ficar abaixo do mínimo
            </label>
          </div>
          <div className="flex items-end sm:col-span-2 lg:col-span-4">
            <Button type="submit"><Plus className="w-4 h-4" /> Adicionar item</Button>
          </div>
        </form>
        <p className="text-xs text-muted mt-3">
          Para registrar uma compra (com valor e conta a pagar), use <strong>Entrada de compra</strong>.
          {selectedUnit === 'todas' && ` Como "Ambas as unidades" está selecionado, o novo item é cadastrado em ${UNITS[0].name}.`}
        </p>
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
                      {rows.map((r) => <th key={r.digito} className="px-1 pb-1 text-center text-xs text-muted font-medium w-10">{r.digito}</th>)}
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
                              {item ? quantityInput(item, true) : <span className="text-muted text-xs">—</span>}
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
            Números em vermelho estão abaixo do mínimo (1 unidade). Clique no número, digite a quantidade e aperte Enter. Para diminuir, o sistema pede o motivo.
          </p>
        </Card>
      )}

      <Card title="Todos os itens">
        <p className="text-xs text-muted mb-3 flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Os botões +/− e o campo de quantidade são só para ajuste (contagem, perda, quebra) e não criam despesa. Compras devem ser lançadas por Entrada de compra, para não duplicar o estoque.
        </p>
        {loading ? (
          <p className="text-sm text-muted py-4 text-center">Carregando...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="pb-3 font-medium">Item</th>
                  <th className="pb-3 font-medium">Quantidade</th>
                  <th className="pb-3 font-medium">Valor em estoque</th>
                  <th className="pb-3 font-medium">Por convidado</th>
                  <th className="pb-3 font-medium">Mínimo</th>
                  <th className="pb-3 font-medium">Status</th>
                  <th className="pb-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {outrosItens.map((i) => {
                  const minimo = effectiveMinimum(i)
                  const custo = unitCost(i)
                  return (
                    <tr key={i.id}>
                      <td className="py-3 font-medium">
                        {i.name}
                        <p className="text-xs text-muted font-normal">{i.category}{i.supplier ? ` · ${i.supplier}` : ''}</p>
                      </td>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <button onClick={() => stepQuantity(i, -1)} className="w-6 h-6 rounded border border-line flex items-center justify-center hover:bg-paper" aria-label="Diminuir quantidade">
                            <Minus className="w-3 h-3" />
                          </button>
                          <div className="flex items-center gap-1">
                            {quantityInput(i)}
                            <span className="text-xs text-muted">{i.unit_of_measure}</span>
                          </div>
                          <button onClick={() => stepQuantity(i, 1)} className="w-6 h-6 rounded border border-line flex items-center justify-center hover:bg-paper" aria-label="Aumentar quantidade">
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                      <td className="py-3">
                        {i.has_cost ? (
                          <>
                            <p>{brl(i.total_value)}</p>
                            <p className="text-[11px] text-muted flex items-center gap-1.5">
                              {custo != null ? `${brl(custo)} / ${i.unit_of_measure}` : ''}
                              <Can permission="action:estoque.custo_inicial">
                                <button onClick={() => openCost(i)} className="text-muted hover:text-purple" aria-label={`Editar custo de ${i.name}`} title="Editar custo por unidade">
                                  <Pencil className="w-3 h-3" />
                                </button>
                              </Can>
                            </p>
                          </>
                        ) : (
                          <div className="flex flex-col items-start gap-1">
                            <Badge tone="amber">Sem custo</Badge>
                            <Can permission="action:estoque.custo_inicial">
                              <button onClick={() => openCost(i)} className="text-xs text-purple font-medium">Definir custo</button>
                            </Can>
                          </div>
                        )}
                      </td>
                      <td className="py-3">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          defaultValue={i.quantity_per_guest ?? ''}
                          key={i.quantity_per_guest ?? 'none'}
                          placeholder="—"
                          aria-label={`Consumo por convidado de ${i.name}`}
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
                        {qtd(minimo)} {i.unit_of_measure}
                        {i.quantity_per_guest != null && <span className="text-[10px] block">(varia por convidado)</span>}
                      </td>
                      <td className="py-3">{i.quantity < minimo ? <Badge tone="danger">Repor</Badge> : <Badge tone="teal">OK</Badge>}</td>
                      <td className="py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <button onClick={() => openHistory(i)} className="text-muted hover:text-purple" aria-label="Histórico do item"><History className="w-3.5 h-3.5" /></button>
                          <button onClick={() => openTransferItem(i)} className="text-muted hover:text-purple" aria-label="Transferir para outra unidade"><ArrowLeftRight className="w-3.5 h-3.5" /></button>
                          <button onClick={() => openEditItem(i)} className="text-muted hover:text-purple" aria-label="Editar item"><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={() => handleRemove(i.id)} className="text-muted hover:text-danger" aria-label="Remover item"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {outrosItens.length === 0 && (
                  <tr><td colSpan={7} className="py-6 text-center text-muted">Nenhum item cadastrado ainda.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {purchaseModal && (
        <StockPurchaseModal
          expenseId={purchaseModal.expenseId}
          prefill={purchaseModal.prefill}
          defaultUnitSlug={(purchaseModal.prefill && items.find((i) => i.id === purchaseModal.prefill?.itemId)?.unit_id) || (selectedUnit === 'todas' ? UNITS[0].id : selectedUnit)}
          onClose={closePurchaseModal}
          onSaved={(msg) => {
            closePurchaseModal()
            setNotice(msg)
            loadItems()
          }}
        />
      )}

      {pendingAdjust && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setPendingAdjust(null)} />
          <div className="relative w-full max-w-sm bg-surface rounded-card p-6 shadow-xl">
            <h2 className="text-lg font-display font-semibold mb-1">Diminuir estoque</h2>
            <p className="text-sm text-muted mb-4">
              {pendingAdjust.item.name}: de {qtd(pendingAdjust.item.quantity)} para {qtd(pendingAdjust.newQuantity)} {pendingAdjust.item.unit_of_measure}. Qual o motivo?
            </p>
            <form onSubmit={confirmPendingAdjust} className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {ADJUST_REASONS.map((r) => (
                  <button key={r} type="button" onClick={() => setAdjustReason(r)} className={`px-3 py-1.5 rounded-lg text-sm border ${adjustReason === r ? 'bg-purple text-white border-purple' : 'border-line'}`}>{r}</button>
                ))}
              </div>
              {adjustReason === 'Outro' && (
                <input autoFocus value={adjustOther} onChange={(e) => setAdjustOther(e.target.value)} placeholder="Descreva o motivo" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
              )}
              <p className="text-xs text-muted">Sai pelo custo médio e fica no histórico do item. Não vira despesa no Financeiro.</p>
              <div className="flex gap-2 pt-1">
                <Button type="button" variant="secondary" className="flex-1 justify-center" onClick={() => setPendingAdjust(null)}>Cancelar</Button>
                <Button type="submit" className="flex-1 justify-center" disabled={adjustReason === 'Outro' && !adjustOther.trim()}>Confirmar</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {costItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setCostItem(null)} />
          <div className="relative w-full max-w-sm bg-surface rounded-card p-6 shadow-xl">
            <h2 className="text-lg font-display font-semibold mb-1">{costItem.has_cost ? 'Editar custo' : 'Definir custo inicial'}</h2>
            <p className="text-sm text-muted mb-4">
              {costItem.name} — {qtd(costItem.quantity)} {costItem.unit_of_measure} em estoque. O novo custo vale para o estoque atual (valor em estoque = quantidade × custo), sem mudar a quantidade e sem criar lançamento no Financeiro. Consumos já lançados nas festas mantêm o custo da época.
            </p>
            <form onSubmit={handleSaveCost} className="space-y-3">
              <div>
                <label className="block text-xs text-muted mb-1">Custo por {costItem.unit_of_measure} (R$)</label>
                <input autoFocus value={costValue} onChange={(e) => setCostValue(e.target.value)} inputMode="decimal" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
                {parseDecimal(costValue) != null && (
                  <p className="text-xs text-muted mt-1">Valor em estoque: {brl((parseDecimal(costValue) ?? 0) * costItem.quantity)}</p>
                )}
              </div>
              {costItem.has_cost && (
                <div>
                  <label className="block text-xs text-muted mb-1">Motivo (opcional)</label>
                  <input value={costReason} onChange={(e) => setCostReason(e.target.value)} placeholder="Ex: preço errado na compra" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
                </div>
              )}
              {costError && <div className="bg-danger-light text-danger text-sm rounded-lg px-3 py-2">{costError}</div>}
              <div className="flex gap-2">
                <Button type="button" variant="secondary" className="flex-1 justify-center" onClick={() => setCostItem(null)}>Cancelar</Button>
                <Button type="submit" className="flex-1 justify-center">Salvar</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {historyItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setHistoryItem(null)} />
          <div className="relative w-full max-w-2xl bg-surface rounded-card p-6 shadow-xl max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-3">
              <div>
                <h2 className="text-lg font-display font-semibold">Histórico — {historyItem.name}</h2>
                <p className="text-sm text-muted">Hoje: {qtd(historyItem.quantity)} {historyItem.unit_of_measure} · {historyItem.has_cost ? brl(historyItem.total_value) : 'sem custo'}</p>
              </div>
              <button onClick={() => setHistoryItem(null)} aria-label="Fechar"><X className="w-5 h-5 text-muted" /></button>
            </div>
            {movements.length === 0 ? (
              <p className="text-sm text-muted">Nenhuma movimentação registrada ainda.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-line">
                    <th className="pb-2 font-medium">Quando</th>
                    <th className="pb-2 font-medium">O quê</th>
                    <th className="pb-2 font-medium text-right">Qtd</th>
                    <th className="pb-2 font-medium text-right">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {movements.map((m) => (
                    <tr key={m.id}>
                      <td className="py-2 text-xs text-muted whitespace-nowrap">{new Date(m.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                      <td className="py-2">
                        <p>{MOVEMENT_LABEL[m.kind] ?? m.kind}{m.created_by_name ? <span className="text-xs text-muted"> · {m.created_by_name}</span> : null}</p>
                        {m.reason && <p className="text-xs text-muted">{m.reason}</p>}
                        {m.expense_id && (m.kind === 'compra' || m.kind === 'compra_ajuste') && (
                          <button onClick={() => { setHistoryItem(null); setPurchaseModal({ expenseId: m.expense_id, prefill: null }) }} className="text-xs text-purple font-medium">Editar compra</button>
                        )}
                      </td>
                      <td className={`py-2 text-right ${m.quantity < 0 ? 'text-danger' : 'text-teal'}`}>{m.quantity > 0 ? '+' : ''}{qtd(m.quantity)}</td>
                      <td className="py-2 text-right text-muted">{m.value !== 0 ? brl(m.value) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setEditingItem(null)} />
          <div className="relative w-full max-w-md bg-surface rounded-card p-6 shadow-xl">
            <h2 className="text-lg font-display font-semibold mb-4">Editar item</h2>
            <form onSubmit={handleSaveEditItem} className="space-y-3">
              <div>
                <label className="block text-xs text-muted mb-1">Nome do item</label>
                <input type="text" required value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Categoria</label>
                <select value={editCategory} onChange={(e) => setEditCategory(e.target.value as InventoryCategory)} className="w-full border border-line rounded-lg px-3 py-2 text-sm">
                  {INVENTORY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted mb-1">Unidade de medida</label>
                  <input type="text" value={editUnitOfMeasure} onChange={(e) => setEditUnitOfMeasure(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Estoque mínimo fixo</label>
                  <input type="number" min={0} value={editMinimumQuantity} onChange={(e) => setEditMinimumQuantity(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Tipo de consumo</label>
                <select value={editConsumptionType} onChange={(e) => setEditConsumptionType(e.target.value as 'por_convidado' | 'por_festa')} className="w-full border border-line rounded-lg px-3 py-2 text-sm">
                  <option value="por_convidado">Por convidado (varia com o público)</option>
                  <option value="por_festa">Por festa (velas, toalhas…)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Fornecedor (opcional)</label>
                <input type="text" value={editSupplier} onChange={(e) => setEditSupplier(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
              </div>
              <label className="flex items-start gap-2 text-sm bg-paper rounded-lg px-3 py-2.5 cursor-pointer">
                <input type="checkbox" checked={editNotifyShopping} onChange={(e) => setEditNotifyShopping(e.target.checked)} className="mt-0.5" />
                <span>
                  Avisar na Lista de compras
                  <span className="block text-xs text-muted">Quando o item ficar abaixo do mínimo, ele aparece na Lista de compras. Desmarque para itens que você não quer que avisem.</span>
                </span>
              </label>
              <p className="text-xs text-muted">A quantidade é ajustada na tabela (+/−). O valor muda só por Entrada de compra, consumo, ajuste ou transferência.</p>
              <div className="flex gap-2 pt-2">
                <Button type="button" variant="secondary" className="flex-1 justify-center" onClick={() => setEditingItem(null)}>Cancelar</Button>
                <Button type="submit" className="flex-1 justify-center">Salvar</Button>
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
              "{transferringItem.name}" — tem {qtd(transferringItem.quantity)} {transferringItem.unit_of_measure} em {UNITS.find((u) => u.id === transferringItem.unit_id)?.name}
              {unitCost(transferringItem) != null ? `, a ${brl(unitCost(transferringItem))} por ${transferringItem.unit_of_measure}` : ', sem custo'}.
            </p>
            {transferError && <div className="bg-danger-light text-danger text-sm rounded-lg px-3 py-2 mb-3">{transferError}</div>}
            <form onSubmit={(e) => handleConfirmTransfer(e)} className="space-y-3">
              <div>
                <label className="block text-xs text-muted mb-1">Transferir para</label>
                <select value={transferDestUnit} onChange={(e) => setTransferDestUnit(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm">
                  {UNITS.filter((u) => u.id !== transferringItem.unit_id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Quantidade a transferir</label>
                <input inputMode="decimal" value={transferQuantity} onChange={(e) => setTransferQuantity(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
                {unitCost(transferringItem) != null && parseDecimal(transferQuantity) != null && (
                  <p className="text-xs text-muted mt-1">Valor do acerto: {brl(Math.round((parseDecimal(transferQuantity) ?? 0) * (unitCost(transferringItem) ?? 0) * 100) / 100)} (pelo custo médio, sem margem)</p>
                )}
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Vencimento da conta a pagar</label>
                <input type="date" value={transferDueDate} onChange={(e) => setTransferDueDate(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
              </div>
              <p className="text-xs text-muted">
                A unidade que recebe "compra" da outra pelo custo: o valor entra na hora como conta a pagar no Financeiro dela. Ao marcar como paga, o recebimento entra sozinho na unidade que mandou.
              </p>
              {transferZeroConfirm ? (
                <div className="bg-amber-light rounded-lg p-3 text-sm space-y-2">
                  <p className="font-medium text-amber">Este item está sem custo.</p>
                  <p>O valor do acerto entre as unidades vai ficar zerado. É isso mesmo?</p>
                  <div className="flex gap-2">
                    <Button type="button" variant="secondary" onClick={() => setTransferZeroConfirm(false)}>Não, voltar</Button>
                    <Button type="button" disabled={transferring} onClick={(e) => handleConfirmTransfer(e as unknown as FormEvent, true)}>Sim, transferir com valor zero</Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 pt-2">
                  <Button type="button" variant="secondary" className="flex-1 justify-center" onClick={() => setTransferringItem(null)}>Cancelar</Button>
                  <Button type="submit" className="flex-1 justify-center" disabled={transferring}>{transferring ? 'Transferindo...' : 'Transferir'}</Button>
                </div>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
