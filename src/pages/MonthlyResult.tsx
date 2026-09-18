import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { useUnit, UNITS } from '../lib/UnitContext'
import { currentMonthValue, lastNMonths } from '../lib/monthUtils'
import { loadMonthByUnit, type MonthResult } from '../lib/financeAggregates'

function currency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

export function MonthlyResult() {
  const { selectedUnit, unitDbIds, unitDbIdsLoading } = useUnit()
  const [loading, setLoading] = useState(true)
  const [byUnit, setByUnit] = useState<Record<string, MonthResult>>({})
  const [history, setHistory] = useState<{ mes: string; lucro: number }[]>([])

  const unitIds = selectedUnit === 'todas' ? UNITS.map((u) => u.id) : [selectedUnit]

  useEffect(() => {
    if (!unitDbIdsLoading) loadData()
  }, [unitDbIdsLoading, unitDbIds])

  async function loadData() {
    setLoading(true)
    const unitIdBySlug: Record<string, string> = {}
    for (const u of UNITS) if (unitDbIds[u.id]) unitIdBySlug[u.id] = unitDbIds[u.id].unitId

    const current = await loadMonthByUnit(currentMonthValue(), unitIdBySlug)
    setByUnit(current)

    const months = lastNMonths(6)
    const hist = await Promise.all(
      months.map(async ({ value, label }) => {
        const data = await loadMonthByUnit(value, unitIdBySlug)
        const lucro = Object.values(data).reduce((s, r) => s + (r.receita - r.taxasCartao - r.despesas - r.custos), 0)
        return { mes: label, lucro }
      }),
    )
    setHistory(hist)
    setLoading(false)
  }

  const porUnidade = useMemo(
    () =>
      unitIds.map((id) => {
        const r = byUnit[id] ?? { receita: 0, taxasCartao: 0, despesas: 0, custos: 0 }
        const lucro = r.receita - r.taxasCartao - r.despesas - r.custos
        const margem = r.receita > 0 ? (lucro / r.receita) * 100 : 0
        return {
          id,
          name: UNITS.find((u) => u.id === id)?.name ?? id,
          receita: r.receita,
          taxasCartao: r.taxasCartao,
          despesas: r.despesas,
          custos: r.custos,
          lucro,
          margem,
        }
      }),
    [unitIds, byUnit],
  )

  const totais = porUnidade.reduce(
    (acc, u) => {
      acc.receita += u.receita
      acc.taxasCartao += u.taxasCartao
      acc.despesas += u.despesas
      acc.custos += u.custos
      acc.lucro += u.lucro
      return acc
    },
    { receita: 0, taxasCartao: 0, despesas: 0, custos: 0, lucro: 0 },
  )
  const margemTotal = totais.receita > 0 ? (totais.lucro / totais.receita) * 100 : 0

  const unitLabel = selectedUnit === 'todas' ? 'Ambas as unidades' : UNITS.find((u) => u.id === selectedUnit)?.name

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Resultado do mês</h1>
        <p className="text-sm text-muted mt-1">{unitLabel} · quanto sobrou de verdade, depois de tudo</p>
      </div>

      {loading ? (
        <Card><p className="text-sm text-muted py-6 text-center">Carregando...</p></Card>
      ) : (
        <>
          <Card>
            <div className="grid grid-cols-2 sm:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-line gap-y-3">
              <div className="pb-3 sm:pb-0 sm:pr-4">
                <p className="text-xs text-muted">Receita recebida</p>
                <p className="text-xl font-display font-semibold mt-1">{currency(totais.receita)}</p>
              </div>
              <div className="py-3 sm:py-0 sm:px-4">
                <p className="text-xs text-muted">(−) Taxas de cartão</p>
                <p className="text-xl font-display font-semibold mt-1 text-danger">{currency(totais.taxasCartao)}</p>
              </div>
              <div className="py-3 sm:py-0 sm:px-4">
                <p className="text-xs text-muted">(−) Despesas gerais</p>
                <p className="text-xl font-display font-semibold mt-1 text-danger">{currency(totais.despesas)}</p>
              </div>
              <div className="py-3 sm:py-0 sm:px-4">
                <p className="text-xs text-muted">(−) Custos das festas</p>
                <p className="text-xl font-display font-semibold mt-1 text-danger">{currency(totais.custos)}</p>
              </div>
              <div className="pt-3 sm:pt-0 sm:pl-4">
                <p className="text-xs text-muted">= Lucro líquido</p>
                <p className={`text-xl font-display font-semibold mt-1 ${totais.lucro >= 0 ? 'text-teal' : 'text-danger'}`}>
                  {currency(totais.lucro)}
                </p>
                <p className="text-xs text-muted mt-0.5">margem de {margemTotal.toFixed(0)}%</p>
              </div>
            </div>
          </Card>
          <p className="text-xs text-muted -mt-4">
            Receita = pagamentos recebidos este mês (valor bruto). Como os pagamentos podem chegar antes ou depois da
            festa, esse número não é exatamente "faturamento das festas deste mês" — é o dinheiro que entrou de fato.
            O lucro líquido já desconta a taxa estimada da maquininha de cada pagamento, conforme a forma de pagamento
            (ajustável em Pagamentos).
          </p>

          {selectedUnit === 'todas' && (
            <Card title="Resultado por unidade">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-line">
                    <th className="pb-3 font-medium">Unidade</th>
                    <th className="pb-3 font-medium">Receita</th>
                    <th className="pb-3 font-medium">Taxas de cartão</th>
                    <th className="pb-3 font-medium">Despesas gerais</th>
                    <th className="pb-3 font-medium">Custos de festa</th>
                    <th className="pb-3 font-medium">Lucro líquido</th>
                    <th className="pb-3 font-medium">Margem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {porUnidade.map((u) => (
                    <tr key={u.id}>
                      <td className="py-3 font-medium">{u.name}</td>
                      <td className="py-3">{currency(u.receita)}</td>
                      <td className="py-3 text-danger">{currency(u.taxasCartao)}</td>
                      <td className="py-3 text-danger">{currency(u.despesas)}</td>
                      <td className="py-3 text-danger">{currency(u.custos)}</td>
                      <td className={`py-3 font-medium ${u.lucro >= 0 ? 'text-teal' : 'text-danger'}`}>{currency(u.lucro)}</td>
                      <td className="py-3">
                        <div className="flex items-center gap-1.5">
                          <Badge tone={u.margem >= 25 ? 'teal' : u.margem >= 10 ? 'amber' : 'danger'}>{u.margem.toFixed(0)}%</Badge>
                          {u.margem < 10 && (
                            <span title="Margem baixa">
                              <AlertTriangle className="w-3.5 h-3.5 text-danger" />
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          <Card title="Lucro líquido — últimos 6 meses">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2DBEE" vertical={false} />
                <XAxis dataKey="mes" tick={{ fontSize: 12, fill: '#6E6880' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#6E6880' }} axisLine={false} tickLine={false} width={40} />
                <Tooltip formatter={(value: number) => currency(value)} contentStyle={{ borderRadius: 8, borderColor: '#E2DBEE', fontSize: 13 }} />
                <Line type="monotone" dataKey="lucro" name="Lucro líquido" stroke="#1F7A5C" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        </>
      )}
    </div>
  )
}
