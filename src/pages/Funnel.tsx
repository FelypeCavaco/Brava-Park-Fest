import { useEffect, useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { Card } from '../components/ui/Card'
import { supabase } from '../lib/supabaseClient'
import { CLIENT_SOURCE_LABEL } from '../types'

const PIE_COLORS = ['#6D28D9', '#7CB92E', '#F59E0B', '#1F7A5C', '#DC2626', '#6E6880']

const CLOSED_STATUSES = ['confirmada', 'sinal_pago', 'quitada']

interface OrigemRow {
  origem: string
  recebidos: number
  fechados: number
}

export function Funnel() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [recebidos, setRecebidos] = useState(0)
  const [negociacao, setNegociacao] = useState(0)
  const [fechados, setFechados] = useState(0)
  const [porOrigem, setPorOrigem] = useState<OrigemRow[]>([])

  useEffect(() => {
    loadFunnel()
  }, [])

  async function loadFunnel() {
    setLoading(true)
    const [{ data: reservationsData, error: resErr }, { data: clientsData }] = await Promise.all([
      supabase.from('reservations').select('id, status, client_id'),
      supabase.from('clients').select('id, source'),
    ])

    if (resErr) {
      setError('Não foi possível carregar o funil.')
      setLoading(false)
      return
    }

    const reservations = reservationsData ?? []
    setRecebidos(reservations.length)
    setNegociacao(reservations.filter((r) => r.status === 'orcamento').length)
    setFechados(reservations.filter((r) => CLOSED_STATUSES.includes(r.status)).length)

    const closedClientIds = new Set(reservations.filter((r) => CLOSED_STATUSES.includes(r.status)).map((r) => r.client_id))

    const grouped = new Map<string, { recebidos: number; fechados: number }>()
    for (const c of clientsData ?? []) {
      const origem = c.source || 'não informado'
      const entry = grouped.get(origem) ?? { recebidos: 0, fechados: 0 }
      entry.recebidos += 1
      if (closedClientIds.has(c.id)) entry.fechados += 1
      grouped.set(origem, entry)
    }
    setPorOrigem(
      Array.from(grouped.entries())
        .map(([origem, v]) => ({ origem, ...v }))
        .sort((a, b) => b.recebidos - a.recebidos),
    )
    setLoading(false)
  }

  const funil = [
    { etapa: 'Reservas recebidas', valor: recebidos },
    { etapa: 'Em negociação (orçamento)', valor: negociacao },
    { etapa: 'Fechadas', valor: fechados },
  ]
  const taxaGeral = recebidos > 0 ? ((fechados / recebidos) * 100).toFixed(0) : '0'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Funil de conversão</h1>
        <p className="text-sm text-muted mt-1">Do orçamento até a festa fechada</p>
      </div>

      {error && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5">{error}</div>}

      {loading ? (
        <Card><p className="text-sm text-muted py-6 text-center">Carregando...</p></Card>
      ) : (
        <>
          <Card title={`Taxa de conversão geral: ${taxaGeral}%`}>
            <div className="space-y-3">
              {funil.map((f, i) => (
                <div key={f.etapa}>
                  <div className="flex justify-between text-sm mb-1">
                    <span>{f.etapa}</span>
                    <span className="font-medium">{f.valor}</span>
                  </div>
                  <div className="h-2 bg-paper rounded-full overflow-hidden">
                    <div
                      className="h-full bg-purple rounded-full"
                      style={{ width: `${recebidos > 0 ? (f.valor / recebidos) * 100 : 0}%`, opacity: 1 - i * 0.25 }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Conversão por origem do cliente">
            {porOrigem.some((o) => o.fechados > 0) ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                  <Pie
                    data={porOrigem.filter((o) => o.fechados > 0).map((o) => ({ name: CLIENT_SOURCE_LABEL[o.origem] ?? o.origem, value: o.fechados }))}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="45%"
                    outerRadius={70}
                  >
                    {porOrigem
                      .filter((o) => o.fechados > 0)
                      .map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} verticalAlign="bottom" />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted py-6 text-center">Nenhuma festa fechada ainda para mostrar no gráfico.</p>
            )}
            <p className="text-xs text-muted mb-3">Distribuição das festas fechadas por origem do cliente.</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="pb-3 font-medium">Origem</th>
                  <th className="pb-3 font-medium">Clientes</th>
                  <th className="pb-3 font-medium">Fecharam festa</th>
                  <th className="pb-3 font-medium">Taxa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {porOrigem.map((o) => (
                  <tr key={o.origem}>
                    <td className="py-3 font-medium">{CLIENT_SOURCE_LABEL[o.origem] ?? o.origem}</td>
                    <td className="py-3">{o.recebidos}</td>
                    <td className="py-3">{o.fechados}</td>
                    <td className="py-3">{((o.fechados / o.recebidos) * 100 || 0).toFixed(0)}%</td>
                  </tr>
                ))}
                {porOrigem.length === 0 && (
                  <tr><td colSpan={4} className="py-6 text-center text-muted">Nenhum cliente cadastrado ainda.</td></tr>
                )}
              </tbody>
            </table>
            <p className="text-xs text-muted mt-3">
              "Não informado" agrupa clientes cadastrados sem essa pergunta respondida.
            </p>
          </Card>
        </>
      )}
    </div>
  )
}
