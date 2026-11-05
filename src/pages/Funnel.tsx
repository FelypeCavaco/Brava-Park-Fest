import { useEffect, useMemo, useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { Card } from '../components/ui/Card'
import { supabase } from '../lib/supabaseClient'
import { CLIENT_SOURCE_LABEL } from '../types'
import { PeriodoGrafico, GraficoSerie, usePeriodo } from '../components/PeriodoGrafico'
import { faixasDoPeriodo, descreverPeriodo, indiceDaFaixa, limitesDasFaixas } from '../lib/periodo'

const PIE_COLORS = ['#6D28D9', '#7CB92E', '#F59E0B', '#1F7A5C', '#DC2626', '#6E6880']

const CLOSED_STATUSES = ['confirmada', 'sinal_pago', 'quitada']

interface Reserva { id: string; status: string; client_id: string; created_at: string }

export function Funnel() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reservas, setReservas] = useState<Reserva[]>([])
  const [origemDoCliente, setOrigemDoCliente] = useState<Record<string, string>>({})
  const [clientesPorOrigem, setClientesPorOrigem] = useState<Record<string, number>>({})
  const [clientesFechadosPorOrigem, setClientesFechadosPorOrigem] = useState<Record<string, number>>({})
  const origemP = usePeriodo('funil-origem', 12, 'barras')
  const [visao, setVisao] = useState<'pizza' | 'barras' | 'linhas'>('pizza')

  useEffect(() => {
    loadFunnel()
  }, [])

  async function loadFunnel() {
    setLoading(true)
    const [{ data: reservationsData, error: resErr }, { data: clientsData }] = await Promise.all([
      supabase.from('reservations').select('id, status, client_id, created_at'),
      supabase.from('clients').select('id, source'),
    ])

    if (resErr) {
      setError('Não foi possível carregar o funil.')
      setLoading(false)
      return
    }

    const lista = (reservationsData ?? []) as Reserva[]
    setReservas(lista)
    const origem: Record<string, string> = {}
    const porOrigem: Record<string, number> = {}
    const fechadosPorOrigem: Record<string, number> = {}
    const clientesFechados = new Set(lista.filter((r) => CLOSED_STATUSES.includes(r.status)).map((r) => r.client_id))
    for (const c of clientsData ?? []) {
      const o = c.source || 'não informado'
      origem[c.id] = o
      porOrigem[o] = (porOrigem[o] ?? 0) + 1
      if (clientesFechados.has(c.id)) fechadosPorOrigem[o] = (fechadosPorOrigem[o] ?? 0) + 1
    }
    setOrigemDoCliente(origem)
    setClientesPorOrigem(porOrigem)
    setClientesFechadosPorOrigem(fechadosPorOrigem)
    setLoading(false)
  }

  const recebidos = reservas.length
  const negociacao = reservas.filter((r) => r.status === 'orcamento').length
  const fechados = reservas.filter((r) => CLOSED_STATUSES.includes(r.status)).length
  const funil = [
    { etapa: 'Reservas recebidas', valor: recebidos },
    { etapa: 'Em negociação (orçamento)', valor: negociacao },
    { etapa: 'Fechadas', valor: fechados },
  ]
  const taxaGeral = recebidos > 0 ? ((fechados / recebidos) * 100).toFixed(0) : '0'

  // Festas cadastradas no período (pela data do cadastro), por origem do cliente.
  const doPeriodo = useMemo(() => {
    const faixas = faixasDoPeriodo(origemP.periodo)
    const { ini, fim } = limitesDasFaixas(faixas)
    const idx = indiceDaFaixa(faixas)
    const origens = new Map<string, { recebidos: number; fechados: number }>()
    const linhas = faixas.map((f) => ({ rotulo: f.rotulo } as Record<string, string | number>))
    for (const r of reservas) {
      const d = r.created_at?.slice(0, 10)
      if (!d || d < ini || d >= fim) continue
      const o = origemDoCliente[r.client_id] ?? 'não informado'
      const e = origens.get(o) ?? { recebidos: 0, fechados: 0 }
      e.recebidos += 1
      const fechou = CLOSED_STATUSES.includes(r.status)
      if (fechou) e.fechados += 1
      origens.set(o, e)
      const i = idx(d)
      if (fechou && i >= 0) linhas[i][o] = ((linhas[i][o] as number) ?? 0) + 1
    }
    const lista = Array.from(origens.entries()).map(([origem, v]) => ({ origem, ...v })).sort((a, b) => b.fechados - a.fechados || b.recebidos - a.recebidos)
    for (const l of linhas) for (const o of lista) l[o.origem] = l[o.origem] ?? 0
    return { lista, linhas }
  }, [reservas, origemDoCliente, origemP.periodo])

  const comFechadas = doPeriodo.lista.filter((o) => o.fechados > 0)

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

          <Card title={`Festas fechadas por origem — ${descreverPeriodo(origemP.periodo)}`}>
            <div className="mb-3">
              <PeriodoGrafico
                periodo={origemP.periodo}
                onChange={origemP.setPeriodo}
                tipo={visao}
                onTipo={setVisao}
                tiposExtras={[['pizza', 'Pizza']] as const}
              />
            </div>
            {comFechadas.length === 0 ? (
              <p className="text-sm text-muted py-6 text-center">Nenhuma festa fechada neste período.</p>
            ) : visao === 'pizza' ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                  <Pie
                    data={comFechadas.map((o) => ({ name: CLIENT_SOURCE_LABEL[o.origem] ?? o.origem, value: o.fechados }))}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="45%"
                    outerRadius={70}
                  >
                    {comFechadas.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} verticalAlign="bottom" />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <GraficoSerie
                dados={doPeriodo.linhas}
                tipo={visao}
                inteiro
                larguraEixo={30}
                series={comFechadas.map((o, i) => ({ chave: o.origem, nome: CLIENT_SOURCE_LABEL[o.origem] ?? o.origem, cor: PIE_COLORS[i % PIE_COLORS.length] }))}
              />
            )}
            <p className="text-xs text-muted mb-3 mt-2">Festas cadastradas no período (pela data do cadastro), separadas pela origem do cliente.</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="pb-3 font-medium">Origem</th>
                  <th className="pb-3 font-medium">Festas cadastradas</th>
                  <th className="pb-3 font-medium">Fechadas</th>
                  <th className="pb-3 font-medium">Taxa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {doPeriodo.lista.map((o) => (
                  <tr key={o.origem}>
                    <td className="py-3 font-medium">{CLIENT_SOURCE_LABEL[o.origem] ?? o.origem}</td>
                    <td className="py-3">{o.recebidos}</td>
                    <td className="py-3">{o.fechados}</td>
                    <td className="py-3">{((o.fechados / o.recebidos) * 100 || 0).toFixed(0)}%</td>
                  </tr>
                ))}
                {doPeriodo.lista.length === 0 && (
                  <tr><td colSpan={4} className="py-6 text-center text-muted">Nenhuma festa cadastrada neste período.</td></tr>
                )}
              </tbody>
            </table>
          </Card>

          <Card title="Clientes por origem (desde o começo)">
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
                {Object.entries(clientesPorOrigem).sort((a, b) => b[1] - a[1]).map(([o, n]) => (
                  <tr key={o}>
                    <td className="py-3 font-medium">{CLIENT_SOURCE_LABEL[o] ?? o}</td>
                    <td className="py-3">{n}</td>
                    <td className="py-3">{clientesFechadosPorOrigem[o] ?? 0}</td>
                    <td className="py-3">{(((clientesFechadosPorOrigem[o] ?? 0) / n) * 100 || 0).toFixed(0)}%</td>
                  </tr>
                ))}
                {Object.keys(clientesPorOrigem).length === 0 && (
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
