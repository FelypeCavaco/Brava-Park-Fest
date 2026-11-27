import { useCallback, useEffect, useMemo, useState } from 'react'
import { Beer, Plus, Minus, X, Check, Wallet, Users, PackageX } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Can } from './Can'
import { brl, friendlyDbError, parseDecimal } from '../lib/format'
import { PAYMENT_METHOD_LABEL, type PaymentMethod } from '../types'

// Vendas no bar durante a festa (migração 101). Pago na hora vira entrada no
// Financeiro; na conta do dono soma no valor da festa. O estoque baixa e o
// custo entra na festa nos dois casos. Cancelar devolve tudo, com motivo.

interface Bebida { id: string; name: string; sale_price: number; quantity: number; unit_of_measure: string }
interface Venda {
  id: string; modo: 'pago' | 'conta'; forma: string | null; total: number; custo: number | null; vendido_em: string
  criado_por: string | null; cancelada_em: string | null; cancelada_por: string | null; motivo_cancelamento: string | null
  payment_id?: string | null
  bar_venda_itens: { nome: string; quantidade: number; preco_unit: number }[]
}
export interface TotaisBar { pagoNaHora: number; naConta: number; custo: number }
interface Linha { chave: string; item: string | null; nome: string; quantidade: number; preco: number }

const FORMAS: PaymentMethod[] = ['pix', 'cartao_debito', 'cartao_credito', 'dinheiro']
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
const qtdTxt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })

export function VendasBar({ reservationId, unitId, onMudou, onTotais }: {
  reservationId: string; unitId: string; onMudou: () => void; onTotais: (t: TotaisBar) => void
}) {
  const [vendas, setVendas] = useState<Venda[]>([])
  const [bebidas, setBebidas] = useState<Bebida[]>([])
  const [aberto, setAberto] = useState(false)
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [modo, setModo] = useState<'pago' | 'conta'>('pago')
  const [forma, setForma] = useState<PaymentMethod>('pix')
  const [donoPagou, setDonoPagou] = useState(false) // venda na conta, mas o dono já pagou agora
  const [recebendo, setRecebendo] = useState<{ id: string; forma: PaymentMethod } | null>(null)
  const [avulso, setAvulso] = useState<{ nome: string; preco: string; qtd: string } | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const [cancelando, setCancelando] = useState<{ id: string; motivo: string } | null>(null)
  const [semTabela, setSemTabela] = useState(false)

  const carregar = useCallback(async () => {
    const [v, b] = await Promise.all([
      supabase.from('bar_vendas')
        .select('id, modo, forma, total, custo, vendido_em, criado_por, cancelada_em, cancelada_por, motivo_cancelamento, payment_id, bar_venda_itens(nome, quantidade, preco_unit)')
        .eq('reservation_id', reservationId).order('vendido_em', { ascending: false }),
      supabase.from('inventory_items').select('id, name, sale_price, quantity, unit_of_measure').eq('unit_id', unitId).not('sale_price', 'is', null).order('name'),
    ])
    if (v.error) { setSemTabela(/bar_vendas|sale_price/.test(v.error.message)); return }
    const lista = (v.data ?? []).map((x: any) => ({ ...x, total: Number(x.total), custo: x.custo != null ? Number(x.custo) : null,
      bar_venda_itens: (x.bar_venda_itens ?? []).map((i: any) => ({ nome: i.nome, quantidade: Number(i.quantidade), preco_unit: Number(i.preco_unit) })) })) as Venda[]
    setVendas(lista)
    setBebidas(((b.data ?? []) as any[]).map((x) => ({ id: x.id, name: x.name, sale_price: Number(x.sale_price), quantity: Number(x.quantity), unit_of_measure: x.unit_of_measure })))
  }, [reservationId, unitId])
  useEffect(() => { carregar() }, [carregar])

  const ativas = vendas.filter((v) => !v.cancelada_em)
  const totais: TotaisBar = useMemo(() => ({
    pagoNaHora: ativas.filter((v) => v.modo === 'pago').reduce((s, v) => s + v.total, 0),
    naConta: ativas.filter((v) => v.modo === 'conta').reduce((s, v) => s + v.total, 0),
    custo: ativas.reduce((s, v) => s + (v.custo ?? 0), 0),
  }), [vendas]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onTotais(totais) }, [totais]) // eslint-disable-line react-hooks/exhaustive-deps

  const totalVenda = linhas.reduce((s, l) => s + Math.round(l.quantidade * l.preco * 100) / 100, 0)

  function somar(b: Bebida, d: number) {
    setLinhas((prev) => {
      const at = prev.find((l) => l.item === b.id)
      if (!at) return d > 0 ? [...prev, { chave: b.id, item: b.id, nome: b.name, quantidade: d, preco: b.sale_price }] : prev
      const q = at.quantidade + d
      return q <= 0 ? prev.filter((l) => l.item !== b.id) : prev.map((l) => (l.item === b.id ? { ...l, quantidade: q } : l))
    })
  }
  function adicionarAvulso() {
    if (!avulso) return
    const preco = parseDecimal(avulso.preco), q = parseDecimal(avulso.qtd)
    if (!avulso.nome.trim() || preco == null || !q) return setMsg({ ok: false, texto: 'Preencha nome, quantidade e preço do item.' })
    setLinhas((prev) => [...prev, { chave: `a${Date.now()}`, item: null, nome: avulso.nome.trim(), quantidade: q, preco }])
    setAvulso(null); setMsg(null)
  }
  function fechar() { setAberto(false); setLinhas([]); setAvulso(null); setModo('pago'); setForma('pix'); setDonoPagou(false) }

  async function receber() {
    if (!recebendo) return
    const { error } = await supabase.rpc('bar_receber', { p_venda: recebendo.id, p_forma: recebendo.forma })
    if (error) return setMsg({ ok: false, texto: friendlyDbError(error.message) })
    setRecebendo(null)
    setMsg({ ok: true, texto: 'Pagamento das bebidas lançado na festa.' })
    await carregar(); onMudou()
  }

  async function confirmar() {
    if (!linhas.length) return
    setSalvando(true); setMsg(null)
    const { error } = await supabase.rpc('bar_vender', {
      p_reservation: reservationId, p_modo: modo, p_forma: modo === 'pago' || donoPagou ? forma : null, p_dono_pagou: modo === 'conta' && donoPagou,
      p_itens: linhas.map((l) => (l.item ? { item: l.item, quantidade: l.quantidade, preco: l.preco } : { nome: l.nome, quantidade: l.quantidade, preco: l.preco })),
    })
    setSalvando(false)
    if (error) return setMsg({ ok: false, texto: friendlyDbError(error.message) })
    setMsg({ ok: true, texto: modo === 'pago'
      ? `Venda de ${brl(totalVenda)} registrada. O estoque baixou e o valor já está no Financeiro (Vendas no bar, ${PAYMENT_METHOD_LABEL[forma].toLowerCase()}).`
      : donoPagou
        ? `Venda de ${brl(totalVenda)} registrada na festa e já paga (${PAYMENT_METHOD_LABEL[forma].toLowerCase()}). O estoque baixou e a festa continua com o pagamento em dia.`
        : `Venda de ${brl(totalVenda)} registrada na conta do dono da festa. O estoque baixou e o valor somou no total da festa. Quando ele pagar, use "Marcar como paga" na venda.` })
    fechar(); await carregar(); onMudou()
  }

  async function cancelar() {
    if (!cancelando) return
    const { error } = await supabase.rpc('bar_cancelar', { p_venda: cancelando.id, p_motivo: cancelando.motivo })
    if (error) return setMsg({ ok: false, texto: friendlyDbError(error.message) })
    setCancelando(null)
    setMsg({ ok: true, texto: 'Venda cancelada: o estoque voltou e o valor saiu da festa e do Financeiro.' })
    await carregar(); onMudou()
  }

  if (semTabela) return null
  const vendido = totais.pagoNaHora + totais.naConta
  const lucro = vendido - totais.custo

  return (
    <Card title="Vendas no bar" action={<Beer className="w-4 h-4 text-amber" />} className="md:col-span-2">
      <p className="text-xs text-muted mb-3">
        Bebidas vendidas durante a festa. Pago na hora entra no Financeiro na hora; na conta do dono soma no valor da festa. O estoque baixa e o lucro do bar entra no lucro da festa.
      </p>

      {vendido > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          <Resumo rotulo="Vendido" valor={brl(vendido)} />
          <Resumo rotulo="Pago na hora / na conta" valor={`${brl(totais.pagoNaHora)} · ${brl(totais.naConta)}`} pequeno />
          <Resumo rotulo="Custo das bebidas" valor={brl(totais.custo)} />
          <Resumo rotulo="Lucro do bar" valor={brl(lucro)} destaque={lucro >= 0 ? 'teal' : 'danger'} />
        </div>
      )}

      {msg && <div className={`text-sm rounded-lg px-3 py-2 mb-3 flex justify-between gap-2 ${msg.ok ? 'bg-teal-light text-teal' : 'bg-danger-light text-danger'}`}>{msg.texto}<button onClick={() => setMsg(null)} aria-label="Fechar aviso"><X className="w-4 h-4" /></button></div>}

      <Can permission="action:festa.vendas_bar">
        {!aberto ? (
          <Button onClick={() => { setAberto(true); setMsg(null) }}><Plus className="w-4 h-4" />Nova venda</Button>
        ) : (
          <div className="rounded-xl border border-amber/30 bg-amber-light/30 p-4 space-y-4 animate-card-in">
            {bebidas.length === 0 ? (
              <p className="text-sm text-muted">Nenhuma bebida desta unidade tem preço de venda. Defina em <b>Estoque</b> → editar o item → <b>Preço de venda no bar</b>.</p>
            ) : (
              <div>
                <p className="text-xs font-semibold text-muted mb-2">Toque para adicionar</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {bebidas.map((b) => {
                    const l = linhas.find((x) => x.item === b.id)
                    return (
                      <div key={b.id} className={`rounded-lg border bg-surface p-2.5 transition-all ${l ? 'border-amber shadow-sm' : 'border-line'}`}>
                        <button type="button" onClick={() => somar(b, 1)} className="w-full text-left">
                          <p className="text-sm font-semibold leading-tight">{b.name}</p>
                          <p className="text-xs text-muted">{brl(b.sale_price)} · tem {qtdTxt(b.quantity)} {b.unit_of_measure}</p>
                        </button>
                        {l && (
                          <div className="flex items-center gap-2 mt-2">
                            <button type="button" onClick={() => somar(b, -1)} className="w-7 h-7 rounded-md border border-line flex items-center justify-center" aria-label={`Tirar um ${b.name}`}><Minus className="w-3.5 h-3.5" /></button>
                            <span className="font-display font-bold tabular-nums w-6 text-center">{qtdTxt(l.quantidade)}</span>
                            <button type="button" onClick={() => somar(b, 1)} className="w-7 h-7 rounded-md border border-line flex items-center justify-center" aria-label={`Mais um ${b.name}`}><Plus className="w-3.5 h-3.5" /></button>
                            {l.quantidade > b.quantity && <span className="text-[10px] text-amber leading-tight">mais do que tem no estoque</span>}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {avulso ? (
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs text-muted">Item fora do estoque<input className="campo mt-1 !w-48" value={avulso.nome} onChange={(e) => setAvulso({ ...avulso, nome: e.target.value })} placeholder="Ex.: Chopp (litro)" /></label>
                <label className="text-xs text-muted">Quantidade<input className="campo mt-1 !w-20" inputMode="decimal" value={avulso.qtd} onChange={(e) => setAvulso({ ...avulso, qtd: e.target.value })} /></label>
                <label className="text-xs text-muted">Preço<input className="campo mt-1 !w-24" inputMode="decimal" value={avulso.preco} onChange={(e) => setAvulso({ ...avulso, preco: e.target.value })} placeholder="R$" /></label>
                <Button type="button" variant="secondary" onClick={adicionarAvulso}>Adicionar</Button>
                <button type="button" className="text-xs text-muted" onClick={() => setAvulso(null)}>cancelar</button>
              </div>
            ) : (
              <button type="button" onClick={() => setAvulso({ nome: '', preco: '', qtd: '1' })} className="text-xs font-medium text-purple inline-flex items-center gap-1"><PackageX className="w-3.5 h-3.5" />Item que não está no estoque (ex.: chopp por litro)</button>
            )}

            {linhas.length > 0 && (
              <>
                <div className="rounded-lg bg-surface border border-line divide-y divide-line text-sm">
                  {linhas.map((l) => (
                    <div key={l.chave} className="flex items-center gap-2 px-3 py-2">
                      <span className="flex-1">{qtdTxt(l.quantidade)}× {l.nome}{!l.item && <span className="text-[11px] text-muted"> · sem estoque</span>}</span>
                      <label className="text-xs text-muted flex items-center gap-1">R$
                        <input className="campo !w-20 !py-1 text-right" inputMode="decimal" defaultValue={String(l.preco).replace('.', ',')}
                          onBlur={(e) => { const p = parseDecimal(e.target.value); if (p != null) setLinhas((prev) => prev.map((x) => (x.chave === l.chave ? { ...x, preco: p } : x))) }} aria-label={`Preço de ${l.nome}`} />
                      </label>
                      <span className="w-24 text-right tabular-nums font-medium">{brl(l.quantidade * l.preco)}</span>
                      <button type="button" onClick={() => setLinhas((prev) => prev.filter((x) => x.chave !== l.chave))} className="text-muted hover:text-danger" aria-label={`Tirar ${l.nome}`}><X className="w-4 h-4" /></button>
                    </div>
                  ))}
                </div>

                <div className="grid sm:grid-cols-2 gap-2">
                  <Escolha ativo={modo === 'pago'} onClick={() => setModo('pago')} icone={Wallet} titulo="Pagou agora" texto="Entra hoje no Financeiro, como Vendas no bar." />
                  <Escolha ativo={modo === 'conta'} onClick={() => setModo('conta')} icone={Users} titulo="Na conta do dono da festa" texto="Soma no valor da festa; entra quando ele pagar." />
                </div>
                {modo === 'conta' && (
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={donoPagou} onChange={(e) => setDonoPagou(e.target.checked)} />
                    O dono da festa já pagou estas bebidas agora
                  </label>
                )}
                {(modo === 'pago' || donoPagou) && (
                  <div className="flex flex-wrap gap-1.5">
                    {FORMAS.map((f) => (
                      <button key={f} type="button" onClick={() => setForma(f)} className={`px-3 h-8 rounded-full text-xs font-semibold border ${forma === f ? 'bg-purple text-white border-purple' : 'border-line bg-surface'}`}>{PAYMENT_METHOD_LABEL[f]}</button>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="font-display text-xl font-bold">Total: {brl(totalVenda)}</span>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={fechar}>Cancelar</Button>
                    <Button onClick={confirmar} disabled={salvando}><Check className="w-4 h-4" />{salvando ? 'Registrando...' : 'Confirmar venda'}</Button>
                  </div>
                </div>
              </>
            )}
            {linhas.length === 0 && <div className="flex justify-end"><Button variant="ghost" onClick={fechar}>Fechar</Button></div>}
          </div>
        )}
      </Can>

      <div className="mt-4 divide-y divide-line">
        {vendas.length === 0 && <p className="text-sm text-muted py-2">Nenhuma venda no bar nesta festa.</p>}
        {vendas.map((v) => (
          <div key={v.id} className={`py-2.5 text-sm ${v.cancelada_em ? 'opacity-60' : ''}`}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-muted tabular-nums">{hora(v.vendido_em)}</span>
              <span className="flex-1 min-w-[10rem]">{v.bar_venda_itens.map((i) => `${qtdTxt(i.quantidade)}× ${i.nome}`).join(', ')}</span>
              <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${v.modo === 'pago' ? 'bg-teal-light text-teal' : 'bg-purple-light text-purple-dark'}`}>
                {v.modo === 'pago' ? `pago · ${PAYMENT_METHOD_LABEL[v.forma as PaymentMethod] ?? v.forma}` : v.payment_id ? `na conta do dono · paga${v.forma ? ` (${PAYMENT_METHOD_LABEL[v.forma as PaymentMethod] ?? v.forma})` : ''}` : 'na conta do dono · falta receber'}
              </span>
              <span className={`w-24 text-right tabular-nums font-semibold ${v.cancelada_em ? 'line-through' : ''}`}>{brl(v.total)}</span>
              {!v.cancelada_em && v.modo === 'conta' && !v.payment_id && (
                <Can permission="action:festa.vendas_bar">
                  <button type="button" className="text-xs font-semibold text-purple hover:underline" onClick={() => setRecebendo({ id: v.id, forma: 'pix' })}>marcar como paga</button>
                </Can>
              )}
              {!v.cancelada_em && (
                <Can permission="action:festa.vendas_bar">
                  <button type="button" className="text-xs text-muted hover:text-danger" onClick={() => setCancelando({ id: v.id, motivo: '' })}>cancelar</button>
                </Can>
              )}
            </div>
            <p className="text-[11px] text-muted mt-0.5">
              {v.criado_por ? `por ${v.criado_por}` : ''}{v.custo != null && !v.cancelada_em ? ` · custo ${brl(v.custo)}` : ''}
              {v.cancelada_em ? ` · cancelada por ${v.cancelada_por ?? '—'}: ${v.motivo_cancelamento}` : ''}
            </p>
            {recebendo?.id === v.id && (
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <span className="text-xs text-muted mr-1">O dono pagou {brl(v.total)} no:</span>
                {FORMAS.map((f) => (
                  <button key={f} type="button" onClick={() => setRecebendo({ id: v.id, forma: f })} className={`px-3 h-8 rounded-full text-xs font-semibold border ${recebendo.forma === f ? 'bg-purple text-white border-purple' : 'border-line bg-surface'}`}>{PAYMENT_METHOD_LABEL[f]}</button>
                ))}
                <Button variant="secondary" onClick={receber}>Lançar pagamento</Button>
                <button type="button" className="text-xs text-muted" onClick={() => setRecebendo(null)}>voltar</button>
              </div>
            )}
            {cancelando?.id === v.id && (
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <input className="campo !w-72" autoFocus value={cancelando.motivo} onChange={(e) => setCancelando({ ...cancelando, motivo: e.target.value })} placeholder="Motivo do cancelamento (obrigatório)" />
                <Button variant="secondary" onClick={cancelar} disabled={cancelando.motivo.trim().length < 3}>Cancelar venda</Button>
                <button type="button" className="text-xs text-muted" onClick={() => setCancelando(null)}>voltar</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}

function Resumo({ rotulo, valor, destaque, pequeno }: { rotulo: string; valor: string; destaque?: 'teal' | 'danger'; pequeno?: boolean }) {
  return (
    <div className="rounded-lg bg-paper px-3 py-2">
      <p className="text-[11px] text-muted">{rotulo}</p>
      <p className={`font-display font-bold tabular-nums ${pequeno ? 'text-sm' : 'text-lg'} ${destaque === 'teal' ? 'text-teal' : destaque === 'danger' ? 'text-danger' : ''}`}>{valor}</p>
    </div>
  )
}

function Escolha({ ativo, onClick, icone: Icone, titulo, texto }: { ativo: boolean; onClick: () => void; icone: typeof Beer; titulo: string; texto: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={ativo} className={`text-left rounded-lg border-2 px-3 py-2 transition-all ${ativo ? 'border-purple bg-surface' : 'border-line bg-surface/60 hover:border-purple/40'}`}>
      <span className="flex items-center gap-2 text-sm font-semibold"><Icone className={`w-4 h-4 ${ativo ? 'text-purple' : 'text-muted'}`} />{titulo}{ativo && <Check className="w-4 h-4 text-purple ml-auto" />}</span>
      <span className="block text-[11px] text-muted mt-0.5">{texto}</span>
    </button>
  )
}
