import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { faixasDoPeriodo, descreverPeriodo, indiceDaFaixa, limitesDasFaixas } from '../lib/periodo'
import { PeriodoGrafico, GraficoSerie, usePeriodo } from './PeriodoGrafico'
import { Card } from './ui/Card'
import { supabase } from '../lib/supabaseClient'
import { useUnit, UNITS, unitColor } from '../lib/UnitContext'

// Festas por mês, por unidade, com a linha do ano anterior para comparar.
// Dois modos:
//   • "Realizadas": pelo mês da festa (não conta canceladas).
//   • "Fechadas": pelo mês em que a festa foi cadastrada (vendas do mês),
//     contando todas as cadastradas — inclusive as que ainda estão em
//     orçamento e as que depois foram canceladas (aparecem no resumo).

type Modo = 'realizadas' | 'fechadas'
interface Linha { event_date: string; created_at: string; unit_id: string; status: string }

export function FestasPorMesChart() {
  const { selectedUnit, unitDbIds, unitDbIdsLoading } = useUnit()
  const [rows, setRows] = useState<Linha[]>([])
  const festasP = usePeriodo('painel-festas-por-mes', 12, 'barras')
  const [modo, setModo] = useState<Modo>('realizadas')

  useEffect(() => {
    if (unitDbIdsLoading) return
    supabase
      .from('reservations')
      .select('event_date, created_at, unit_id, status')
      .order('event_date')
      .then(({ data }) => setRows((data ?? []) as Linha[]))
  }, [unitDbIdsLoading])

  const slugById = useMemo(() => {
    const m: Record<string, string> = {}
    for (const s of Object.keys(unitDbIds)) m[unitDbIds[s].unitId] = s
    return m
  }, [unitDbIds])

  // Data que define o mês de cada festa no modo escolhido (cadastro no fuso
  // de quem está usando, que é o de Brasília).
  const datas = useMemo(
    () =>
      rows
        .filter((r) => modo === 'fechadas' || r.status !== 'cancelada')
        .map((r) => ({ ...r, ref: modo === 'realizadas' ? r.event_date : format(new Date(r.created_at), 'yyyy-MM-dd') })),
    [rows, modo],
  )

  const unidades = selectedUnit === 'todas' ? UNITS.map((u) => u.id) : [selectedUnit]
  const faixas = useMemo(() => faixasDoPeriodo(festasP.periodo), [festasP.periodo])

  // Conta por faixa do período; "anterior" = a mesma faixa um ano antes.
  const { data, canceladas, orcamento } = useMemo(() => {
    const base = faixas.map((f) => {
      const row: Record<string, number | string> = { rotulo: f.rotulo, anterior: 0, total: 0 }
      for (const u of unidades) row[u] = 0
      return row
    })
    const idx = indiceDaFaixa(faixas)
    const { ini, fim } = limitesDasFaixas(faixas)
    const umAnoAntes = (d: string) => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`
    const umAnoDepois = (d: string) => `${Number(d.slice(0, 4)) + 1}${d.slice(4)}`
    let canc = 0
    let orc = 0
    for (const r of datas) {
      const slug = slugById[r.unit_id]
      if (!slug || !unidades.includes(slug)) continue
      if (r.ref >= ini && r.ref < fim) {
        const k = idx(r.ref)
        if (k < 0) continue
        base[k][slug] = (base[k][slug] as number) + 1
        base[k].total = (base[k].total as number) + 1
        if (r.status === 'cancelada') canc++
        if (r.status === 'orcamento') orc++
      } else if (r.ref >= umAnoAntes(ini) && r.ref < umAnoAntes(fim)) {
        const k = idx(umAnoDepois(r.ref))
        if (k >= 0) base[k].anterior = (base[k].anterior as number) + 1
      }
    }
    return { data: base, canceladas: canc, orcamento: orc }
  }, [datas, slugById, unidades.join(','), faixas])

  const totalAno = data.reduce((s, r) => s + (r.total as number), 0)
  const totalAnterior = data.reduce((s, r) => s + (r.anterior as number), 0)
  const melhorMes = data.reduce((best, r) => ((r.total as number) > (best.total as number) ? r : best), data[0] ?? { rotulo: '', total: 0 })

  return (
    <Card
      title={`${modo === 'realizadas' ? 'Festas realizadas' : 'Festas fechadas (vendas)'} — ${descreverPeriodo(festasP.periodo)}`}
      action={
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-line p-0.5" role="tablist">
            {([
              ['realizadas', 'Realizadas no mês'],
              ['fechadas', 'Fechadas no mês'],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={modo === k}
                onClick={() => setModo(k)}
                className={`px-2.5 h-7 rounded-md text-xs font-medium ${modo === k ? 'bg-purple text-white' : 'text-ink/70 hover:bg-paper'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      }
    >
      <div className="mb-3"><PeriodoGrafico periodo={festasP.periodo} onChange={festasP.setPeriodo} tipo={festasP.tipo} onTipo={festasP.setTipo} /></div>
      <p className="text-xs text-muted mb-3">
        {totalAno} festa{totalAno === 1 ? '' : 's'} {modo === 'realizadas' ? 'realizadas' : 'fechadas'} no período
        {totalAnterior > 0 ? ` · ${totalAnterior} no mesmo período do ano anterior` : ''}
        {totalAno > 0 ? ` · ${modo === 'realizadas' ? 'mais cheio' : 'que mais vendeu'}: ${melhorMes.rotulo} (${melhorMes.total})` : ''}
        {modo === 'realizadas'
          ? ' · conta pela data da festa, sem as canceladas'
          : ` · conta pela data em que a festa foi cadastrada${canceladas > 0 ? ` · ${canceladas} depois cancelada${canceladas === 1 ? '' : 's'}` : ''}${orcamento > 0 ? ` · ${orcamento} ainda em orçamento` : ''}`}
      </p>
      <GraficoSerie
        dados={data}
        tipo={festasP.tipo}
        altura={260}
        inteiro
        larguraEixo={30}
        series={[
          ...unidades.map((u) => ({ chave: u, nome: UNITS.find((x) => x.id === u)?.name ?? u, cor: unitColor(u), pilha: festasP.tipo === 'barras' ? 'festas' : undefined, ajuda: modo === 'realizadas' ? 'Festas desta unidade pela data em que acontecem (sem as canceladas).' : 'Festas desta unidade pela data em que foram cadastradas (vendas), contando as que depois foram canceladas.' })),
          ...(totalAnterior > 0 ? [{ chave: 'anterior', nome: 'Ano anterior (total)', cor: '#F2900C', tracejada: true, ajuda: 'Total do mesmo período um ano antes, para comparar se está melhor ou pior.' }] : []),
        ]}
      />
    </Card>
  )
}
