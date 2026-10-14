// Comissão da gerente por festa cadastrada, com repasse semanal (segunda).
// Os cálculos ficam no banco (migração 064): commission_pending diz o que
// falta pagar ou abater; pay_commissions lança as contas pagas no Financeiro.
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
import { brl, todayIso, friendlyDbError } from '../lib/format'
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type PaymentMethod } from '../types'

interface Pendente {
  reservation_id: string; unit_id: string; cliente: string; cadastro: string; event_date: string; status: string
  cancelada_em: string | null; kind: 'comissao' | 'abatimento' | 'ajuste'; amount: number
}
interface Repasse {
  id: string; until_date: string; paid_date: string; payment_method: string | null; total: number; created_at: string
  itens: { reservation_id: string; unit_id: string; kind: string; amount: number; cliente: string; cadastro: string }[]
}
interface Valor { id: string; amount: number; valid_from: string; created_at: string }

const dataBR = (iso: string) => format(parseISO(iso), 'dd/MM/yyyy')
const KIND_LABEL: Record<string, string> = { comissao: 'Festa fechada', abatimento: 'Cancelada: abate', ajuste: 'Ajuste de valor' }

export function Commissions() {
  const { unitDbIds } = useUnit()
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ultimoDomingo, setUltimoDomingo] = useState<string | null>(null)
  const [proximo, setProximo] = useState<Pendente[]>([])
  const [semanaAberta, setSemanaAberta] = useState<Pendente[]>([])
  const [repasses, setRepasses] = useState<Repasse[]>([])
  const [valores, setValores] = useState<Valor[]>([])
  const [inicio, setInicio] = useState('')
  const [beneficiario, setBeneficiario] = useState('Gerente')
  const [abertoRepasse, setAbertoRepasse] = useState<string | null>(null)

  // formulário de pagamento
  const [pagando, setPagando] = useState(false)
  const [dataPagamento, setDataPagamento] = useState(todayIso())
  const [forma, setForma] = useState<PaymentMethod>('pix')
  const [salvando, setSalvando] = useState(false)
  // configuração
  const [novoValor, setNovoValor] = useState('')
  const [novoValorDesde, setNovoValorDesde] = useState(todayIso())
  const [inicioEdit, setInicioEdit] = useState('')
  const [benefEdit, setBenefEdit] = useState('')

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
    const [pend, hoje, rep, val, cfg] = await Promise.all([
      supabase.rpc('commission_pending', { p_until: domingo }),
      supabase.rpc('commission_pending', { p_until: todayIso() }),
      supabase
        .from('commission_payouts')
        .select('id, until_date, paid_date, payment_method, total, created_at, commission_payout_items(reservation_id, unit_id, kind, amount, reservation:reservations(created_at, client:clients(name)))')
        .order('paid_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(30),
      supabase.from('commission_rates').select('id, amount, valid_from, created_at').order('valid_from', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('commission_settings').select('start_date, beneficiary').maybeSingle(),
    ])
    if (pend.error) {
      setErro(
        /permiss/i.test(pend.error.message)
          ? 'Você não tem permissão para ver as comissões.'
          : /PGRST20[25]/.test(pend.error.code ?? '') || /schema cache/i.test(pend.error.message)
            ? 'As comissões ainda não foram instaladas no banco de dados (migração 064). Assim que ela for rodada no Supabase, esta tela passa a funcionar.'
            : 'Não foi possível carregar as comissões.',
      )
      setLoading(false)
      return
    }
    const lista = ((pend.data ?? []) as Pendente[]).map((p) => ({ ...p, amount: Number(p.amount) }))
    setProximo(lista)
    const ids = new Set(lista.map((p) => p.reservation_id))
    setSemanaAberta(((hoje.data ?? []) as Pendente[]).filter((p) => !ids.has(p.reservation_id)).map((p) => ({ ...p, amount: Number(p.amount) })))
    setRepasses(
      ((rep.data ?? []) as any[]).map((r) => ({
        id: r.id, until_date: r.until_date, paid_date: r.paid_date, payment_method: r.payment_method, total: Number(r.total), created_at: r.created_at,
        itens: (r.commission_payout_items ?? []).map((i: any) => ({
          reservation_id: i.reservation_id, unit_id: i.unit_id, kind: i.kind, amount: Number(i.amount),
          cliente: i.reservation?.client?.name ?? '—', cadastro: i.reservation?.created_at ? format(new Date(i.reservation.created_at), 'yyyy-MM-dd') : '',
        })),
      })),
    )
    setValores(((val.data ?? []) as Valor[]).map((v) => ({ ...v, amount: Number(v.amount) })))
    if (cfg.data) {
      setInicio(cfg.data.start_date)
      setInicioEdit(cfg.data.start_date)
      setBeneficiario(cfg.data.beneficiary)
      setBenefEdit(cfg.data.beneficiary)
    }
    setLoading(false)
  }

  useEffect(() => {
    carregar()
  }, [])

  const hoje = todayIso()
  const valorAtual = valores.find((v) => v.valid_from <= hoje)
  const valoresFuturos = valores.filter((v) => v.valid_from > hoje)

  const porUnidade = useMemo(() => {
    const g: Record<string, Pendente[]> = {}
    for (const p of proximo) (g[p.unit_id] ??= []).push(p)
    return Object.entries(g).map(([unitId, itens]) => ({ unitId, itens, total: itens.reduce((s, i) => s + i.amount, 0) }))
  }, [proximo])
  const totalPagavel = porUnidade.filter((u) => u.total > 0).reduce((s, u) => s + u.total, 0)

  async function pagar(e: FormEvent) {
    e.preventDefault()
    if (!ultimoDomingo) return
    setSalvando(true)
    const { error } = await supabase.rpc('pay_commissions', { p_until: ultimoDomingo, p_paid_date: dataPagamento, p_payment_method: forma })
    setSalvando(false)
    if (error) {
      setErro(friendlyDbError(error.message))
      return
    }
    setPagando(false)
    setAviso('Repasse lançado. As contas pagas já estão no Financeiro.')
    await carregar()
  }

  async function desfazer(r: Repasse) {
    if (!window.confirm(`Desfazer o repasse de ${brl(r.total)} pago em ${dataBR(r.paid_date)}? As contas dele saem do Financeiro e as festas voltam a ficar pendentes.`)) return
    const { error } = await supabase.rpc('undo_commission_payout', { p_payout: r.id })
    if (error) setErro(friendlyDbError(error.message))
    else {
      setAviso('Repasse desfeito.')
      await carregar()
    }
  }

  async function salvarValor(e: FormEvent) {
    e.preventDefault()
    const v = Number(novoValor.replace(',', '.'))
    if (!(v >= 0) || novoValor.trim() === '') return
    const { error } = await supabase.rpc('set_commission_rate', { p_amount: v, p_valid_from: novoValorDesde })
    if (error) setErro(friendlyDbError(error.message))
    else {
      setNovoValor('')
      setAviso(`Novo valor de ${brl(v)} salvo, valendo para festas cadastradas a partir de ${dataBR(novoValorDesde)}.`)
      await carregar()
    }
  }

  async function salvarConfig(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.rpc('set_commission_settings', { p_start: inicioEdit, p_beneficiary: benefEdit })
    if (error) setErro(friendlyDbError(error.message))
    else {
      setAviso('Configuração salva.')
      await carregar()
    }
  }

  function Tabela({ itens, mostrarUnidade }: { itens: Pendente[]; mostrarUnidade?: boolean }) {
    return (
      <table className="w-full text-sm min-w-[560px]">
        <thead>
          <tr className="text-left text-muted border-b border-line">
            <th className="pb-2 font-medium">Cadastrada em</th>
            <th className="pb-2 font-medium">Cliente</th>
            {mostrarUnidade && <th className="pb-2 font-medium">Unidade</th>}
            <th className="pb-2 font-medium">Data da festa</th>
            <th className="pb-2 font-medium">Tipo</th>
            <th className="pb-2 font-medium text-right">Valor</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((p) => (
            <tr key={p.reservation_id} className="border-b border-line last:border-0">
              <td className="py-2">{dataBR(p.cadastro)}</td>
              <td className="py-2"><Link to={`/reservas/${p.reservation_id}`} className="text-purple hover:underline">{p.cliente}</Link></td>
              {mostrarUnidade && <td className="py-2">{nomeUnidade[p.unit_id] ?? '—'}</td>}
              <td className="py-2">{dataBR(p.event_date)}</td>
              <td className="py-2">
                <Badge tone={p.kind === 'comissao' ? 'teal' : p.kind === 'abatimento' ? 'danger' : 'amber'}>{KIND_LABEL[p.kind]}</Badge>
                {p.kind === 'abatimento' && p.cancelada_em && <span className="block text-[11px] text-muted">cancelada em {dataBR(p.cancelada_em)}</span>}
              </td>
              <td className={`py-2 text-right whitespace-nowrap ${p.amount < 0 ? 'text-danger' : ''}`}>{p.amount < 0 ? '− ' : ''}{brl(Math.abs(p.amount))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Comissões</h1>
        <p className="text-sm text-muted mt-1">
          Comissão de {beneficiario} por festa cadastrada · repasse toda segunda-feira
        </p>
      </div>

      <p className="text-xs text-muted flex items-start gap-1.5 -mt-3">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        Cada festa cadastrada gera a comissão no valor que vale no dia do cadastro. Na segunda, o repasse paga as festas cadastradas até o domingo anterior.
        Se uma festa com comissão já paga for cancelada, o valor é abatido no próximo repasse. Festa cadastrada e cancelada antes do repasse não gera comissão.
        O repasse vira uma conta paga no Financeiro, em cada unidade (despesa geral, categoria "Comissão").
      </p>

      {erro && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5 flex justify-between gap-2">{erro}<button onClick={() => setErro(null)}><X className="w-4 h-4" /></button></div>}
      {aviso && <div className="bg-teal-light text-teal text-sm rounded-lg px-4 py-2.5 flex justify-between gap-2">{aviso}<button onClick={() => setAviso(null)}><X className="w-4 h-4" /></button></div>}

      {loading ? (
        <Card><p className="text-sm text-muted py-6 text-center">Carregando...</p></Card>
      ) : erro && proximo.length === 0 && repasses.length === 0 ? null : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <p className="text-xs text-muted">Valor por festa hoje</p>
              <p className="text-xl font-display font-semibold mt-1">{valorAtual ? brl(valorAtual.amount) : '—'}</p>
              <p className="text-[11px] text-muted mt-1">
                {valoresFuturos.length > 0 ? `Muda para ${brl(valoresFuturos[valoresFuturos.length - 1].amount)} em ${dataBR(valoresFuturos[valoresFuturos.length - 1].valid_from)}.` : 'Para mudar, veja Configuração abaixo.'}
              </p>
            </Card>
            <Card>
              <p className="text-xs text-muted">Próximo repasse</p>
              <p className="text-xl font-display font-semibold mt-1 text-amber">{brl(totalPagavel)}</p>
              <p className="text-[11px] text-muted mt-1">Festas cadastradas até domingo, {ultimoDomingo ? dataBR(ultimoDomingo) : '—'}, ainda não pagas (já com abatimentos).</p>
            </Card>
            <Card>
              <p className="text-xs text-muted">Semana em andamento</p>
              <p className="text-xl font-display font-semibold mt-1">{semanaAberta.filter((p) => p.kind === 'comissao').length} festa(s)</p>
              <p className="text-[11px] text-muted mt-1">Cadastradas depois de domingo. Entram no repasse da próxima segunda ({brl(semanaAberta.reduce((s, p) => s + p.amount, 0))}).</p>
            </Card>
          </div>

          <Card
            title={`Próximo repasse — festas cadastradas até ${ultimoDomingo ? dataBR(ultimoDomingo) : '—'}`}
            action={
              totalPagavel > 0 ? (
                <Can permission="action:comissoes.pagar">
                  <Button onClick={() => setPagando(true)}>Pagar repasse de {brl(totalPagavel)}</Button>
                </Can>
              ) : undefined
            }
          >
            {porUnidade.length === 0 ? (
              <p className="text-sm text-muted py-3">Nada a pagar: todas as festas cadastradas até domingo já foram pagas.</p>
            ) : (
              <div className="space-y-5">
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

            {pagando && (
              <form onSubmit={pagar} className="mt-4 bg-paper rounded-lg p-4 space-y-3">
                <p className="text-sm font-medium">
                  Confirmar o repasse de {brl(totalPagavel)} para {beneficiario}. Vai criar {porUnidade.filter((u) => u.total > 0).length} conta(s) já paga(s) no Financeiro, uma por unidade.
                </p>
                <div className="flex flex-wrap gap-3 items-end">
                  <label className="text-sm">
                    <span className="block text-xs text-muted mb-1">Data do pagamento</span>
                    <input type="date" value={dataPagamento} max={hoje} onChange={(e) => setDataPagamento(e.target.value)} className="border border-line rounded-lg px-3 h-9 text-sm" required />
                  </label>
                  <label className="text-sm">
                    <span className="block text-xs text-muted mb-1">Forma de pagamento</span>
                    <select value={forma} onChange={(e) => setForma(e.target.value as PaymentMethod)} className="border border-line rounded-lg px-3 h-9 text-sm">
                      {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>)}
                    </select>
                  </label>
                  <Button type="submit" disabled={salvando}>{salvando ? 'Lançando...' : 'Confirmar pagamento'}</Button>
                  <Button type="button" variant="secondary" onClick={() => setPagando(false)}>Voltar</Button>
                </div>
              </form>
            )}
          </Card>

          {semanaAberta.length > 0 && (
            <Card title="Semana em andamento (ainda não fecha)">
              <p className="text-[11px] text-muted mb-2">Festas cadastradas depois do último domingo. Só entram no repasse da próxima segunda.</p>
              <Tabela itens={semanaAberta} mostrarUnidade />
            </Card>
          )}

          <Card title="Repasses feitos">
            {repasses.length === 0 ? (
              <p className="text-sm text-muted py-3">Nenhum repasse lançado ainda.</p>
            ) : (
              <ul className="divide-y divide-line">
                {repasses.map((r) => (
                  <li key={r.id} className="py-2.5">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <button onClick={() => setAbertoRepasse(abertoRepasse === r.id ? null : r.id)} className="flex items-center gap-1.5 text-sm text-left">
                        {abertoRepasse === r.id ? <ChevronUp className="w-4 h-4 text-muted" /> : <ChevronDown className="w-4 h-4 text-muted" />}
                        <span>
                          Pago em <strong>{dataBR(r.paid_date)}</strong> · festas cadastradas até {dataBR(r.until_date)}
                          {r.payment_method ? ` · ${PAYMENT_METHOD_LABEL[r.payment_method as PaymentMethod] ?? r.payment_method}` : ''}
                        </span>
                      </button>
                      <span className="flex items-center gap-3">
                        <strong className="text-sm">{brl(r.total)}</strong>
                        <Can permission="action:comissoes.desfazer">
                          <button onClick={() => desfazer(r)} className="text-xs text-danger font-medium">Desfazer</button>
                        </Can>
                      </span>
                    </div>
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
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <form onSubmit={salvarValor} className="space-y-2">
                  <p className="text-sm font-medium">Mudar o valor da comissão</p>
                  <p className="text-[11px] text-muted">Vale para as festas cadastradas a partir da data escolhida. As festas cadastradas antes continuam com o valor antigo. Se escolher uma data passada, as festas já pagas desde aquela data geram um ajuste no próximo repasse.</p>
                  <div className="flex flex-wrap gap-2 items-end">
                    <label className="text-sm">
                      <span className="block text-xs text-muted mb-1">Novo valor por festa (R$)</span>
                      <input value={novoValor} onChange={(e) => setNovoValor(e.target.value)} inputMode="decimal" placeholder="150" className="border border-line rounded-lg px-3 h-9 text-sm w-32" required />
                    </label>
                    <label className="text-sm">
                      <span className="block text-xs text-muted mb-1">A partir de</span>
                      <input type="date" value={novoValorDesde} onChange={(e) => setNovoValorDesde(e.target.value)} className="border border-line rounded-lg px-3 h-9 text-sm" required />
                    </label>
                    <Button type="submit">Salvar valor</Button>
                  </div>
                  <ul className="text-[12px] text-muted pt-1">
                    {valores.map((v) => (
                      <li key={v.id}>{brl(v.amount)} {v.valid_from <= '2000-01-01' ? 'desde o início' : `a partir de ${dataBR(v.valid_from)}`}</li>
                    ))}
                  </ul>
                </form>
                <form onSubmit={salvarConfig} className="space-y-2">
                  <p className="text-sm font-medium">Início e nome</p>
                  <p className="text-[11px] text-muted">
                    Só contam festas cadastradas a partir desta data. Use para não pagar de novo o que já foi pago fora do sistema. Hoje: {inicio ? dataBR(inicio) : '—'}.
                  </p>
                  <div className="flex flex-wrap gap-2 items-end">
                    <label className="text-sm">
                      <span className="block text-xs text-muted mb-1">Contar festas cadastradas a partir de</span>
                      <input type="date" value={inicioEdit} onChange={(e) => setInicioEdit(e.target.value)} className="border border-line rounded-lg px-3 h-9 text-sm" required />
                    </label>
                    <label className="text-sm">
                      <span className="block text-xs text-muted mb-1">Quem recebe</span>
                      <input value={benefEdit} onChange={(e) => setBenefEdit(e.target.value)} className="border border-line rounded-lg px-3 h-9 text-sm w-44" />
                    </label>
                    <Button type="submit" variant="secondary">Salvar</Button>
                  </div>
                </form>
              </div>
            </Card>
          </Can>
        </>
      )}
    </div>
  )
}
