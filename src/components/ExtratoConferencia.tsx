import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Check, ChevronRight, Clock, CreditCard, Pencil, RotateCcw, Sparkles, Trash2, X } from 'lucide-react'
import { format, parseISO, subDays } from 'date-fns'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { supabase } from '../lib/supabaseClient'
import { brl, friendlyDbError, parseDecimal } from '../lib/format'
import { EXPENSE_CATEGORIES } from '../types'
import type { ExtratoArquivo } from '../lib/extratoArquivo'

// Conferência do extrato antes de lançar: o sistema simula o envio
// (bank_preview, não grava nada) e mostra o que faria com cada movimento.
// A pessoa pode corrigir data, valor, sinal e descrição, escolher o que
// fazer (festa, conta, despesa com categoria, inclusive nova, receita) ou
// não lançar. Só então envia (bank_import com a escolha de cada um).

type Acao = 'auto' | 'festa' | 'conta' | 'despesa' | 'receita' | 'ignorar' | 'cartao_lancado'

interface Previa {
  status: 'lancado' | 'conciliado' | 'possivel_duplicado' | 'cartao' | 'a_classificar' | 'ignorado' | 'ja_enviado'
  how: string | null
  dup: string | null
  suggestions: { reservation_id?: string; expense_id?: string; payment_id?: string; kind?: string; income_ids?: string[]; bate?: boolean; label: string }[]
}

interface Item {
  id: string
  orig: { data: string; valor: number; descricao: string }
  data: string
  entrada: boolean
  valor: string
  descricao: string
  acao: Acao
  reservationId: string
  expenseId: string
  categoria: string
  novaCategoria: string
  fornecedor: string
  descReceita: string
  lembrar: boolean
  paymentIds: string[]
  incomeIds: string[]
  valorVenda: string
}

const NOVA = '__nova__'
const dia = (iso: string) => format(parseISO(iso), 'dd/MM/yyyy')
const campo = 'h-10 rounded-lg border border-line bg-surface px-3 text-sm w-full'

// Categorias de despesa: as padrão + as que a empresa já usou (no
// Financeiro, "Outros" com nome próprio) + as das regras do extrato.
export function useCategoriasDespesa() {
  const [usadas, setUsadas] = useState<string[]>([])
  useEffect(() => {
    Promise.all([
      supabase.from('expenses').select('category').order('created_at', { ascending: false }).limit(2000),
      supabase.from('bank_rules').select('category').not('category', 'is', null),
    ]).then(([a, b]) => {
      const todas = [...(a.data ?? []), ...(b.data ?? [])].map((r: { category: string | null }) => (r.category ?? '').trim()).filter(Boolean)
      setUsadas([...new Set(todas)])
    })
  }, [])
  return useMemo(() => {
    const extras = usadas.filter((c) => !(EXPENSE_CATEGORIES as readonly string[]).includes(c)).sort((a, b) => a.localeCompare(b, 'pt-BR'))
    return [...EXPENSE_CATEGORIES, ...extras]
  }, [usadas])
}

export function CategoriaCampo({ categorias, valor, nova, onValor, onNova }: {
  categorias: string[]; valor: string; nova: string; onValor: (v: string) => void; onNova: (v: string) => void
}) {
  return (
    <div className="space-y-2">
      <select value={valor} onChange={(e) => onValor(e.target.value)} className={campo} aria-label="Categoria">
        <option value="">Categoria...</option>
        {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
        <option value={NOVA}>+ Nova categoria...</option>
      </select>
      {valor === NOVA && (
        <input value={nova} onChange={(e) => onNova(e.target.value)} placeholder="Nome da nova categoria (ex.: Lanches da equipe)" className={campo} autoFocus />
      )}
    </div>
  )
}
export const categoriaFinal = (valor: string, nova: string) => (valor === NOVA ? nova.trim() : valor)

export function ExtratoConferencia({ unitId, unidade, arquivo, extrato, onLancado, onCancelar }: {
  unitId: string
  unidade?: string
  arquivo: string
  extrato: ExtratoArquivo
  onLancado: (r: { total: number; novas: number; lancadas: number; duplicados: number; cartao?: number; a_classificar: number; ignoradas: number }) => void
  onCancelar: () => void
}) {
  const [itens, setItens] = useState<Item[]>(() => extrato.movimentos.map((m) => ({
    id: m.id, orig: { data: m.data, valor: m.valor, descricao: m.descricao },
    data: m.data, entrada: m.valor > 0, valor: Math.abs(m.valor).toFixed(2).replace('.', ','), descricao: m.descricao,
    acao: 'auto', reservationId: '', expenseId: '', categoria: '', novaCategoria: '', fornecedor: '', descReceita: '', lembrar: true, paymentIds: [], incomeIds: [], valorVenda: '',
  })))
  const [previa, setPrevia] = useState<Record<string, Previa> | null>(null)
  const [erroPrevia, setErroPrevia] = useState<string | null>(null)
  const [aberto, setAberto] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<'todos' | 'atencao' | 'confirmar'>('todos')
  const [festas, setFestas] = useState<{ id: string; label: string }[]>([])
  const [contas, setContas] = useState<{ id: string; label: string }[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // apagados da conferência: não são enviados (dá para desfazer)
  const [apagados, setApagados] = useState<Item[]>([])
  // o que o sistema lançaria sozinho só vale depois que a pessoa confirma (um por um ou em lote)
  const [confirmados, setConfirmados] = useState<Set<string>>(new Set())
  const [loteAberto, setLoteAberto] = useState(false)
  const categorias = useCategoriasDespesa()

  useEffect(() => {
    supabase.rpc('bank_preview', { p_unit: unitId, p_lines: extrato.movimentos }).then(({ data, error }) => {
      if (error) setErroPrevia(friendlyDbError(error.message))
      else setPrevia((data ?? {}) as Record<string, Previa>)
    })
    supabase.from('reservations').select('id, event_date, child_name, client:clients(name)')
      .eq('unit_id', unitId).neq('status', 'cancelada')
      .gte('event_date', format(subDays(parseISO(extrato.inicio ?? extrato.movimentos[0].data), 120), 'yyyy-MM-dd'))
      .order('event_date').limit(500)
      .then(({ data }) => setFestas((data ?? []).map((r: any) => ({
        id: r.id, label: `${format(parseISO(r.event_date), 'dd/MM/yyyy')}${r.child_name ? ' · ' + r.child_name : ''} (${r.client?.name ?? '—'})`,
      }))))
    supabase.from('expenses').select('id, category, description, supplier, amount, due_date')
      .eq('unit_id', unitId).in('status', ['a_vencer', 'atrasado']).order('due_date').limit(400)
      .then(({ data }) => setContas((data ?? []).map((e: any) => ({
        id: e.id, label: `${brl(Number(e.amount))} · ${e.category}${e.supplier || e.description ? ' · ' + (e.supplier || e.description) : ''} · vence ${format(parseISO(e.due_date), 'dd/MM')}`,
      }))))
  }, [unitId, extrato])

  const muda = (id: string, p: Partial<Item>) => {
    // mexeu no movimento: a confirmação anterior não vale mais
    setConfirmados((c) => { if (!c.has(id)) return c; const n = new Set(c); n.delete(id); return n })
    setItens((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)))
  }
  const editado = (x: Item) => x.data !== x.orig.data || x.descricao !== x.orig.descricao
    || (parseDecimal(x.valor) ?? 0) * (x.entrada ? 1 : -1) !== x.orig.valor
  const precisaAtencao = (x: Item) => x.acao === 'auto' && ['possivel_duplicado', 'a_classificar', 'cartao'].includes(previa?.[x.id]?.status ?? '')
  // movimento que o sistema lançaria ou baixaria por conta própria: exige confirmação explícita
  const lancariaSozinho = (x: Item) => x.acao === 'auto' && ['lancado', 'conciliado'].includes(previa?.[x.id]?.status ?? '')
  const exigeConfirmacao = (x: Item) => x.acao === 'auto' && (lancariaSozinho(x) || editado(x) || !previa)
  const aConfirmar = itens.filter((x) => exigeConfirmacao(x) && !confirmados.has(x.id))
  const confirmar = (ids: string[]) => setConfirmados((c) => new Set([...c, ...ids]))
  const visiveis = itens.filter((x) => filtro === 'todos' || precisaAtencao(x) || (filtro === 'confirmar' && aConfirmar.some((a) => a.id === x.id)))
  const naoLancar = itens.filter((x) => x.acao === 'ignorar' || previa?.[x.id]?.status === 'ja_enviado').length

  function apagar(x: Item) {
    setItens((xs) => xs.filter((i) => i.id !== x.id))
    setApagados((a) => [...a, x])
    if (aberto === x.id) setAberto(null)
  }

  function desfazerApagar() {
    const ordem = new Map(extrato.movimentos.map((m, i) => [m.id, i]))
    setItens((xs) => [...xs, ...apagados].sort((a, b) => (ordem.get(a.id) ?? 0) - (ordem.get(b.id) ?? 0)))
    setApagados([])
  }

  function proximo(id: string) {
    const i = visiveis.findIndex((x) => x.id === id)
    setAberto(visiveis[i + 1]?.id ?? null)
  }

  function problema(x: Item): string | null {
    const v = parseDecimal(x.valor)
    if (!v || v <= 0) return 'Informe o valor.'
    if (!x.data) return 'Informe a data.'
    if (x.acao === 'festa' && !x.reservationId) return 'Escolha a festa.'
    if (x.acao === 'conta' && !x.expenseId) return 'Escolha a conta a pagar.'
    if (x.acao === 'despesa' && !categoriaFinal(x.categoria, x.novaCategoria)) return 'Escolha ou crie a categoria.'
    return null
  }

  async function lancar() {
    setErro(null)
    if (itens.length === 0) return setErro('Todos os movimentos foram apagados: não há nada para lançar.')
    if (erroPrevia) return setErro('Não consegui comparar com o sistema. Por segurança, nada é lançado sem essa comparação: tente de novo.')
    if (aConfirmar.length > 0) { setFiltro('confirmar'); return setErro(`Faltam ${aConfirmar.length} movimento${aConfirmar.length > 1 ? 's' : ''} para você confirmar.`) }
    const ruim = itens.find((x) => problema(x))
    if (ruim) { setFiltro('todos'); setAberto(ruim.id); return setErro(`${dia(ruim.data)} · ${ruim.descricao}: ${problema(ruim)}`) }
    const linhas = itens.map((x) => {
      const valor = (parseDecimal(x.valor) ?? 0) * (x.entrada ? 1 : -1)
      const acao = x.acao === 'auto' ? { tipo: 'auto' }
        : x.acao === 'ignorar' ? { tipo: 'ignorar', lembrar: x.lembrar }
        : x.acao === 'festa' ? { tipo: 'festa', reservation_id: x.reservationId, ...(parseDecimal(x.valorVenda) ? { valor: parseDecimal(x.valorVenda) } : {}) }
        : x.acao === 'cartao_lancado' ? { tipo: 'cartao_lancado', payment_ids: x.paymentIds, income_ids: x.incomeIds }
        : x.acao === 'conta' ? { tipo: 'conta', expense_id: x.expenseId }
        : x.acao === 'despesa' ? { tipo: 'despesa', category: categoriaFinal(x.categoria, x.novaCategoria), supplier: x.fornecedor, lembrar: x.lembrar }
        : { tipo: 'receita', description: x.descReceita, lembrar: x.lembrar }
      return { id: x.id, data: x.data, valor: Math.round(valor * 100) / 100, descricao: x.descricao.trim(), acao }
    })
    setBusy(true)
    const { data, error } = await supabase.rpc('bank_import', { p_unit: unitId, p_file_name: arquivo, p_lines: linhas })
    setBusy(false)
    if (error) return setErro(friendlyDbError(error.message))
    onLancado(data as Parameters<typeof onLancado>[0])
  }

  const atencao = itens.filter(precisaAtencao).length

  return (
    <Card title={`Confira um por um antes de lançar${unidade ? ` · ${unidade}` : ''}`}>
      <p className="text-sm">
        <b>{arquivo}</b> ({extrato.formato}): <b>{itens.length}</b> movimentos de {dia(extrato.inicio!)} a {dia(extrato.fim!)}.
        {' '}Use o <b>lápis</b> para corrigir ou escolher o que fazer e a <b>lixeira</b> para tirar da lista. Nada é lançado sozinho: o que o sistema sugere só entra depois que você <b>confirma</b> e clica em <b>Lançar</b>.
      </p>
      {extrato.formato !== 'OFX' && (
        <p className="text-xs text-muted mt-1">
          {extrato.formato === 'PDF' ? 'O PDF é lido pelo texto da página: ' : ''}confira se as datas, os valores e o sinal (entrada ou saída) estão certos.
        </p>
      )}
      {!previa && !erroPrevia && <p className="text-xs text-muted mt-2">Comparando com o que já está no sistema...</p>}
      {erroPrevia && <p className="text-xs text-danger mt-2">Não foi possível comparar com o sistema ({erroPrevia}). Por segurança, nada é lançado sem essa comparação: cancele e tente de novo.</p>}

      {aConfirmar.length > 0 && (
        <div className="mt-3 rounded-lg border border-teal/40 bg-teal-light/50 px-3 py-2.5 text-sm">
          <p><b>{aConfirmar.length}</b> movimento{aConfirmar.length > 1 ? 's' : ''} com sugestão do sistema esperando a sua confirmação. Nada é lançado antes disso.</p>
          <div className="flex flex-wrap gap-2 mt-2">
            <Button variant="secondary" onClick={() => setLoteAberto((v) => !v)}>{loteAberto ? 'Fechar a lista' : `Ver e confirmar os ${aConfirmar.length} de uma vez`}</Button>
            <Button variant="ghost" onClick={() => setFiltro('confirmar')}>Conferir um por um</Button>
          </div>
          {loteAberto && (
            <div className="mt-3 space-y-2">
              <ul className="text-xs divide-y divide-line rounded-lg border border-line bg-surface">
                {aConfirmar.map((x) => (
                  <li key={x.id} className="px-3 py-2 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span className="text-muted tabular-nums">{dia(x.data)}</span>
                    <span className={x.entrada ? 'text-teal font-semibold' : 'text-danger font-semibold'}>{x.entrada ? '+' : '−'} {brl(parseDecimal(x.valor) ?? 0)}</span>
                    <span className="flex-1 min-w-[10rem]">{previa?.[x.id]?.how ?? 'o sistema decide ao lançar'}</span>
                  </li>
                ))}
              </ul>
              <Button onClick={() => { confirmar(aConfirmar.map((x) => x.id)); setLoteAberto(false) }}><Check className="w-4 h-4" />Confirmar os {aConfirmar.length}</Button>
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2 mt-3">
        {([['todos', `Todos ${itens.length}`], ['atencao', `Precisam de você ${atencao}`], ...(aConfirmar.length ? [['confirmar', `A confirmar ${aConfirmar.length}`]] : [])] as [string, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setFiltro(k as 'todos' | 'atencao' | 'confirmar')}
            className={`h-8 px-3 rounded-full text-xs font-medium border ${filtro === k ? 'bg-purple text-white border-purple' : 'bg-surface border-line'}`}>{label}</button>
        ))}
      </div>

      <ul className="mt-3 border border-line rounded-lg divide-y divide-line">
        {visiveis.length === 0 && <li className="px-3 py-3 text-sm text-muted">Nada precisa da sua atenção. Pode lançar.</li>}
        {visiveis.map((x) => {
          const p = previa?.[x.id]
          const ja = p?.status === 'ja_enviado'
          const valorNum = parseDecimal(x.valor) ?? 0
          const isOpen = aberto === x.id
          return (
            <li key={x.id} className={`${ja || x.acao === 'ignorar' ? 'opacity-60' : ''}`}>
              <div className="flex items-start">
              <button type="button" onClick={() => !ja && setAberto(isOpen ? null : x.id)} disabled={ja}
                className="flex-1 min-w-0 text-left pl-3 pr-1 py-2.5 flex items-start gap-3 hover:bg-paper/60">
                <span className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${x.entrada ? 'bg-teal-light text-teal' : 'bg-danger-light text-danger'}`}>
                  {x.entrada ? <ArrowDownLeft className="w-3.5 h-3.5" /> : <ArrowUpRight className="w-3.5 h-3.5" />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-start justify-between gap-3">
                    <span className="text-sm min-w-0 break-words"><span className="text-muted tabular-nums mr-2">{dia(x.data)}</span>{x.descricao}</span>
                    <span className={`text-sm font-semibold tabular-nums shrink-0 ${x.entrada ? 'text-teal' : 'text-danger'} ${x.acao === 'ignorar' ? 'line-through' : ''}`}>
                      {x.entrada ? '+' : '−'} {brl(valorNum)}
                    </span>
                  </span>
                  <Situacao x={x} p={p} editado={editado(x)} categoria={categoriaFinal(x.categoria, x.novaCategoria)}
                    festa={festas.find((f) => f.id === x.reservationId)?.label} conta={contas.find((c) => c.id === x.expenseId)?.label} />
                </span>
                {!ja && <Pencil className="w-3.5 h-3.5 text-muted mt-1 shrink-0" />}
              </button>
              <button type="button" onClick={() => apagar(x)} title="Apagar este movimento (não será enviado)"
                aria-label={`Apagar o movimento ${x.descricao}`} className="px-2.5 py-3 text-muted hover:text-danger shrink-0">
                <Trash2 className="w-4 h-4" />
              </button>
              </div>

              {exigeConfirmacao(x) && !isOpen && (
                <div className="px-3 pb-3 -mt-1 ml-10 flex flex-wrap items-center gap-2">
                  {confirmados.has(x.id) ? (
                    <>
                      <span className="text-xs font-semibold text-teal inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" />Confirmado</span>
                      <button onClick={() => setConfirmados((c) => { const n = new Set(c); n.delete(x.id); return n })} className="text-xs text-muted underline">desfazer</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => confirmar([x.id])} className="h-8 px-3 rounded-lg text-xs font-semibold bg-teal text-white">Confirmar</button>
                      <button onClick={() => muda(x.id, { acao: 'ignorar', lembrar: false })} className="h-8 px-3 rounded-lg text-xs font-medium border border-line bg-surface">Não lançar</button>
                      <button onClick={() => setAberto(x.id)} className="h-8 px-3 rounded-lg text-xs font-medium border border-line bg-surface">É outra coisa</button>
                    </>
                  )}
                </div>
              )}
              {p?.status === 'possivel_duplicado' && x.acao === 'auto' && !isOpen && (
                <div className="px-3 pb-3 -mt-1 ml-10 flex flex-wrap gap-2">
                  <button onClick={() => muda(x.id, { acao: 'ignorar', lembrar: false })} className="h-8 px-3 rounded-lg text-xs font-medium border border-line bg-surface">
                    É repetido, não lançar
                  </button>
                  <button onClick={() => setAberto(x.id)} className="h-8 px-3 rounded-lg text-xs font-medium border border-line bg-surface">
                    Não é, escolher o que fazer
                  </button>
                </div>
              )}
              {p?.status === 'cartao' && x.acao === 'auto' && !isOpen && (
                <div className="px-3 pb-3 -mt-1 ml-10 flex flex-wrap gap-2">
                  {p.suggestions.filter((s) => s.bate && (s.payment_id || s.income_ids)).slice(0, 2).map((s) => (
                    <button key={s.payment_id ?? s.income_ids!.join('-')} onClick={() => muda(x.id, s.payment_id ? { acao: 'cartao_lancado', paymentIds: [s.payment_id], incomeIds: [] } : { acao: 'cartao_lancado', paymentIds: [], incomeIds: s.income_ids! })}
                      className="h-8 px-3 rounded-lg text-xs font-medium border border-purple/40 bg-purple-light/50 text-purple-dark">
                      Já lançado: {s.label.split(' · cai na conta')[0]}
                    </button>
                  ))}
                  <button onClick={() => setAberto(x.id)} className="h-8 px-3 rounded-lg text-xs font-medium border border-line bg-surface">Conferir</button>
                </div>
              )}
              {p?.status === 'a_classificar' && x.acao === 'auto' && !isOpen && p.suggestions.length > 0 && (
                <div className="px-3 pb-3 -mt-1 ml-10 flex flex-wrap gap-2">
                  {p.suggestions.map((s) => (
                    <button key={s.reservation_id ?? s.expense_id}
                      onClick={() => muda(x.id, s.reservation_id ? { acao: 'festa', reservationId: s.reservation_id } : { acao: 'conta', expenseId: s.expense_id! })}
                      className="h-8 px-3 rounded-lg text-xs font-medium border border-purple/40 bg-purple-light/50 text-purple-dark">
                      {s.label}
                    </button>
                  ))}
                </div>
              )}

              {isOpen && (
                <div className="px-3 pb-3 ml-10 space-y-3 text-sm">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <input type="date" value={x.data} onChange={(e) => muda(x.id, { data: e.target.value })} className={campo} aria-label="Data" />
                    <div className="flex rounded-lg border border-line overflow-hidden h-10">
                      <button onClick={() => muda(x.id, { entrada: true, acao: ['despesa', 'conta'].includes(x.acao) ? 'auto' : x.acao })}
                        className={`flex-1 text-xs font-medium ${x.entrada ? 'bg-teal text-white' : 'bg-surface'}`}>Entrada</button>
                      <button onClick={() => muda(x.id, { entrada: false, acao: ['festa', 'receita', 'cartao_lancado'].includes(x.acao) ? 'auto' : x.acao })}
                        className={`flex-1 text-xs font-medium ${!x.entrada ? 'bg-danger text-white' : 'bg-surface'}`}>Saída</button>
                    </div>
                    <input value={x.valor} onChange={(e) => muda(x.id, { valor: e.target.value })} inputMode="decimal" className={`${campo} col-span-2 sm:col-span-2`} aria-label="Valor" />
                  </div>
                  <input value={x.descricao} onChange={(e) => muda(x.id, { descricao: e.target.value })} className={campo} aria-label="Descrição" />

                  <label className="block">
                    <span className="block text-xs text-muted mb-1">O que fazer com este movimento?</span>
                    <select value={x.acao} className={campo} onChange={(e) => {
                      const acao = e.target.value as Acao
                      // venda no cartão: já marca a venda cujo valor bate
                      const melhor = (p?.suggestions ?? []).find((s) => s.bate && (s.payment_id || s.income_ids))
                      muda(x.id, acao === 'cartao_lancado' && x.paymentIds.length === 0 && x.incomeIds.length === 0 && melhor
                        ? { acao, paymentIds: melhor.payment_id ? [melhor.payment_id] : [], incomeIds: melhor.income_ids ?? [] } : { acao })
                    }}>
                      <option value="auto">Deixar o sistema decidir</option>
                      {x.entrada ? <>
                        <option value="cartao_lancado">Venda no cartão já lançada (festa ou bar)</option>
                        <option value="festa">Pagamento de festa</option>
                        <option value="receita">Outra receita</option>
                      </> : <>
                        <option value="despesa">Despesa (escolher categoria)</option>
                        <option value="conta">Pagou uma conta a pagar</option>
                      </>}
                      <option value="ignorar">Não lançar</option>
                    </select>
                  </label>

                  {x.acao === 'festa' && (
                    <select value={x.reservationId} onChange={(e) => muda(x.id, { reservationId: e.target.value })} className={campo} aria-label="Festa">
                      <option value="">Escolha a festa...</option>
                      {festas.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                    </select>
                  )}
                  {x.acao === 'cartao_lancado' && (
                    <div className="space-y-1.5">
                      {(p?.suggestions ?? []).filter((s) => s.payment_id || s.income_ids).length === 0
                        ? <p className="text-xs text-muted">Não achamos vendas no cartão (festas ou bar) lançadas nos últimos dias. Pode confirmar mesmo assim.</p>
                        : <p className="text-xs text-muted">Marque a(s) venda(s) que este depósito paga:</p>}
                      {(p?.suggestions ?? []).filter((s) => s.payment_id).map((s) => (
                        <label key={s.payment_id} className={`flex items-start gap-2 px-3 py-2 rounded-lg border bg-surface cursor-pointer ${x.paymentIds.includes(s.payment_id!) ? 'border-purple' : 'border-line'}`}>
                          <input type="checkbox" className="mt-0.5" checked={x.paymentIds.includes(s.payment_id!)}
                            onChange={(e) => muda(x.id, { paymentIds: e.target.checked ? [...x.paymentIds, s.payment_id!] : x.paymentIds.filter((i) => i !== s.payment_id) })} />
                          <span className="min-w-0">{s.label}{s.bate && <span className="ml-1 text-teal font-medium">· valor bate</span>}</span>
                        </label>
                      ))}
                      {(p?.suggestions ?? []).filter((s) => s.income_ids).map((s) => {
                        const marcado = s.income_ids!.every((i) => x.incomeIds.includes(i))
                        return (
                          <label key={s.income_ids!.join('-')} className={`flex items-start gap-2 px-3 py-2 rounded-lg border bg-surface cursor-pointer ${marcado ? 'border-purple' : 'border-line'}`}>
                            <input type="checkbox" className="mt-0.5" checked={marcado}
                              onChange={(e) => muda(x.id, { incomeIds: e.target.checked ? [...new Set([...x.incomeIds, ...s.income_ids!])] : x.incomeIds.filter((i) => !s.income_ids!.includes(i)) })} />
                            <span className="min-w-0">{s.label}{s.bate && <span className="ml-1 text-teal font-medium">· valor bate</span>}</span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                  {x.acao === 'festa' && p?.status === 'cartao' && (
                    <label className="block">
                      <span className="block text-xs text-muted mb-1">Valor da venda com a taxa (opcional; se vazio, lança o que caiu na conta)</span>
                      <input value={x.valorVenda} onChange={(e) => muda(x.id, { valorVenda: e.target.value })} inputMode="decimal" className={campo} />
                    </label>
                  )}
                  {x.acao === 'conta' && (
                    <select value={x.expenseId} onChange={(e) => muda(x.id, { expenseId: e.target.value })} className={campo} aria-label="Conta a pagar">
                      <option value="">{contas.length ? 'Escolha a conta...' : 'Nenhuma conta a pagar em aberto'}</option>
                      {contas.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  )}
                  {x.acao === 'despesa' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <CategoriaCampo categorias={categorias} valor={x.categoria} nova={x.novaCategoria}
                        onValor={(v) => muda(x.id, { categoria: v })} onNova={(v) => muda(x.id, { novaCategoria: v })} />
                      <input value={x.fornecedor} onChange={(e) => muda(x.id, { fornecedor: e.target.value })} placeholder="Fornecedor (opcional)" className={campo} />
                    </div>
                  )}
                  {x.acao === 'receita' && (
                    <input value={x.descReceita} onChange={(e) => muda(x.id, { descReceita: e.target.value })} placeholder="Descrição da receita (opcional)" className={campo} />
                  )}
                  {['despesa', 'receita', 'ignorar'].includes(x.acao) && (
                    <label className="flex items-center gap-2 text-xs text-muted">
                      <input type="checkbox" checked={x.lembrar} onChange={(e) => muda(x.id, { lembrar: e.target.checked })} />
                      Fazer igual da próxima vez que aparecer esta descrição
                    </label>
                  )}
                  {problema(x) && <p className="text-xs text-danger">{problema(x)}</p>}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => setAberto(null)}><Check className="w-4 h-4" /> Pronto</Button>
                    <Button variant="ghost" onClick={() => proximo(x.id)}>Próximo <ChevronRight className="w-4 h-4" /></Button>
                    {editado(x) && (
                      <Button variant="ghost" onClick={() => muda(x.id, { data: x.orig.data, descricao: x.orig.descricao, entrada: x.orig.valor > 0, valor: Math.abs(x.orig.valor).toFixed(2).replace('.', ',') })}>
                        Desfazer correções
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {erro && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5 mt-3">{erro}</div>}
      <div className="flex flex-wrap items-center gap-3 mt-4">
        <Button onClick={lancar} disabled={busy || itens.length === 0 || !!erroPrevia || !previa || aConfirmar.length > 0}>
          {busy ? 'Lançando...' : `Lançar ${itens.length - naoLancar} movimento${itens.length - naoLancar === 1 ? '' : 's'}`}
        </Button>
        <Button variant="ghost" onClick={onCancelar} disabled={busy}>Cancelar</Button>
        {aConfirmar.length > 0 && <span className="text-xs text-amber">Confirme os {aConfirmar.length} que estão esperando para poder lançar.</span>}
        {naoLancar > 0 && <span className="text-xs text-muted">{naoLancar} não {naoLancar === 1 ? 'será lançado' : 'serão lançados'}</span>}
        {apagados.length > 0 && (
          <span className="text-xs text-muted inline-flex items-center gap-1">
            {apagados.length} apagado{apagados.length > 1 ? 's' : ''} ·
            <button onClick={desfazerApagar} className="text-purple font-medium inline-flex items-center gap-1"><RotateCcw className="w-3 h-3" /> Desfazer</button>
          </span>
        )}
      </div>
    </Card>
  )
}

function Situacao({ x, p, editado, categoria, festa, conta }: {
  x: Item; p: Previa | undefined; editado: boolean; categoria: string; festa?: string; conta?: string
}) {
  const linha = (icone: React.ReactNode, cor: string, texto: React.ReactNode) => (
    <span className={`mt-1 flex items-start gap-1.5 text-xs ${cor}`}>{icone}<span className="min-w-0">{texto}</span></span>
  )
  if (p?.status === 'ja_enviado') return linha(<Check className="w-3.5 h-3.5 shrink-0" />, 'text-muted', 'Já enviado antes: não entra de novo')
  if (x.acao === 'ignorar') return linha(<X className="w-3.5 h-3.5 shrink-0" />, 'text-muted', 'Não será lançado')
  if (x.acao !== 'auto') {
    const t = x.acao === 'cartao_lancado' ? `Venda no cartão já lançada${x.paymentIds.length + x.incomeIds.length ? ` (${x.paymentIds.length + x.incomeIds.length} venda${x.paymentIds.length + x.incomeIds.length > 1 ? 's' : ''})` : ''}: só confere`
      : x.acao === 'festa' ? `Pagamento da festa ${festa ?? '(escolha a festa)'}`
      : x.acao === 'conta' ? `Baixa da conta ${conta ?? '(escolha a conta)'}`
      : x.acao === 'despesa' ? `Despesa · ${categoria || '(escolha a categoria)'}${x.fornecedor ? ' · ' + x.fornecedor : ''}`
      : `Outra receita${x.descReceita ? ' · ' + x.descReceita : ''}`
    return linha(<Pencil className="w-3.5 h-3.5 shrink-0" />, 'text-purple', <>Você escolheu: <b>{t}</b></>)
  }
  if (editado) return linha(<Clock className="w-3.5 h-3.5 shrink-0" />, 'text-muted', 'Corrigido: o sistema decide ao lançar')
  if (!p) return linha(<Clock className="w-3.5 h-3.5 shrink-0" />, 'text-muted', 'Conferindo...')
  if (p.status === 'lancado' || p.status === 'conciliado') return linha(<Sparkles className="w-3.5 h-3.5 shrink-0" />, 'text-teal', <>O sistema vai lançar: <b>{p.how}</b></>)
  if (p.status === 'ignorado') return linha(<X className="w-3.5 h-3.5 shrink-0" />, 'text-muted', p.how ?? 'Será ignorado')
  if (p.status === 'cartao') return linha(<CreditCard className="w-3.5 h-3.5 shrink-0" />, 'text-orange', <>Parece <b>venda no cartão</b>: pode ser de festa e já ter sido lançada. Confira.</>)
  if (p.status === 'possivel_duplicado') return linha(<AlertTriangle className="w-3.5 h-3.5 shrink-0" />, 'text-orange', <>Pode ser repetido: <b>{p.dup ?? 'um lançamento que já existe'}</b></>)
  return linha(<AlertTriangle className="w-3.5 h-3.5 shrink-0" />, 'text-amber', p.suggestions.length ? 'Não reconhecido: é alguma destas?' : 'Não reconhecido: escolha o que fazer, ou deixe para classificar depois')
}
