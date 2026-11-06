import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Pencil, Trash2, ExternalLink } from 'lucide-react'
import { Card } from '../ui/Card'
import { Can } from '../Can'
import { supabase } from '../../lib/supabaseClient'
import { UNITS } from '../../lib/UnitContext'
import { currentMonthValue, monthBounds } from '../../lib/monthUtils'
import { PAYMENT_METHOD_LABEL, type PaymentMethod } from '../../types'

// Lançamentos › Entradas: todo dinheiro que entrou no mês escolhido.
//   • Pagamentos das festas (editados na própria festa);
//   • Entradas lançadas à mão (editáveis aqui);
//   • Acertos entre unidades e multa e juros (mudam só pelas telas deles).

export interface EntradaManual { id: string; unit_id: string; category: string | null; description: string; amount: number; received_date: string; payment_method: string | null }
type Origem = 'festa' | 'manual' | 'acerto' | 'multa'
interface Linha { id: string; origem: Origem; data: string; quem: string; detalhe: string; forma: string | null; valor: number; unidade: string; reservationId: string | null; manual: EntradaManual | null }

const ROTULO: Record<Origem, string> = { festa: 'Pagamento de festa', manual: 'Lançada à mão', acerto: 'Acerto entre unidades', multa: 'Multa e juros' }
const COR: Record<Origem, string> = { festa: 'bg-teal-light text-teal', manual: 'bg-purple-light text-purple', acerto: 'bg-paper text-ink/70', multa: 'bg-amber-light text-amber' }

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
const dataBr = (iso: string) => iso.split('-').reverse().join('/')

export function ListaDeEntradas({ slugs, unitDbIds, recarga, onEditar, onRemover }: {
  slugs: string[]
  unitDbIds: Record<string, { unitId: string }>
  recarga: unknown
  onEditar: (e: EntradaManual) => void
  onRemover: (e: EntradaManual) => void
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
        .from('payments')
        .select('id, amount, payment_date, payment_method, notes, reservation:reservations!inner(id, unit_id, event_date, child_name, client:clients(name))')
        .in('reservation.unit_id', ids)
        .gte('payment_date', startIso)
        .lt('payment_date', endIso)
        .order('payment_date', { ascending: false })
        .limit(2000),
      supabase
        .from('other_incomes')
        .select('id, unit_id, kind, category, description, amount, received_date, payment_method')
        .in('unit_id', ids)
        .gte('received_date', startIso)
        .lt('received_date', endIso)
        .order('received_date', { ascending: false })
        .limit(2000),
    ]).then(([p, o]) => {
      if (!vivo) return
      if (p.error || o.error) {
        setErro('Não foi possível carregar as entradas.')
        setLinhas([])
        return
      }
      const lista: Linha[] = []
      for (const x of (p.data ?? []) as any[]) {
        const r = x.reservation
        lista.push({
          id: `p-${x.id}`,
          origem: 'festa',
          data: x.payment_date,
          quem: `${r?.client?.name ?? 'Cliente'}${r?.child_name ? ` — festa de ${r.child_name}` : ''}`,
          detalhe: [r?.event_date ? `festa em ${dataBr(r.event_date)}` : '', x.notes].filter(Boolean).join(' · '),
          forma: x.payment_method,
          valor: Number(x.amount),
          unidade: nomeUnidade(r?.unit_id),
          reservationId: r?.id ?? null,
          manual: null,
        })
      }
      for (const x of (o.data ?? []) as any[]) {
        const origem: Origem = x.kind === 'manual' ? 'manual' : x.kind === 'multa_juros' ? 'multa' : 'acerto'
        lista.push({
          id: `o-${x.id}`,
          origem,
          data: x.received_date,
          quem: x.description || ROTULO[origem],
          detalhe: origem === 'manual' && x.category ? x.category : '',
          forma: x.payment_method,
          valor: Number(x.amount),
          unidade: nomeUnidade(x.unit_id),
          reservationId: null,
          manual: origem === 'manual'
            ? { id: x.id, unit_id: slugDoId[x.unit_id] ?? '', category: x.category ?? null, description: x.description, amount: Number(x.amount), received_date: x.received_date, payment_method: x.payment_method }
            : null,
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
    const t: Record<'todas' | Origem, { n: number; v: number }> = { todas: { n: 0, v: 0 }, festa: { n: 0, v: 0 }, manual: { n: 0, v: 0 }, acerto: { n: 0, v: 0 }, multa: { n: 0, v: 0 } }
    for (const l of linhas ?? []) {
      t.todas.n++
      t.todas.v += l.valor
      t[l.origem].n++
      t[l.origem].v += l.valor
    }
    return t
  }, [linhas])

  const totalVisivel = visiveis.reduce((s, l) => s + l.valor, 0)
  const varias = slugs.length > 1

  return (
    <Card title="Entradas">
      <p className="text-xs text-muted mb-3">
        Todo dinheiro que entrou no mês: pagamentos das festas, entradas lançadas à mão, acertos entre unidades e multa e juros. As lançadas à mão são editadas aqui; os pagamentos de festa, na própria festa.
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <label className="inline-flex items-center gap-2 text-sm">
          <span className="text-muted">Mês</span>
          <input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} className="border border-line rounded-lg px-2 h-8 text-sm bg-surface" />
        </label>
        <div className="inline-flex flex-wrap rounded-lg border border-line bg-surface p-0.5 gap-0.5" role="tablist" aria-label="Tipo de entrada">
          {(['todas', 'festa', 'manual', 'acerto', 'multa'] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={filtro === k} onClick={() => setFiltro(k)} className={`px-2.5 h-7 rounded-md text-xs font-medium whitespace-nowrap ${filtro === k ? 'bg-purple text-white' : 'text-ink/70 hover:bg-paper'}`}>
              {k === 'todas' ? 'Todas' : k === 'festa' ? 'Pagamentos de festas' : k === 'manual' ? 'Lançadas à mão' : k === 'acerto' ? 'Acertos' : 'Multa e juros'} ({totais[k].n})
            </button>
          ))}
        </div>
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cliente ou descrição…" className="border border-line rounded-lg px-3 h-8 text-sm bg-surface flex-1 min-w-[180px]" aria-label="Buscar" />
      </div>

      {erro && <p className="text-sm bg-danger-light text-danger rounded-lg px-3 py-2 mb-3">{erro}</p>}

      {linhas === null ? (
        <p className="text-sm text-muted py-6 text-center">Carregando…</p>
      ) : visiveis.length === 0 ? (
        <p className="text-sm text-muted py-6 text-center">Nenhuma entrada {filtro === 'todas' ? '' : 'deste tipo '}neste mês{busca ? ' com essa busca' : ''}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="pb-3 font-medium">Recebido em</th>
                {varias && <th className="pb-3 font-medium">Unidade</th>}
                <th className="pb-3 font-medium">Tipo</th>
                <th className="pb-3 font-medium">Cliente ou descrição</th>
                <th className="pb-3 font-medium">Forma</th>
                <th className="pb-3 font-medium text-right">Valor</th>
                <th className="pb-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visiveis.map((l) => (
                <tr key={l.id}>
                  <td className="py-3 text-muted whitespace-nowrap">{dataBr(l.data)}</td>
                  {varias && <td className="py-3 text-muted">{l.unidade}</td>}
                  <td className="py-3"><span className={`inline-flex text-[11px] font-semibold rounded px-1.5 py-0.5 whitespace-nowrap ${COR[l.origem]}`}>{ROTULO[l.origem]}</span></td>
                  <td className="py-3">
                    {l.quem}
                    {l.detalhe && <span className="block text-xs text-muted">{l.detalhe}</span>}
                  </td>
                  <td className="py-3 text-muted">{l.forma ? PAYMENT_METHOD_LABEL[l.forma as PaymentMethod] ?? l.forma : '—'}</td>
                  <td className="py-3 text-right text-teal font-medium whitespace-nowrap">{brl(l.valor)}</td>
                  <td className="py-3 text-right">
                    {l.reservationId ? (
                      <Link to={`/reservas/${l.reservationId}?aba=financeiro`} className="inline-flex items-center gap-1 text-xs font-medium text-purple whitespace-nowrap">
                        Abrir festa <ExternalLink className="w-3 h-3" />
                      </Link>
                    ) : l.manual ? (
                      <div className="flex items-center justify-end gap-3">
                        <Can permission="action:financeiro.registrar_despesa">
                          <button onClick={() => onEditar(l.manual!)} className="text-muted hover:text-purple" aria-label="Editar entrada">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        </Can>
                        <Can permission="action:financeiro.remover">
                          <button onClick={() => onRemover(l.manual!)} className="text-muted hover:text-danger" aria-label="Remover entrada">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </Can>
                      </div>
                    ) : (
                      <span className="text-[11px] text-muted" title="Muda só pela tela de Acertos entre unidades ou pelas parcelas da festa">travada</span>
                    )}
                  </td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td colSpan={varias ? 5 : 4} className="pt-3">Total ({visiveis.length} entrada{visiveis.length === 1 ? '' : 's'})</td>
                <td className="pt-3 text-right text-teal whitespace-nowrap">{brl(totalVisivel)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
