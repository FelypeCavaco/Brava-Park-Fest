import { useCallback, useEffect, useState } from 'react'
import { Banknote, ChevronLeft, ChevronRight, Plus, X, TrendingUp, TrendingDown, Scale, CalendarClock, Check, Wallet } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import { UNITS, useUnit } from '../lib/UnitContext'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { NovoLancamento } from '../components/NovoLancamento'
import { brl, friendlyDbError } from '../lib/format'
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type PaymentMethod } from '../types'

// Financeiro básico das casas que só têm a recreação (sem a gestão de festas):
// o mês em uma tela, o que entrou, o que saiu, as contas a pagar e o resultado.

interface Fin {
  mes: string
  entradas: { total: number; anterior: number; por_origem: { origem: string; valor: number }[]; por_forma: { forma: string; valor: number }[] }
  saidas: { total: number; anterior: number; por_categoria: { categoria: string; valor: number }[] }
  a_pagar: number; atrasado: number; no_caixa_aberto: number
  por_dia: { dia: string; entradas: number; saidas: number }[]
  contas: { id: string; vencimento: string; categoria: string; descricao: string | null; fornecedor: string | null; valor: number; status: string; unidade: string }[]
  ultimas_entradas: { data: string; descricao: string | null; valor: number; forma: string | null }[]
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const dataBr = (d: string) => d.split('-').reverse().slice(0, 2).join('/')
const forma = (f: string | null) => (f && PAYMENT_METHOD_LABEL[f as PaymentMethod]) || (f === 'outra' || !f ? 'Outra' : f)

export function FinanceiroRecreacao() {
  const { can } = useAuth()
  const { selectedUnit, unitDbIds } = useUnit()
  const unitId = selectedUnit === 'todas' ? null : unitDbIds[selectedUnit]?.unitId ?? null
  const [mes, setMes] = useState(() => { const h = new Date(); return new Date(h.getFullYear(), h.getMonth(), 1) })
  const [f, setF] = useState<Fin | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [novo, setNovo] = useState(false)
  const [pagando, setPagando] = useState<{ id: string; forma: PaymentMethod } | null>(null)

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('rec_financeiro', { p_mes: iso(mes), p_unit: unitId })
    if (error) return setErro(friendlyDbError(error.message))
    setErro(null); setF(data as Fin)
  }, [mes, unitId])
  useEffect(() => { setF(null); carregar() }, [carregar])

  async function pagar(id: string, fp: PaymentMethod) {
    const { error } = await supabase.from('expenses').update({ status: 'pago', paid_date: iso(new Date()), payment_method: fp }).eq('id', id)
    if (error) return setErro('Não foi possível marcar como paga. Tente de novo.')
    setPagando(null); setMsg('Conta marcada como paga.'); carregar()
  }

  const ehAtual = iso(mes) === iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const resultado = f ? Number(f.entradas.total) - Number(f.saidas.total) : 0
  const maxDia = Math.max(1, ...(f?.por_dia ?? []).map((d) => Math.max(Number(d.entradas), Number(d.saidas))))
  const varEnt = f && Number(f.entradas.anterior) > 0 ? Math.round(((Number(f.entradas.total) - Number(f.entradas.anterior)) / Number(f.entradas.anterior)) * 100) : null

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex flex-wrap items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple to-purple-dark text-white flex items-center justify-center shadow-lg shadow-purple/30 shrink-0"><Banknote className="w-6 h-6" strokeWidth={1.75} /></div>
        <div className="flex-1 min-w-[14rem]">
          <h1 className="text-2xl font-semibold">Financeiro</h1>
          <p className="text-sm text-muted">O mês da sua casa em uma tela: entradas, saídas, contas a pagar e resultado.</p>
        </div>
        {(can('action:financeiro.registrar_despesa')) && <Button onClick={() => setNovo(true)}><Plus className="w-4 h-4" />Novo lançamento</Button>}
      </div>

      <div className="flex items-center gap-2">
        <button type="button" aria-label="Mês anterior" onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))} className="w-9 h-9 rounded-full border border-line bg-surface flex items-center justify-center hover:border-purple/40"><ChevronLeft className="w-4 h-4" /></button>
        <span className="font-semibold min-w-[10rem] text-center first-letter:uppercase">{MESES[mes.getMonth()]} de {mes.getFullYear()}</span>
        <button type="button" aria-label="Próximo mês" disabled={ehAtual} onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))} className="w-9 h-9 rounded-full border border-line bg-surface flex items-center justify-center hover:border-purple/40 disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
      </div>

      {erro && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5 flex justify-between gap-2"><span>{erro}</span><button onClick={() => setErro(null)} aria-label="Fechar aviso"><X className="w-4 h-4" /></button></div>}
      {msg && <div className="bg-teal-light text-teal text-sm rounded-lg px-4 py-2.5 flex justify-between gap-2"><span className="flex items-center gap-2"><Check className="w-4 h-4" />{msg}</span><button onClick={() => setMsg(null)} aria-label="Fechar aviso"><X className="w-4 h-4" /></button></div>}
      {!f && !erro && <Card><p className="text-sm text-muted text-center py-6">Carregando...</p></Card>}

      {f && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Numero icone={TrendingUp} rotulo="Entradas" valor={brl(Number(f.entradas.total))} cor="text-teal"
              dica={varEnt == null ? 'sem mês anterior para comparar' : `${varEnt >= 0 ? '+' : ''}${varEnt}% sobre o mês anterior`} />
            <Numero icone={TrendingDown} rotulo="Saídas pagas" valor={brl(Number(f.saidas.total))} cor="text-danger" dica={`mês anterior ${brl(Number(f.saidas.anterior))}`} />
            <Numero icone={Scale} rotulo="Resultado" valor={brl(resultado)} cor={resultado >= 0 ? 'text-teal' : 'text-danger'} dica={resultado >= 0 ? 'entrou mais do que saiu' : 'saiu mais do que entrou'} />
            <Numero icone={CalendarClock} rotulo="A pagar" valor={brl(Number(f.a_pagar))} cor={Number(f.atrasado) > 0 ? 'text-danger' : undefined} dica={Number(f.atrasado) > 0 ? `${brl(Number(f.atrasado))} em atraso` : 'nada em atraso'} />
          </div>
          {Number(f.no_caixa_aberto) > 0 && ehAtual && (
            <p className="text-sm rounded-lg bg-purple-light text-purple px-4 py-2.5 flex items-center gap-2"><Wallet className="w-4 h-4 shrink-0" />Há {brl(Number(f.no_caixa_aberto))} em caixa aberto da recreação. Esse valor entra nas entradas quando o caixa for fechado.</p>
          )}

          <Card>
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <h2 className="font-semibold flex-1">Dia a dia</h2>
              <span className="text-xs text-muted flex items-center gap-3"><span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-teal inline-block" />Entradas</span><span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-danger/80 inline-block" />Saídas</span></span>
            </div>
            <div className="flex items-end gap-[3px] h-36" role="img" aria-label="Entradas e saídas por dia">
              {f.por_dia.map((d) => (
                <div key={d.dia} className="flex-1 min-w-0 h-full flex items-end justify-center gap-px" title={`${dataBr(d.dia)}: entrou ${brl(Number(d.entradas))}, saiu ${brl(Number(d.saidas))}`}>
                  <div className="flex-1 rounded-t bg-teal min-h-[1px]" style={{ height: `${(Number(d.entradas) / maxDia) * 100}%` }} />
                  <div className="flex-1 rounded-t bg-danger/80 min-h-[1px]" style={{ height: `${(Number(d.saidas) / maxDia) * 100}%` }} />
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-muted mt-1"><span>{dataBr(f.por_dia[0].dia)}</span><span>{dataBr(f.por_dia[f.por_dia.length - 1].dia)}</span></div>
          </Card>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <h2 className="font-semibold mb-3">De onde veio o dinheiro</h2>
              {f.entradas.por_origem.length === 0 ? <Vazio /> : <Barras itens={f.entradas.por_origem.map((o) => ({ nome: o.origem, valor: Number(o.valor) }))} cor="bg-teal" />}
              {f.entradas.por_forma.length > 0 && (
                <>
                  <h3 className="font-semibold text-sm mt-5 mb-2">Por forma de pagamento</h3>
                  <Barras itens={f.entradas.por_forma.map((o) => ({ nome: forma(o.forma), valor: Number(o.valor) }))} cor="bg-purple" />
                </>
              )}
            </Card>
            <Card>
              <h2 className="font-semibold mb-3">Para onde foi</h2>
              {f.saidas.por_categoria.length === 0 ? <Vazio texto="Nenhuma conta paga neste mês." /> : <Barras itens={f.saidas.por_categoria.map((o) => ({ nome: o.categoria, valor: Number(o.valor) }))} cor="bg-danger/80" />}
            </Card>
          </div>

          <Card>
            <h2 className="font-semibold mb-3">Contas a pagar</h2>
            {f.contas.length === 0 ? <Vazio texto="Nenhuma conta pendente." /> : (
              <ul className="divide-y divide-line">
                {f.contas.map((c) => (
                  <li key={c.id} className="py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
                    <span className={`w-14 font-semibold ${c.status === 'atrasado' ? 'text-danger' : ''}`}>{dataBr(c.vencimento)}</span>
                    <span className="flex-1 min-w-[10rem]"><b>{c.descricao || c.categoria}</b><span className="text-muted"> · {c.categoria}{c.fornecedor ? ` · ${c.fornecedor}` : ''}</span></span>
                    {c.status === 'atrasado' && <span className="text-[11px] font-bold rounded-full bg-danger-light text-danger px-2 py-0.5">atrasada</span>}
                    <span className="font-bold">{brl(Number(c.valor))}</span>
                    {can('action:financeiro.registrar_despesa') && (pagando?.id === c.id ? (
                      <span className="flex items-center gap-1.5">
                        <select className="campo !py-1 !text-xs" value={pagando.forma} onChange={(e) => setPagando({ id: c.id, forma: e.target.value as PaymentMethod })} aria-label="Forma de pagamento">
                          {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>)}
                        </select>
                        <Button className="!py-1 !px-2.5 !text-xs" onClick={() => pagar(c.id, pagando.forma)}>Confirmar</Button>
                        <button type="button" className="text-xs text-muted" onClick={() => setPagando(null)}>cancelar</button>
                      </span>
                    ) : <Button variant="secondary" className="!py-1 !px-2.5 !text-xs" onClick={() => setPagando({ id: c.id, forma: 'pix' as PaymentMethod })}>Marcar como paga</Button>)}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {f.ultimas_entradas.length > 0 && (
            <Card>
              <h2 className="font-semibold mb-3">Últimas entradas do mês</h2>
              <ul className="divide-y divide-line text-sm">{f.ultimas_entradas.map((e, i) => (
                <li key={i} className="py-2 flex flex-wrap gap-x-4"><span className="w-14 text-muted">{dataBr(e.data)}</span><span className="flex-1 min-w-[8rem]">{e.descricao || 'Entrada'}</span><span className="text-muted">{forma(e.forma)}</span><span className="font-semibold text-teal">{brl(Number(e.valor))}</span></li>
              ))}</ul>
            </Card>
          )}
        </>
      )}

      {novo && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setNovo(false)} />
          <div className="relative w-full max-w-3xl my-6">
            <button type="button" onClick={() => setNovo(false)} className="absolute right-3 top-3 z-10 text-muted hover:text-ink" aria-label="Fechar"><X className="w-5 h-5" /></button>
            <NovoLancamento unitDbIds={unitDbIds} defaultUnit={selectedUnit === 'todas' ? UNITS[0]?.id ?? '' : selectedUnit} categoriasUsadas={[]} onSaved={() => { setNovo(false); carregar() }} />
          </div>
        </div>
      )}
    </div>
  )
}

function Numero({ icone: Ic, rotulo, valor, dica, cor }: { icone: typeof Banknote; rotulo: string; valor: string; dica?: string; cor?: string }) {
  return (
    <div className="bg-surface border border-line rounded-card p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted flex items-center gap-1.5"><Ic className="w-3.5 h-3.5" />{rotulo}</p>
      <p className={`font-display font-bold text-xl mt-1 truncate ${cor ?? ''}`}>{valor}</p>
      {dica && <p className="text-[11px] text-muted mt-0.5">{dica}</p>}
    </div>
  )
}

function Barras({ itens, cor }: { itens: { nome: string; valor: number }[]; cor: string }) {
  const total = itens.reduce((a, x) => a + Math.max(0, x.valor), 0) || 1
  return (
    <ul className="space-y-2.5">{itens.map((o) => (
      <li key={o.nome}>
        <div className="flex justify-between text-sm"><span className="font-semibold">{o.nome}</span><span className="font-bold">{brl(o.valor)}</span></div>
        <div className="h-2 rounded-full bg-line mt-1 overflow-hidden"><div className={`h-full rounded-full ${cor}`} style={{ width: `${Math.max(0, (o.valor / total) * 100)}%` }} /></div>
      </li>
    ))}</ul>
  )
}
const Vazio = ({ texto = 'Nada neste mês.' }: { texto?: string }) => <p className="text-sm text-muted py-2">{texto}</p>
