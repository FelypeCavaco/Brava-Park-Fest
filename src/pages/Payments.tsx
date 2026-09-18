import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, parseISO, isSameMonth } from 'date-fns'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { useUnit } from '../lib/UnitContext'
import { supabase } from '../lib/supabaseClient'
import { PAYMENT_METHOD_FEE_PERCENT, PAYMENT_METHOD_LABEL, PAYMENT_METHODS, type PaymentMethod } from '../types'

interface MethodBreakdown {
  method: PaymentMethod
  total: number
  feePercent: number
  taxa: number
  liquido: number
}

interface ReservationPaymentRow {
  id: string
  unidade: string
  cliente: string
  data: string
  finalValue: number
  pago: number
  saldo: number
}

function currency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

export function Payments() {
  const { selectedUnit, unitDbIds, unitDbIdsLoading } = useUnit()
  const navigate = useNavigate()
  const [rows, setRows] = useState<ReservationPaymentRow[]>([])
  const [recebidoMes, setRecebidoMes] = useState(0)
  const [taxaCartaoMes, setTaxaCartaoMes] = useState(0)
  const [breakdownMes, setBreakdownMes] = useState<MethodBreakdown[]>([])
  const [feePercentByMethod, setFeePercentByMethod] = useState<Record<string, number>>({ ...PAYMENT_METHOD_FEE_PERCENT })
  const [savingFee, setSavingFee] = useState<PaymentMethod | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!unitDbIdsLoading) loadAll()
  }, [unitDbIdsLoading, unitDbIds])

  async function loadAll() {
    setLoading(true)
    setError(null)

    const dbIdToSlug: Record<string, string> = {}
    for (const slug of Object.keys(unitDbIds)) dbIdToSlug[unitDbIds[slug].unitId] = slug

    const [{ data, error }, { data: feeRows }] = await Promise.all([
      supabase
        .from('reservations')
        .select('id, event_date, final_value, unit_id, client:clients(name), payments(amount, payment_date, payment_method)')
        .neq('status', 'cancelada')
        .order('event_date', { ascending: false }),
      supabase.from('payment_method_fees').select('payment_method, fee_percent'),
    ])

    if (error) {
      setError('Não foi possível carregar os pagamentos.')
      setLoading(false)
      return
    }

    const fees: Record<string, number> = { ...PAYMENT_METHOD_FEE_PERCENT }
    for (const f of feeRows ?? []) fees[f.payment_method] = Number(f.fee_percent)
    setFeePercentByMethod(fees)

    const now = new Date()
    let mesTotal = 0
    let mesTaxa = 0
    const totalByMethod: Record<string, number> = {}

    const mapped: ReservationPaymentRow[] = (data ?? []).map((r: any) => {
      const pagamentos = (r.payments ?? []) as { amount: string | number; payment_date: string; payment_method: PaymentMethod | null }[]
      const pago = pagamentos.reduce((s, p) => s + Number(p.amount), 0)
      for (const p of pagamentos) {
        if (isSameMonth(parseISO(p.payment_date), now)) {
          mesTotal += Number(p.amount)
          const method = p.payment_method ?? 'outro'
          totalByMethod[method] = (totalByMethod[method] ?? 0) + Number(p.amount)
          if (p.payment_method) mesTaxa += (Number(p.amount) * (fees[p.payment_method] ?? 0)) / 100
        }
      }
      return {
        id: r.id,
        unidade: dbIdToSlug[r.unit_id] ?? '',
        cliente: r.client?.name ?? '—',
        data: format(parseISO(r.event_date), 'dd/MM/yyyy'),
        finalValue: Number(r.final_value) || 0,
        pago,
        saldo: (Number(r.final_value) || 0) - pago,
      }
    })

    setRows(mapped)
    setRecebidoMes(mesTotal)
    setTaxaCartaoMes(mesTaxa)
    setBreakdownMes(
      (PAYMENT_METHODS as readonly PaymentMethod[])
        .filter((m) => totalByMethod[m] > 0)
        .map((m) => {
          const total = totalByMethod[m] ?? 0
          const feePercent = fees[m] ?? 0
          const taxa = (total * feePercent) / 100
          return { method: m, total, feePercent, taxa, liquido: total - taxa }
        }),
    )
    setLoading(false)
  }

  async function handleUpdateFee(method: PaymentMethod, value: string) {
    const feePercent = Number(value)
    if (Number.isNaN(feePercent) || feePercent < 0) return
    setSavingFee(method)
    setFeePercentByMethod((prev) => ({ ...prev, [method]: feePercent }))
    await supabase.from('payment_method_fees').upsert({ payment_method: method, fee_percent: feePercent }, { onConflict: 'payment_method' })
    setSavingFee(null)
    loadAll()
  }

  const filtered = useMemo(
    () => (selectedUnit === 'todas' ? rows : rows.filter((r) => r.unidade === selectedUnit)),
    [rows, selectedUnit],
  )

  const totalRecebido = useMemo(() => filtered.reduce((s, r) => s + r.pago, 0), [filtered])
  const totalSaldo = useMemo(() => filtered.reduce((s, r) => s + Math.max(0, r.saldo), 0), [filtered])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Pagamentos</h1>
        <p className="text-sm text-muted mt-1">Todos os pagamentos recebidos e o saldo devedor de cada festa</p>
      </div>

      {error && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5">{error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <p className="text-xs text-muted">Recebido (total)</p>
          <p className="text-lg font-display font-semibold mt-1 text-teal">{currency(totalRecebido)}</p>
        </Card>
        <Card className={totalSaldo > 0 ? 'border-danger' : ''}>
          <p className="text-xs text-muted">Saldo em aberto</p>
          <p className={`text-lg font-display font-semibold mt-1 ${totalSaldo > 0 ? 'text-danger' : ''}`}>{currency(totalSaldo)}</p>
        </Card>
        <Card>
          <p className="text-xs text-muted">Recebido este mês</p>
          <p className="text-lg font-display font-semibold mt-1">{currency(recebidoMes)}</p>
        </Card>
        <Card>
          <p className="text-xs text-muted">Taxa de maquininha (mês)</p>
          <p className="text-lg font-display font-semibold mt-1">{currency(taxaCartaoMes)}</p>
        </Card>
      </div>

      <Card title="Taxas da maquininha — por forma de pagamento (mês atual)">
        <table className="w-full text-sm mb-2">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-line">
              <th className="pb-3 font-medium">Forma</th>
              <th className="pb-3 font-medium">Recebido</th>
              <th className="pb-3 font-medium">Taxa (%)</th>
              <th className="pb-3 font-medium">Valor da taxa</th>
              <th className="pb-3 font-medium">Líquido</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {breakdownMes.map((b) => (
              <tr key={b.method}>
                <td className="py-2.5 font-medium">{PAYMENT_METHOD_LABEL[b.method]}</td>
                <td className="py-2.5">{currency(b.total)}</td>
                <td className="py-2.5">
                  <input
                    type="number"
                    min={0}
                    step="0.1"
                    defaultValue={feePercentByMethod[b.method] ?? 0}
                    onBlur={(e) => handleUpdateFee(b.method, e.target.value)}
                    disabled={savingFee === b.method}
                    className="w-20 border border-line rounded-lg px-2 py-1 text-sm"
                  />
                </td>
                <td className="py-2.5 text-danger">{currency(b.taxa)}</td>
                <td className="py-2.5 font-medium text-teal">{currency(b.liquido)}</td>
              </tr>
            ))}
            {breakdownMes.length === 0 && (
              <tr><td colSpan={5} className="py-4 text-center text-muted">Nenhum pagamento recebido este mês ainda.</td></tr>
            )}
          </tbody>
        </table>
        <p className="text-xs text-muted">
          Ajuste a taxa de cada forma de pagamento aqui (ex: débito e crédito da maquininha) — o valor já entra no
          cálculo do lucro líquido em "Resultado do mês".
        </p>
      </Card>

      <Card title="Pagamentos por festa">
        {loading ? (
          <p className="text-sm text-muted py-6 text-center">Carregando...</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="pb-3 font-medium">Cliente</th>
                <th className="pb-3 font-medium">Evento</th>
                <th className="pb-3 font-medium">Valor firmado</th>
                <th className="pb-3 font-medium">Pago</th>
                <th className="pb-3 font-medium">Saldo</th>
                <th className="pb-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((r) => (
                <tr key={r.id} onClick={() => navigate(`/reservas/${r.id}`)} className="cursor-pointer hover:bg-paper/60 transition-colors">
                  <td className="py-3 font-medium">{r.cliente}</td>
                  <td className="py-3 text-muted">{r.data}</td>
                  <td className="py-3">{currency(r.finalValue)}</td>
                  <td className="py-3 text-teal">{currency(r.pago)}</td>
                  <td className="py-3">
                    {r.saldo > 0.005 ? (
                      <Badge tone="danger">{currency(r.saldo)}</Badge>
                    ) : (
                      <Badge tone="teal">Quitado</Badge>
                    )}
                  </td>
                  <td className="py-3 text-right text-xs text-purple font-medium">Abrir festa →</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="py-6 text-center text-muted">Nenhuma festa encontrada.</td></tr>
              )}
            </tbody>
          </table>
        )}
        <p className="text-xs text-muted mt-3">
          Para registrar um novo pagamento, abra a festa correspondente — não existe mais parcela fixa: cada pagamento
          entra na hora em que acontece, na Central da Festa.
        </p>
      </Card>
    </div>
  )
}
