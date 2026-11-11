import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { Card } from '../ui/Card'
import { supabase } from '../../lib/supabaseClient'
import { UNITS } from '../../lib/UnitContext'
import { currentMonthValue, monthBounds } from '../../lib/monthUtils'
import { PAYMENT_METHOD_LABEL, type PaymentMethod } from '../../types'

// Lançamentos › Saídas: todo dinheiro que saiu no mês escolhido, num lugar só.
//   • Contas pagas (lançadas aqui no Financeiro, compras de estoque, comissões, acertos...);
//   • Custos das festas, que ficam guardados dentro de cada festa:
//     despesa fixa da festa, pagamento da equipe e custos lançados na festa.
//     Contam pela data da festa (igual ao Resultado do mês).
//   • Pagamentos que só quitam custos de festa já lançados aparecem para
//     conferência, mas não somam de novo (senão o custo contaria duas vezes).

type Origem = 'conta' | 'fixa' | 'equipe' | 'festa' | 'quitacao'
interface Linha { id: string; origem: Origem; data: string; quem: string; detalhe: string; forma: string | null; valor: number; unidade: string; reservationId: string | null }

const ROTULO: Record<Origem, string> = {
  conta: 'Conta paga',
  fixa: 'Despesa fixa da festa',
  equipe: 'Equipe da festa',
  festa: 'Custo lançado na festa',
  quitacao: 'Pagamento de custo de festa',
}
const COR: Record<Origem, string> = {
  conta: 'bg-purple-light text-purple',
  fixa: 'bg-amber-light text-amber',
  equipe: 'bg-teal-light text-teal',
  festa: 'bg-paper text-ink/70',
  quitacao: 'bg-paper text-muted',
}
const FILTROS: ('todas' | Origem)[] = ['todas', 'conta', 'fixa', 'equipe', 'festa', 'quitacao']
const NOME_FILTRO: Record<'todas' | Origem, string> = { todas: 'Todas', conta: 'Contas pagas', fixa: 'Despesas fixas das festas', equipe: 'Equipe', festa: 'Custos lançados na festa', quitacao: 'Pagamentos de custos de festa' }

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
const dataBr = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')

export function ListaDeSaidas({ slugs, unitDbIds, recarga, onVerPagas }: {
  slugs: string[]
  unitDbIds: Record<string, { unitId: string }>
  recarga: unknown
  onVerPagas: () => void
}) {
  const [mes, setMes] = useState(currentMonthValue)
  const [filtro, setFiltro] = useState<'todas' | Origem>('todas')
  const [busca, setBusca] = useState('')
  const [linhas, setLinhas] = useState<Linha[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const ids = useMemo(() => slugs.map((s) => unitDbIds[s]?.unitId).filter(Boolean) as string[], [slugs, unitDbIds])
  const slugDoId = useMemo(() => {
    const m: Record<string, string> = {}
    for (const s of Object.keys(unitDbIds)) m[unitDbIds[s].unitId] = s
    return m
  }, [unitDbIds])
  const nomeUnidade = (unitId: string) => UNITS.find((u) => u.id === slugDoId[unitId])?.name ?? ''

  useEffect(() => {
    if (ids.length === 0) return
    let vivo = true
    setLinhas(null)
    setErro(null)
    const { startIso, endIso } = monthBounds(mes)
    Promise.all([
      supabase
        .from('expenses')
        .select('id, unit_id, category, description, supplier, amount, paid_date, payment_method, covers_festa_costs')
        .in('unit_id', ids)
        .eq('status', 'pago')
        .gte('paid_date', startIso)
        .lt('paid_date', endIso)
        .order('paid_date', { ascending: false })
        .limit(2000),
      supabase
        .from('reservation_costs')
        .select('id, description, amount, fixed_cost_id, reservation:reservations!inner(id, unit_id, event_date, status, child_name, client:clients(name))')
        .in('reservation.unit_id', ids)
        .neq('reservation.status', 'cancelada')
        .gte('reservation.event_date', startIso)
        .lt('reservation.event_date', endIso)
        .limit(5000),
    ]).then(([e, c]) => {
      if (!vivo) return
      if (e.error || c.error) {
        setErro('Não foi possível carregar as saídas.')
        setLinhas([])
        return
      }
      const lista: Linha[] = []
      for (const x of (e.data ?? []) as any[]) {
        const quitacao = !!x.covers_festa_costs
        lista.push({
          id: `e-${x.id}`,
          origem: quitacao ? 'quitacao' : 'conta',
          data: x.paid_date,
          quem: x.description || x.category || 'Conta',
          detalhe: [x.category, x.supplier].filter(Boolean).join(' · '),
          forma: x.payment_method,
          valor: Number(x.amount),
          unidade: nomeUnidade(x.unit_id),
          reservationId: null,
        })
      }
      for (const x of (c.data ?? []) as any[]) {
        const r = x.reservation
        if (!r) continue
        const desc = String(x.description ?? '')
        const origem: Origem = x.fixed_cost_id ? 'fixa' : desc.startsWith('Equipe —') ? 'equipe' : 'festa'
        const festa = `${r.client?.name ?? 'Cliente'}${r.child_name ? ` — festa de ${r.child_name}` : ''}`
        lista.push({
          id: `c-${x.id}`,
          origem,
          data: r.event_date,
          quem: desc || ROTULO[origem],
          detalhe: festa,
          forma: null,
          valor: Number(x.amount),
          unidade: nomeUnidade(r.unit_id),
          reservationId: r.id,
        })
      }
      lista.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0))
      setLinhas(lista)
    })
    return () => {
      vivo = false
    }
  }, [mes, ids.join(','), recarga])

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return (linhas ?? []).filter((l) => (filtro === 'todas' || l.origem === filtro) && (!t || `${l.quem} ${l.detalhe}`.toLowerCase().includes(t)))
  }, [linhas, filtro, busca])

  const totais = useMemo(() => {
    const t = Object.fromEntries(FILTROS.map((k) => [k, { n: 0, v: 0 }])) as Record<'todas' | Origem, { n: number; v: number }>
    for (const l of linhas ?? []) {
      t[l.origem].n++
      t[l.origem].v += l.valor
      t.todas.n++
      if (l.origem !== 'quitacao') t.todas.v += l.valor
    }
    return t
  }, [linhas])

  // a quitação de custo de festa não soma: o custo já está na linha da festa
  const totalVisivel = visiveis.reduce((s, l) => s + (l.origem === 'quitacao' && filtro !== 'quitacao' ? 0 : l.valor), 0)
  const temQuitacao = visiveis.some((l) => l.origem === 'quitacao')
  const varias = slugs.length > 1

  return (
    <Card title="Saídas">
      <p className="text-xs text-muted mb-3">
        Todo dinheiro que saiu no mês, num lugar só: as contas pagas e os custos de cada festa (despesa fixa da festa, equipe e custos lançados na festa). Os custos das festas contam pela data da festa e são editados na própria festa; as contas, na aba Pagas.
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <label className="inline-flex items-center gap-2 text-sm">
          <span className="text-muted">Mês</span>
          <input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} className="border border-line rounded-lg px-2 h-8 text-sm bg-surface" />
        </label>
        <div className="inline-flex flex-wrap rounded-lg border border-line bg-surface p-0.5 gap-0.5" role="tablist" aria-label="Tipo de saída">
          {FILTROS.filter((k) => k === 'todas' || totais[k].n > 0).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={filtro === k} onClick={() => setFiltro(k)} className={`px-2.5 h-7 rounded-md text-xs font-medium whitespace-nowrap ${filtro === k ? 'bg-purple text-white' : 'text-ink/70 hover:bg-paper'}`}>
              {NOME_FILTRO[k]} ({totais[k].n})
            </button>
          ))}
        </div>
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar descrição, fornecedor ou cliente…" className="border border-line rounded-lg px-3 h-8 text-sm bg-surface flex-1 min-w-[180px]" aria-label="Buscar" />
      </div>

      {erro && <p className="text-sm bg-danger-light text-danger rounded-lg px-3 py-2 mb-3">{erro}</p>}

      {linhas === null ? (
        <p className="text-sm text-muted py-6 text-center">Carregando…</p>
      ) : visiveis.length === 0 ? (
        <p className="text-sm text-muted py-6 text-center">Nenhuma saída {filtro === 'todas' ? '' : 'deste tipo '}neste mês{busca ? ' com essa busca' : ''}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="pb-3 font-medium">Data</th>
                {varias && <th className="pb-3 font-medium">Unidade</th>}
                <th className="pb-3 font-medium">Tipo</th>
                <th className="pb-3 font-medium">Descrição</th>
                <th className="pb-3 font-medium">Forma</th>
                <th className="pb-3 font-medium text-right">Valor</th>
                <th className="pb-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visiveis.map((l) => (
                <tr key={l.id} className={l.origem === 'quitacao' ? 'opacity-70' : ''}>
                  <td className="py-3 text-muted whitespace-nowrap">
                    {dataBr(l.data)}
                    {l.reservationId && <span className="block text-[11px]">data da festa</span>}
                  </td>
                  {varias && <td className="py-3 text-muted">{l.unidade}</td>}
                  <td className="py-3"><span className={`inline-flex text-[11px] font-semibold rounded px-1.5 py-0.5 whitespace-nowrap ${COR[l.origem]}`}>{ROTULO[l.origem]}</span></td>
                  <td className="py-3">
                    {l.quem}
                    {l.detalhe && <span className="block text-xs text-muted">{l.detalhe}</span>}
                    {l.origem === 'quitacao' && <span className="block text-[11px] text-muted">Já contado no custo da festa — não soma de novo.</span>}
                  </td>
                  <td className="py-3 text-muted">{l.forma ? PAYMENT_METHOD_LABEL[l.forma as PaymentMethod] ?? l.forma : '—'}</td>
                  <td className="py-3 text-right text-danger font-medium whitespace-nowrap">{brl(l.valor)}</td>
                  <td className="py-3 text-right">
                    {l.reservationId ? (
                      <Link to={`/reservas/${l.reservationId}?aba=financeiro`} className="inline-flex items-center gap-1 text-xs font-medium text-purple whitespace-nowrap">
                        Abrir festa <ExternalLink className="w-3 h-3" />
                      </Link>
                    ) : (
                      <button onClick={onVerPagas} className="text-xs font-medium text-purple whitespace-nowrap">Ver em Pagas</button>
                    )}
                  </td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td colSpan={varias ? 5 : 4} className="pt-3">
                  Total ({visiveis.length} saída{visiveis.length === 1 ? '' : 's'})
                  {temQuitacao && filtro !== 'quitacao' && <span className="block text-[11px] font-normal text-muted">Sem os pagamentos de custos de festa, que já estão nas linhas das festas.</span>}
                </td>
                <td className="pt-3 text-right text-danger whitespace-nowrap">{brl(totalVisivel)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
