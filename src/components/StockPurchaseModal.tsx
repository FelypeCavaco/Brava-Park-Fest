import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, X, AlertTriangle } from 'lucide-react'
import { Button } from './ui/Button'
import { supabase } from '../lib/supabaseClient'
import { useUnit, UNITS } from '../lib/UnitContext'
import { brl, qtd, parseDecimal, todayIso, friendlyDbError } from '../lib/format'
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type PaymentMethod } from '../types'

// Entrada de compra de estoque: lançada uma vez só, aqui. Ao salvar, o banco
// soma quantidade e valor no estoque e cria (ou atualiza, na edição) a conta
// a pagar vinculada — tudo numa única operação.

interface StockItemOption {
  id: string
  name: string
  unitOfMeasure: string
}

interface Variant {
  id: string
  label: string
  volumeAmount: number
}

interface Line {
  key: string
  itemId: string
  variantId: string // '' = quantidade direta na unidade do item
  amount: string // quantidade (ou nº de garrafas, se tiver tamanho)
  value: string // valor total desta linha (R$)
}

export interface StockPurchasePrefill {
  itemId: string
  quantity: number
}

interface Props {
  expenseId?: string | null
  defaultUnitSlug: string
  prefill?: StockPurchasePrefill | null
  onClose: () => void
  onSaved: (message: string) => void
}

let lineSeq = 0
const newLine = (itemId = '', amount = ''): Line => ({ key: `l${++lineSeq}`, itemId, variantId: '', amount, value: '' })

export function StockPurchaseModal({ expenseId, defaultUnitSlug, prefill, onClose, onSaved }: Props) {
  const { unitDbIds } = useUnit()
  const editing = !!expenseId

  // No celular, a página de trás rolava junto e a janela "travava" depois de
  // descer: enquanto ela está aberta, a página de trás fica parada.
  useEffect(() => {
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = antes
    }
  }, [])
  const [unitSlug, setUnitSlug] = useState(defaultUnitSlug)
  const [supplier, setSupplier] = useState('')
  const [purchaseDate, setPurchaseDate] = useState(todayIso())
  const [category, setCategory] = useState<string>('Fornecedores')
  const [lines, setLines] = useState<Line[]>([newLine(prefill?.itemId ?? '', prefill ? String(prefill.quantity).replace('.', ',') : '')])
  const [other, setOther] = useState('')
  const [paid, setPaid] = useState(true)
  const [method, setMethod] = useState<PaymentMethod>('pix')
  const [paidDate, setPaidDate] = useState(todayIso())
  const [dueDate, setDueDate] = useState(todayIso())
  const [items, setItems] = useState<StockItemOption[]>([])
  const [variants, setVariants] = useState<Record<string, Variant[]>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsJustification, setNeedsJustification] = useState(false)
  const [justification, setJustification] = useState('')
  const [duplicates, setDuplicates] = useState<{ description: string | null; supplier: string | null; amount: number; due_date: string }[] | null>(null)

  const unitId = unitDbIds[unitSlug]?.unitId

  useEffect(() => {
    if (!unitId) return
    loadItems(unitId)
  }, [unitId])

  useEffect(() => {
    if (expenseId) loadExisting(expenseId)
  }, [expenseId])

  async function loadItems(uId: string) {
    setLoading(true)
    const { data } = await supabase.from('inventory_items').select('id, name, unit_of_measure').eq('unit_id', uId).order('name')
    const list = (data ?? []).map((i) => ({ id: i.id, name: i.name, unitOfMeasure: i.unit_of_measure }))
    setItems(list)
    const map: Record<string, Variant[]> = {}
    if (list.length > 0) {
      const { data: vs } = await supabase
        .from('inventory_purchase_variants')
        .select('id, inventory_item_id, label, volume_amount')
        .in('inventory_item_id', list.map((i) => i.id))
      for (const v of vs ?? []) (map[v.inventory_item_id] ??= []).push({ id: v.id, label: v.label, volumeAmount: Number(v.volume_amount) })
    }
    setVariants(map)
    setLoading(false)
  }

  async function loadExisting(id: string) {
    const [{ data: exp }, { data: its }] = await Promise.all([
      supabase.from('expenses').select('*').eq('id', id).single(),
      supabase.from('expense_items').select('inventory_item_id, quantity, line_value').eq('expense_id', id),
    ])
    if (!exp) return
    const slug = Object.keys(unitDbIds).find((s) => unitDbIds[s].unitId === exp.unit_id)
    if (slug) setUnitSlug(slug)
    setSupplier(exp.supplier ?? '')
    setPurchaseDate(exp.purchase_date ?? exp.due_date)
    setCategory(exp.category)
    setOther(Number(exp.other_items_value) > 0 ? String(exp.other_items_value).replace('.', ',') : '')
    setPaid(exp.status === 'pago')
    if (exp.payment_method) setMethod(exp.payment_method)
    if (exp.paid_date) setPaidDate(exp.paid_date)
    setDueDate(exp.due_date)
    setLines(
      (its ?? [])
        .filter((i) => i.inventory_item_id)
        .map((i) => ({
          ...newLine(i.inventory_item_id as string, String(Number(i.quantity)).replace('.', ',')),
          value: i.line_value != null ? String(Number(i.line_value)).replace('.', ',') : '',
        })),
    )
  }

  // Quantidade que entra no estoque (já convertida pelo tamanho de compra) e custo unitário.
  function lineInfo(l: Line) {
    const item = items.find((i) => i.id === l.itemId)
    const amount = parseDecimal(l.amount) ?? 0
    const variant = (variants[l.itemId] ?? []).find((v) => v.id === l.variantId)
    const quantity = variant ? Math.round(variant.volumeAmount * amount * 1000) / 1000 : amount
    const value = parseDecimal(l.value)
    return { item, quantity, value, variant, unitCost: value != null && quantity > 0 ? value / quantity : null }
  }

  const otherValue = parseDecimal(other) ?? 0
  const total = useMemo(() => lines.reduce((s, l) => s + (lineInfo(l).value ?? 0), 0) + otherValue, [lines, other, items, variants])

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  async function checkDuplicates() {
    if (!unitId) return []
    const month = purchaseDate.slice(0, 7)
    const [y, m] = month.split('-').map(Number)
    const end = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`
    const { data } = await supabase
      .from('expenses')
      .select('id, description, supplier, amount, due_date')
      .eq('unit_id', unitId)
      .gte('due_date', `${month}-01`)
      .lt('due_date', end)
    const sup = supplier.trim().toLowerCase()
    return (data ?? [])
      .filter((e) => e.id !== expenseId)
      .filter((e) => Math.abs(Number(e.amount) - total) < 0.01 || (sup.length > 2 && ((e.supplier ?? '').toLowerCase().includes(sup) || (e.description ?? '').toLowerCase().includes(sup))))
      .map((e) => ({ description: e.description, supplier: e.supplier, amount: Number(e.amount), due_date: e.due_date }))
  }

  async function handleSubmit(e: FormEvent, skipDuplicateCheck = false) {
    e.preventDefault()
    setError(null)
    if (!unitId) return setError('Unidade não encontrada.')
    const payload = []
    for (const l of lines) {
      const info = lineInfo(l)
      if (!info.item) return setError('Escolha o item em todas as linhas (ou remova a linha vazia).')
      if (!(info.quantity > 0)) return setError(`Informe a quantidade de "${info.item.name}".`)
      if (info.value != null && info.value <= 0) return setError(`O valor de "${info.item.name}" precisa ser maior que zero (ou deixe em branco).`)
      payload.push({
        inventory_item_id: info.item.id,
        item_name: info.variant ? `${info.item.name} — ${qtd(parseDecimal(l.amount) ?? 0)}x ${info.variant.label}` : info.item.name,
        quantity: info.quantity,
        value: info.value,
      })
    }
    if (payload.length === 0) return setError('A compra precisa ter ao menos um item.')
    if (!(total > 0)) return setError('Informe o valor de ao menos um item.')

    if (!skipDuplicateCheck && !editing) {
      const dups = await checkDuplicates()
      if (dups.length > 0) {
        setDuplicates(dups)
        return
      }
    }

    setSaving(true)
    const { error: rpcError } = await supabase.rpc('save_stock_purchase', {
      p_expense_id: expenseId ?? null,
      p_unit_id: unitId,
      p_supplier: supplier.trim() || null,
      p_purchase_date: purchaseDate,
      p_category: category,
      p_paid: paid,
      p_payment_method: paid ? method : null,
      p_paid_date: paid ? paidDate : null,
      p_due_date: paid ? null : dueDate,
      p_other_value: otherValue,
      p_items: payload,
      p_justification: justification.trim() || null,
    })
    setSaving(false)
    if (rpcError) {
      if (rpcError.message.includes('ESTOQUE_NEGATIVO')) setNeedsJustification(true)
      setError(friendlyDbError(rpcError.message))
      return
    }
    onSaved(editing ? 'Compra atualizada — estoque e conta a pagar ajustados.' : `Compra lançada: ${brl(total)} no estoque e no Financeiro.`)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 overflow-y-auto overscroll-contain">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative w-full max-w-3xl bg-surface rounded-card p-6 shadow-xl my-8">
        <div className="flex items-start justify-between mb-1">
          <h2 className="text-lg font-display font-semibold">{editing ? 'Editar compra de estoque' : 'Entrada de compra'}</h2>
          <button onClick={onClose} aria-label="Fechar" className="text-muted hover:text-ink"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-muted mb-4">
          Lance a compra uma vez só: o estoque soma as quantidades e o valor, e a conta a pagar é criada sozinha no Financeiro.
        </p>

        <form onSubmit={(e) => handleSubmit(e)} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-muted mb-1">Unidade</label>
              <select value={unitSlug} disabled={editing} onChange={(e) => { setUnitSlug(e.target.value); setLines([newLine()]) }} className="w-full border border-line rounded-lg px-3 py-2 text-sm disabled:bg-paper">
                {UNITS.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Fornecedor / mercado (opcional)</label>
              <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Ex: Mercado X" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Data da compra</label>
              <input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-muted mb-1">Itens comprados</p>
            <p className="text-[11px] text-muted mb-2">
              Em cada item: a <strong>quantidade na unidade em que ele está cadastrado no estoque</strong> (ex: litros, unidades, pacotes) e o{' '}
              <strong>valor total pago por aquele item</strong> na nota — não o preço por litro ou por unidade. O sistema calcula o custo unitário sozinho.
            </p>
            {loading ? (
              <p className="text-sm text-muted">Carregando itens...</p>
            ) : (
              <div className="space-y-2">
                {lines.map((l) => {
                  const info = lineInfo(l)
                  const vs = variants[l.itemId] ?? []
                  return (
                    <div key={l.key} className="grid grid-cols-12 gap-2 items-start bg-paper/60 rounded-lg p-2">
                      <select value={l.itemId} onChange={(e) => updateLine(l.key, { itemId: e.target.value, variantId: '' })} aria-label="Item" className="col-span-12 sm:col-span-4 sm:mt-[18px] border border-line rounded-lg px-2 py-2 text-sm bg-surface">
                        <option value="">Escolha o item…</option>
                        {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                      </select>
                      {vs.length > 0 ? (
                        <select value={l.variantId} onChange={(e) => updateLine(l.key, { variantId: e.target.value })} aria-label="Tamanho de compra" className="col-span-6 sm:col-span-2 sm:mt-[18px] border border-line rounded-lg px-2 py-2 text-sm bg-surface">
                          <option value="">Em {info.item?.unitOfMeasure ?? 'un'}</option>
                          {vs.map((v) => <option key={v.id} value={v.id}>Garrafa {v.label}</option>)}
                        </select>
                      ) : (
                        <div className="hidden sm:block sm:col-span-2" />
                      )}
                      <div className="col-span-6 sm:col-span-2">
                        <label className="block text-[10px] text-muted mb-0.5">
                          {info.variant ? 'Nº de garrafas' : `Quantidade (${info.item?.unitOfMeasure ?? 'unidade do item'})`}
                        </label>
                        <input value={l.amount} onChange={(e) => updateLine(l.key, { amount: e.target.value })} inputMode="decimal" placeholder={info.variant ? 'Garrafas' : info.item ? `Em ${info.item.unitOfMeasure}` : 'Qtd'} aria-label={info.variant ? 'Número de garrafas' : `Quantidade em ${info.item?.unitOfMeasure ?? 'unidades'}`} className="w-full border border-line rounded-lg px-2 py-2 text-sm" />
                        {info.variant && info.quantity > 0 && <p className="text-[11px] text-muted mt-0.5">= {qtd(info.quantity)} {info.item?.unitOfMeasure} no estoque</p>}
                      </div>
                      <div className="col-span-10 sm:col-span-3">
                        <label className="block text-[10px] text-muted mb-0.5">Valor TOTAL pago por este item (R$)</label>
                        <input value={l.value} onChange={(e) => updateLine(l.key, { value: e.target.value })} inputMode="decimal" placeholder="Ex: 96,00 (total, não por litro)" aria-label="Valor total pago por este item" className="w-full border border-line rounded-lg px-2 py-2 text-sm" />
                        <p className="text-[11px] text-muted mt-0.5">
                          {info.unitCost != null ? `= ${brl(info.unitCost)} por ${info.item?.unitOfMeasure ?? 'un'}` : l.value.trim() === '' && l.itemId ? 'Sem valor: entra sem custo' : ''}
                        </p>
                      </div>
                      <button type="button" onClick={() => setLines((prev) => (prev.length > 1 ? prev.filter((x) => x.key !== l.key) : prev))} aria-label="Remover linha" className="col-span-2 sm:col-span-1 h-9 mt-[18px] flex items-center justify-center text-muted hover:text-danger">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )
                })}
                <button type="button" onClick={() => setLines((prev) => [...prev, newLine()])} className="text-sm text-purple font-medium flex items-center gap-1">
                  <Plus className="w-4 h-4" /> Adicionar item
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div>
              <label className="block text-xs text-muted mb-1">Outros itens da nota, sem estoque (R$)</label>
              <input value={other} onChange={(e) => setOther(e.target.value)} inputMode="decimal" placeholder="Ex: produtos de limpeza" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Categoria da despesa</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm">
                {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="bg-purple-light rounded-lg px-3 py-2">
              <p className="text-xs text-purple-dark">Valor total da compra</p>
              <p className="text-xl font-display font-semibold text-purple-dark">{brl(total)}</p>
            </div>
          </div>

          <div className="border-t border-line pt-3 space-y-3">
            <div className="flex gap-2">
              <button type="button" onClick={() => setPaid(true)} className={`px-3 py-1.5 rounded-lg text-sm border ${paid ? 'bg-purple text-white border-purple' : 'border-line'}`}>Já paguei</button>
              <button type="button" onClick={() => setPaid(false)} className={`px-3 py-1.5 rounded-lg text-sm border ${!paid ? 'bg-purple text-white border-purple' : 'border-line'}`}>Vou pagar depois</button>
            </div>
            {paid ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted mb-1">Forma de pagamento</label>
                  <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className="w-full border border-line rounded-lg px-3 py-2 text-sm">
                    {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Data do pagamento</label>
                  <input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
            ) : (
              <div className="max-w-xs">
                <label className="block text-xs text-muted mb-1">Vencimento</label>
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
              </div>
            )}
          </div>

          {duplicates && (
            <div className="bg-amber-light border border-amber/30 rounded-lg p-3 text-sm">
              <p className="font-medium text-amber flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Já existe conta parecida neste mês</p>
              <ul className="mt-1 text-xs text-ink/80 space-y-0.5">
                {duplicates.map((d, i) => (
                  <li key={i}>• {d.description ?? d.supplier ?? 'Despesa'} — {brl(d.amount)} (venc. {d.due_date.split('-').reverse().join('/')})</li>
                ))}
              </ul>
              <p className="text-xs mt-1">Confira se não é a mesma compra antes de lançar de novo.</p>
              <div className="flex gap-2 mt-2">
                <Button type="button" variant="secondary" onClick={() => setDuplicates(null)}>Voltar</Button>
                <Button type="button" onClick={(e) => { setDuplicates(null); handleSubmit(e as unknown as FormEvent, true) }}>Lançar mesmo assim</Button>
              </div>
            </div>
          )}

          {needsJustification && (
            <div>
              <label className="block text-xs text-muted mb-1">Justificativa (parte dessa compra já foi consumida)</label>
              <textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={2} className="w-full border border-line rounded-lg px-3 py-2 text-sm" placeholder="Ex: quantidade lançada errada na nota" />
            </div>
          )}

          {error && <div className="bg-danger-light text-danger text-sm rounded-lg px-3 py-2">{error}</div>}

          {!duplicates && (
            <div className="flex gap-2 pt-1">
              <Button type="button" variant="secondary" className="flex-1 justify-center" onClick={onClose}>Cancelar</Button>
              <Button type="submit" className="flex-1 justify-center" disabled={saving}>
                {saving ? 'Salvando...' : editing ? 'Salvar alterações' : 'Lançar compra'}
              </Button>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
