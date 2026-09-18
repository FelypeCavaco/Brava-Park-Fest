import { FormEvent, useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Plus, Trash2, Pause, Play, Repeat, TrendingUp, Pencil, X } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Can } from '../components/Can'
import { useUnit, UNITS } from '../lib/UnitContext'
import { supabase } from '../lib/supabaseClient'
import {
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  type Expense,
  type ExpenseCategory,
  type RecurringExpense,
  type PayableStatus,
  type PaymentMethod,
} from '../types'
import { currentMonthValue, lastNMonths, monthBounds, addMonthsToValue } from '../lib/monthUtils'
import { loadMonthByUnit, loadExpectedRemainingByUnit } from '../lib/financeAggregates'
import { useUndo } from '../lib/UndoContext'

function currency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

const statusLabel: Record<PayableStatus, string> = {
  a_vencer: 'A vencer',
  pago: 'Pago',
  atrasado: 'Atrasado',
  cancelado: 'Cancelado',
}

const statusTone: Record<PayableStatus, 'amber' | 'teal' | 'danger' | 'neutral'> = {
  a_vencer: 'amber',
  pago: 'teal',
  atrasado: 'danger',
  cancelado: 'neutral',
}

interface InventoryItemLite {
  id: string
  name: string
  quantity: number
  unitOfMeasure: string
}

interface PurchaseItemRow {
  itemId: string
  itemName: string // já vem descritivo (ex: "Suco de laranja — 2x 5L (10 L)"), pra ficar claro no histórico depois
  quantity: number
}

interface PurchaseVariant {
  id: string
  label: string
  volumeAmount: number
}

interface UnitSummary {
  entradas: number
  aPagar: number
  atrasado: number
  totalDespesas: number
  saldo: number
  recebimentosPrevistos: number
  saldoProjetado: number
}

export function Finance() {
  const { selectedUnit, unitDbIds, unitDbIdsLoading } = useUnit()
  const { scheduleDelete } = useUndo()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [recurring, setRecurring] = useState<RecurringExpense[]>([])
  const [expenseItemsByExpense, setExpenseItemsByExpense] = useState<Record<string, { id: string; itemName: string; quantity: number; inventoryItemId: string | null }[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [receitaByUnit, setReceitaByUnit] = useState<Record<string, number>>({})
  const [recebimentosPrevistosByUnit, setRecebimentosPrevistosByUnit] = useState<Record<string, number>>({})
  const [fluxoCaixaByUnit, setFluxoCaixaByUnit] = useState<Record<string, { mes: string; mesValue: string; entradas: number; saidas: number }[]>>({})

  const [expenseUnit, setExpenseUnit] = useState(selectedUnit === 'todas' ? UNITS[0].id : selectedUnit)
  const [category, setCategory] = useState<ExpenseCategory>(EXPENSE_CATEGORIES[0])
  const [categoryOutro, setCategoryOutro] = useState('')
  const [description, setDescription] = useState('')
  const [supplier, setSupplier] = useState('')
  const [amount, setAmount] = useState('')
  const [dueDate, setDueDate] = useState('2026-09-07')

  const [fluxoDetalhe, setFluxoDetalhe] = useState<{
    tipo: 'entradas' | 'saidas'
    mesLabel: string
    loading: boolean
    entradas: { cliente: string; valor: number; data: string; metodo: string | null }[]
    despesasPagas: { descricao: string; valor: number }[]
    custosFesta: { cliente: string; descricao: string; valor: number }[]
  } | null>(null)

  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [editDescription, setEditDescription] = useState('')
  const [editSupplier, setEditSupplier] = useState('')
  const [editCategory, setEditCategory] = useState<ExpenseCategory>(EXPENSE_CATEGORIES[0])
  const [editCategoryOutro, setEditCategoryOutro] = useState('')
  const [editAmount, setEditAmount] = useState('')
  const [editDueDate, setEditDueDate] = useState('')
  const [editStatus, setEditStatus] = useState<PayableStatus>('a_vencer')
  const [editPaymentMethod, setEditPaymentMethod] = useState<PaymentMethod>('pix')
  const [editPaidDate, setEditPaidDate] = useState('')
  const [savingEditExpense, setSavingEditExpense] = useState(false)

  const [purchaseInventory, setPurchaseInventory] = useState<InventoryItemLite[]>([])
  const [purchaseVariants, setPurchaseVariants] = useState<Record<string, PurchaseVariant[]>>({})
  const [purchaseItems, setPurchaseItems] = useState<PurchaseItemRow[]>([])
  const [purchaseItemId, setPurchaseItemId] = useState('')
  const [purchaseItemVariantId, setPurchaseItemVariantId] = useState('')
  const [purchaseItemQty, setPurchaseItemQty] = useState('')

  const [recUnit, setRecUnit] = useState(selectedUnit === 'todas' ? UNITS[0].id : selectedUnit)
  const [recCategory, setRecCategory] = useState<ExpenseCategory>(EXPENSE_CATEGORIES[0])
  const [recCategoryOutro, setRecCategoryOutro] = useState('')
  const [recDescription, setRecDescription] = useState('')
  const [recAmount, setRecAmount] = useState('')
  const [recDay, setRecDay] = useState('5')
  const [recComecar, setRecComecar] = useState<'este_mes' | 'proximo_mes'>('este_mes')

  useEffect(() => {
    if (!unitDbIdsLoading) loadAll()
  }, [unitDbIdsLoading, unitDbIds])

  useEffect(() => {
    if (!unitDbIdsLoading) loadPurchaseInventory(expenseUnit)
  }, [expenseUnit, unitDbIdsLoading, unitDbIds])

  function dbIdToSlugMap() {
    const map: Record<string, string> = {}
    for (const slug of Object.keys(unitDbIds)) map[unitDbIds[slug].unitId] = slug
    return map
  }

  async function loadPurchaseInventory(unitSlug: string) {
    const dbIds = unitDbIds[unitSlug]
    if (!dbIds) return
    const { data } = await supabase.from('inventory_items').select('id, name, quantity, unit_of_measure').eq('unit_id', dbIds.unitId).order('name')
    const items = (data ?? []).map((i) => ({ id: i.id, name: i.name, quantity: Number(i.quantity), unitOfMeasure: i.unit_of_measure }))
    setPurchaseInventory(items)

    const itemIds = items.map((i) => i.id)
    const variantsMap: Record<string, PurchaseVariant[]> = {}
    if (itemIds.length > 0) {
      const { data: variantsData } = await supabase
        .from('inventory_purchase_variants')
        .select('id, inventory_item_id, label, volume_amount')
        .in('inventory_item_id', itemIds)
      for (const v of variantsData ?? []) {
        if (!variantsMap[v.inventory_item_id]) variantsMap[v.inventory_item_id] = []
        variantsMap[v.inventory_item_id].push({ id: v.id, label: v.label, volumeAmount: Number(v.volume_amount) })
      }
    }
    setPurchaseVariants(variantsMap)

    setPurchaseItems([])
    setPurchaseItemId('')
    setPurchaseItemVariantId('')
    setPurchaseItemQty('')
  }

  async function loadAll() {
    setLoading(true)
    // Gera (se ainda não existir) o lançamento deste mês de cada despesa
    // fixa ativa, antes de carregar — assim ela já aparece pendente/vencida
    // igual uma conta a pagar normal.
    await supabase.rpc('ensure_recurring_expenses_current_month')

    const dbIdToSlug = dbIdToSlugMap()
    const [{ data: exp, error: expErr }, { data: rec }, { data: expItems }] = await Promise.all([
      supabase.from('expenses').select('*').order('due_date', { ascending: false }),
      supabase.from('recurring_expenses').select('*').order('day_of_month'),
      supabase.from('expense_items').select('id, expense_id, item_name, quantity, inventory_item_id'),
    ])

    if (expErr) setError('Não foi possível carregar as despesas.')

    setExpenses(
      (exp ?? []).map((e) => ({
        id: e.id,
        unit_id: dbIdToSlug[e.unit_id] ?? '',
        category: e.category,
        description: e.description,
        supplier: e.supplier,
        amount: Number(e.amount),
        due_date: e.due_date,
        paid_date: e.paid_date,
        status: e.status,
        payment_method: e.payment_method,
        recurring_expense_id: e.recurring_expense_id,
      })),
    )
    setRecurring(
      (rec ?? []).map((r) => ({
        id: r.id,
        unit_id: dbIdToSlug[r.unit_id] ?? '',
        category: r.category,
        description: r.description,
        amount: Number(r.amount),
        day_of_month: r.day_of_month,
        active: r.active,
        first_charge_month: r.first_charge_month,
      })),
    )

    const grouped: Record<string, { id: string; itemName: string; quantity: number; inventoryItemId: string | null }[]> = {}
    for (const it of expItems ?? []) {
      const list = grouped[it.expense_id] ?? []
      list.push({ id: it.id, itemName: it.item_name, quantity: Number(it.quantity), inventoryItemId: it.inventory_item_id })
      grouped[it.expense_id] = list
    }
    setExpenseItemsByExpense(grouped)
    setLoading(false)

    await loadAggregates()
  }

  // Receita/recebimentos previstos/fluxo de caixa dos últimos 6 meses, pras
  // DUAS unidades sempre (a tela não mistura os valores, só mostra os dois
  // lado a lado quando "Ambas as unidades" está selecionado). Chamado tanto
  // na carga inicial quanto depois de qualquer lançamento/edição/exclusão de
  // despesa — senão o gráfico fica com número desatualizado até recarregar a
  // página inteira.
  async function loadAggregates() {
    const unitIdBySlug: Record<string, string> = {}
    for (const u of UNITS) if (unitDbIds[u.id]) unitIdBySlug[u.id] = unitDbIds[u.id].unitId

    const currentMonth = currentMonthValue()
    const monthData = await loadMonthByUnit(currentMonth, unitIdBySlug)
    const receita: Record<string, number> = {}
    for (const slug of Object.keys(unitIdBySlug)) receita[slug] = monthData[slug]?.receita ?? 0
    setReceitaByUnit(receita)

    const previsto: Record<string, number> = {}
    for (const slug of Object.keys(unitIdBySlug)) {
      previsto[slug] = await loadExpectedRemainingByUnit(currentMonth, { [slug]: unitIdBySlug[slug] })
    }
    setRecebimentosPrevistosByUnit(previsto)

    const months = lastNMonths(6)
    const fluxoPorUnidade: Record<string, { mes: string; mesValue: string; entradas: number; saidas: number }[]> = {}
    for (const slug of Object.keys(unitIdBySlug)) fluxoPorUnidade[slug] = []
    for (const { value, label } of months) {
      const data = await loadMonthByUnit(value, unitIdBySlug)
      for (const slug of Object.keys(unitIdBySlug)) {
        fluxoPorUnidade[slug].push({
          mes: label,
          mesValue: value,
          entradas: data[slug]?.receita ?? 0,
          saidas: (data[slug]?.despesas ?? 0) + (data[slug]?.custos ?? 0),
        })
      }
    }
    setFluxoCaixaByUnit(fluxoPorUnidade)
  }

  // Detalhe de um mês específico do gráfico de fluxo de caixa — aberto ao
  // clicar em cima da barra de "Entradas" ou "Saídas".
  async function openFluxoDetalhe(unitSlug: string | 'todas', mesValue: string, mesLabel: string, tipo: 'entradas' | 'saidas') {
    const unitIds = unitSlug === 'todas' ? Object.values(unitDbIds).map((d) => d.unitId) : [unitDbIds[unitSlug]?.unitId].filter(Boolean)
    if (unitIds.length === 0) return
    setFluxoDetalhe({ tipo, mesLabel, loading: true, entradas: [], despesasPagas: [], custosFesta: [] })
    const { startIso, endIso } = monthBounds(mesValue)

    if (tipo === 'entradas') {
      const { data } = await supabase
        .from('payments')
        .select('amount, payment_date, payment_method, reservation:reservations!inner(unit_id, client:clients(name))')
        .in('reservation.unit_id', unitIds)
        .gte('payment_date', startIso)
        .lt('payment_date', endIso)
        .order('payment_date')
      const entradas = (data ?? []).map((p: any) => ({
        cliente: p.reservation?.client?.name ?? '—',
        valor: Number(p.amount),
        data: format(parseISO(p.payment_date), 'dd/MM/yyyy'),
        metodo: p.payment_method,
      }))
      setFluxoDetalhe({ tipo, mesLabel, loading: false, entradas, despesasPagas: [], custosFesta: [] })
      return
    }

    // Despesa fixa já é um lançamento de verdade em `expenses` (com
    // recurring_expense_id preenchido), então já vem junto na busca abaixo —
    // não precisa buscar separado.
    const [{ data: expensesData }, { data: reservationsData }] = await Promise.all([
      supabase.from('expenses').select('description, supplier, amount, recurring_expense_id').in('unit_id', unitIds).eq('status', 'pago').gte('paid_date', startIso).lt('paid_date', endIso),
      supabase
        .from('reservations')
        .select('id, client:clients(name), reservation_costs(description, amount)')
        .in('unit_id', unitIds)
        .neq('status', 'cancelada')
        .gte('event_date', startIso)
        .lt('event_date', endIso),
    ])

    const despesasPagas = (expensesData ?? []).map((e) => ({
      descricao: (e.description || e.supplier || 'Despesa') + (e.recurring_expense_id ? ' (fixa)' : ''),
      valor: Number(e.amount),
    }))
    const custosFesta: { cliente: string; descricao: string; valor: number }[] = []
    for (const r of reservationsData ?? []) {
      for (const c of (r as any).reservation_costs ?? []) {
        custosFesta.push({ cliente: (r as any).client?.name ?? '—', descricao: c.description, valor: Number(c.amount) })
      }
    }

    setFluxoDetalhe({ tipo, mesLabel, loading: false, entradas: [], despesasPagas, custosFesta })
  }

  const summaryByUnit = useMemo(() => {
    const result: Record<string, UnitSummary> = {}
    const mesAtual = currentMonthValue()
    for (const u of UNITS) {
      const slug = u.id
      // Despesa fixa já vira lançamento de verdade em `expenses` todo mês
      // (ver ensure_recurring_expenses_current_month), então já está contada
      // aqui dentro — não soma separado, senão conta em dobro.
      const expensesForUnit = expenses.filter((e) => e.unit_id === slug)
      // Só o que já foi pago de verdade este mês sai do saldo — uma conta "a
      // vencer" ainda não tirou dinheiro nenhum do caixa.
      const despesasPagas = expensesForUnit
        .filter((e) => e.status === 'pago' && e.paid_date?.slice(0, 7) === mesAtual)
        .reduce((s, e) => s + e.amount, 0)
      const aPagar = expensesForUnit.filter((e) => e.status === 'a_vencer').reduce((s, e) => s + e.amount, 0)
      const atrasado = expensesForUnit.filter((e) => e.status === 'atrasado').reduce((s, e) => s + e.amount, 0)
      const entradas = receitaByUnit[slug] ?? 0
      const totalDespesas = despesasPagas
      const saldo = entradas - totalDespesas
      const recebimentosPrevistos = recebimentosPrevistosByUnit[slug] ?? 0
      const saldoProjetado = saldo + recebimentosPrevistos - aPagar - atrasado
      result[slug] = { entradas, aPagar, atrasado, totalDespesas, saldo, recebimentosPrevistos, saldoProjetado }
    }
    return result
  }, [expenses, receitaByUnit, recebimentosPrevistosByUnit])

  // Fluxo de caixa (projeção + gráfico de 6 meses) soma as duas unidades
  // quando "Ambas as unidades" está selecionado — diferente dos cartões de
  // cima, que continuam separados por unidade (contas bancárias diferentes).
  const fluxoResumo = useMemo(() => {
    if (selectedUnit !== 'todas') return summaryByUnit[selectedUnit] ?? null
    const unidades = UNITS.map((u) => summaryByUnit[u.id]).filter((s): s is UnitSummary => !!s)
    if (unidades.length === 0) return null
    return unidades.reduce(
      (acc, s) => ({
        entradas: acc.entradas + s.entradas,
        aPagar: acc.aPagar + s.aPagar,
        atrasado: acc.atrasado + s.atrasado,
        totalDespesas: acc.totalDespesas + s.totalDespesas,
        saldo: acc.saldo + s.saldo,
        recebimentosPrevistos: acc.recebimentosPrevistos + s.recebimentosPrevistos,
        saldoProjetado: acc.saldoProjetado + s.saldoProjetado,
      }),
      { entradas: 0, aPagar: 0, atrasado: 0, totalDespesas: 0, saldo: 0, recebimentosPrevistos: 0, saldoProjetado: 0 },
    )
  }, [selectedUnit, summaryByUnit])

  const fluxoChartData = useMemo(() => {
    if (selectedUnit !== 'todas') return fluxoCaixaByUnit[selectedUnit] ?? []
    const porUnidade = UNITS.map((u) => fluxoCaixaByUnit[u.id] ?? [])
    const base = porUnidade.find((arr) => arr.length > 0)
    if (!base) return []
    return base.map((row, i) => ({
      mes: row.mes,
      mesValue: row.mesValue,
      entradas: porUnidade.reduce((s, arr) => s + (arr[i]?.entradas ?? 0), 0),
      saidas: porUnidade.reduce((s, arr) => s + (arr[i]?.saidas ?? 0), 0),
    }))
  }, [selectedUnit, fluxoCaixaByUnit])

  const visibleUnitSlugs = selectedUnit === 'todas' ? UNITS.map((u) => u.id) : [selectedUnit]
  const unitIds = visibleUnitSlugs

  const filteredExpenses = useMemo(
    () => expenses.filter((e) => unitIds.includes(e.unit_id)).sort((a, b) => (a.due_date < b.due_date ? 1 : -1)),
    [expenses, unitIds],
  )

  const filteredRecurring = useMemo(
    () => recurring.filter((r) => unitIds.includes(r.unit_id)).sort((a, b) => a.day_of_month - b.day_of_month),
    [recurring, unitIds],
  )

  // Lançamento deste mês de cada despesa fixa (gerado sozinho ao carregar a
  // tela) — é o que mostra se está pendente, vencida ou já paga.
  const currentExpenseByRecurringId = useMemo(() => {
    const mesAtual = currentMonthValue()
    const map: Record<string, Expense> = {}
    for (const e of expenses) {
      if (e.recurring_expense_id && e.due_date.slice(0, 7) === mesAtual) map[e.recurring_expense_id] = e
    }
    return map
  }, [expenses])

  // Despesa fixa já vira lançamento de verdade em `expenses` (incluído aqui
  // via filteredExpenses) — não soma o molde de recurring_expenses separado,
  // senão conta em dobro.
  const porCategoria = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of filteredExpenses) map.set(e.category, (map.get(e.category) ?? 0) + e.amount)
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1])
  }, [filteredExpenses])

  const totalDespesasGeral = useMemo(() => filteredExpenses.reduce((s, e) => s + e.amount, 0), [filteredExpenses])

  function addPurchaseItem() {
    const item = purchaseInventory.find((i) => i.id === purchaseItemId)
    if (!item) return
    const variants = purchaseVariants[item.id] ?? []

    if (variants.length > 0) {
      const variant = variants.find((v) => v.id === purchaseItemVariantId)
      const bottles = Number(purchaseItemQty)
      if (!variant || !bottles) return
      const totalQuantity = Math.round(variant.volumeAmount * bottles * 1000) / 1000
      setPurchaseItems((prev) => [
        ...prev,
        {
          itemId: item.id,
          itemName: `${item.name} — ${bottles}x ${variant.label} (${totalQuantity} ${item.unitOfMeasure})`,
          quantity: totalQuantity,
        },
      ])
    } else {
      const qty = Number(purchaseItemQty)
      if (!qty) return
      setPurchaseItems((prev) => [...prev, { itemId: item.id, itemName: `${item.name} — ${qty} ${item.unitOfMeasure}`, quantity: qty }])
    }

    setPurchaseItemId('')
    setPurchaseItemVariantId('')
    setPurchaseItemQty('')
  }

  function removePurchaseItem(index: number) {
    setPurchaseItems((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleAddExpense(e: FormEvent) {
    e.preventDefault()
    const value = Number(amount)
    if (!value || !description.trim()) return

    const dbIds = unitDbIds[expenseUnit]
    if (!dbIds) {
      setError('Não encontrei essa unidade no banco de dados ainda.')
      return
    }

    const finalCategory = category === 'Outros' ? (categoryOutro.trim() || 'Outros') : category

    const { data, error } = await supabase
      .from('expenses')
      .insert({
        unit_id: dbIds.unitId,
        category: finalCategory,
        description: description.trim(),
        supplier: supplier.trim() || null,
        amount: value,
        due_date: dueDate,
        status: 'a_vencer',
      })
      .select()
      .single()

    if (error) {
      setError('Não foi possível salvar a despesa.')
      return
    }

    if (purchaseItems.length > 0) {
      const results = await Promise.all(
        purchaseItems.map((p) =>
          supabase.rpc('record_stock_purchase', {
            p_expense_id: data.id,
            p_inventory_item_id: p.itemId,
            p_item_name: p.itemName,
            p_quantity: p.quantity,
          }),
        ),
      )
      if (results.some((r: any) => r.error)) {
        setError('A despesa foi salva, mas não deu para atualizar todo o estoque — confira em Estoque.')
      } else {
        setExpenseItemsByExpense((prev) => ({
          ...prev,
          [data.id]: purchaseItems.map((p, i) => ({ id: results[i].data as string, itemName: p.itemName, quantity: p.quantity, inventoryItemId: p.itemId })),
        }))
      }
      await loadPurchaseInventory(expenseUnit)
    }

    setExpenses((prev) => [
      ...prev,
      { id: data.id, unit_id: expenseUnit, category: data.category, description: data.description, supplier: data.supplier, amount: Number(data.amount), due_date: data.due_date, paid_date: data.paid_date, status: data.status, payment_method: data.payment_method, recurring_expense_id: null },
    ])
    setDescription('')
    setSupplier('')
    setAmount('')
    setCategoryOutro('')
    setPurchaseItems([])
    await loadAggregates()
  }

  function handleRemove(id: string) {
    const expense = expenses.find((e) => e.id === id)
    if (!expense) return
    const linkedItems = expenseItemsByExpense[id] ?? []
    setExpenses((prev) => prev.filter((e) => e.id !== id))
    setExpenseItemsByExpense((prev) => {
      const { [id]: _removed, ...rest } = prev
      return rest
    })
    scheduleDelete({
      label: `Despesa "${expense.description}" removida`,
      commit: async () => {
        // Se essa despesa tinha somado item no estoque, desfaz a soma antes de
        // apagar — senão o estoque fica com uma quantidade que na verdade
        // nunca foi comprada de verdade.
        for (const item of linkedItems) {
          await supabase.rpc('undo_stock_purchase', { p_id: item.id })
        }
        await supabase.from('expenses').delete().eq('id', id)
        await loadAggregates()
      },
      undo: async () => {
        await supabase.from('expenses').insert({ ...expense, unit_id: unitDbIds[expense.unit_id]?.unitId })
        const newItems: typeof linkedItems = []
        for (const item of linkedItems) {
          const { data: newId } = await supabase.rpc('record_stock_purchase', {
            p_expense_id: id,
            p_inventory_item_id: item.inventoryItemId,
            p_item_name: item.itemName,
            p_quantity: item.quantity,
          })
          newItems.push({ ...item, id: newId as string })
        }
        setExpenses((prev) => [...prev, expense])
        if (newItems.length > 0) setExpenseItemsByExpense((prev) => ({ ...prev, [id]: newItems }))
        await loadAggregates()
      },
    })
  }

  // Editar e "marcar pago" usam o mesmo modal — marcar como pago exige dizer
  // a forma de pagamento, então em vez de um link que já muda o status na
  // hora, abre o formulário completo com "Pago" pré-selecionado.
  function openEditExpense(expense: Expense, forcedStatus?: PayableStatus) {
    setEditingExpense(expense)
    setEditDescription(expense.description ?? '')
    setEditSupplier(expense.supplier ?? '')
    const isKnownCategory = (EXPENSE_CATEGORIES as readonly string[]).includes(expense.category)
    setEditCategory(isKnownCategory ? expense.category : 'Outros')
    setEditCategoryOutro(isKnownCategory ? '' : expense.category)
    setEditAmount(String(expense.amount))
    setEditDueDate(expense.due_date)
    setEditStatus(forcedStatus ?? expense.status)
    setEditPaymentMethod(expense.payment_method ?? 'pix')
    setEditPaidDate(expense.paid_date ?? new Date().toISOString().slice(0, 10))
  }

  async function handleSaveEditExpense(e: FormEvent) {
    e.preventDefault()
    if (!editingExpense) return
    const value = Number(editAmount)
    if (!value || !editDescription.trim()) return
    const finalCategory = editCategory === 'Outros' ? editCategoryOutro.trim() || 'Outros' : editCategory

    const payload: Record<string, unknown> = {
      description: editDescription.trim(),
      supplier: editSupplier.trim() || null,
      category: finalCategory,
      amount: value,
      due_date: editDueDate,
      status: editStatus,
      payment_method: editStatus === 'pago' ? editPaymentMethod : null,
      paid_date: editStatus === 'pago' ? editPaidDate : null,
    }

    setSavingEditExpense(true)
    const { error } = await supabase.from('expenses').update(payload).eq('id', editingExpense.id)
    setSavingEditExpense(false)
    if (error) {
      setError('Não foi possível salvar as alterações.')
      return
    }

    setExpenses((prev) =>
      prev.map((exp) =>
        exp.id === editingExpense.id
          ? {
              ...exp,
              description: editDescription.trim(),
              supplier: editSupplier.trim() || null,
              category: finalCategory as ExpenseCategory,
              amount: value,
              due_date: editDueDate,
              status: editStatus,
              payment_method: editStatus === 'pago' ? editPaymentMethod : null,
              paid_date: editStatus === 'pago' ? editPaidDate : null,
            }
          : exp,
      ),
    )
    setEditingExpense(null)
    await loadAggregates()
  }

  async function handleAddRecurring(e: FormEvent) {
    e.preventDefault()
    const value = Number(recAmount)
    const day = Math.min(28, Math.max(1, Number(recDay) || 5))
    if (!value || !recDescription.trim()) return

    const dbIds = unitDbIds[recUnit]
    if (!dbIds) {
      setError('Não encontrei essa unidade no banco de dados ainda.')
      return
    }

    const finalRecCategory = recCategory === 'Outros' ? (recCategoryOutro.trim() || 'Outros') : recCategory
    const firstChargeMonth = recComecar === 'proximo_mes' ? `${addMonthsToValue(currentMonthValue(), 1)}-01` : null

    const { data, error } = await supabase
      .from('recurring_expenses')
      .insert({
        unit_id: dbIds.unitId,
        category: finalRecCategory,
        description: recDescription.trim(),
        amount: value,
        day_of_month: day,
        active: true,
        first_charge_month: firstChargeMonth,
      })
      .select()
      .single()

    if (error) {
      setError('Não foi possível salvar a despesa fixa.')
      return
    }

    setRecurring((prev) => [
      ...prev,
      {
        id: data.id,
        unit_id: recUnit,
        category: data.category,
        description: data.description,
        amount: Number(data.amount),
        day_of_month: data.day_of_month,
        active: data.active,
        first_charge_month: data.first_charge_month,
      },
    ])
    setRecDescription('')
    setRecAmount('')
    setRecCategoryOutro('')
    setRecComecar('este_mes')
    // Se já pediu pra valer este mês, gera o lançamento pendente na hora —
    // senão só apareceria depois de recarregar o Painel/Financeiro.
    if (!firstChargeMonth) await supabase.rpc('ensure_recurring_expenses_current_month')
    await loadAll()
  }

  async function toggleRecurring(id: string) {
    const current = recurring.find((r) => r.id === id)
    if (!current) return
    setRecurring((prev) => prev.map((r) => (r.id === id ? { ...r, active: !r.active } : r)))
    await supabase.from('recurring_expenses').update({ active: !current.active }).eq('id', id)
    await loadAggregates()
  }

  function handleRemoveRecurring(id: string) {
    const rec = recurring.find((r) => r.id === id)
    if (!rec) return
    setRecurring((prev) => prev.filter((r) => r.id !== id))
    scheduleDelete({
      label: `Despesa fixa "${rec.description}" removida`,
      commit: async () => {
        await supabase.from('recurring_expenses').delete().eq('id', id)
        await loadAggregates()
      },
      undo: async () => {
        await supabase.from('recurring_expenses').insert({ ...rec, unit_id: unitDbIds[rec.unit_id]?.unitId })
        setRecurring((prev) => [...prev, rec])
        await loadAggregates()
      },
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Financeiro</h1>
        <p className="text-sm text-muted mt-1">Contas a pagar, despesas fixas e fluxo de caixa do mês — sempre por unidade, já que são contas bancárias diferentes</p>
      </div>

      {error && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5">{error}</div>}

      {visibleUnitSlugs.map((slug) => {
        const s = summaryByUnit[slug]
        const unitName = UNITS.find((u) => u.id === slug)?.name ?? slug
        if (!s) return null
        return (
          <div key={slug} className="space-y-4">
            {selectedUnit === 'todas' && <p className="text-sm font-display font-semibold">{unitName}</p>}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <p className="text-xs text-muted">Entradas do mês</p>
                <p className="text-xl font-display font-semibold mt-1 text-teal">{currency(s.entradas)}</p>
              </Card>
              <Card>
                <p className="text-xs text-muted">A pagar (a vencer)</p>
                <p className="text-xl font-display font-semibold mt-1 text-amber">{currency(s.aPagar)}</p>
              </Card>
              <Card className={s.atrasado > 0 ? 'border-danger' : ''}>
                <p className="text-xs text-muted">Atrasado</p>
                <p className={`text-xl font-display font-semibold mt-1 ${s.atrasado > 0 ? 'text-danger' : ''}`}>{currency(s.atrasado)}</p>
              </Card>
              <Card className={s.saldo >= 0 ? 'border-teal' : 'border-danger'}>
                <p className="text-xs text-muted">Saldo do mês</p>
                <p className={`text-xl font-display font-semibold mt-1 ${s.saldo >= 0 ? 'text-teal' : 'text-danger'}`}>{currency(s.saldo)}</p>
              </Card>
            </div>
          </div>
        )
      })}

      {fluxoResumo && (
        <>
          <Card title="Fluxo de caixa futuro (projeção)" action={<TrendingUp className="w-4 h-4 text-purple" />}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>Saldo do mês {currency(fluxoResumo.saldo)}</span>
              <span className="text-muted">+</span>
              <span className="text-teal">Recebimentos previstos {currency(fluxoResumo.recebimentosPrevistos)}</span>
              <span className="text-muted">−</span>
              <span className="text-danger">Contas a pagar {currency(fluxoResumo.aPagar + fluxoResumo.atrasado)}</span>
              <span className="text-muted">=</span>
              <span className={`font-display font-semibold text-base ${fluxoResumo.saldoProjetado >= 0 ? 'text-teal' : 'text-danger'}`}>
                Saldo projetado {currency(fluxoResumo.saldoProjetado)}
              </span>
            </div>
          </Card>

          <Card title={selectedUnit === 'todas' ? 'Fluxo de caixa — últimos 6 meses (Vila Operária + São Vicente)' : 'Fluxo de caixa — últimos 6 meses'}>
            <p className="text-xs text-muted mb-2">Clique numa barra de Entradas ou Saídas pra ver o detalhe daquele mês.</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={fluxoChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2DBEE" vertical={false} />
                <XAxis dataKey="mes" tick={{ fontSize: 12, fill: '#6E6880' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#6E6880' }} axisLine={false} tickLine={false} width={40} />
                <Tooltip formatter={(value: number) => currency(value)} contentStyle={{ borderRadius: 8, borderColor: '#E2DBEE', fontSize: 13 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar
                  dataKey="entradas"
                  name="Entradas"
                  fill="#1F7A5C"
                  radius={[4, 4, 0, 0]}
                  cursor="pointer"
                  onClick={(barData: any) => {
                    const row = barData.payload ?? barData
                    openFluxoDetalhe(selectedUnit, row.mesValue, row.mes, 'entradas')
                  }}
                />
                <Bar
                  dataKey="saidas"
                  name="Saídas"
                  fill="#B23A3A"
                  radius={[4, 4, 0, 0]}
                  cursor="pointer"
                  onClick={(barData: any) => {
                    const row = barData.payload ?? barData
                    openFluxoDetalhe(selectedUnit, row.mesValue, row.mes, 'saidas')
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </>
      )}

      <Card
        title="Despesas fixas (recorrentes)"
        action={<span className="text-xs text-muted flex items-center gap-1"><Repeat className="w-3 h-3" /> viram pendente sozinhas todo dia 1º</span>}
      >
        {loading ? (
          <p className="text-sm text-muted py-4 text-center">Carregando...</p>
        ) : (
          <table className="w-full text-sm mb-4">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                {selectedUnit === 'todas' && <th className="pb-3 font-medium">Unidade</th>}
                <th className="pb-3 font-medium">Categoria</th>
                <th className="pb-3 font-medium">Descrição</th>
                <th className="pb-3 font-medium">Valor</th>
                <th className="pb-3 font-medium">Vencimento</th>
                <th className="pb-3 font-medium">Status deste mês</th>
                <th className="pb-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filteredRecurring.map((r) => {
                const instancia = currentExpenseByRecurringId[r.id]
                return (
                <tr key={r.id} className={r.active ? '' : 'opacity-50'}>
                  {selectedUnit === 'todas' && <td className="py-2.5 text-muted">{UNITS.find((u) => u.id === r.unit_id)?.name}</td>}
                  <td className="py-2.5">{r.category}</td>
                  <td className="py-2.5 font-medium">{r.description}</td>
                  <td className="py-2.5">{currency(r.amount)}</td>
                  <td className="py-2.5 text-muted">
                    {instancia ? new Date(instancia.due_date + 'T00:00:00').toLocaleDateString('pt-BR') : `dia ${r.day_of_month}`}
                  </td>
                  <td className="py-2.5">
                    {!r.active ? (
                      <Badge tone="neutral">Pausada</Badge>
                    ) : instancia ? (
                      <Badge tone={statusTone[instancia.status]}>{statusLabel[instancia.status]}</Badge>
                    ) : r.first_charge_month && r.first_charge_month > `${currentMonthValue()}-01` ? (
                      <Badge tone="neutral">Começa em {new Date(r.first_charge_month + 'T00:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</Badge>
                    ) : (
                      <Badge tone="neutral">—</Badge>
                    )}
                  </td>
                  <td className="py-2.5 text-right">
                    <Can permission="action:financeiro.despesas_fixas">
                      <div className="flex items-center justify-end gap-3">
                        {instancia && instancia.status !== 'pago' && (
                          <button onClick={() => openEditExpense(instancia, 'pago')} className="text-purple text-xs font-medium">
                            Marcar pago
                          </button>
                        )}
                        <button onClick={() => toggleRecurring(r.id)} className="text-muted hover:text-ink" aria-label={r.active ? 'Pausar' : 'Ativar'}>
                          {r.active ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                        </button>
                        <button onClick={() => handleRemoveRecurring(r.id)} className="text-muted hover:text-danger" aria-label="Remover despesa fixa">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </Can>
                  </td>
                </tr>
                )
              })}
              {filteredRecurring.length === 0 && (
                <tr>
                  <td colSpan={selectedUnit === 'todas' ? 7 : 6} className="py-4 text-center text-muted">
                    Nenhuma despesa fixa cadastrada.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        <Can permission="action:financeiro.despesas_fixas">
          <form onSubmit={handleAddRecurring} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <select value={recUnit} onChange={(e) => setRecUnit(e.target.value)} className="border border-line rounded-lg px-3 py-2 text-sm">
              {UNITS.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            <select value={recCategory} onChange={(e) => setRecCategory(e.target.value as ExpenseCategory)} className="border border-line rounded-lg px-3 py-2 text-sm">
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {recCategory === 'Outros' && (
              <input
                type="text"
                value={recCategoryOutro}
                onChange={(e) => setRecCategoryOutro(e.target.value)}
                placeholder="Qual categoria?"
                className="border border-line rounded-lg px-3 py-2 text-sm"
              />
            )}
            <input
              type="text"
              value={recDescription}
              onChange={(e) => setRecDescription(e.target.value)}
              placeholder="Descrição (ex: Aluguel)"
              className="border border-line rounded-lg px-3 py-2 text-sm"
            />
            <input
              type="number"
              value={recAmount}
              onChange={(e) => setRecAmount(e.target.value)}
              placeholder="Valor mensal"
              className="border border-line rounded-lg px-3 py-2 text-sm"
            />
            <select
              value={recComecar}
              onChange={(e) => setRecComecar(e.target.value as 'este_mes' | 'proximo_mes')}
              className="border border-line rounded-lg px-3 py-2 text-sm"
            >
              <option value="este_mes">Já descontar este mês</option>
              <option value="proximo_mes">Começar só mês que vem</option>
            </select>
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                max={28}
                value={recDay}
                onChange={(e) => setRecDay(e.target.value)}
                placeholder="Dia"
                className="w-20 border border-line rounded-lg px-3 py-2 text-sm"
              />
              <Button type="submit" className="flex-1 justify-center">
                <Plus className="w-4 h-4" /> Adicionar
              </Button>
            </div>
          </form>
        </Can>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Can permission="action:financeiro.registrar_despesa">
        <Card title="Registrar conta a pagar" className="lg:col-span-2">
          <form onSubmit={handleAddExpense} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted mb-1">Unidade</label>
              <select
                value={expenseUnit}
                onChange={(e) => setExpenseUnit(e.target.value)}
                className="w-full border border-line rounded-lg px-3 py-2 text-sm"
              >
                {UNITS.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Categoria</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                className="w-full border border-line rounded-lg px-3 py-2 text-sm"
              >
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              {category === 'Outros' && (
                <input
                  type="text"
                  value={categoryOutro}
                  onChange={(e) => setCategoryOutro(e.target.value)}
                  placeholder="Qual categoria?"
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm mt-2"
                />
              )}
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-muted mb-1">Descrição</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex: Conta de luz, material de limpeza..."
                className="w-full border border-line rounded-lg px-3 py-2 text-sm"
              />
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
            <div>
              <label className="block text-xs text-muted mb-1">Vencimento</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full border border-line rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Valor</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0,00"
                className="w-full border border-line rounded-lg px-3 py-2 text-sm"
              />
            </div>

            <div className="sm:col-span-2 pt-2 border-t border-line">
              <p className="text-xs text-muted mb-2">
                Comprou insumo pro estoque? Especifica o item e a quantidade — soma sozinho no estoque de {UNITS.find((u) => u.id === expenseUnit)?.name}.
              </p>
              {purchaseItems.length > 0 && (
                <ul className="mb-2 space-y-1">
                  {purchaseItems.map((p, index) => (
                    <li key={`${p.itemId}-${index}`} className="flex items-center justify-between text-xs bg-paper rounded-lg px-3 py-1.5">
                      {p.itemName}
                      <button type="button" onClick={() => removePurchaseItem(index)} className="text-muted hover:text-danger">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {purchaseInventory.length > 0 ? (
                <div className="space-y-1.5">
                  <div className="flex flex-wrap gap-2">
                    <select
                      value={purchaseItemId}
                      onChange={(e) => {
                        setPurchaseItemId(e.target.value)
                        setPurchaseItemVariantId('')
                        setPurchaseItemQty('')
                      }}
                      className="flex-1 min-w-[140px] border border-line rounded-lg px-3 py-1.5 text-sm"
                    >
                      <option value="">Escolha um item...</option>
                      {purchaseInventory.map((i) => (
                        <option key={i.id} value={i.id}>{i.name} (tem {i.quantity} {i.unitOfMeasure})</option>
                      ))}
                    </select>
                    {(purchaseVariants[purchaseItemId]?.length ?? 0) > 0 ? (
                      <>
                        <select
                          value={purchaseItemVariantId}
                          onChange={(e) => setPurchaseItemVariantId(e.target.value)}
                          className="border border-line rounded-lg px-3 py-1.5 text-sm"
                        >
                          <option value="">Tamanho...</option>
                          {purchaseVariants[purchaseItemId].map((v) => (
                            <option key={v.id} value={v.id}>{v.label}</option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min={0}
                          value={purchaseItemQty}
                          onChange={(e) => setPurchaseItemQty(e.target.value)}
                          placeholder="Quantas garrafas"
                          className="w-36 border border-line rounded-lg px-3 py-1.5 text-sm"
                        />
                      </>
                    ) : (
                      <input
                        type="number"
                        min={0}
                        value={purchaseItemQty}
                        onChange={(e) => setPurchaseItemQty(e.target.value)}
                        placeholder="Qtd"
                        className="w-24 border border-line rounded-lg px-3 py-1.5 text-sm"
                      />
                    )}
                    <Button type="button" variant="secondary" className="text-xs px-3 py-1.5" onClick={addPurchaseItem}>
                      <Plus className="w-3.5 h-3.5" /> Adicionar item
                    </Button>
                  </div>
                  {purchaseItemVariantId && purchaseItemQty && (
                    <p className="text-xs text-muted">
                      = {(
                        Number(purchaseItemQty) * (purchaseVariants[purchaseItemId]?.find((v) => v.id === purchaseItemVariantId)?.volumeAmount ?? 0)
                      ).toLocaleString('pt-BR')}{' '}
                      {purchaseInventory.find((i) => i.id === purchaseItemId)?.unitOfMeasure} no estoque
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted">Nenhum item cadastrado no estoque desta unidade ainda.</p>
              )}
            </div>

            <div className="sm:col-span-2 flex items-end">
              <Button type="submit" className="w-full justify-center">
                <Plus className="w-4 h-4" /> Adicionar conta
              </Button>
            </div>
          </form>
          <p className="text-xs text-muted mt-3">
            Use esta área para gastos gerais do negócio. Custos de uma festa específica (buffet, decoração, DJ) ficam
            em "Lucro por festa", não aqui.
          </p>
        </Card>
        </Can>

        <Card title="Despesas por categoria">
          {porCategoria.length === 0 ? (
            <p className="text-sm text-muted">Nenhuma despesa neste período.</p>
          ) : (
            <div className="space-y-3">
              {porCategoria.map(([cat, total]) => (
                <div key={cat}>
                  <div className="flex justify-between text-sm mb-1">
                    <span>{cat}</span>
                    <span className="font-medium">{currency(total)}</span>
                  </div>
                  <div className="h-1.5 bg-paper rounded-full overflow-hidden">
                    <div className="h-full bg-danger rounded-full" style={{ width: `${(total / totalDespesasGeral) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Contas a pagar lançadas">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-line">
              {selectedUnit === 'todas' && <th className="pb-3 font-medium">Unidade</th>}
              <th className="pb-3 font-medium">Vencimento</th>
              <th className="pb-3 font-medium">Categoria</th>
              <th className="pb-3 font-medium">Descrição</th>
              <th className="pb-3 font-medium">Fornecedor</th>
              <th className="pb-3 font-medium">Valor</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {filteredExpenses.map((e) => (
              <tr key={e.id}>
                {selectedUnit === 'todas' && <td className="py-3 text-muted">{UNITS.find((u) => u.id === e.unit_id)?.name}</td>}
                <td className="py-3 text-muted">{new Date(e.due_date + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                <td className="py-3">{e.category}</td>
                <td className="py-3 font-medium">
                  {e.description}
                  {expenseItemsByExpense[e.id] && expenseItemsByExpense[e.id].length > 0 && (
                    <p className="text-xs text-muted font-normal">
                      Estoque: {expenseItemsByExpense[e.id].map((it) => (it.itemName.includes('—') ? it.itemName : `${it.quantity}x ${it.itemName}`)).join(', ')}
                    </p>
                  )}
                </td>
                <td className="py-3 text-muted">{e.supplier ?? '—'}</td>
                <td className="py-3">{currency(e.amount)}</td>
                <td className="py-3">
                  <Badge tone={statusTone[e.status]}>{statusLabel[e.status]}</Badge>
                  {e.status === 'pago' && e.payment_method && (
                    <p className="text-xs text-muted mt-0.5">{PAYMENT_METHOD_LABEL[e.payment_method]}</p>
                  )}
                </td>
                <td className="py-3 text-right">
                  <div className="flex items-center justify-end gap-3">
                    {e.status !== 'pago' && (
                      <Can permission="action:financeiro.marcar_pago">
                        <button onClick={() => openEditExpense(e, 'pago')} className="text-purple text-xs font-medium">
                          Marcar pago
                        </button>
                      </Can>
                    )}
                    <Can permission="action:financeiro.registrar_despesa">
                      <button onClick={() => openEditExpense(e)} className="text-muted hover:text-purple" aria-label="Editar despesa">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </Can>
                    <Can permission="action:financeiro.remover">
                      <button onClick={() => handleRemove(e.id)} className="text-muted hover:text-danger" aria-label="Remover despesa">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </Can>
                  </div>
                </td>
              </tr>
            ))}
            {filteredExpenses.length === 0 && (
              <tr>
                <td colSpan={selectedUnit === 'todas' ? 8 : 7} className="py-6 text-center text-muted">
                  Nenhuma conta a pagar lançada ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {fluxoDetalhe && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setFluxoDetalhe(null)} />
          <div className="relative w-full max-w-md bg-surface rounded-card p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-display font-semibold">
                {fluxoDetalhe.tipo === 'entradas' ? 'Entradas' : 'Saídas'} — {fluxoDetalhe.mesLabel}
              </h2>
              <button onClick={() => setFluxoDetalhe(null)} className="text-muted hover:text-ink">
                <X className="w-5 h-5" />
              </button>
            </div>

            {fluxoDetalhe.loading ? (
              <p className="text-sm text-muted py-6 text-center">Carregando...</p>
            ) : fluxoDetalhe.tipo === 'entradas' ? (
              <div>
                {fluxoDetalhe.entradas.length === 0 ? (
                  <p className="text-sm text-muted py-4 text-center">Nenhum pagamento recebido neste mês.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {fluxoDetalhe.entradas.map((p, i) => (
                      <li key={i} className="py-2.5 flex items-center justify-between gap-3 text-sm">
                        <div>
                          <p className="font-medium">{p.cliente}</p>
                          <p className="text-xs text-muted">
                            {p.data}{p.metodo ? ` · ${PAYMENT_METHOD_LABEL[p.metodo as PaymentMethod] ?? p.metodo}` : ''}
                          </p>
                        </div>
                        <span className="font-medium text-teal">{currency(p.valor)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex items-center justify-between pt-3 mt-2 border-t border-line text-sm font-medium">
                  <span>Total</span>
                  <span className="text-teal">{currency(fluxoDetalhe.entradas.reduce((s, p) => s + p.valor, 0))}</span>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {fluxoDetalhe.despesasPagas.length === 0 && fluxoDetalhe.custosFesta.length === 0 ? (
                  <p className="text-sm text-muted py-4 text-center">Nenhuma saída neste mês.</p>
                ) : (
                  <>
                    {fluxoDetalhe.despesasPagas.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="text-xs text-muted font-medium">Despesas gerais pagas</p>
                          <p className="text-xs text-danger font-medium">{currency(fluxoDetalhe.despesasPagas.reduce((s, d) => s + d.valor, 0))}</p>
                        </div>
                        <ul className="divide-y divide-line">
                          {fluxoDetalhe.despesasPagas.map((d, i) => (
                            <li key={i} className="py-2 flex items-center justify-between text-sm">
                              <span>{d.descricao}</span>
                              <span className="text-danger">{currency(d.valor)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {fluxoDetalhe.custosFesta.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="text-xs text-muted font-medium">Custos de festas do mês</p>
                          <p className="text-xs text-danger font-medium">{currency(fluxoDetalhe.custosFesta.reduce((s, c) => s + c.valor, 0))}</p>
                        </div>
                        <ul className="divide-y divide-line">
                          {fluxoDetalhe.custosFesta.map((c, i) => (
                            <li key={i} className="py-2 flex items-center justify-between text-sm">
                              <span>{c.descricao} <span className="text-muted">({c.cliente})</span></span>
                              <span className="text-danger">{currency(c.valor)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="flex items-center justify-between pt-3 border-t border-line text-sm font-medium">
                      <span>Total</span>
                      <span className="text-danger">
                        {currency(
                          fluxoDetalhe.despesasPagas.reduce((s, d) => s + d.valor, 0) +
                            fluxoDetalhe.custosFesta.reduce((s, c) => s + c.valor, 0),
                        )}
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {editingExpense && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setEditingExpense(null)} />
          <div className="relative w-full max-w-md bg-surface rounded-card p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-display font-semibold">Editar conta a pagar</h2>
              <button onClick={() => setEditingExpense(null)} className="text-muted hover:text-ink">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveEditExpense} className="space-y-3">
              <div>
                <label className="block text-xs text-muted mb-1">Descrição</label>
                <input
                  type="text"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                />
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted mb-1">Categoria</label>
                  <select
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value as ExpenseCategory)}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                  >
                    {EXPENSE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  {editCategory === 'Outros' && (
                    <input
                      type="text"
                      value={editCategoryOutro}
                      onChange={(e) => setEditCategoryOutro(e.target.value)}
                      placeholder="Qual categoria?"
                      className="w-full border border-line rounded-lg px-3 py-2 text-sm mt-2"
                    />
                  )}
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Valor</label>
                  <input
                    type="number"
                    value={editAmount}
                    onChange={(e) => setEditAmount(e.target.value)}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted mb-1">Vencimento</label>
                  <input
                    type="date"
                    value={editDueDate}
                    onChange={(e) => setEditDueDate(e.target.value)}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Status</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as PayableStatus)}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                  >
                    {(Object.keys(statusLabel) as PayableStatus[]).map((s) => (
                      <option key={s} value={s}>{statusLabel[s]}</option>
                    ))}
                  </select>
                </div>
              </div>
              {editStatus === 'pago' && (
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-line">
                  <div>
                    <label className="block text-xs text-muted mb-1">Forma de pagamento</label>
                    <select
                      value={editPaymentMethod}
                      onChange={(e) => setEditPaymentMethod(e.target.value as PaymentMethod)}
                      className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                    >
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-muted mb-1">Data do pagamento</label>
                    <input
                      type="date"
                      value={editPaidDate}
                      onChange={(e) => setEditPaidDate(e.target.value)}
                      className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              )}
              <Button type="submit" className="w-full justify-center mt-2" disabled={savingEditExpense}>
                {savingEditExpense ? 'Salvando...' : 'Salvar alterações'}
              </Button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
