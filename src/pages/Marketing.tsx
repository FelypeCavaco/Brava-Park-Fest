import { FormEvent, useEffect, useState } from 'react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { useUnit, UNITS } from '../lib/UnitContext'
import { supabase } from '../lib/supabaseClient'
import { currentMonthValue, monthBounds } from '../lib/monthUtils'
import { faixasDoPeriodo, descreverPeriodo, indiceDaFaixa, limitesDasFaixas } from '../lib/periodo'
import { PeriodoGrafico, GraficoSerie, usePeriodo } from '../components/PeriodoGrafico'

const CLOSED_STATUSES = ['confirmada', 'sinal_pago', 'quitada']
const PAID_TRAFFIC_SOURCES = ['instagram', 'facebook', 'google']

function currency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

export function Marketing() {
  const { selectedUnit, unitDbIds } = useUnit()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [mesForm, setMesForm] = useState(currentMonthValue())
  const [unidadeForm, setUnidadeForm] = useState(UNITS[0].id)
  const [valorForm, setValorForm] = useState('')

  const [gastoMes, setGastoMes] = useState(0)
  const [contratosFechados, setContratosFechados] = useState(0)
  const [ticketMedio, setTicketMedio] = useState(0)
  const [cacHistory, setCacHistory] = useState<Record<string, string | number>[]>([])
  const cacP = usePeriodo('marketing-cac', 6, 'linhas')

  const unitIds = selectedUnit === 'todas' ? Object.values(unitDbIds).map((d) => d.unitId) : [unitDbIds[selectedUnit]?.unitId].filter(Boolean) as string[]

  useEffect(() => {
    if (Object.keys(unitDbIds).length > 0) loadData()
  }, [selectedUnit, unitDbIds])

  async function loadData() {
    setLoading(true)
    setError(null)

    const { startIso, endIso } = monthBounds(currentMonthValue())

    const [{ data: spendRows, error: spendErr }, { data: closedReservations }] = await Promise.all([
      supabase.from('marketing_spend').select('amount').in('unit_id', unitIds).eq('month', startIso),
      supabase
        .from('reservations')
        .select('final_value, status, unit_id, created_at, client:clients!inner(source)')
        .in('unit_id', unitIds)
        .in('status', CLOSED_STATUSES)
        .in('client.source', PAID_TRAFFIC_SOURCES)
        .gte('created_at', startIso)
        .lt('created_at', endIso),
    ])

    if (spendErr) setError('Não foi possível carregar os dados de marketing.')

    const gasto = (spendRows ?? []).reduce((s, r) => s + Number(r.amount), 0)
    const fechados = closedReservations ?? []
    const ticket = fechados.length > 0 ? fechados.reduce((s, r) => s + Number(r.final_value), 0) / fechados.length : 0

    setGastoMes(gasto)
    setContratosFechados(fechados.length)
    setTicketMedio(ticket)

    setLoading(false)
  }

  // CAC por mês no período escolhido (o gasto com tráfego é lançado por mês).
  useEffect(() => {
    if (unitIds.length === 0) return
    const faixas = faixasDoPeriodo(cacP.periodo, { granularidade: 'mensal' })
    const { ini, fim } = limitesDasFaixas(faixas)
    const idx = indiceDaFaixa(faixas)
    let vivo = true
    Promise.all([
      supabase.from('marketing_spend').select('amount, month').in('unit_id', unitIds).gte('month', ini).lt('month', fim),
      supabase
        .from('reservations')
        .select('id, created_at, client:clients!inner(source)')
        .in('unit_id', unitIds)
        .in('status', CLOSED_STATUSES)
        .in('client.source', PAID_TRAFFIC_SOURCES)
        .gte('created_at', ini)
        .lt('created_at', fim),
    ]).then(([{ data: spend }, { data: closed }]) => {
      if (!vivo) return
      const gasto = faixas.map(() => 0)
      const fechados = faixas.map(() => 0)
      for (const r of spend ?? []) { const k = idx(r.month); if (k >= 0) gasto[k] += Number(r.amount) }
      for (const r of closed ?? []) { const k = idx(r.created_at); if (k >= 0) fechados[k] += 1 }
      setCacHistory(faixas.map((f, k) => ({ rotulo: f.rotulo, cac: fechados[k] > 0 ? Math.round(gasto[k] / fechados[k]) : 0, gasto: gasto[k] })))
    })
    return () => { vivo = false }
  }, [cacP.periodo, selectedUnit, unitDbIds, gastoMes])

  async function handleSaveSpend(e: FormEvent) {
    e.preventDefault()
    const valor = Number(valorForm)
    const dbIds = unitDbIds[unidadeForm]
    if (!valor || !dbIds) return

    const { startIso } = monthBounds(mesForm)
    const { error } = await supabase
      .from('marketing_spend')
      .upsert({ unit_id: dbIds.unitId, month: startIso, amount: valor }, { onConflict: 'unit_id,month' })

    if (error) {
      setError('Não foi possível salvar o gasto.')
      return
    }
    setValorForm('')
    loadData()
  }

  const cac = contratosFechados > 0 ? gastoMes / contratosFechados : 0
  const cacRatio = ticketMedio > 0 ? cac / ticketMedio : 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Tráfego pago e CAC</h1>
        <p className="text-sm text-muted mt-1">
          Compare o custo de aquisição de cliente com o ticket médio, para saber se vale aumentar ou reduzir o
          investimento em tráfego.
        </p>
      </div>

      {error && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5">{error}</div>}

      <Card title="Registrar gasto do mês">
        <form onSubmit={handleSaveSpend} className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-muted mb-1">Mês</label>
            <input type="month" value={mesForm} onChange={(e) => setMesForm(e.target.value)} className="border border-line rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Unidade</label>
            <select value={unidadeForm} onChange={(e) => setUnidadeForm(e.target.value)} className="border border-line rounded-lg px-3 py-2 text-sm">
              {UNITS.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Valor investido</label>
            <input
              type="number"
              placeholder="0,00"
              value={valorForm}
              onChange={(e) => setValorForm(e.target.value)}
              className="border border-line rounded-lg px-3 py-2 text-sm w-40"
            />
          </div>
          <Button type="submit" className="text-xs px-4 py-2">Salvar</Button>
        </form>
        <p className="text-xs text-muted mt-3">
          Salvar de novo no mesmo mês e unidade substitui o valor anterior. No futuro dá para integrar direto com
          Meta Ads / Google Ads via API.
        </p>
      </Card>

      {loading ? (
        <Card><p className="text-sm text-muted py-6 text-center">Carregando...</p></Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <p className="text-xs text-muted">Gasto em tráfego (mês atual)</p>
              <p className="text-2xl font-display font-semibold mt-1">{currency(gastoMes)}</p>
            </Card>
            <Card>
              <p className="text-xs text-muted">CAC (custo por cliente)</p>
              <p className="text-2xl font-display font-semibold mt-1">{contratosFechados > 0 ? currency(cac) : '—'}</p>
              <p className="text-xs text-muted mt-1">{contratosFechados} festa(s) vinda(s) de tráfego pago (Instagram/Facebook/Google) no mês</p>
            </Card>
            <Card className={contratosFechados === 0 ? '' : cacRatio < 0.15 ? 'border-teal' : cacRatio > 0.3 ? 'border-danger' : ''}>
              <p className="text-xs text-muted">CAC vs. ticket médio</p>
              <p className="text-2xl font-display font-semibold mt-1">
                {contratosFechados > 0 ? `${(cacRatio * 100).toFixed(0)}%` : '—'}
              </p>
              <p className="text-xs text-muted mt-1">
                {contratosFechados === 0
                  ? 'Sem festas fechadas neste mês ainda'
                  : cacRatio < 0.15
                    ? 'Saudável — dá espaço para aumentar o investimento'
                    : cacRatio > 0.3
                      ? 'Alto — vale revisar a campanha ou reduzir o investimento'
                      : 'Dentro da média'}
              </p>
            </Card>
          </div>

          <Card title={`Evolução do CAC — ${descreverPeriodo(cacP.periodo, { granularidade: 'mensal' })}`}>
            <div className="mb-3"><PeriodoGrafico periodo={cacP.periodo} onChange={cacP.setPeriodo} tipo={cacP.tipo} onTipo={cacP.setTipo} mensal /></div>
            <p className="text-xs text-muted mb-2">O gasto com tráfego é lançado por mês, então este gráfico é sempre mês a mês.</p>
            <GraficoSerie
              dados={cacHistory}
              tipo={cacP.tipo}
              formatar={currency}
              series={[
                { chave: 'cac', nome: 'CAC (custo por cliente fechado)', cor: '#6D28D9', ajuda: 'Quanto custou, em tráfego pago, cada festa fechada com cliente que veio de Instagram, Facebook ou Google naquele mês. Quanto menor, melhor.' },
                { chave: 'gasto', nome: 'Gasto com tráfego', cor: '#F2900C', tracejada: true, ajuda: 'Total investido em anúncios no mês, como foi lançado na tela de Marketing.' },
              ]}
            />
          </Card>
        </>
      )}
    </div>
  )
}
