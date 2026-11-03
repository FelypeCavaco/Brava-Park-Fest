import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, ArrowDownCircle, ArrowUpCircle } from 'lucide-react'
import { Card } from './ui/Card'
import { supabase } from '../lib/supabaseClient'
import { brl } from '../lib/format'

// Financeiro → Caixa: entradas e saídas do mês, abrindo em níveis.
// Entradas: por forma de pagamento → por festa → cada pagamento.
// Saídas: por categoria → cada conta paga → os itens da compra (quando a
// compra tem itens lançados). Os custos lançados nas festas do mês entram
// como "Custos das festas" → por festa → cada custo.

const FORMA: Record<string, string> = {
  pix: 'Pix', cartao_credito: 'Cartão de crédito', cartao_debito: 'Cartão de débito', dinheiro: 'Dinheiro',
  boleto: 'Boleto', transferencia: 'Transferência', outro: 'Outro',
}
const formaLabel = (m: string | null) => (m ? FORMA[m] ?? m : 'Sem forma informada')
const dataBr = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')

interface No {
  chave: string
  titulo: string
  detalhe?: string
  valor: number
  filhos?: No[]
}

function somar(nos: No[]) {
  return nos.reduce((t, n) => t + n.valor, 0)
}

function Linha({ no, nivel, abertos, alternar }: { no: No; nivel: number; abertos: Set<string>; alternar: (k: string) => void }) {
  const temFilhos = (no.filhos?.length ?? 0) > 0
  const aberto = abertos.has(no.chave)
  return (
    <>
      <button
        type="button"
        onClick={() => temFilhos && alternar(no.chave)}
        className={`w-full flex items-center gap-2 py-2 text-left text-sm ${temFilhos ? 'hover:bg-paper' : 'cursor-default'} ${nivel === 0 ? 'font-semibold' : ''}`}
        style={{ paddingLeft: 8 + nivel * 20, paddingRight: 8 }}
        aria-expanded={temFilhos ? aberto : undefined}
      >
        {temFilhos ? <ChevronRight className={`w-4 h-4 text-muted shrink-0 transition-transform ${aberto ? 'rotate-90' : ''}`} /> : <span className="w-4 shrink-0" />}
        <span className="flex-1 min-w-0">
          <span className={nivel === 0 ? '' : 'text-ink'}>{no.titulo}</span>
          {no.detalhe && <span className="block text-xs text-muted font-normal">{no.detalhe}</span>}
        </span>
        <span className="tabular-nums shrink-0">{brl(no.valor)}</span>
      </button>
      {aberto && no.filhos?.map((f) => <Linha key={f.chave} no={f} nivel={nivel + 1} abertos={abertos} alternar={alternar} />)}
    </>
  )
}

export function FinanceBreakdown({ unitId }: { unitId: string | null }) {
  const hoje = new Date()
  const [mes, setMes] = useState(`${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`)
  const [entradas, setEntradas] = useState<No[]>([])
  const [saidas, setSaidas] = useState<No[]>([])
  const [carregando, setCarregando] = useState(true)
  const [abertos, setAbertos] = useState<Set<string>>(new Set())

  const meses = useMemo(() => {
    const lista: { v: string; l: string }[] = []
    for (let i = -12; i <= 1; i++) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() + i, 1)
      const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const l = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
      lista.push({ v, l: l.charAt(0).toUpperCase() + l.slice(1) })
    }
    return lista.reverse()
  }, [])

  useEffect(() => {
    let ativo = true
    ;(async () => {
      setCarregando(true)
      setAbertos(new Set())
      const ini = `${mes}-01`
      const [a, m] = mes.split('-').map(Number)
      const fim = new Date(a, m, 0).toISOString().slice(0, 10)
      const hojeIso = new Date().toISOString().slice(0, 10)

      let pq = supabase.from('payments')
        .select('id, amount, payment_date, payment_method, reservation:reservations!inner(id, unit_id, event_date, child_name, client:clients(name))')
        .gte('payment_date', ini).lte('payment_date', fim)
      if (unitId) pq = pq.eq('reservation.unit_id', unitId)
      let oq = supabase.from('other_incomes').select('id, amount, received_date, kind, description, payment_method, unit_id').gte('received_date', ini).lte('received_date', fim)
      if (unitId) oq = oq.eq('unit_id', unitId)
      let eq = supabase.from('expenses')
        .select('id, category, description, supplier, amount, paid_date, payment_method, unit_id, expense_items(id, item_name, quantity, line_value)')
        .eq('status', 'pago').gte('paid_date', ini).lte('paid_date', fim)
      if (unitId) eq = eq.eq('unit_id', unitId)
      let cq = supabase.from('reservations')
        .select('id, event_date, child_name, unit_id, client:clients(name), reservation_costs(id, description, amount)')
        .gte('event_date', ini).lte('event_date', fim < hojeIso ? fim : hojeIso).neq('status', 'cancelada')
      if (unitId) cq = cq.eq('unit_id', unitId)

      const [p, o, e, c] = await Promise.all([pq, oq, eq, cq])
      if (!ativo) return

      // ---------- entradas: forma → festa → pagamento ----------
      const porForma = new Map<string, Map<string, { titulo: string; detalhe: string; pags: No[] }>>()
      for (const x of (p.data ?? []) as any[]) {
        const forma = formaLabel(x.payment_method)
        const r = x.reservation
        if (!porForma.has(forma)) porForma.set(forma, new Map())
        const festas = porForma.get(forma)!
        if (!festas.has(r.id)) {
          festas.set(r.id, {
            titulo: r.child_name ? `Festa de ${r.child_name}` : `Festa de ${r.client?.name ?? 'cliente'}`,
            detalhe: `${r.client?.name ?? ''} · festa em ${dataBr(r.event_date)}`,
            pags: [],
          })
        }
        festas.get(r.id)!.pags.push({ chave: `p-${x.id}`, titulo: `Pagamento em ${dataBr(x.payment_date)}`, valor: Number(x.amount) })
      }
      const nosEntrada: No[] = [...porForma.entries()].map(([forma, festas]) => {
        const filhos = [...festas.entries()].map(([id, f]) => ({
          chave: `e-${forma}-${id}`, titulo: f.titulo, detalhe: f.detalhe, valor: somar(f.pags), filhos: f.pags.length > 1 ? f.pags : undefined,
        })).sort((x, y) => y.valor - x.valor)
        return { chave: `e-${forma}`, titulo: `${forma} de festas`, detalhe: `${filhos.length} ${filhos.length === 1 ? 'festa' : 'festas'}`, valor: somar(filhos), filhos }
      })
      const outras = ((o.data ?? []) as any[]).map((x) => ({
        chave: `o-${x.id}`,
        titulo: x.kind === 'multa_juros' ? 'Multa e juros de parcela' : x.description || 'Acerto entre unidades',
        detalhe: `${dataBr(x.received_date)} · ${formaLabel(x.payment_method)}`,
        valor: Number(x.amount),
      }))
      if (outras.length) nosEntrada.push({ chave: 'e-outras', titulo: 'Outras entradas', detalhe: 'Acertos entre unidades, multa e juros', valor: somar(outras), filhos: outras })
      nosEntrada.sort((x, y) => y.valor - x.valor)

      // ---------- saídas: categoria → conta → itens ----------
      const porCat = new Map<string, No[]>()
      for (const x of (e.data ?? []) as any[]) {
        const itens = ((x.expense_items ?? []) as any[]).map((i) => ({
          chave: `i-${i.id}`, titulo: i.item_name, detalhe: `Quantidade: ${Number(i.quantity).toLocaleString('pt-BR')}`, valor: Number(i.line_value ?? 0),
        }))
        const titulo = [x.supplier, x.description].filter(Boolean).join(' · ') || x.category
        const no: No = { chave: `d-${x.id}`, titulo, detalhe: `Paga em ${dataBr(x.paid_date)} · ${formaLabel(x.payment_method)}`, valor: Number(x.amount), filhos: itens.length ? itens : undefined }
        const cat = x.category || 'Outros'
        if (!porCat.has(cat)) porCat.set(cat, [])
        porCat.get(cat)!.push(no)
      }
      const nosSaida: No[] = [...porCat.entries()].map(([cat, contas]) => ({
        chave: `s-${cat}`, titulo: cat, detalhe: `${contas.length} ${contas.length === 1 ? 'conta' : 'contas'}`, valor: somar(contas), filhos: contas.sort((x, y) => y.valor - x.valor),
      }))
      const custos: No[] = ((c.data ?? []) as any[])
        .map((r) => {
          const itens = ((r.reservation_costs ?? []) as any[]).map((k) => ({ chave: `k-${k.id}`, titulo: k.description, valor: Number(k.amount) }))
          return { chave: `cf-${r.id}`, titulo: r.child_name ? `Festa de ${r.child_name}` : `Festa de ${r.client?.name ?? 'cliente'}`, detalhe: `${r.client?.name ?? ''} · ${dataBr(r.event_date)}`, valor: somar(itens), filhos: itens }
        })
        .filter((n) => n.valor > 0)
      if (custos.length) nosSaida.push({ chave: 's-custos-festas', titulo: 'Custos das festas', detalhe: `${custos.length} ${custos.length === 1 ? 'festa realizada' : 'festas realizadas'}`, valor: somar(custos), filhos: custos })
      nosSaida.sort((x, y) => y.valor - x.valor)

      setEntradas(nosEntrada)
      setSaidas(nosSaida)
      setCarregando(false)
    })()
    return () => {
      ativo = false
    }
  }, [mes, unitId])

  const alternar = (k: string) => setAbertos((prev) => {
    const n = new Set(prev)
    if (n.has(k)) n.delete(k)
    else n.add(k)
    return n
  })

  return (
    <Card
      title="Entradas e saídas detalhadas"
      action={
        <select value={mes} onChange={(e) => setMes(e.target.value)} aria-label="Mês" className="h-9 rounded-lg border border-line bg-surface px-2 text-sm">
          {meses.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}
        </select>
      }
    >
      <p className="text-xs text-muted mb-4">Clique numa linha para abrir os detalhes. Entradas pela data do pagamento; contas pela data em que foram pagas; custos das festas pela data da festa (só as que já aconteceram).</p>
      {carregando ? (
        <p className="text-sm text-muted py-6 text-center">Carregando...</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {([['Entradas', entradas, ArrowDownCircle, 'text-teal'], ['Saídas', saidas, ArrowUpCircle, 'text-danger']] as const).map(([rot, nos, Icone, cor]) => (
            <div key={rot} className="min-w-0">
              <div className="flex items-center justify-between border-b border-line pb-2 mb-1">
                <p className={`text-sm font-semibold flex items-center gap-1.5 ${cor}`}><Icone className="w-4 h-4" /> {rot}</p>
                <p className={`font-display font-semibold tabular-nums ${cor}`}>{brl(somar(nos))}</p>
              </div>
              {nos.length === 0 ? (
                <p className="text-sm text-muted py-4">Nada neste mês.</p>
              ) : (
                <div className="divide-y divide-line">
                  {nos.map((n) => <Linha key={n.chave} no={n} nivel={0} abertos={abertos} alternar={alternar} />)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
