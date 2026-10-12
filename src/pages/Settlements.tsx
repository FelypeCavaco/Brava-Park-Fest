import { FormEvent, useEffect, useMemo, useState } from 'react'
import { ArrowRight, X } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Can } from '../components/Can'
import { useUnit, UNITS } from '../lib/UnitContext'
import { supabase } from '../lib/supabaseClient'
import { brl, qtd, todayIso, friendlyDbError } from '../lib/format'
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type PaymentMethod } from '../types'

// Acertos entre unidades: quando uma unidade manda estoque para a outra, a
// que recebe "compra" pelo custo. A transferência cria o acerto pendente; ao
// confirmar o envio do dinheiro, o banco cria juntos a saída (quem pagou) e a
// entrada (quem recebeu) — uma única vez, e só mudam por aqui.

type Status = 'pendente' | 'pago' | 'cancelado' | 'sem_valor'

const STATUS_LABEL: Record<Status, string> = { pendente: 'Pendente', pago: 'Pago', cancelado: 'Cancelado', sem_valor: 'Sem valor' }
const STATUS_TONE: Record<Status, 'amber' | 'teal' | 'neutral'> = { pendente: 'amber', pago: 'teal', cancelado: 'neutral', sem_valor: 'neutral' }

interface Settlement {
  id: string
  numero: number
  fromSlug: string
  toSlug: string
  itemName: string
  quantity: number
  unitOfMeasure: string | null
  unitCost: number | null
  amount: number
  status: Status
  transferDate: string
  createdByName: string | null
  batchId: string | null
  paidDate: string | null
  dueDate: string | null
  paymentMethod: string | null
  confirmedByName: string | null
  cancelReason: string | null
  cancelledByName: string | null
}

const unitName = (slug: string) => UNITS.find((u) => u.id === slug)?.name ?? slug
const fmtDate = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—')

export function Settlements() {
  const { selectedUnit, unitDbIds, unitDbIdsLoading } = useUnit()
  const [rows, setRows] = useState<Settlement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<Status | 'todos'>('pendente')
  const [selected, setSelected] = useState<string[]>([])

  const [confirming, setConfirming] = useState(false)
  const [paidDate, setPaidDate] = useState(todayIso())
  const [method, setMethod] = useState<PaymentMethod>('pix')
  const [processing, setProcessing] = useState(false)

  const [cancelling, setCancelling] = useState<Settlement | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [undoing, setUndoing] = useState<string | null>(null)

  useEffect(() => {
    if (!unitDbIdsLoading) load()
  }, [unitDbIdsLoading, unitDbIds])

  async function load() {
    setLoading(true)
    const slugById: Record<string, string> = {}
    for (const slug of Object.keys(unitDbIds)) slugById[unitDbIds[slug].unitId] = slug
    const { data, error: err } = await supabase.from('unit_settlements').select('*').order('numero', { ascending: false })
    if (err) setError('Não foi possível carregar os acertos.')
    setRows(
      (data ?? []).map((r) => ({
        id: r.id,
        numero: Number(r.numero),
        fromSlug: slugById[r.from_unit_id] ?? '',
        toSlug: slugById[r.to_unit_id] ?? '',
        itemName: r.item_name,
        quantity: Number(r.quantity),
        unitOfMeasure: r.unit_of_measure,
        unitCost: r.unit_cost != null ? Number(r.unit_cost) : null,
        amount: Number(r.amount),
        status: r.status,
        transferDate: r.transfer_date,
        createdByName: r.created_by_name,
        batchId: r.batch_id,
        paidDate: r.paid_date,
        dueDate: r.due_date ?? null,
        paymentMethod: r.payment_method,
        confirmedByName: r.confirmed_by_name,
        cancelReason: r.cancel_reason,
        cancelledByName: r.cancelled_by_name,
      })),
    )
    setSelected([])
    setLoading(false)
  }

  const visible = useMemo(
    () =>
      rows
        .filter((r) => selectedUnit === 'todas' || r.fromSlug === selectedUnit || r.toSlug === selectedUnit)
        .filter((r) => statusFilter === 'todos' || r.status === statusFilter),
    [rows, selectedUnit, statusFilter],
  )

  // Total pendente por direção (quem paga → quem recebe).
  const pendentesPorDirecao = useMemo(() => {
    const map = new Map<string, { from: string; to: string; total: number; count: number }>()
    for (const r of rows) {
      if (r.status !== 'pendente') continue
      if (selectedUnit !== 'todas' && r.fromSlug !== selectedUnit && r.toSlug !== selectedUnit) continue
      const k = `${r.toSlug}>${r.fromSlug}`
      const cur = map.get(k) ?? { from: r.toSlug, to: r.fromSlug, total: 0, count: 0 }
      cur.total += r.amount
      cur.count += 1
      map.set(k, cur)
    }
    return Array.from(map.values())
  }, [rows, selectedUnit])

  const selectedRows = rows.filter((r) => selected.includes(r.id))
  const selectedTotal = selectedRows.reduce((s, r) => s + r.amount, 0)
  const mixedDirections = new Set(selectedRows.map((r) => `${r.fromSlug}>${r.toSlug}`)).size > 1

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function handleConfirm(e: FormEvent) {
    e.preventDefault()
    if (processing || selectedRows.length === 0 || mixedDirections) return
    setProcessing(true)
    const { error: rpcError } = await supabase.rpc('confirm_settlements', { p_ids: selected, p_paid_date: paidDate, p_payment_method: method })
    setProcessing(false)
    if (rpcError) {
      setError(friendlyDbError(rpcError.message))
      setConfirming(false)
      await load()
      return
    }
    const r = selectedRows[0]
    setNotice(`Acerto confirmado: saída de ${brl(selectedTotal)} em ${unitName(r.toSlug)} e entrada de ${brl(selectedTotal)} em ${unitName(r.fromSlug)}.`)
    setConfirming(false)
    await load()
  }

  async function handleCancel(e: FormEvent) {
    e.preventDefault()
    if (!cancelling || !cancelReason.trim()) return
    const { error: rpcError } = await supabase.rpc('cancel_settlement', { p_id: cancelling.id, p_reason: cancelReason.trim() })
    if (rpcError) setError(friendlyDbError(rpcError.message))
    else setNotice(`Acerto nº ${cancelling.numero} cancelado. A transferência de estoque continua valendo; só a cobrança foi anulada.`)
    setCancelling(null)
    setCancelReason('')
    await load()
  }

  async function handleUndo(batchId: string) {
    // Acertos antigos (confirmados em lote) usam a função de lote; os novos, a conta do próprio acerto.
    const row = rows.find((x) => x.id === batchId || x.batchId === batchId)
    const { error: rpcError } = row?.batchId
      ? await supabase.rpc('undo_settlement_batch', { p_batch_id: row.batchId })
      : await supabase.rpc('undo_settlement', { p_id: batchId })
    if (rpcError) setError(friendlyDbError(rpcError.message))
    else setNotice('Confirmação desfeita: os dois lançamentos foram removidos e o acerto voltou a Pendente.')
    setUndoing(null)
    await load()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Acertos entre unidades</h1>
        <p className="text-sm text-muted mt-1">Estoque transferido entre Vila Operária e São Vicente: quem recebeu os produtos paga a outra pelo custo, sem margem. Cada transferência já vira conta a pagar no Financeiro de quem recebeu; marcar a conta como paga (lá ou aqui) confirma o acerto e lança o recebimento na outra unidade.</p>
      </div>

      {error && (
        <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5 flex justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Fechar aviso"><X className="w-4 h-4" /></button>
        </div>
      )}
      {notice && (
        <div className="bg-teal-light text-teal text-sm rounded-lg px-4 py-2.5 flex justify-between gap-3">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Fechar aviso"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {pendentesPorDirecao.length === 0 ? (
          <Card><p className="text-sm text-muted">Nenhum acerto pendente.</p></Card>
        ) : (
          pendentesPorDirecao.map((d) => (
            <Card key={`${d.from}>${d.to}`} className="border-amber">
              <p className="text-xs text-muted flex items-center gap-1.5">{unitName(d.from)} <ArrowRight className="w-3 h-3" /> {unitName(d.to)}</p>
              <p className="text-2xl font-display font-semibold mt-1 text-amber">{brl(d.total)}</p>
              <p className="text-xs text-muted mt-0.5">{d.count} acerto(s) pendente(s): {unitName(d.from)} precisa enviar para {unitName(d.to)}</p>
            </Card>
          ))
        )}
      </div>

      <Card
        title="Acertos"
        action={
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as Status | 'todos'); setSelected([]) }} className="border border-line rounded-lg px-2 py-1 text-xs" aria-label="Filtrar por status">
            <option value="pendente">Pendentes</option>
            <option value="pago">Pagos</option>
            <option value="cancelado">Cancelados</option>
            <option value="sem_valor">Sem valor</option>
            <option value="todos">Todos</option>
          </select>
        }
      >
        {selected.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 bg-purple-light rounded-lg px-3 py-2">
            <p className="text-sm text-purple-dark">
              {selected.length} selecionado(s) · {brl(selectedTotal)}
              {mixedDirections && <span className="text-danger"> — misture só acertos com a mesma origem e o mesmo destino</span>}
            </p>
            <Can permission="action:acertos.confirmar">
              <Button onClick={() => { setPaidDate(todayIso()); setConfirming(true) }} disabled={mixedDirections}>Confirmar acerto</Button>
            </Can>
          </div>
        )}
        {loading ? (
          <p className="text-sm text-muted py-4 text-center">Carregando...</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted py-4 text-center">Nenhum acerto neste filtro.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="pb-3 font-medium w-8"></th>
                  <th className="pb-3 font-medium">Nº</th>
                  <th className="pb-3 font-medium">Transferência</th>
                  <th className="pb-3 font-medium">Item</th>
                  <th className="pb-3 font-medium">Valor</th>
                  <th className="pb-3 font-medium">Quem paga → quem recebe</th>
                  <th className="pb-3 font-medium">Status</th>
                  <th className="pb-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visible.map((r) => (
                  <tr key={r.id}>
                    <td className="py-3">
                      {r.status === 'pendente' && (
                        <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} aria-label={`Selecionar acerto nº ${r.numero}`} />
                      )}
                    </td>
                    <td className="py-3 text-muted">{r.numero}</td>
                    <td className="py-3 text-muted">
                      {fmtDate(r.transferDate)}
                      {r.createdByName && <p className="text-[11px]">{r.createdByName}</p>}
                    </td>
                    <td className="py-3">
                      {qtd(r.quantity)} {r.unitOfMeasure} de {r.itemName}
                      {r.unitCost != null && <p className="text-[11px] text-muted">{brl(r.unitCost)} por {r.unitOfMeasure}</p>}
                    </td>
                    <td className="py-3 font-medium">{brl(r.amount)}</td>
                    <td className="py-3">
                      <span className="inline-flex items-center gap-1">{unitName(r.toSlug)} <ArrowRight className="w-3 h-3 text-muted" /> {unitName(r.fromSlug)}</span>
                    </td>
                    <td className="py-3">
                      <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                      {r.status === 'pago' && (
                        <p className="text-[11px] text-muted mt-0.5">{fmtDate(r.paidDate)} · {r.paymentMethod ? PAYMENT_METHOD_LABEL[r.paymentMethod as PaymentMethod] ?? r.paymentMethod : ''}{r.confirmedByName ? ` · ${r.confirmedByName}` : ''}</p>
                      )}
                      {r.status === 'pendente' && r.dueDate && <p className="text-[11px] text-muted mt-0.5">Conta a pagar no Financeiro · vence {fmtDate(r.dueDate)}</p>}
                      {r.status === 'cancelado' && <p className="text-[11px] text-muted mt-0.5">Motivo: {r.cancelReason}{r.cancelledByName ? ` · ${r.cancelledByName}` : ''}</p>}
                    </td>
                    <td className="py-3 text-right whitespace-nowrap">
                      {r.status === 'pendente' && (
                        <Can permission="action:acertos.confirmar">
                          <button onClick={() => { setCancelling(r); setCancelReason('') }} className="text-xs text-muted hover:text-danger">Cancelar</button>
                        </Can>
                      )}
                      {r.status === 'pago' && (
                        <Can permission="action:acertos.desfazer">
                          <button onClick={() => setUndoing(r.batchId ?? r.id)} className="text-xs text-muted hover:text-danger">Desfazer confirmação</button>
                        </Can>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-xs text-muted">Transferência entre CNPJs pode exigir nota fiscal. Confirme o tratamento com o contador.</p>

      {confirming && selectedRows.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => !processing && setConfirming(false)} />
          <div className="relative w-full max-w-md bg-surface rounded-card p-6 shadow-xl">
            <h2 className="text-lg font-display font-semibold mb-1">Confirmar acerto</h2>
            <p className="text-sm text-muted mb-3">
              {unitName(selectedRows[0].toSlug)} enviou <strong className="text-ink">{brl(selectedTotal)}</strong> para {unitName(selectedRows[0].fromSlug)}.
            </p>
            <ul className="text-xs text-muted mb-3 space-y-0.5 max-h-32 overflow-y-auto">
              {selectedRows.map((r) => <li key={r.id}>• Nº {r.numero}: {qtd(r.quantity)} {r.unitOfMeasure} de {r.itemName} — {brl(r.amount)}</li>)}
            </ul>
            <form onSubmit={handleConfirm} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted mb-1">Data do pagamento</label>
                  <input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Forma de pagamento</label>
                  <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className="w-full border border-line rounded-lg px-3 py-2 text-sm">
                    {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>)}
                  </select>
                </div>
              </div>
              <p className="text-xs text-muted">
                As contas a pagar desses acertos em {unitName(selectedRows[0].toSlug)} serão marcadas como pagas, e entra {brl(selectedTotal)} em {unitName(selectedRows[0].fromSlug)} (recuperação de custo, não é faturamento).
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" className="flex-1 justify-center" disabled={processing} onClick={() => setConfirming(false)}>Voltar</Button>
                <Button type="submit" className="flex-1 justify-center" disabled={processing}>{processing ? 'Confirmando...' : 'Confirmar'}</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {cancelling && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setCancelling(null)} />
          <div className="relative w-full max-w-md bg-surface rounded-card p-6 shadow-xl">
            <h2 className="text-lg font-display font-semibold mb-1">Cancelar acerto nº {cancelling.numero}</h2>
            <p className="text-sm text-muted mb-3">A transferência de estoque continua valendo — só a cobrança de {brl(cancelling.amount)} é anulada, e a conta a pagar dela fica cancelada.</p>
            <form onSubmit={handleCancel} className="space-y-3">
              <textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={2} placeholder="Motivo (obrigatório)" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
              <div className="flex gap-2">
                <Button type="button" variant="secondary" className="flex-1 justify-center" onClick={() => setCancelling(null)}>Voltar</Button>
                <Button type="submit" className="flex-1 justify-center" disabled={!cancelReason.trim()}>Cancelar acerto</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {undoing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setUndoing(null)} />
          <div className="relative w-full max-w-md bg-surface rounded-card p-6 shadow-xl">
            <h2 className="text-lg font-display font-semibold mb-1">Desfazer confirmação</h2>
            <p className="text-sm text-muted mb-4">A conta a pagar volta a ficar em aberto, o recebimento da outra unidade é removido e o acerto volta a Pendente.</p>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" className="flex-1 justify-center" onClick={() => setUndoing(null)}>Voltar</Button>
              <Button type="button" className="flex-1 justify-center" onClick={() => handleUndo(undoing)}>Desfazer</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
