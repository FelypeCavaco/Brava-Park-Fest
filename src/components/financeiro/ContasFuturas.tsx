import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { Card } from '../ui/Card'
import { supabase } from '../../lib/supabaseClient'
import { UNITS } from '../../lib/UnitContext'
import { daysInMonth } from '../../lib/monthUtils'

// Lançamentos › Contas futuras: tudo o que ainda vai sair nos próximos dias, num lugar só.
//   • Contas já lançadas que ainda não venceram (inclui as despesas fixas deste mês);
//   • Despesas fixas dos meses seguintes, que ainda não viraram conta (o sistema
//     cria a conta quando o mês chega);
//   • Custos de cada festa que ainda vai acontecer: despesa fixa da festa e o que
//     já foi lançado nela, festa por festa, na data da festa.
// Só lê: nada aqui lança nem muda conta. Contas atrasadas ficam em "A pagar".

type Tipo = 'conta' | 'fixa' | 'prevista' | 'festa'
interface ItemCusto { descricao: string; valor: number; fixo: boolean }
interface Futura {
  id: string
  tipo: Tipo
  data: string
  titulo: string
  detalhe: string
  unidade: string
  valor: number
  itens?: ItemCusto[]
  reservationId?: string
}

const ROTULO: Record<Tipo, string> = {
  conta: 'Conta lançada',
  fixa: 'Despesa fixa lançada',
  prevista: 'Despesa fixa (ainda não lançada)',
  festa: 'Custos da festa',
}
const COR: Record<Tipo, string> = {
  conta: 'bg-purple-light text-purple',
  fixa: 'bg-amber-light text-amber',
  prevista: 'bg-paper text-ink/70',
  festa: 'bg-teal-light text-teal',
}
const FILTROS: ('todas' | Tipo)[] = ['todas', 'festa', 'prevista', 'fixa', 'conta']
const NOME_FILTRO: Record<'todas' | Tipo, string> = {
  todas: 'Tudo',
  festa: 'Custos das festas',
  prevista: 'Despesas fixas por vir',
  fixa: 'Despesas fixas lançadas',
  conta: 'Outras contas lançadas',
}
const HORIZONTES = [30, 60, 90, 180] as const

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
const dataBr = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')
const pad = (n: number) => String(n).padStart(2, '0')
const isoDe = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const nomeMes = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  const s = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function ContasFuturas({ slugs, unitDbIds, recarga, onVerAPagar }: {
  slugs: string[]
  unitDbIds: Record<string, { unitId: string }>
  recarga: unknown
  onVerAPagar: () => void
}) {
  const [horizonte, setHorizonte] = useState<(typeof HORIZONTES)[number]>(90)
  const [filtro, setFiltro] = useState<'todas' | Tipo>('todas')
  const [linhas, setLinhas] = useState<Futura[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const ids = useMemo(() => slugs.map((s) => unitDbIds[s]?.unitId).filter(Boolean) as string[], [slugs, unitDbIds])
  const slugDoId = useMemo(() => {
    const m: Record<string, string> = {}
    for (const s of Object.keys(unitDbIds)) m[unitDbIds[s].unitId] = s
    return m
  }, [unitDbIds])
  const nomeUnidade = (unitId: string) => UNITS.find((u) => u.id === slugDoId[unitId])?.name ?? ''
  const varias = slugs.length > 1

  useEffect(() => {
    if (ids.length === 0) return
    let vivo = true
    setLinhas(null)
    setErro(null)
    const hojeD = new Date()
    const hoje = isoDe(hojeD)
    const fim = isoDe(new Date(hojeD.getFullYear(), hojeD.getMonth(), hojeD.getDate() + horizonte))
    Promise.all([
      supabase
        .from('expenses')
        .select('id, unit_id, category, description, supplier, amount, due_date, recurring_expense_id')
        .in('unit_id', ids)
        .in('status', ['a_vencer', 'atrasado'])
        .eq('covers_festa_costs', false)
        .gte('due_date', hoje)
        .lte('due_date', fim)
        .order('due_date')
        .limit(1000),
      supabase
        .from('recurring_expenses')
        .select('id, unit_id, category, description, amount, day_of_month, first_charge_month')
        .in('unit_id', ids)
        .eq('active', true),
      supabase
        .from('reservations')
        .select('id, unit_id, event_date, child_name, client:clients(name), reservation_costs(id, description, amount, fixed_cost_id)')
        .in('unit_id', ids)
        .neq('status', 'cancelada')
        .gte('event_date', hoje)
        .lte('event_date', fim)
        .order('event_date')
        .limit(500),
    ]).then(([e, r, f]) => {
      if (!vivo) return
      if (e.error || r.error || f.error) {
        setErro('Não foi possível carregar as contas futuras.')
        setLinhas([])
        return
      }
      const lista: Futura[] = []
      const jaLancada = new Set<string>() // despesa fixa + mês que já virou conta
      for (const x of (e.data ?? []) as any[]) {
        const fixa = !!x.recurring_expense_id
        if (fixa) jaLancada.add(`${x.recurring_expense_id}|${String(x.due_date).slice(0, 7)}`)
        lista.push({
          id: `e-${x.id}`,
          tipo: fixa ? 'fixa' : 'conta',
          data: x.due_date,
          titulo: x.description || x.category || 'Conta',
          detalhe: [x.category, x.supplier].filter(Boolean).join(' · '),
          unidade: nomeUnidade(x.unit_id),
          valor: Number(x.amount),
        })
      }
      // despesas fixas dos meses seguintes (o mês atual já virou conta lançada)
      for (const x of (r.data ?? []) as any[]) {
        for (let k = 1; k <= 7; k++) {
          const m = new Date(hojeD.getFullYear(), hojeD.getMonth() + k, 1)
          const ym = `${m.getFullYear()}-${pad(m.getMonth() + 1)}`
          if (x.first_charge_month && ym < String(x.first_charge_month).slice(0, 7)) continue
          if (jaLancada.has(`${x.id}|${ym}`)) continue
          const venc = `${ym}-${pad(Math.min(Number(x.day_of_month) || 1, daysInMonth(ym)))}`
          if (venc > fim) break
          lista.push({
            id: `r-${x.id}-${ym}`,
            tipo: 'prevista',
            data: venc,
            titulo: x.description,
            detalhe: x.category,
            unidade: nomeUnidade(x.unit_id),
            valor: Number(x.amount),
          })
        }
      }
      // custos de cada festa que ainda vai acontecer
      for (const x of (f.data ?? []) as any[]) {
        const custos = ((x.reservation_costs ?? []) as any[]).map((c) => ({ descricao: String(c.description ?? ''), valor: Number(c.amount), fixo: !!c.fixed_cost_id }))
        const total = custos.reduce((s, c) => s + c.valor, 0)
        lista.push({
          id: `f-${x.id}`,
          tipo: 'festa',
          data: x.event_date,
          titulo: `Festa de ${x.child_name || x.client?.name || 'cliente'}`,
          detalhe: x.child_name && x.client?.name ? `Cliente: ${x.client.name}` : '',
          unidade: nomeUnidade(x.unit_id),
          valor: total,
          itens: custos,
          reservationId: x.id,
        })
      }
      lista.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.titulo.localeCompare(b.titulo)))
      setLinhas(lista)
    })
    return () => {
      vivo = false
    }
  }, [horizonte, ids.join(','), recarga])

  const totais = useMemo(() => {
    const t = Object.fromEntries(FILTROS.map((k) => [k, { n: 0, v: 0 }])) as Record<'todas' | Tipo, { n: number; v: number }>
    for (const l of linhas ?? []) {
      t[l.tipo].n++
      t[l.tipo].v += l.valor
      t.todas.n++
      t.todas.v += l.valor
    }
    return t
  }, [linhas])

  const visiveis = useMemo(() => (linhas ?? []).filter((l) => filtro === 'todas' || l.tipo === filtro), [linhas, filtro])
  const porMes = useMemo(() => {
    const g = new Map<string, Futura[]>()
    for (const l of visiveis) {
      const k = l.data.slice(0, 7)
      g.set(k, [...(g.get(k) ?? []), l])
    }
    return [...g.entries()]
  }, [visiveis])
  const festasSemCusto = (linhas ?? []).filter((l) => l.tipo === 'festa' && (l.itens?.length ?? 0) === 0).length

  return (
    <Card title="Contas futuras">
      <p className="text-xs text-muted mb-3">
        Tudo o que ainda vai sair: contas já lançadas que não venceram, despesas fixas dos próximos meses (a conta só é criada quando o mês chega) e os custos de cada festa que ainda vai acontecer, na data dela.
        Contas atrasadas ficam em <button type="button" onClick={onVerAPagar} className="text-purple font-medium">A pagar</button>.
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5 gap-0.5" role="tablist" aria-label="Período">
          {HORIZONTES.map((h) => (
            <button key={h} type="button" role="tab" aria-selected={horizonte === h} onClick={() => setHorizonte(h)} className={`px-2.5 h-7 rounded-md text-xs font-medium whitespace-nowrap ${horizonte === h ? 'bg-purple text-white' : 'text-ink/70 hover:bg-paper'}`}>
              Próximos {h} dias
            </button>
          ))}
        </div>
        <div className="inline-flex flex-wrap rounded-lg border border-line bg-surface p-0.5 gap-0.5" role="tablist" aria-label="Tipo de conta">
          {FILTROS.filter((k) => k === 'todas' || totais[k].n > 0).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={filtro === k} onClick={() => setFiltro(k)} className={`px-2.5 h-7 rounded-md text-xs font-medium whitespace-nowrap ${filtro === k ? 'bg-purple text-white' : 'text-ink/70 hover:bg-paper'}`}>
              {NOME_FILTRO[k]} ({totais[k].n})
            </button>
          ))}
        </div>
      </div>

      {linhas && linhas.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <div className="bg-paper rounded-lg p-3">
            <p className="text-[11px] text-muted">Total previsto a sair</p>
            <p className="text-lg font-display font-semibold text-danger">{brl(totais.todas.v)}</p>
            <p className="text-[11px] text-muted">nos próximos {horizonte} dias</p>
          </div>
          <div className="bg-paper rounded-lg p-3">
            <p className="text-[11px] text-muted">Custos das festas</p>
            <p className="text-lg font-display font-semibold">{brl(totais.festa.v)}</p>
            <p className="text-[11px] text-muted">{totais.festa.n} festa{totais.festa.n === 1 ? '' : 's'}</p>
          </div>
          <div className="bg-paper rounded-lg p-3">
            <p className="text-[11px] text-muted">Despesas fixas</p>
            <p className="text-lg font-display font-semibold">{brl(totais.fixa.v + totais.prevista.v)}</p>
            <p className="text-[11px] text-muted">{brl(totais.prevista.v)} ainda não lançadas</p>
          </div>
          <div className="bg-paper rounded-lg p-3">
            <p className="text-[11px] text-muted">Outras contas lançadas</p>
            <p className="text-lg font-display font-semibold">{brl(totais.conta.v)}</p>
            <p className="text-[11px] text-muted">{totais.conta.n} conta{totais.conta.n === 1 ? '' : 's'}</p>
          </div>
        </div>
      )}

      {erro && <p className="text-sm bg-danger-light text-danger rounded-lg px-3 py-2 mb-3">{erro}</p>}

      {linhas === null ? (
        <p className="text-sm text-muted py-6 text-center">Carregando…</p>
      ) : visiveis.length === 0 ? (
        <p className="text-sm text-muted py-6 text-center">Nenhuma conta futura {filtro === 'todas' ? '' : 'deste tipo '}nos próximos {horizonte} dias.</p>
      ) : (
        <div className="space-y-5">
          {porMes.map(([ym, itens]) => (
            <div key={ym}>
              <div className="flex items-baseline justify-between gap-3 border-b border-line pb-1.5 mb-1">
                <h3 className="text-sm font-semibold">{nomeMes(ym)}</h3>
                <span className="text-sm font-semibold text-danger">{brl(itens.reduce((s, l) => s + l.valor, 0))}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm table-fixed min-w-[760px]">
                  <colgroup>
                    <col style={{ width: '6.5rem' }} />
                    {varias && <col style={{ width: '7.5rem' }} />}
                    <col style={{ width: '13.5rem' }} />
                    <col />
                    <col style={{ width: '7.5rem' }} />
                    <col style={{ width: '8rem' }} />
                  </colgroup>
                  <tbody className="divide-y divide-line">
                    {itens.map((l) => (
                      <tr key={l.id} className="align-top">
                        <td className="py-2.5 pr-3 text-muted whitespace-nowrap">
                          {dataBr(l.data)}
                          {l.tipo === 'festa' && <span className="block text-[11px]">data da festa</span>}
                          {l.tipo === 'prevista' && <span className="block text-[11px]">vencimento</span>}
                        </td>
                        {varias && <td className="py-2.5 pr-3 text-muted whitespace-nowrap">{l.unidade}</td>}
                        <td className="py-2.5 pr-3 whitespace-nowrap"><span className={`inline-flex text-[11px] font-semibold rounded px-1.5 py-0.5 ${COR[l.tipo]}`}>{ROTULO[l.tipo]}</span></td>
                        <td className="py-2.5 pr-3">
                          {l.titulo}
                          {l.detalhe && <span className="block text-xs text-muted">{l.detalhe}</span>}
                          {l.tipo === 'festa' && (
                            (l.itens?.length ?? 0) === 0 ? (
                              <span className="block text-xs text-muted">Nenhum custo lançado nesta festa ainda.</span>
                            ) : (
                              <ul className="mt-1 text-xs text-ink/80 space-y-0.5">
                                {l.itens!.map((c, i) => (
                                  <li key={i} className="flex justify-between gap-3 max-w-md">
                                    <span>{c.descricao}{c.fixo && <span className="ml-1.5 text-[10px] font-semibold text-amber bg-amber-light rounded px-1">fixo</span>}</span>
                                    <span className="whitespace-nowrap">{brl(c.valor)}</span>
                                  </li>
                                ))}
                              </ul>
                            )
                          )}
                        </td>
                        <td className="py-2.5 pr-3 text-right text-danger font-medium whitespace-nowrap">{brl(l.valor)}</td>
                        <td className="py-2.5 text-right whitespace-nowrap">
                          {l.reservationId ? (
                            <Link to={`/reservas/${l.reservationId}?aba=financeiro`} className="inline-flex items-center gap-1 text-xs font-medium text-purple">
                              Abrir festa <ExternalLink className="w-3 h-3" />
                            </Link>
                          ) : l.tipo === 'prevista' ? (
                            <span className="text-[11px] text-muted">vira conta no mês</span>
                          ) : (
                            <button onClick={onVerAPagar} className="text-xs font-medium text-purple">Ver em A pagar</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {festasSemCusto > 0 && filtro !== 'conta' && filtro !== 'fixa' && filtro !== 'prevista' && (
            <p className="text-[11px] text-muted">
              {festasSemCusto} festa{festasSemCusto === 1 ? '' : 's'} sem custo lançado ainda. A equipe e outros gastos entram na festa quando você lança (ou quando marca a presença da equipe).
            </p>
          )}
        </div>
      )}
    </Card>
  )
}
