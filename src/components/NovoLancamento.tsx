import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { format, parseISO, addDays } from 'date-fns'
import { Plus, Check, X } from 'lucide-react'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import { UNITS } from '../lib/UnitContext'
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type PaymentMethod } from '../types'
import { parseDecimal, friendlyDbError, todayIso } from '../lib/format'
import { addMonthsToValue, currentMonthValue, monthBounds } from '../lib/monthUtils'

// Novo lançamento do Financeiro: uma tela só para conta a pagar, conta já
// paga e entrada de dinheiro (pagamento de festa ou outra entrada). Dá para
// criar categoria nova ali mesmo, sem perder o que já foi preenchido
// (categorias ficam em finance_categories — migração 087).

type Tipo = 'pagar' | 'paga' | 'entrada'
type Origem = 'festa' | 'outra'
const NOVA = '__nova__'

export const TIPOS_ENTRADA_BASE = ['Aluguel do espaço', 'Venda avulsa', 'Reembolso', 'Rendimento da conta', 'Outras entradas']

interface FestaOpcao { id: string; label: string; falta: number; data: string }
interface Parecido { id: string; reservationId: string; cliente: string; data: string; descricao: string; valor: number }

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function dataBr(iso: string) {
  return iso ? format(parseISO(iso), 'dd/MM/yyyy') : ''
}
const nomeMes = (m: string) => {
  const t = parseISO(`${m}-01`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export function NovoLancamento({ unitDbIds, defaultUnit, categoriasUsadas, onSaved }: {
  unitDbIds: Record<string, { unitId: string }>
  defaultUnit: string
  categoriasUsadas: string[]
  onSaved: () => Promise<void> | void
}) {
  const { can } = useAuth()
  const podeConta = can('action:financeiro.registrar_despesa')
  const podeFixa = can('action:financeiro.despesas_fixas')
  const podeFesta = can('action:festa.pagamentos')
  const tiposPermitidos: Tipo[] = [...(podeConta ? (['pagar', 'paga'] as Tipo[]) : []), ...(podeConta || podeFesta ? (['entrada'] as Tipo[]) : [])]

  const [tipo, setTipo] = useState<Tipo>(tiposPermitidos[0] ?? 'pagar')
  const [unit, setUnit] = useState(defaultUnit)
  const [valor, setValor] = useState('')
  const [categoria, setCategoria] = useState<string>(EXPENSE_CATEGORIES[0])
  const [tipoEntrada, setTipoEntrada] = useState(TIPOS_ENTRADA_BASE[0])
  const [novaCat, setNovaCat] = useState<string | null>(null)
  const [descricao, setDescricao] = useState('')
  const [fornecedor, setFornecedor] = useState('')
  const [vencimento, setVencimento] = useState(todayIso)
  const [pagoEm, setPagoEm] = useState(todayIso)
  const [forma, setForma] = useState<PaymentMethod>('pix')
  const [repete, setRepete] = useState(false)
  const [dia, setDia] = useState('5')
  const [comecar, setComecar] = useState<'este_mes' | 'proximo_mes'>('este_mes')
  const [cobre, setCobre] = useState(false)
  const [origem, setOrigem] = useState<Origem>(podeFesta ? 'festa' : 'outra')
  const [festaId, setFestaId] = useState('')
  const [festaBusca, setFestaBusca] = useState('')
  const [festas, setFestas] = useState<FestaOpcao[]>([])
  const [customDespesa, setCustomDespesa] = useState<string[]>([])
  const [customEntrada, setCustomEntrada] = useState<string[]>([])
  const [aviso, setAviso] = useState<Parecido[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => setUnit(defaultUnit), [defaultUnit])

  // Categorias criadas pela casa.
  useEffect(() => {
    supabase.from('finance_categories').select('kind, name').order('name').then(({ data }) => {
      setCustomDespesa((data ?? []).filter((c) => c.kind === 'despesa').map((c) => c.name))
      setCustomEntrada((data ?? []).filter((c) => c.kind === 'entrada').map((c) => c.name))
    })
  }, [])

  // Festas da unidade (últimos 6 meses e próximas), com o que ainda falta pagar.
  useEffect(() => {
    const unitId = unitDbIds[unit]?.unitId
    if (!unitId || tipo !== 'entrada' || origem !== 'festa') return
    const desde = format(addDays(new Date(), -180), 'yyyy-MM-dd')
    supabase
      .from('reservations')
      .select('id, event_date, child_name, final_value, client:clients(name), payments(amount)')
      .eq('unit_id', unitId)
      .neq('status', 'cancelada')
      .gte('event_date', desde)
      .order('event_date')
      .then(({ data }) => {
        const lista = ((data ?? []) as any[]).map((r) => {
          const pago = (r.payments ?? []).reduce((s: number, p: any) => s + Number(p.amount), 0)
          const falta = Math.max(0, Number(r.final_value ?? 0) - pago)
          const quem = r.client?.name ?? 'Cliente'
          return { id: r.id, data: r.event_date, falta, label: `${quem}${r.child_name ? ` (${r.child_name})` : ''} — festa em ${dataBr(r.event_date)}` }
        })
        // Primeiro as que ainda têm saldo a receber.
        lista.sort((a, b) => (a.falta > 0 ? 0 : 1) - (b.falta > 0 ? 0 : 1) || a.data.localeCompare(b.data))
        setFestas(lista)
      })
  }, [unit, tipo, origem, unitDbIds])

  const listaDespesa = useMemo(() => {
    const base = EXPENSE_CATEGORIES.filter((c) => c !== 'Outros') as string[]
    const extra = [...customDespesa, ...categoriasUsadas].filter((c) => c && c !== 'Estorno' && c !== 'Outros')
    const unicos: string[] = []
    for (const c of [...base, ...extra]) if (!unicos.some((u) => u.toLowerCase() === c.toLowerCase())) unicos.push(c)
    return [...unicos.slice(0, base.length), ...unicos.slice(base.length).sort((a, b) => a.localeCompare(b, 'pt-BR')), 'Outros']
  }, [customDespesa, categoriasUsadas])

  const listaEntrada = useMemo(() => {
    const unicos: string[] = []
    for (const c of [...TIPOS_ENTRADA_BASE.slice(0, -1), ...customEntrada.sort((a, b) => a.localeCompare(b, 'pt-BR')), 'Outras entradas'])
      if (!unicos.some((u) => u.toLowerCase() === c.toLowerCase())) unicos.push(c)
    return unicos
  }, [customEntrada])

  const festasFiltradas = useMemo(() => {
    const t = festaBusca.trim().toLowerCase()
    return t ? festas.filter((f) => f.label.toLowerCase().includes(t)) : festas
  }, [festas, festaBusca])

  const ehEntrada = tipo === 'entrada'
  const ehFixa = tipo === 'pagar' && repete
  const valorNum = parseDecimal(valor) ?? 0
  const festaSel = festas.find((f) => f.id === festaId)
  const unidadeNome = UNITS.find((u) => u.id === unit)?.name ?? ''
  const mesInicioFixa = comecar === 'proximo_mes' ? addMonthsToValue(currentMonthValue(), 1) : currentMonthValue()

  // Frase de conferência.
  const resumo = useMemo(() => {
    if (!valorNum) return 'Preencha o valor para ver o resumo.'
    const v = brl(valorNum)
    const u = UNITS.length > 1 ? ` (${unidadeNome})` : ''
    if (tipo === 'entrada') {
      if (origem === 'festa') return festaSel ? `Entrada de ${v} no dia ${dataBr(pagoEm)}, pagamento da festa de ${festaSel.label.split(' — ')[0]}, por ${PAYMENT_METHOD_LABEL[forma]}${u}.` : `Entrada de ${v}: escolha a festa.`
      return `Entrada de ${v} no dia ${dataBr(pagoEm)}, ${tipoEntrada.toLowerCase()}${descricao.trim() ? ` (${descricao.trim()})` : ''}, por ${PAYMENT_METHOD_LABEL[forma]}${u}.`
    }
    const oque = `${descricao.trim() || 'conta'} — ${categoria}`
    const extra = cobre && !ehFixa ? ' Fica só para controle: não entra nos totais (o valor já está nos custos das festas).' : ''
    if (ehFixa) return `Conta fixa de ${v} todo dia ${Math.min(28, Math.max(1, Number(dia) || 5))}, a partir de ${nomeMes(mesInicioFixa).toLowerCase()}: ${oque}${u}.`
    if (tipo === 'paga') return `Conta de ${v} já paga em ${dataBr(pagoEm)} por ${PAYMENT_METHOD_LABEL[forma]}: ${oque}${u}.${extra}`
    return `Conta de ${v} a pagar, vence em ${dataBr(vencimento)}: ${oque}${u}.${extra}`
  }, [valorNum, tipo, origem, festaSel, pagoEm, forma, tipoEntrada, descricao, categoria, cobre, ehFixa, dia, mesInicioFixa, vencimento, unidadeNome])

  async function criarCategoria() {
    const nome = (novaCat ?? '').trim().replace(/\s+/g, ' ')
    if (!nome) return
    const kind = ehEntrada ? 'entrada' : 'despesa'
    const lista = ehEntrada ? listaEntrada : listaDespesa
    const existente = lista.find((c) => c.toLowerCase() === nome.toLowerCase())
    if (existente) {
      ehEntrada ? setTipoEntrada(existente) : setCategoria(existente)
      setNovaCat(null)
      return
    }
    const { error } = await supabase.from('finance_categories').insert({ kind, name: nome })
    if (error && !/duplicate|unique/i.test(error.message)) {
      setErro(/finance_categories/.test(error.message) ? 'Falta rodar a migração 087 no banco.' : friendlyDbError(error.message))
      return
    }
    if (ehEntrada) {
      setCustomEntrada((p) => [...p, nome])
      setTipoEntrada(nome)
    } else {
      setCustomDespesa((p) => [...p, nome])
      setCategoria(nome)
    }
    setNovaCat(null)
    setErro(null)
  }

  async function contaParecida(unitId: string): Promise<Parecido[] | null> {
    const ref = tipo === 'paga' ? pagoEm : vencimento
    const { startIso, endIso } = monthBounds(ref.slice(0, 7))
    const { data } = await supabase
      .from('reservations')
      .select('id, event_date, client:clients(name), reservation_costs(id, description, amount)')
      .eq('unit_id', unitId)
      .neq('status', 'cancelada')
      .gte('event_date', startIso)
      .lt('event_date', endIso)
    const t = `${descricao} ${fornecedor}`.trim().toLowerCase()
    const achados: Parecido[] = []
    for (const r of (data ?? []) as any[]) {
      for (const c of r.reservation_costs ?? []) {
        const desc = String(c.description ?? '').toLowerCase()
        const mesmoValor = Math.abs(Number(c.amount) - valorNum) < 0.01
        const parecido = t.length > 2 && desc.length > 2 && (desc.includes(t) || t.includes(desc))
        if (mesmoValor || parecido) achados.push({ id: c.id, reservationId: r.id, cliente: r.client?.name ?? 'Festa', data: r.event_date, descricao: c.description, valor: Number(c.amount) })
      }
    }
    return achados.length ? achados : null
  }

  function limpar(tudo: boolean) {
    setValor('')
    setDescricao('')
    setFornecedor('')
    setCobre(false)
    setAviso(null)
    setFestaId('')
    setFestaBusca('')
    setNovaCat(null)
    if (tudo) {
      setRepete(false)
      setCategoria(EXPENSE_CATEGORIES[0])
      setTipoEntrada(TIPOS_ENTRADA_BASE[0])
      setVencimento(todayIso())
      setPagoEm(todayIso())
      setForma('pix')
      setDia('5')
      setComecar('este_mes')
      setOk(null)
      setErro(null)
    }
  }

  async function salvar(opts: { outro?: boolean; pularAviso?: boolean; cobreForcado?: boolean } = {}) {
    setErro(null)
    setOk(null)
    const unitId = unitDbIds[unit]?.unitId
    if (!unitId) return setErro('Não encontrei essa unidade no banco de dados.')
    if (!valorNum || valorNum <= 0) return setErro('Informe o valor.')
    if (novaCat !== null) return setErro('Termine de criar a categoria nova (botão Criar) ou cancele.')
    const cobreFinal = opts.cobreForcado ?? cobre

    setSalvando(true)
    try {
      if (ehEntrada) {
        if (origem === 'festa') {
          if (!festaId) return setErro('Escolha a festa que pagou.')
          const { error } = await supabase.from('payments').insert({
            reservation_id: festaId, amount: valorNum, payment_date: pagoEm, payment_method: forma,
            notes: descricao.trim() ? `${descricao.trim()} (lançado no Financeiro)` : 'Lançado no Financeiro',
          })
          if (error) return setErro('Não foi possível registrar o pagamento da festa. ' + friendlyDbError(error.message))
        } else {
          const { error } = await supabase.rpc('register_other_income', {
            p_unit: unitId, p_category: tipoEntrada, p_description: descricao.trim() || null, p_amount: valorNum, p_date: pagoEm, p_method: forma,
          })
          if (error) return setErro(/register_other_income/.test(error.message) ? 'Falta rodar a migração 087 no banco.' : friendlyDbError(error.message))
        }
      } else {
        if (!descricao.trim()) return setErro('Escreva uma descrição (ex: Conta de luz).')
        if (ehFixa) {
          const d = Math.min(28, Math.max(1, Number(dia) || 5))
          const { error } = await supabase.from('recurring_expenses').insert({
            unit_id: unitId, category: categoria, description: descricao.trim(), amount: valorNum, day_of_month: d, active: true,
            first_charge_month: comecar === 'proximo_mes' ? `${mesInicioFixa}-01` : null,
          })
          if (error) return setErro('Não foi possível salvar a conta fixa. ' + friendlyDbError(error.message))
          if (comecar === 'este_mes') await supabase.rpc('ensure_recurring_expenses_current_month')
        } else {
          if (!cobreFinal && !opts.pularAviso) {
            const achados = await contaParecida(unitId)
            if (achados) {
              setAviso(achados)
              return
            }
          }
          const paga = tipo === 'paga'
          const { error } = await supabase.from('expenses').insert({
            unit_id: unitId, category: categoria, description: descricao.trim(), supplier: fornecedor.trim() || null, amount: valorNum,
            due_date: paga ? pagoEm : vencimento,
            status: paga ? 'pago' : vencimento < todayIso() ? 'atrasado' : 'a_vencer',
            paid_date: paga ? pagoEm : null,
            payment_method: paga ? forma : null,
            covers_festa_costs: cobreFinal,
          })
          if (error) return setErro('Não foi possível salvar a conta. ' + friendlyDbError(error.message))
        }
      }
      setOk(`Lançado: ${resumo}`)
      setAviso(null)
      if (opts.outro) limpar(false)
      else {
        limpar(false)
        setRepete(false)
      }
      await onSaved()
    } finally {
      setSalvando(false)
    }
  }

  if (tiposPermitidos.length === 0) return null

  const campo = 'w-full border border-line rounded-lg px-3 py-2 text-sm bg-surface'
  const rotulo = 'block text-xs text-muted mb-1'
  const listaCat = ehEntrada ? listaEntrada : listaDespesa
  const valorCat = ehEntrada ? tipoEntrada : categoria

  const seletorCategoria = (
    <div>
      <label className={rotulo}>{ehEntrada ? 'Tipo de entrada' : 'Categoria'}</label>
      {novaCat === null ? (
        <select
          value={valorCat}
          onChange={(e) => {
            if (e.target.value === NOVA) setNovaCat('')
            else ehEntrada ? setTipoEntrada(e.target.value) : setCategoria(e.target.value)
          }}
          className={campo}
        >
          {listaCat.map((c) => <option key={c} value={c}>{c}</option>)}
          <option value={NOVA}>+ Nova categoria…</option>
        </select>
      ) : (
        <div className="flex gap-1.5">
          <input
            autoFocus
            value={novaCat}
            onChange={(e) => setNovaCat(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); criarCategoria() }
              if (e.key === 'Escape') setNovaCat(null)
            }}
            placeholder={ehEntrada ? 'Nome do tipo de entrada' : 'Nome da categoria'}
            maxLength={60}
            className={campo}
          />
          <Button type="button" onClick={criarCategoria} className="px-3" disabled={!novaCat.trim()}><Check className="w-4 h-4" /> Criar</Button>
          <button type="button" onClick={() => setNovaCat(null)} className="text-muted hover:text-ink px-1" aria-label="Cancelar categoria nova"><X className="w-4 h-4" /></button>
        </div>
      )}
      {novaCat !== null && <p className="text-[11px] text-muted mt-1">O resto do lançamento continua preenchido.</p>}
    </div>
  )

  const rotuloTipo: Record<Tipo, [string, string]> = {
    pagar: ['Conta a pagar', 'Ainda vai vencer'],
    paga: ['Conta já paga', 'O dinheiro já saiu'],
    entrada: ['Entrada de dinheiro', 'Dinheiro que entrou'],
  }

  return (
    <Card title="Novo lançamento">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4" role="tablist">
        {tiposPermitidos.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tipo === t}
            onClick={() => { setTipo(t); setAviso(null); setNovaCat(null); setErro(null) }}
            className={`text-left rounded-lg border px-3 py-2.5 transition-colors ${tipo === t ? (t === 'entrada' ? 'border-teal bg-teal-light' : 'border-purple bg-purple-light') : 'border-line hover:bg-paper'}`}
          >
            <span className={`block text-sm font-semibold ${tipo === t ? (t === 'entrada' ? 'text-teal' : 'text-purple-dark') : ''}`}>{rotuloTipo[t][0]}</span>
            <span className="block text-xs text-muted">{rotuloTipo[t][1]}</span>
          </button>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); salvar() }} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={rotulo}>Unidade</label>
          <select value={unit} onChange={(e) => { setUnit(e.target.value); setFestaId('') }} className={campo}>
            {UNITS.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div>
          <label className={rotulo}>{ehFixa ? 'Valor por mês' : 'Valor'}</label>
          <input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" className={campo} />
        </div>

        {ehEntrada && (
          <div className="sm:col-span-2">
            <label className={rotulo}>De onde veio?</label>
            <div className="inline-flex rounded-lg border border-line p-0.5">
              {([['festa', 'Pagamento de uma festa'], ['outra', 'Outra entrada']] as const)
                .filter(([k]) => (k === 'festa' ? podeFesta : podeConta))
                .map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setOrigem(k)} className={`px-3 h-8 rounded-md text-xs font-medium ${origem === k ? 'bg-teal text-white' : 'text-ink/70 hover:bg-paper'}`}>{l}</button>
                ))}
            </div>
          </div>
        )}

        {ehEntrada && origem === 'festa' ? (
          <div className="sm:col-span-2">
            <label className={rotulo}>Festa</label>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-2">
              <input value={festaBusca} onChange={(e) => setFestaBusca(e.target.value)} placeholder="Buscar pelo nome…" className={campo} />
              <select value={festaId} onChange={(e) => setFestaId(e.target.value)} className={campo}>
                <option value="">Escolha a festa…</option>
                {festasFiltradas.map((f) => (
                  <option key={f.id} value={f.id}>{f.label}{f.falta > 0 ? ` · falta ${brl(f.falta)}` : ' · quitada'}</option>
                ))}
              </select>
            </div>
            {festaSel && festaSel.falta > 0 && valorNum > festaSel.falta + 0.009 && (
              <p className="text-xs text-amber mt-1">O valor é maior do que falta pagar nesta festa ({brl(festaSel.falta)}).</p>
            )}
          </div>
        ) : (
          seletorCategoria
        )}

        {!(ehEntrada && origem === 'festa') && (
          <div className={ehEntrada ? '' : ''}>
            <label className={rotulo}>{ehEntrada ? 'Descrição (opcional)' : 'Descrição'}</label>
            <input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder={ehEntrada ? 'Ex: aluguel do salão para evento da escola' : 'Ex: Conta de luz, material de limpeza…'} className={campo} />
          </div>
        )}
        {ehEntrada && origem === 'festa' && (
          <div className="sm:col-span-2">
            <label className={rotulo}>Observação (opcional)</label>
            <input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex: sinal pago em dinheiro na visita" className={campo} />
          </div>
        )}

        {!ehEntrada && !ehFixa && (
          <div>
            <label className={rotulo}>Fornecedor (opcional)</label>
            <input value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} placeholder="Nome do fornecedor" className={campo} />
          </div>
        )}

        {tipo === 'pagar' && !repete && (
          <div>
            <label className={rotulo}>Vencimento</label>
            <input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} className={campo} />
          </div>
        )}

        {(tipo === 'paga' || ehEntrada) && (
          <>
            <div>
              <label className={rotulo}>{ehEntrada ? 'Recebido em' : 'Pago em'}</label>
              <input type="date" value={pagoEm} onChange={(e) => setPagoEm(e.target.value)} className={campo} />
            </div>
            <div>
              <label className={rotulo}>Forma</label>
              <select value={forma} onChange={(e) => setForma(e.target.value as PaymentMethod)} className={campo}>
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>)}
              </select>
            </div>
          </>
        )}

        {tipo === 'pagar' && podeFixa && (
          <div className="sm:col-span-2 rounded-lg border border-line px-3 py-2.5">
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={repete} onChange={(e) => setRepete(e.target.checked)} className="mt-0.5" />
              <span>
                Repete todo mês
                <span className="block text-xs text-muted">Vira uma despesa fixa: o sistema lança a conta sozinho todo mês (ex: aluguel, internet).</span>
              </span>
            </label>
            {repete && (
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className={rotulo}>Vence todo dia</label>
                  <input type="number" min={1} max={28} value={dia} onChange={(e) => setDia(e.target.value)} className={campo} />
                </div>
                <div>
                  <label className={rotulo}>Começa</label>
                  <select value={comecar} onChange={(e) => setComecar(e.target.value as 'este_mes' | 'proximo_mes')} className={campo}>
                    <option value="este_mes">Já neste mês</option>
                    <option value="proximo_mes">Só no mês que vem</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        )}

        {!ehEntrada && !ehFixa && (
          <label className="sm:col-span-2 flex items-start gap-2 text-sm bg-paper rounded-lg px-3 py-2.5 cursor-pointer">
            <input type="checkbox" checked={cobre} onChange={(e) => setCobre(e.target.checked)} className="mt-0.5" />
            <span>
              Só registrar o pagamento — o valor já está nos custos das festas
              <span className="block text-xs text-muted">
                Ex: nota do fornecedor de docinhos que já entra como custo de cada festa. A conta fica na lista para você controlar, mas não entra nos totais, senão o gasto conta duas vezes.
              </span>
            </span>
          </label>
        )}

        {!ehEntrada && (
          <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-2 bg-purple-light/60 rounded-lg px-3 py-2">
            <p className="text-xs text-purple-dark">Compra de estoque? Use <strong>Estoque → Entrada de compra</strong>: ela soma no estoque e cria a conta sozinha.</p>
            <Link to="/estoque?entrada=1" className="text-xs font-medium text-purple whitespace-nowrap">Abrir Entrada de compra →</Link>
          </div>
        )}

        {aviso && (
          <div className="sm:col-span-2 bg-amber-light text-amber text-sm rounded-lg px-3 py-2.5 space-y-2">
            <p className="font-medium">Já existe um custo de festa parecido neste mês</p>
            <ul className="text-xs space-y-0.5">
              {aviso.map((c) => (
                <li key={c.id}>• <Link to={`/reservas/${c.reservationId}`} className="underline">{c.cliente}</Link> ({format(parseISO(c.data), 'dd/MM')}): {c.descricao} — {brl(c.valor)}</li>
              ))}
            </ul>
            <p className="text-xs">Se esta conta paga esse mesmo custo, use "Só registrar o pagamento" para não contar duas vezes.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={() => setAviso(null)}>Voltar</Button>
              <Button type="button" variant="secondary" onClick={() => salvar({ cobreForcado: true, pularAviso: true })}>Só registrar o pagamento e salvar</Button>
              <Button type="button" onClick={() => salvar({ pularAviso: true })}>Salvar mesmo assim</Button>
            </div>
          </div>
        )}

        <p className="sm:col-span-2 text-sm bg-surface border border-line rounded-lg px-3 py-2.5">{resumo}</p>

        {erro && <p className="sm:col-span-2 text-sm bg-danger-light text-danger rounded-lg px-3 py-2">{erro}</p>}
        {ok && !erro && <p className="sm:col-span-2 text-sm bg-teal-light text-teal rounded-lg px-3 py-2">{ok}</p>}

        <div className="sm:col-span-2 flex flex-wrap gap-2">
          <Button type="submit" disabled={salvando} className="justify-center"><Plus className="w-4 h-4" /> {salvando ? 'Salvando…' : 'Salvar'}</Button>
          <Button type="button" variant="secondary" disabled={salvando} onClick={() => salvar({ outro: true })}>Salvar e lançar outro</Button>
          <Button type="button" variant="ghost" disabled={salvando} onClick={() => limpar(true)}>Limpar</Button>
        </div>
      </form>
      {!ehEntrada && (
        <p className="text-xs text-muted mt-3">
          Custos de uma festa específica (buffet, decoração, DJ, equipe) são lançados na própria festa (Central da festa → Financeiro), não aqui.
        </p>
      )}
    </Card>
  )
}
