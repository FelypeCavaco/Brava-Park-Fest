// Comissões por festa cadastrada, com repasse por pessoa (semanal, quinzenal ou mensal).
// Os cálculos ficam no banco (migrações 064, 066, 096 e 098): commission_pending diz
// o que falta pagar ou abater de cada pessoa; pay_commissions lança as contas
// pagas no Financeiro (ou só marca como paga, quando já foi lançado por fora).
import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { ChevronDown, ChevronUp, Info, X } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Can } from '../components/Can'
import { useUnit, UNITS } from '../lib/UnitContext'
import { supabase } from '../lib/supabaseClient'
import { brl, todayIso, friendlyDbError, parseDecimal } from '../lib/format'
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type PaymentMethod } from '../types'

type Modo = 'fixo' | 'percentual'
interface Versao { id: string; mode: Modo; value: number; valid_from: string; created_at: string }
interface Regra { id: string; name: string; user_id: string | null; scope: 'cadastradas' | 'todas'; start_date: string; versions: Versao[] }
interface Pendente {
  rule_id: string; rule_name: string; reservation_id: string; unit_id: string; cliente: string; cadastro: string; event_date: string
  status: string; cancelada_em: string | null; kind: 'comissao' | 'abatimento' | 'ajuste'; amount: number
  modo: Modo | null; valor_regra: number | null; valor_festa: number; cancelada_manual: boolean
}
interface Repasse {
  id: string; rule_id: string | null; until_date: string; paid_date: string; payment_method: string | null; total: number; created_at: string
  finance_launched: boolean; note: string | null
  itens: { reservation_id: string; unit_id: string; kind: string; amount: number; cliente: string; cadastro: string }[]
}
interface Historico {
  rule_id: string; rule_name: string; reservation_id: string; unit_id: string; cliente: string; cadastro: string; event_date: string; status: string
  cancelada_em: string | null; cadastrada_por: string; conta: boolean; devido: number; pago: number
  ultimo_repasse: string | null; situacao: string; modo: Modo | null; valor_regra: number | null; valor_festa: number; fora_financeiro: boolean
}
// Quando cada pessoa é paga (migração 098). Sem ela, todos são semanais, na segunda.
type Freq = 'semanal' | 'quinzenal' | 'mensal'
interface Agenda { rule_id: string; frequency: Freq; weekday: number; day: number; day2: number; last_pay: string; next_pay: string; cutoff: string }
const DIAS_SEMANA = ['segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado', 'domingo']
function descAgenda(a: { frequency: Freq; weekday: number; day: number; day2: number } | undefined) {
  if (!a || (a.frequency === 'semanal' && a.weekday === 1)) return 'toda segunda-feira'
  if (a.frequency === 'semanal') return `toda ${DIAS_SEMANA[a.weekday - 1]}`
  if (a.frequency === 'quinzenal') return `duas vezes por mês, nos dias ${Math.min(a.day, a.day2)} e ${Math.max(a.day, a.day2)}`
  return `todo dia ${a.day} do mês`
}

type Acao =
  | { tipo: 'paga'; ruleId: string; resId: string; cliente: string; pessoa: string; valor: number }
  | { tipo: 'cancelar'; ruleId: string; resId: string; cliente: string; pessoa: string; valor: number; jaPaga: boolean }

const SITUACAO: Record<string, { label: string; tone: 'teal' | 'amber' | 'danger' | 'neutral' | 'purple' }> = {
  paga: { label: 'Paga', tone: 'teal' },
  a_pagar: { label: 'A pagar no próximo repasse', tone: 'amber' },
  semana_atual: { label: 'Semana em andamento', tone: 'purple' },
  ajuste_pendente: { label: 'Ajuste de valor pendente', tone: 'amber' },
  abater: { label: 'Cancelada: será abatida', tone: 'danger' },
  abatida: { label: 'Paga e depois abatida', tone: 'neutral' },
  cancelada_manual: { label: 'Comissão cancelada', tone: 'danger' },
  outra_pessoa: { label: 'Não gera: cadastrada por outra pessoa', tone: 'neutral' },
  cancelada_antes: { label: 'Não gera: cancelada antes do repasse', tone: 'neutral' },
}
const PENDENTES = ['a_pagar', 'semana_atual', 'ajuste_pendente', 'abater']

const dataBR = (iso: string) => format(parseISO(iso), 'dd/MM/yyyy')
const KIND_LABEL: Record<string, string> = { comissao: 'Festa fechada', abatimento: 'Cancelada: abate', ajuste: 'Ajuste de valor' }
const num = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
const descValor = (modo: Modo | null | undefined, v: number | null | undefined) =>
  v == null || !modo ? '—' : modo === 'percentual' ? `${num(v)}% do valor da festa` : `${brl(v)} por festa`
// valor da versão que vale numa data (a mais recente com valid_from <= data)
function versaoEm(r: Regra, data: string): Versao | undefined {
  return [...r.versions].sort((a, b) => (a.valid_from === b.valid_from ? (a.created_at < b.created_at ? 1 : -1) : a.valid_from < b.valid_from ? 1 : -1)).find((v) => v.valid_from <= data)
}
const inputCls = 'border border-line rounded-lg px-3 h-9 text-sm'

export function Commissions() {
  const { unitDbIds } = useUnit()
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ultimoDomingo, setUltimoDomingo] = useState<string | null>(null)
  const [agendas, setAgendas] = useState<Record<string, Agenda>>({})
  const [regras, setRegras] = useState<Regra[]>([])
  const [proximo, setProximo] = useState<Pendente[]>([])
  const [semanaAberta, setSemanaAberta] = useState<Pendente[]>([])
  const [repasses, setRepasses] = useState<Repasse[]>([])
  const [historico, setHistorico] = useState<Historico[]>([])
  const [usuarios, setUsuarios] = useState<{ id: string; name: string }[]>([])
  const [pessoa, setPessoa] = useState<string>('todas')
  const [abertoRepasse, setAbertoRepasse] = useState<string | null>(null)
  const [filtroHist, setFiltroHist] = useState<'todas' | 'pagas' | 'pendentes' | 'canceladas' | 'nao_geram'>('todas')

  // pagar o repasse de uma pessoa
  const [pagandoRegra, setPagandoRegra] = useState<string | null>(null)
  const [dataPagamento, setDataPagamento] = useState(todayIso())
  const [forma, setForma] = useState<PaymentMethod>('pix')
  const [jaLancado, setJaLancado] = useState(false)
  const [salvando, setSalvando] = useState(false)
  // ação numa festa (marcar como paga / cancelar)
  const [acao, setAcao] = useState<Acao | null>(null)
  const [acaoData, setAcaoData] = useState(todayIso())
  const [acaoForma, setAcaoForma] = useState<PaymentMethod>('pix')
  const [acaoTexto, setAcaoTexto] = useState('')
  const [erroAcao, setErroAcao] = useState<string | null>(null)

  const hoje = todayIso()
  const nomeUnidade = useMemo(() => {
    const m: Record<string, string> = {}
    for (const u of UNITS) if (unitDbIds[u.id]) m[unitDbIds[u.id].unitId] = u.name
    return m
  }, [unitDbIds])

  async function carregar() {
    setLoading(true)
    setErro(null)
    const { data: dom } = await supabase.rpc('commission_last_sunday')
    const domingo = dom as string
    setUltimoDomingo(domingo)
    // Cada pessoa tem a sua data de repasse (098). Se o banco ainda não tem, vale a segunda para todos.
    const sch = await supabase.rpc('commission_schedules')
    const agendasNovas: Record<string, Agenda> = {}
    if (!sch.error) for (const a of (sch.data ?? []) as Agenda[]) agendasNovas[a.rule_id] = a
    setAgendas(agendasNovas)
    const ids098 = Object.keys(agendasNovas)
    const [pendLista, ate, rep, reg, hist, us] = await Promise.all([
      Promise.all(
        ids098.length > 0
          ? ids098.map((id) => supabase.rpc('commission_pending', { p_until: agendasNovas[id].cutoff, p_rule: id }))
          : [supabase.rpc('commission_pending', { p_until: domingo, p_rule: null })],
      ),
      supabase.rpc('commission_pending', { p_until: todayIso(), p_rule: null }),
      supabase
        .from('commission_payouts')
        .select('id, rule_id, until_date, paid_date, payment_method, total, created_at, finance_launched, note, commission_payout_items(reservation_id, unit_id, kind, amount, reservation:reservations(created_at, client:clients(name)))')
        .order('paid_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(40),
      supabase.from('commission_rules').select('id, name, user_id, scope, start_date, versions:commission_rule_versions(id, mode, value, valid_from, created_at)').order('created_at'),
      supabase.rpc('commission_history', { p_from: null, p_to: null, p_rule: null }),
      supabase.from('user_profiles').select('id, name').eq('active', true).order('name'),
    ])
    const pend = { error: pendLista.find((x) => x.error)?.error ?? null, data: pendLista.flatMap((x) => (x.data ?? []) as any[]) }
    if (pend.error) {
      setErro(
        /permiss/i.test(pend.error.message)
          ? 'Você não tem permissão para ver as comissões.'
          : /PGRST20[25]/.test(pend.error.code ?? '') || /schema cache|commission_pending|p_rule/i.test(pend.error.message)
            ? 'As comissões de várias pessoas ainda não foram instaladas no banco de dados (migração 096). Assim que ela for rodada no Supabase, esta tela passa a funcionar.'
            : 'Não foi possível carregar as comissões.',
      )
      setLoading(false)
      return
    }
    const conv = (p: any): Pendente => ({ ...p, amount: Number(p.amount), valor_regra: p.valor_regra == null ? null : Number(p.valor_regra), valor_festa: Number(p.valor_festa) })
    const lista = ((pend.data ?? []) as any[]).map(conv)
    setProximo(lista)
    const chave = (p: { rule_id: string; reservation_id: string }) => `${p.rule_id}|${p.reservation_id}`
    const ids = new Set(lista.map(chave))
    setSemanaAberta(((ate.data ?? []) as any[]).map(conv).filter((p) => !ids.has(chave(p))))
    setRepasses(
      ((rep.data ?? []) as any[]).map((r) => ({
        id: r.id, rule_id: r.rule_id, until_date: r.until_date, paid_date: r.paid_date, payment_method: r.payment_method, total: Number(r.total), created_at: r.created_at,
        finance_launched: r.finance_launched !== false, note: r.note,
        itens: (r.commission_payout_items ?? []).map((i: any) => ({
          reservation_id: i.reservation_id, unit_id: i.unit_id, kind: i.kind, amount: Number(i.amount),
          cliente: i.reservation?.client?.name ?? '—', cadastro: i.reservation?.created_at ? format(new Date(i.reservation.created_at), 'yyyy-MM-dd') : '',
        })),
      })),
    )
    setRegras(((reg.data ?? []) as any[]).map((r) => ({ ...r, versions: (r.versions ?? []).map((v: any) => ({ ...v, value: Number(v.value) })) })))
    setHistorico(((hist.data ?? []) as any[]).map((h) => ({ ...h, devido: Number(h.devido), pago: Number(h.pago), valor_festa: Number(h.valor_festa), valor_regra: h.valor_regra == null ? null : Number(h.valor_regra) })))
    setUsuarios((us.data ?? []) as { id: string; name: string }[])
    setLoading(false)
  }

  useEffect(() => {
    carregar()
  }, [])

  // festas cadastradas até esta data entram no repasse da pessoa
  const corteDe = (ruleId: string) => agendas[ruleId]?.cutoff ?? ultimoDomingo
  const regrasVisiveis = regras.filter((r) => pessoa === 'todas' || r.id === pessoa)
  const varias = regras.length > 1
  const daPessoa = <T extends { rule_id: string | null }>(l: T[]) => l.filter((x) => pessoa === 'todas' || x.rule_id === pessoa)
  const nomeRegra = (id: string | null) => regras.find((r) => r.id === id)?.name ?? '—'

  // quanto cada pessoa recebe no repasse: com lançamento no Financeiro, a unidade só entra se o total dela for positivo
  const totalDe = (itens: Pendente[], lancar: boolean) => {
    if (!lancar) return itens.reduce((s, i) => s + i.amount, 0)
    const porUn: Record<string, number> = {}
    for (const i of itens) porUn[i.unit_id] = (porUn[i.unit_id] ?? 0) + i.amount
    return Object.values(porUn).filter((v) => v > 0).reduce((s, v) => s + v, 0)
  }

  const historicoFiltrado = daPessoa(historico).filter((h) =>
    filtroHist === 'todas' ? true
      : filtroHist === 'pagas' ? h.situacao === 'paga'
      : filtroHist === 'pendentes' ? PENDENTES.includes(h.situacao)
      : filtroHist === 'canceladas' ? ['abatida', 'abater', 'cancelada_manual'].includes(h.situacao)
      : h.situacao === 'outra_pessoa' || h.situacao === 'cancelada_antes',
  )

  function abrirPagamento(ruleId: string) {
    setPagandoRegra(ruleId)
    setDataPagamento(todayIso())
    setForma('pix')
    setJaLancado(false)
  }

  async function pagar(e: FormEvent, ruleId: string) {
    e.preventDefault()
    const corte = corteDe(ruleId)
    if (!corte) return
    setSalvando(true)
    const { error } = await supabase.rpc('pay_commissions', {
      p_rule: ruleId, p_until: corte, p_paid_date: dataPagamento, p_payment_method: forma, p_launch: !jaLancado, p_reservations: null, p_note: null,
    })
    setSalvando(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    if (error) {
      setErro(friendlyDbError(error.message))
      return
    }
    setPagandoRegra(null)
    setAviso(jaLancado ? 'Repasse marcado como pago. Nada foi lançado no Financeiro (você disse que já estava lançado).' : 'Repasse lançado. As contas pagas já estão no Financeiro.')
    await carregar()
  }

  async function desfazer(r: Repasse) {
    const extra = r.finance_launched ? 'As contas dele saem do Financeiro e as festas voltam a ficar pendentes.' : 'Ele não tinha conta no Financeiro; as festas voltam a ficar pendentes.'
    if (!window.confirm(`Desfazer o repasse de ${brl(r.total)} de ${nomeRegra(r.rule_id)} pago em ${dataBR(r.paid_date)}? ${extra}`)) return
    const { error } = await supabase.rpc('undo_commission_payout', { p_payout: r.id })
    if (error) setErro(friendlyDbError(error.message))
    else {
      setAviso('Repasse desfeito.')
      await carregar()
    }
  }

  function abrirAcao(a: Acao) {
    setAcao(a)
    setAcaoData(todayIso())
    setAcaoForma('pix')
    setAcaoTexto('')
    setErroAcao(null)
  }

  async function confirmarAcao(e: FormEvent) {
    e.preventDefault()
    if (!acao) return
    setSalvando(true)
    const { error } =
      acao.tipo === 'paga'
        ? await supabase.rpc('pay_commissions', {
            p_rule: acao.ruleId, p_until: todayIso(), p_paid_date: acaoData, p_payment_method: acaoForma, p_launch: false, p_reservations: [acao.resId], p_note: acaoTexto.trim() || null,
          })
        : await supabase.rpc('cancel_commission', { p_rule: acao.ruleId, p_reservation: acao.resId, p_reason: acaoTexto.trim() || null })
    setSalvando(false)
    if (error) {
      // o erro aparece dentro da janela (o topo da tela fica longe da linha clicada)
      setErroAcao(friendlyDbError(error.message))
      return
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setAviso(
      acao.tipo === 'paga'
        ? `Comissão de ${acao.pessoa} (${acao.cliente}) marcada como paga, sem lançar no Financeiro.`
        : acao.jaPaga
          ? `Comissão cancelada. Os ${brl(acao.valor)} já pagos serão abatidos no próximo repasse de ${acao.pessoa}.`
          : `Comissão de ${acao.pessoa} (${acao.cliente}) cancelada.`,
    )
    setAcao(null)
    await carregar()
  }

  async function restaurar(ruleId: string, resId: string, cliente: string) {
    if (!window.confirm(`Restaurar a comissão da festa de ${cliente}? Ela volta a entrar nos repasses.`)) return
    const { error } = await supabase.rpc('restore_commission', { p_rule: ruleId, p_reservation: resId })
    if (error) setErro(friendlyDbError(error.message))
    else {
      setAviso('Comissão restaurada.')
      await carregar()
    }
  }

  // botões de cada festa (marcar como paga / cancelar / restaurar)
  function Botoes({ ruleId, resId, cliente, pessoaNome, valor, tipo }: { ruleId: string; resId: string; cliente: string; pessoaNome: string; valor: number; tipo: 'pendente' | 'paga' | 'cancelada' }) {
    return (
      <Can permission="action:comissoes.pagar">
        <span className="inline-flex gap-2 text-xs font-medium whitespace-nowrap">
          {tipo === 'pendente' && (
            <button onClick={() => abrirAcao({ tipo: 'paga', ruleId, resId, cliente, pessoa: pessoaNome, valor })} className="text-teal hover:underline" title="Já foi pago por fora e já está lançado no Financeiro">Já foi paga</button>
          )}
          {(tipo === 'pendente' || tipo === 'paga') && (
            <button onClick={() => abrirAcao({ tipo: 'cancelar', ruleId, resId, cliente, pessoa: pessoaNome, valor, jaPaga: tipo === 'paga' })} className="text-danger hover:underline">Cancelar</button>
          )}
          {tipo === 'cancelada' && <button onClick={() => restaurar(ruleId, resId, cliente)} className="text-purple hover:underline">Restaurar</button>}
        </span>
      </Can>
    )
  }

  function Tabela({ itens, mostrarUnidade, mostrarPessoa }: { itens: Pendente[]; mostrarUnidade?: boolean; mostrarPessoa?: boolean }) {
    return (
      <table className="w-full text-sm min-w-[640px]">
        <thead>
          <tr className="text-left text-muted border-b border-line">
            <th className="pb-2 font-medium">Cadastrada em</th>
            <th className="pb-2 font-medium">Cliente</th>
            {mostrarPessoa && <th className="pb-2 font-medium">Pessoa</th>}
            {mostrarUnidade && <th className="pb-2 font-medium">Unidade</th>}
            <th className="pb-2 font-medium">Data da festa</th>
            <th className="pb-2 font-medium">Tipo</th>
            <th className="pb-2 font-medium text-right">Valor</th>
            <th className="pb-2 font-medium text-right"></th>
          </tr>
        </thead>
        <tbody>
          {itens.map((p) => (
            <tr key={`${p.rule_id}|${p.reservation_id}`} className="border-b border-line last:border-0">
              <td className="py-2">{dataBR(p.cadastro)}</td>
              <td className="py-2"><Link to={`/reservas/${p.reservation_id}`} className="text-purple hover:underline">{p.cliente}</Link></td>
              {mostrarPessoa && <td className="py-2">{p.rule_name}</td>}
              {mostrarUnidade && <td className="py-2">{nomeUnidade[p.unit_id] ?? '—'}</td>}
              <td className="py-2">{dataBR(p.event_date)}</td>
              <td className="py-2">
                <Badge tone={p.kind === 'comissao' ? 'teal' : p.kind === 'abatimento' ? 'danger' : 'amber'}>{p.cancelada_manual && p.kind === 'abatimento' ? 'Comissão cancelada: abate' : KIND_LABEL[p.kind]}</Badge>
                {p.kind === 'abatimento' && p.cancelada_em && !p.cancelada_manual && <span className="block text-[11px] text-muted">festa cancelada em {dataBR(p.cancelada_em)}</span>}
              </td>
              <td className={`py-2 text-right whitespace-nowrap ${p.amount < 0 ? 'text-danger' : ''}`}>
                {p.amount < 0 ? '− ' : ''}{brl(Math.abs(p.amount))}
                {p.modo === 'percentual' && p.valor_regra != null && p.kind !== 'abatimento' && <span className="block text-[11px] text-muted">{num(p.valor_regra)}% de {brl(p.valor_festa)}</span>}
              </td>
              <td className="py-2 text-right">
                {p.kind === 'abatimento' ? (
                  p.cancelada_manual ? <Botoes ruleId={p.rule_id} resId={p.reservation_id} cliente={p.cliente} pessoaNome={p.rule_name} valor={p.amount} tipo="cancelada" /> : null
                ) : (
                  <Botoes ruleId={p.rule_id} resId={p.reservation_id} cliente={p.cliente} pessoaNome={p.rule_name} valor={p.amount} tipo="pendente" />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  const semRegras = !loading && !erro && regras.length === 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Comissões</h1>
        <p className="text-sm text-muted mt-1">
          {regras.length === 0 ? 'Comissão por festa cadastrada' : `Comissão por festa de ${regras.map((r) => r.name).join(', ')}`} · cada pessoa tem a sua data de repasse
        </p>
      </div>

      <p className="text-xs text-muted flex items-start gap-1.5 -mt-3">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>
          Cada pessoa recebe um valor fixo por festa ou uma porcentagem do valor da festa, conforme combinado (veja Configuração, no fim da tela). A festa gera a comissão pelo valor que valia no dia do cadastro.
          No dia do repasse de cada pessoa (semanal, quinzenal ou mensal, veja em cada cartão), o repasse paga as festas cadastradas até a véspera. Se uma festa com comissão já paga for cancelada, o valor é abatido no próximo repasse; festa cadastrada e cancelada antes do repasse não gera comissão.
          Cada repasse vira uma conta paga no Financeiro (categoria "Comissão"), uma por unidade. Se você já lançou esse pagamento por fora, use "Já foi paga" ou marque a opção ao pagar: ele fica como pago aqui, sem criar conta de novo.
        </span>
      </p>

      {erro && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5 flex justify-between gap-2">{erro}<button onClick={() => setErro(null)}><X className="w-4 h-4" /></button></div>}
      {aviso && <div className="bg-teal-light text-teal text-sm rounded-lg px-4 py-2.5 flex justify-between gap-2">{aviso}<button onClick={() => setAviso(null)}><X className="w-4 h-4" /></button></div>}

      {loading ? (
        <Card><p className="text-sm text-muted py-6 text-center">Carregando...</p></Card>
      ) : erro && proximo.length === 0 && repasses.length === 0 && regras.length === 0 ? null : (
        <>
          {varias && (
            <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Pessoa">
              {[{ id: 'todas', name: 'Todas as pessoas' }, ...regras].map((r) => (
                <button key={r.id} type="button" role="tab" aria-selected={pessoa === r.id} onClick={() => setPessoa(r.id)} className={`px-3 h-8 rounded-lg text-sm font-medium border ${pessoa === r.id ? 'bg-purple text-white border-purple' : 'border-line text-ink/70 hover:bg-paper'}`}>
                  {r.name}
                </button>
              ))}
            </div>
          )}

          {semRegras && (
            <Card>
              <p className="text-sm text-muted py-3">Ninguém recebe comissão ainda. Cadastre a primeira pessoa em <strong>Configuração</strong>, no fim da tela: o nome, o valor (fixo ou porcentagem) e de quais festas ela recebe.</p>
            </Card>
          )}

          <div className={`grid grid-cols-1 gap-4 ${regrasVisiveis.length > 1 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-3'}`}>
            {regrasVisiveis.map((r) => {
              const v = versaoEm(r, hoje)
              const futura = [...r.versions].filter((x) => x.valid_from > hoje).sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1))[0]
              const meus = proximo.filter((p) => p.rule_id === r.id)
              const meusSemana = semanaAberta.filter((p) => p.rule_id === r.id)
              return (
                <Card key={r.id}>
                  {varias && <p className="text-sm font-semibold mb-2">{r.name}</p>}
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs text-muted">Valor hoje</p>
                      <p className="text-lg font-display font-semibold">{v ? descValor(v.mode, v.value) : '—'}</p>
                      <p className="text-[11px] text-muted">{futura ? `Muda para ${descValor(futura.mode, futura.value)} em ${dataBR(futura.valid_from)}.` : r.scope === 'todas' ? 'Vale para todas as festas.' : `Festas cadastradas por ${usuarios.find((u) => u.id === r.user_id)?.name ?? r.name}.`}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted">Próximo repasse</p>
                      <p className="text-lg font-display font-semibold text-amber">{brl(totalDe(meus, true))}</p>
                      <p className="text-[11px] text-muted">Festas cadastradas até {corteDe(r.id) ? dataBR(corteDe(r.id)!) : '—'} (já com abatimentos).{meusSemana.length > 0 ? ` Mais ${meusSemana.filter((p) => p.kind === 'comissao').length} festa(s) cadastrada(s) depois, no período em andamento.` : ''}</p>
                      <p className="text-[11px] text-muted mt-1">Paga {descAgenda(agendas[r.id])}{agendas[r.id] ? ` · próximo pagamento em ${dataBR(agendas[r.id].next_pay)}` : ''}.</p>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>

          {regrasVisiveis.map((r) => {
            const meus = proximo.filter((p) => p.rule_id === r.id)
            const total = totalDe(meus, !jaLancado || pagandoRegra !== r.id)
            const porUnidade = (() => {
              const g: Record<string, Pendente[]> = {}
              for (const p of meus) (g[p.unit_id] ??= []).push(p)
              return Object.entries(g).map(([unitId, itens]) => ({ unitId, itens, total: itens.reduce((s, i) => s + i.amount, 0) }))
            })()
            const totalPagavel = totalDe(meus, true)
            return (
              <Card
                key={r.id}
                title={`Próximo repasse${varias ? ` de ${r.name}` : ''} — festas cadastradas até ${corteDe(r.id) ? dataBR(corteDe(r.id)!) : '—'}`}
                action={
                  totalPagavel > 0 && pagandoRegra !== r.id ? (
                    <Can permission="action:comissoes.pagar">
                      <Button onClick={() => abrirPagamento(r.id)}>Pagar repasse de {brl(totalPagavel)}</Button>
                    </Can>
                  ) : undefined
                }
              >
                {porUnidade.length === 0 ? (
                  <p className="text-sm text-muted py-3">Nada a pagar: todas as festas cadastradas até {corteDe(r.id) ? dataBR(corteDe(r.id)!) : 'o último repasse'} já foram pagas.</p>
                ) : (
                  <div className="space-y-5 overflow-x-auto">
                    {porUnidade.map((u) => (
                      <div key={u.unitId}>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <p className="font-semibold text-sm">{nomeUnidade[u.unitId] ?? 'Unidade'}</p>
                          <p className={`text-sm font-semibold ${u.total > 0 ? '' : 'text-muted'}`}>
                            {u.total > 0 ? `Total ${brl(u.total)}` : `Total ${u.total < 0 ? '− ' : ''}${brl(Math.abs(u.total))} · não é pago agora: o abatimento fica para o próximo repasse`}
                          </p>
                        </div>
                        <Tabela itens={u.itens} />
                      </div>
                    ))}
                  </div>
                )}

                {pagandoRegra === r.id && (
                  <form onSubmit={(e) => pagar(e, r.id)} className="mt-4 bg-paper rounded-lg p-4 space-y-3">
                    <p className="text-sm font-medium">
                      Confirmar o repasse de {brl(total)} para {r.name}.{' '}
                      {jaLancado ? 'Vai ficar como pago aqui, sem criar conta no Financeiro.' : `Vai criar ${porUnidade.filter((u) => u.total > 0).length} conta(s) já paga(s) no Financeiro, uma por unidade.`}
                    </p>
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" checked={jaLancado} onChange={(e) => setJaLancado(e.target.checked)} className="mt-0.5" />
                      <span>
                        <strong>Esse pagamento já está lançado no Financeiro.</strong> Só marcar como pago aqui, sem criar a conta de novo.
                      </span>
                    </label>
                    <div className="flex flex-wrap gap-3 items-end">
                      <label className="text-sm">
                        <span className="block text-xs text-muted mb-1">Data do pagamento</span>
                        <input type="date" value={dataPagamento} max={hoje} onChange={(e) => setDataPagamento(e.target.value)} className={inputCls} required />
                      </label>
                      <label className="text-sm">
                        <span className="block text-xs text-muted mb-1">Forma de pagamento</span>
                        <select value={forma} onChange={(e) => setForma(e.target.value as PaymentMethod)} className={inputCls}>
                          {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>)}
                        </select>
                      </label>
                      <Button type="submit" disabled={salvando || total <= 0}>{salvando ? 'Salvando...' : jaLancado ? 'Marcar como pago' : 'Confirmar pagamento'}</Button>
                      <Button type="button" variant="secondary" onClick={() => setPagandoRegra(null)}>Voltar</Button>
                    </div>
                  </form>
                )}
              </Card>
            )
          })}

          {daPessoa(semanaAberta).length > 0 && (
            <Card title="Período em andamento (ainda não fecha)">
              <p className="text-[11px] text-muted mb-2">Festas cadastradas depois do último fechamento de cada pessoa. Só entram no próximo repasse dela.</p>
              <div className="overflow-x-auto"><Tabela itens={daPessoa(semanaAberta)} mostrarUnidade mostrarPessoa={varias} /></div>
            </Card>
          )}

          <Card title="Histórico por festa">
            <p className="text-[11px] text-muted mb-2">
              Todas as festas cadastradas desde o início de cada pessoa, com a situação da comissão de cada uma. Em "Cancelar", a comissão daquela festa deixa de valer só para aquela pessoa.
            </p>
            <div className="flex flex-wrap gap-1 mb-3">
              {([
                ['todas', `Todas (${daPessoa(historico).length})`],
                ['pagas', `Pagas (${daPessoa(historico).filter((h) => h.situacao === 'paga').length})`],
                ['pendentes', `Pendentes (${daPessoa(historico).filter((h) => PENDENTES.includes(h.situacao)).length})`],
                ['canceladas', 'Canceladas e abatidas'],
                ['nao_geram', 'Não geram'],
              ] as const).map(([k, label]) => (
                <button key={k} onClick={() => setFiltroHist(k)} className={`px-2.5 h-7 rounded-md text-xs font-medium border ${filtroHist === k ? 'bg-purple text-white border-purple' : 'border-line text-ink/70 hover:bg-paper'}`}>
                  {label}
                </button>
              ))}
            </div>
            {historicoFiltrado.length === 0 ? (
              <p className="text-sm text-muted py-2">Nenhuma festa neste filtro.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[820px]">
                  <thead>
                    <tr className="text-left text-muted border-b border-line">
                      <th className="pb-2 font-medium">Cadastrada em</th>
                      <th className="pb-2 font-medium">Cliente</th>
                      {varias && <th className="pb-2 font-medium">Pessoa</th>}
                      <th className="pb-2 font-medium">Unidade</th>
                      <th className="pb-2 font-medium">Cadastrada por</th>
                      <th className="pb-2 font-medium">Situação</th>
                      <th className="pb-2 font-medium text-right">Comissão</th>
                      <th className="pb-2 pl-4 font-medium">Pago em</th>
                      <th className="pb-2 font-medium text-right"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {historicoFiltrado.map((h) => {
                      const tipo = PENDENTES.includes(h.situacao) && h.situacao !== 'abater' ? 'pendente' : h.situacao === 'paga' ? 'paga' : h.situacao === 'cancelada_manual' || (h.situacao === 'abater' && h.devido === 0 && h.conta) ? 'cancelada' : null
                      return (
                        <tr key={`${h.rule_id}|${h.reservation_id}`} className="border-b border-line last:border-0">
                          <td className="py-2 whitespace-nowrap">{dataBR(h.cadastro)}</td>
                          <td className="py-2">
                            <Link to={`/reservas/${h.reservation_id}`} className="text-purple hover:underline">{h.cliente}</Link>
                            <span className="block text-[11px] text-muted">festa em {dataBR(h.event_date)}{h.status === 'cancelada' ? ' · cancelada' : ''}</span>
                          </td>
                          {varias && <td className="py-2">{h.rule_name}</td>}
                          <td className="py-2">{nomeUnidade[h.unit_id] ?? '—'}</td>
                          <td className="py-2">{h.cadastrada_por}</td>
                          <td className="py-2">
                            <Badge tone={SITUACAO[h.situacao]?.tone ?? 'neutral'}>{h.situacao === 'paga' && h.fora_financeiro ? 'Paga (sem lançar no Financeiro)' : SITUACAO[h.situacao]?.label ?? h.situacao}</Badge>
                          </td>
                          <td className="py-2 text-right whitespace-nowrap">
                            {h.devido > 0 ? brl(h.devido) : h.pago !== 0 ? brl(h.pago) : '—'}
                            {h.modo === 'percentual' && h.valor_regra != null && (h.devido > 0 || h.pago !== 0) && <span className="block text-[11px] text-muted">{num(h.valor_regra)}% de {brl(h.valor_festa)}</span>}
                          </td>
                          <td className="py-2 pl-4 whitespace-nowrap">{h.ultimo_repasse ? dataBR(h.ultimo_repasse) : "—"}</td>
                          <td className="py-2 text-right">
                            {tipo && <Botoes ruleId={h.rule_id} resId={h.reservation_id} cliente={h.cliente} pessoaNome={h.rule_name} valor={h.devido > 0 ? h.devido : h.pago} tipo={tipo} />}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Repasses feitos">
            {daPessoa(repasses).length === 0 ? (
              <p className="text-sm text-muted py-3">Nenhum repasse lançado ainda.</p>
            ) : (
              <ul className="divide-y divide-line">
                {daPessoa(repasses).map((r) => (
                  <li key={r.id} className="py-2.5">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <button onClick={() => setAbertoRepasse(abertoRepasse === r.id ? null : r.id)} className="flex items-center gap-1.5 text-sm text-left">
                        {abertoRepasse === r.id ? <ChevronUp className="w-4 h-4 text-muted" /> : <ChevronDown className="w-4 h-4 text-muted" />}
                        <span>
                          {varias && <strong>{nomeRegra(r.rule_id)} · </strong>}
                          Pago em <strong>{dataBR(r.paid_date)}</strong> · festas cadastradas até {dataBR(r.until_date)}
                          {r.payment_method ? ` · ${PAYMENT_METHOD_LABEL[r.payment_method as PaymentMethod] ?? r.payment_method}` : ''}
                          {!r.finance_launched && <span className="ml-2 align-middle"><Badge tone="amber">Sem lançar no Financeiro</Badge></span>}
                        </span>
                      </button>
                      <span className="flex items-center gap-3">
                        <strong className="text-sm">{brl(r.total)}</strong>
                        <Can permission="action:comissoes.desfazer">
                          <button onClick={() => desfazer(r)} className="text-xs text-danger font-medium">Desfazer</button>
                        </Can>
                      </span>
                    </div>
                    {!r.finance_launched && r.note && <p className="ml-6 text-[11px] text-muted mt-0.5">{r.note}</p>}
                    {abertoRepasse === r.id && (
                      <ul className="mt-2 ml-6 text-[13px] space-y-0.5">
                        {r.itens.map((i, k) => (
                          <li key={k} className="flex justify-between gap-3">
                            <span>
                              {i.cadastro ? `${dataBR(i.cadastro)} · ` : ''}
                              <Link to={`/reservas/${i.reservation_id}`} className="text-purple hover:underline">{i.cliente}</Link> · {nomeUnidade[i.unit_id] ?? ''} · {KIND_LABEL[i.kind] ?? i.kind}
                            </span>
                            <span className={i.amount < 0 ? 'text-danger' : ''}>{i.amount < 0 ? '− ' : ''}{brl(Math.abs(i.amount))}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Can permission="action:comissoes.configurar">
            <Card title="Configuração">
              <p className="text-[11px] text-muted mb-3">
                Uma linha por pessoa que recebe comissão. Mudar o valor vale para as festas cadastradas a partir da data escolhida; as cadastradas antes continuam com o valor antigo. Se escolher uma data passada, as festas já pagas desde aquela data geram um ajuste no próximo repasse.
                Para parar de pagar uma pessoa, mude o valor para R$ 0 a partir de uma data.
              </p>
              <div className="space-y-4">
                {regras.map((r) => (
                  <CartaoPessoa key={`${r.id}-${agendas[r.id]?.frequency ?? ''}-${agendas[r.id]?.day ?? ''}-${agendas[r.id]?.weekday ?? ''}`} regra={r} agenda={agendas[r.id]} usuarios={usuarios} hoje={hoje} onErro={setErro} onAviso={setAviso} onMudou={carregar} />
                ))}
                <NovaPessoa usuarios={usuarios} hoje={hoje} primeira={regras.length === 0} onErro={setErro} onAviso={setAviso} onMudou={carregar} />
              </div>
            </Card>
          </Can>
        </>
      )}

      {acao && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" onClick={() => setAcao(null)}>
          <form onSubmit={confirmarAcao} onClick={(e) => e.stopPropagation()} className="bg-surface rounded-xl shadow-xl w-full max-w-md p-5 space-y-3">
            <div className="flex justify-between gap-3">
              <h2 className="text-base font-semibold">{acao.tipo === 'paga' ? 'Marcar como paga (já lançada)' : 'Cancelar comissão'}</h2>
              <button type="button" onClick={() => setAcao(null)} aria-label="Fechar"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-sm">
              Comissão de <strong>{acao.pessoa}</strong> na festa de <strong>{acao.cliente}</strong> ({brl(Math.abs(acao.valor))}).
            </p>
            {acao.tipo === 'paga' ? (
              <>
                <p className="text-xs text-muted">Vai ficar como paga aqui, <strong>sem criar conta no Financeiro</strong>. Use quando esse pagamento já foi lançado lá.</p>
                <div className="flex flex-wrap gap-3">
                  <label className="text-sm">
                    <span className="block text-xs text-muted mb-1">Data do pagamento</span>
                    <input type="date" value={acaoData} max={hoje} onChange={(e) => setAcaoData(e.target.value)} className={inputCls} required />
                  </label>
                  <label className="text-sm">
                    <span className="block text-xs text-muted mb-1">Forma de pagamento</span>
                    <select value={acaoForma} onChange={(e) => setAcaoForma(e.target.value as PaymentMethod)} className={inputCls}>
                      {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>)}
                    </select>
                  </label>
                </div>
                <label className="block text-sm">
                  <span className="block text-xs text-muted mb-1">Observação (opcional)</span>
                  <input value={acaoTexto} onChange={(e) => setAcaoTexto(e.target.value)} placeholder="Ex.: lançado no Financeiro em 05/11" className={`${inputCls} w-full`} />
                </label>
              </>
            ) : (
              <>
                {acao.jaPaga ? (
                  <p className="text-xs bg-amber-light text-amber rounded-lg px-3 py-2">Essa comissão já foi paga ({brl(acao.valor)}). Ao cancelar, o valor é <strong>abatido no próximo repasse</strong> de {acao.pessoa}.</p>
                ) : (
                  <p className="text-xs text-muted">A festa deixa de gerar comissão para {acao.pessoa}. Você pode restaurar depois, no histórico.</p>
                )}
                <label className="block text-sm">
                  <span className="block text-xs text-muted mb-1">Motivo (opcional)</span>
                  <input value={acaoTexto} onChange={(e) => setAcaoTexto(e.target.value)} placeholder="Ex.: festa fechada por outra pessoa" className={`${inputCls} w-full`} />
                </label>
              </>
            )}
            {erroAcao && <p className="text-sm bg-danger-light text-danger rounded-lg px-3 py-2" role="alert">{erroAcao}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={() => setAcao(null)}>Voltar</Button>
              <Button type="submit" disabled={salvando}>{salvando ? 'Salvando...' : acao.tipo === 'paga' ? 'Marcar como paga' : 'Cancelar comissão'}</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

// ---------- Configuração: uma pessoa ----------
function SeletorValor({ modo, setModo, valor, setValor }: { modo: Modo; setModo: (m: Modo) => void; valor: string; setValor: (v: string) => void }) {
  return (
    <>
      <label className="text-sm">
        <span className="block text-xs text-muted mb-1">Como recebe</span>
        <select value={modo} onChange={(e) => setModo(e.target.value as Modo)} className={inputCls}>
          <option value="fixo">Valor fixo por festa (R$)</option>
          <option value="percentual">Porcentagem do valor da festa (%)</option>
        </select>
      </label>
      <label className="text-sm">
        <span className="block text-xs text-muted mb-1">{modo === 'fixo' ? 'Valor por festa (R$)' : 'Porcentagem (%)'}</span>
        <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder={modo === 'fixo' ? '150' : '5'} className={`${inputCls} w-28`} required />
      </label>
    </>
  )
}

function SeletorAgenda({ freq, setFreq, weekday, setWeekday, day, setDay, day2, setDay2 }: {
  freq: Freq; setFreq: (f: Freq) => void; weekday: number; setWeekday: (n: number) => void
  day: string; setDay: (v: string) => void; day2: string; setDay2: (v: string) => void
}) {
  return (
    <>
      <label className="text-sm">
        <span className="block text-xs text-muted mb-1">Quando é paga</span>
        <select value={freq} onChange={(e) => setFreq(e.target.value as Freq)} className={inputCls}>
          <option value="semanal">Toda semana</option>
          <option value="quinzenal">Quinzenal (2 vezes por mês)</option>
          <option value="mensal">Uma vez por mês</option>
        </select>
      </label>
      {freq === 'semanal' && (
        <label className="text-sm">
          <span className="block text-xs text-muted mb-1">Dia da semana</span>
          <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} className={inputCls}>
            {DIAS_SEMANA.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
          </select>
        </label>
      )}
      {freq !== 'semanal' && (
        <label className="text-sm">
          <span className="block text-xs text-muted mb-1">{freq === 'mensal' ? 'Todo dia' : 'Primeiro dia'}</span>
          <input value={day} onChange={(e) => setDay(e.target.value.replace(/\D/g, '').slice(0, 2))} inputMode="numeric" placeholder="10" className={`${inputCls} w-20`} required />
        </label>
      )}
      {freq === 'quinzenal' && (
        <label className="text-sm">
          <span className="block text-xs text-muted mb-1">Segundo dia</span>
          <input value={day2} onChange={(e) => setDay2(e.target.value.replace(/\D/g, '').slice(0, 2))} inputMode="numeric" placeholder="25" className={`${inputCls} w-20`} required />
        </label>
      )}
    </>
  )
}

function EscolhaFestas({ scope, setScope, userId, setUserId, usuarios }: { scope: 'cadastradas' | 'todas'; setScope: (s: 'cadastradas' | 'todas') => void; userId: string; setUserId: (v: string) => void; usuarios: { id: string; name: string }[] }) {
  return (
    <>
      <label className="text-sm">
        <span className="block text-xs text-muted mb-1">Recebe sobre</span>
        <select value={scope} onChange={(e) => setScope(e.target.value as 'cadastradas' | 'todas')} className={inputCls}>
          <option value="cadastradas">As festas que ela cadastrou</option>
          <option value="todas">Todas as festas</option>
        </select>
      </label>
      {scope === 'cadastradas' && (
        <label className="text-sm">
          <span className="block text-xs text-muted mb-1">Quem cadastra</span>
          <select value={userId} onChange={(e) => setUserId(e.target.value)} className={`${inputCls} w-48`} required>
            <option value="">Escolha…</option>
            {usuarios.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
      )}
    </>
  )
}

function CartaoPessoa({ regra, agenda, usuarios, hoje, onErro, onAviso, onMudou }: {
  regra: Regra; agenda: Agenda | undefined; usuarios: { id: string; name: string }[]; hoje: string
  onErro: (m: string) => void; onAviso: (m: string) => void; onMudou: () => Promise<void>
}) {
  const [editando, setEditando] = useState(false)
  const [nome, setNome] = useState(regra.name)
  const [scope, setScope] = useState(regra.scope)
  const [userId, setUserId] = useState(regra.user_id ?? '')
  const [inicio, setInicio] = useState(regra.start_date)
  const [modo, setModo] = useState<Modo>(versaoEm(regra, hoje)?.mode ?? 'fixo')
  const [valor, setValor] = useState('')
  const [desde, setDesde] = useState(hoje)
  const [freq, setFreq] = useState<Freq>(agenda?.frequency ?? 'semanal')
  const [weekday, setWeekday] = useState(agenda?.weekday ?? 1)
  const [dia, setDia] = useState(String(agenda?.day ?? 5))
  const [dia2, setDia2] = useState(String(agenda?.day2 ?? 20))
  const versoes = [...regra.versions].sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1))

  async function salvarValor(e: FormEvent) {
    e.preventDefault()
    const v = parseDecimal(valor)
    if (v == null || v < 0 || (modo === 'percentual' && v > 100)) return onErro(modo === 'percentual' ? 'Informe uma porcentagem entre 0 e 100.' : 'Informe um valor válido.')
    const { error } = await supabase.rpc('set_commission_value', { p_rule: regra.id, p_mode: modo, p_value: v, p_valid_from: desde })
    if (error) return onErro(friendlyDbError(error.message))
    setValor('')
    onAviso(`Novo valor de ${regra.name}: ${descValor(modo, v)}, valendo para festas cadastradas a partir de ${dataBR(desde)}.`)
    await onMudou()
  }
  async function salvarDados(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.rpc('update_commission_rule', { p_id: regra.id, p_name: nome, p_user: scope === 'cadastradas' ? userId || null : null, p_scope: scope, p_start: inicio })
    if (error) return onErro(friendlyDbError(error.message))
    setEditando(false)
    onAviso('Dados salvos.')
    await onMudou()
  }
  async function salvarAgenda(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.rpc('set_commission_schedule', {
      p_rule: regra.id, p_frequency: freq, p_weekday: weekday, p_day: freq === 'semanal' ? null : Number(dia), p_day2: freq === 'quinzenal' ? Number(dia2) : null,
    })
    if (error) return onErro(/set_commission_schedule|schema cache/i.test(error.message) ? 'A data de repasse ainda não foi instalada no banco de dados (migração 098).' : friendlyDbError(error.message))
    onAviso(`${regra.name} passa a ser paga ${descAgenda({ frequency: freq, weekday, day: Number(dia), day2: Number(dia2) })}.`)
    await onMudou()
  }
  async function remover() {
    if (!window.confirm(`Remover ${regra.name} da lista de comissões? Só é possível se ela nunca teve repasse.`)) return
    const { error } = await supabase.rpc('delete_commission_rule', { p_id: regra.id })
    if (error) return onErro(friendlyDbError(error.message))
    onAviso(`${regra.name} removida.`)
    await onMudou()
  }

  return (
    <div className="border border-line rounded-lg p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-sm">{regra.name}</p>
          <p className="text-[12px] text-muted">
            {regra.scope === 'todas' ? 'Recebe sobre todas as festas' : `Recebe sobre as festas cadastradas por ${usuarios.find((u) => u.id === regra.user_id)?.name ?? '—'}`} · conta festas cadastradas a partir de {dataBR(regra.start_date)}
          </p>
        </div>
        <span className="flex gap-3 text-xs font-medium">
          <button type="button" onClick={() => setEditando(!editando)} className="text-purple">{editando ? 'Fechar' : 'Editar dados'}</button>
          <button type="button" onClick={remover} className="text-danger">Remover</button>
        </span>
      </div>

      {editando && (
        <form onSubmit={salvarDados} className="flex flex-wrap gap-3 items-end bg-paper rounded-lg p-3">
          <label className="text-sm">
            <span className="block text-xs text-muted mb-1">Nome</span>
            <input value={nome} onChange={(e) => setNome(e.target.value)} className={`${inputCls} w-44`} required />
          </label>
          <EscolhaFestas scope={scope} setScope={setScope} userId={userId} setUserId={setUserId} usuarios={usuarios} />
          <label className="text-sm">
            <span className="block text-xs text-muted mb-1">Contar festas cadastradas a partir de</span>
            <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className={inputCls} required />
          </label>
          <Button type="submit" variant="secondary">Salvar</Button>
        </form>
      )}

      <form onSubmit={salvarAgenda} className="flex flex-wrap gap-3 items-end">
        <SeletorAgenda freq={freq} setFreq={setFreq} weekday={weekday} setWeekday={setWeekday} day={dia} setDay={setDia} day2={dia2} setDay2={setDia2} />
        <Button type="submit" variant="secondary">Salvar quando é paga</Button>
        <p className="basis-full text-[11px] text-muted">
          Hoje: paga {descAgenda(agenda)}. O repasse paga as festas cadastradas até a véspera do dia de pagamento. Mês sem o dia escolhido (ex.: 31 em fevereiro) paga no último dia do mês.
        </p>
      </form>

      <form onSubmit={salvarValor} className="flex flex-wrap gap-3 items-end">
        <SeletorValor modo={modo} setModo={setModo} valor={valor} setValor={setValor} />
        <label className="text-sm">
          <span className="block text-xs text-muted mb-1">A partir de</span>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={inputCls} required />
        </label>
        <Button type="submit">Mudar o valor</Button>
      </form>
      <ul className="text-[12px] text-muted">
        {versoes.map((v) => (
          <li key={v.id}>{descValor(v.mode, v.value)} {v.valid_from <= '2000-01-01' ? 'desde o início' : `a partir de ${dataBR(v.valid_from)}`}</li>
        ))}
      </ul>
    </div>
  )
}

function NovaPessoa({ usuarios, hoje, primeira, onErro, onAviso, onMudou }: {
  usuarios: { id: string; name: string }[]; hoje: string; primeira: boolean
  onErro: (m: string) => void; onAviso: (m: string) => void; onMudou: () => Promise<void>
}) {
  const [aberto, setAberto] = useState(primeira)
  const [nome, setNome] = useState('')
  const [scope, setScope] = useState<'cadastradas' | 'todas'>('cadastradas')
  const [userId, setUserId] = useState('')
  const [inicio, setInicio] = useState(hoje)
  const [modo, setModo] = useState<Modo>('fixo')
  const [valor, setValor] = useState('')
  const [freq, setFreq] = useState<Freq>('semanal')
  const [weekday, setWeekday] = useState(1)
  const [dia, setDia] = useState('5')
  const [dia2, setDia2] = useState('20')

  async function criar(e: FormEvent) {
    e.preventDefault()
    const v = parseDecimal(valor)
    if (v == null || v < 0 || (modo === 'percentual' && v > 100)) return onErro(modo === 'percentual' ? 'Informe uma porcentagem entre 0 e 100.' : 'Informe um valor válido.')
    const { data: novoId, error } = await supabase.rpc('create_commission_rule', { p_name: nome, p_user: scope === 'cadastradas' ? userId || null : null, p_scope: scope, p_start: inicio, p_mode: modo, p_value: v })
    if (error) return onErro(friendlyDbError(error.message))
    // só grava a data de repasse quando não é a padrão (toda segunda)
    if (novoId && !(freq === 'semanal' && weekday === 1)) {
      const { error: e2 } = await supabase.rpc('set_commission_schedule', { p_rule: novoId, p_frequency: freq, p_weekday: weekday, p_day: freq === 'semanal' ? null : Number(dia), p_day2: freq === 'quinzenal' ? Number(dia2) : null })
      if (e2) {
        onErro(`${nome.trim()} foi adicionada, mas a data de repasse não foi salva: ${/set_commission_schedule|schema cache/i.test(e2.message) ? 'a migração 098 ainda não foi instalada no banco.' : friendlyDbError(e2.message)}`)
        setNome(''); setValor(''); setUserId(''); setAberto(false)
        await onMudou()
        return
      }
    }
    onAviso(`${nome.trim()} adicionada: ${descValor(modo, v)}, paga ${descAgenda({ frequency: freq, weekday, day: Number(dia), day2: Number(dia2) })}.`)
    setNome(''); setValor(''); setUserId(''); setAberto(false)
    await onMudou()
  }

  if (!aberto) return <Button type="button" variant="secondary" onClick={() => setAberto(true)}>+ Adicionar pessoa</Button>
  return (
    <form onSubmit={criar} className="border border-dashed border-line rounded-lg p-4 space-y-3">
      <p className="text-sm font-medium">{primeira ? 'Quem recebe comissão' : 'Adicionar pessoa'}</p>
      <div className="flex flex-wrap gap-3 items-end">
        <label className="text-sm">
          <span className="block text-xs text-muted mb-1">Nome de quem recebe</span>
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Fulano" className={`${inputCls} w-44`} required />
        </label>
        <EscolhaFestas scope={scope} setScope={setScope} userId={userId} setUserId={setUserId} usuarios={usuarios} />
        <SeletorValor modo={modo} setModo={setModo} valor={valor} setValor={setValor} />
        <SeletorAgenda freq={freq} setFreq={setFreq} weekday={weekday} setWeekday={setWeekday} day={dia} setDay={setDia} day2={dia2} setDay2={setDia2} />
        <label className="text-sm">
          <span className="block text-xs text-muted mb-1">Contar festas cadastradas a partir de</span>
          <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className={inputCls} required />
        </label>
      </div>
      <p className="text-[11px] text-muted">Ex.: Fulano recebe R$ 100 a cada festa que ele cadastrar, ou 5% do valor de cada festa. A comissão é calculada pelo valor que vale no dia em que a festa é cadastrada.</p>
      <div className="flex gap-2">
        <Button type="submit">Adicionar</Button>
        {!primeira && <Button type="button" variant="secondary" onClick={() => setAberto(false)}>Cancelar</Button>}
      </div>
    </form>
  )
}
