import { useEffect, useMemo, useState } from 'react'
import { format, parseISO, addDays } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, CartesianGrid } from 'recharts'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { supabase } from '../../lib/supabaseClient'
import { UNITS } from '../../lib/UnitContext'
import { parseDecimal, friendlyDbError } from '../../lib/format'
import { currentMonthValue, addMonthsToValue, monthBounds } from '../../lib/monthUtils'
import { loadMonthViews } from '../../pages/FinanceViews'
import { LegendaAjuda } from '../PeriodoGrafico'

// Aba Planejamento do Financeiro: ponto de equilíbrio (quantas festas por mês
// para não ter prejuízo) e projeção do caixa dia a dia (migração 089).

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}
function brl2(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
const dm = (iso: string) => format(parseISO(iso), 'dd/MM')
const hojeIso = () => format(new Date(), 'yyyy-MM-dd')
const FALTA_089 = 'Falta rodar a migração 089 no banco para usar o planejamento.'

// ======================= Ponto de equilíbrio =======================

export function PontoEquilibrio({ unitId }: { unitId: string | null }) {
  const [fixas, setFixas] = useState<{ descricao: string; valor: number }[]>([])
  const [mediaGerais, setMediaGerais] = useState<number | null>(null)
  const [lucroMedio, setLucroMedio] = useState<{ valor: number; festas: number; meses: number } | null>(null)
  const [realizadas, setRealizadas] = useState(0)
  const [marcadas, setMarcadas] = useState(0)
  const [carregando, setCarregando] = useState(true)
  const [sim, setSim] = useState<number | null>(null)

  useEffect(() => {
    let vivo = true
    setCarregando(true)
    ;(async () => {
      const mes = currentMonthValue()
      const meses = Array.from({ length: 6 }, (_, i) => addMonthsToValue(mes, -(i + 1)))
      let qFixas = supabase.from('recurring_expenses').select('description, amount').eq('active', true)
      if (unitId) qFixas = qFixas.eq('unit_id', unitId)
      const { startIso, endIso } = monthBounds(mes)
      let qMarcadas = supabase.from('reservations').select('id', { count: 'exact', head: true })
        .not('status', 'in', '(cancelada,orcamento)').gt('event_date', hojeIso()).lt('event_date', endIso).gte('event_date', startIso)
      if (unitId) qMarcadas = qMarcadas.eq('unit_id', unitId)
      const [{ data: fx }, viewsAnteriores, atual, { count }] = await Promise.all([
        qFixas,
        Promise.all(meses.map((m) => loadMonthViews(m, unitId).catch(() => null))),
        loadMonthViews(mes, unitId).catch(() => null),
        qMarcadas,
      ])
      // Festas marcadas "fora da conta" no Lucro por festa não entram na média.
      const todas = viewsAnteriores.flatMap((v) => v?.festas ?? [])
      const fora = new Set<string>()
      for (let k = 0; k < todas.length; k += 150) {
        const { data } = await supabase.from('reservations').select('id').in('id', todas.slice(k, k + 150).map((f) => f.id)).eq('profit_excluded', true)
        for (const r of data ?? []) fora.add(r.id)
      }
      const validas = todas.filter((f) => f.status === 'completo' && !fora.has(f.id))
      const comDados = viewsAnteriores.filter((v) => v && Number(v.resultado.festas) > 0)
      if (!vivo) return
      setFixas((fx ?? []).map((x) => ({ descricao: x.description, valor: Number(x.amount) })))
      setMediaGerais(comDados.length ? comDados.reduce((s, v) => s + Number(v!.resultado.despesas_gerais), 0) / comDados.length : null)
      setLucroMedio(validas.length ? { valor: validas.reduce((s, f) => s + Number(f.lucro), 0) / validas.length, festas: validas.length, meses: comDados.length } : null)
      setRealizadas(Number(atual?.resultado.festas ?? 0))
      setMarcadas(count ?? 0)
      setCarregando(false)
    })()
    return () => {
      vivo = false
    }
  }, [unitId])

  const somaFixas = fixas.reduce((s, f) => s + f.valor, 0)
  // Custo da casa por mês: a média real das despesas gerais pagas (inclui as
  // fixas e as que variam). Sem histórico, usa as despesas fixas cadastradas.
  const custoCasa = mediaGerais && mediaGerais > 0 ? mediaGerais : somaFixas
  const usaMedia = !!(mediaGerais && mediaGerais > 0)
  const necessarias = lucroMedio && lucroMedio.valor > 0 ? custoCasa / lucroMedio.valor : null
  const nec = necessarias !== null ? Math.ceil(necessarias) : null
  const noMes = realizadas + marcadas
  const simulado = sim ?? Math.max(nec ?? 4, 1)
  const resultadoSim = lucroMedio ? simulado * lucroMedio.valor - custoCasa : 0

  return (
    <Card title="Ponto de equilíbrio">
      <p className="text-xs text-muted mb-3">Quantas festas por mês a casa precisa fazer para não ter prejuízo.</p>
      {carregando ? (
        <p className="text-sm text-muted py-4 text-center">Calculando…</p>
      ) : !lucroMedio || lucroMedio.valor <= 0 ? (
        <p className="text-sm text-muted">Ainda não há festas completas (com custos lançados) nos últimos 6 meses para calcular o lucro médio por festa.</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="bg-purple-light/60 rounded-lg px-3 py-2.5 text-sm">
                <strong className="text-purple-dark">Custo da casa por mês</strong> {brl(custoCasa)} ÷ <strong className="text-purple-dark">lucro médio por festa</strong> {brl(lucroMedio.valor)} ={' '}
                <strong className="text-purple-dark">{necessarias!.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} festas</strong>, ou seja, <strong className="text-purple-dark">{nec} festas por mês</strong>.
              </div>
              <p className="text-xs text-muted">
                Lucro médio por festa: média de {lucroMedio.festas} festa{lucroMedio.festas === 1 ? '' : 's'} completa{lucroMedio.festas === 1 ? '' : 's'} dos últimos 6 meses, depois dos custos de cada uma (equipe, fornecedores, insumos e taxa). Festas com dados incompletos ou fora da conta não entram.
              </p>
              <div>
                <div className="flex justify-between text-sm font-medium">
                  <span>Este mês: {noMes} de {nec} festas</span>
                  <span>{nec ? Math.min(100, Math.round((noMes / nec) * 100)) : 0}%</span>
                </div>
                <div className="h-2.5 bg-paper rounded-full overflow-hidden mt-1.5">
                  <div className={`h-full rounded-full ${noMes >= (nec ?? 0) ? 'bg-teal' : 'bg-purple'}`} style={{ width: `${nec ? Math.min(100, (noMes / nec) * 100) : 0}%` }} />
                </div>
                <p className="text-xs text-muted mt-1.5">
                  {realizadas} realizada{realizadas === 1 ? '' : 's'} + {marcadas} marcada{marcadas === 1 ? '' : 's'} para o resto do mês.{' '}
                  {nec !== null && noMes >= nec ? 'O mês já cobre o custo da casa.' : `Faltam ${(nec ?? 0) - noMes} festa${(nec ?? 0) - noMes === 1 ? '' : 's'} para cobrir o custo da casa.`}
                </p>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-ink/70 mb-1">{usaMedia ? 'De onde vem o custo da casa' : 'Despesas fixas cadastradas'}</p>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-line">
                  {usaMedia && (
                    <tr>
                      <td className="py-1.5">Média das despesas gerais pagas ({lucroMedio.meses} meses)</td>
                      <td className="py-1.5 text-right font-medium">{brl(mediaGerais!)}</td>
                    </tr>
                  )}
                  {fixas.map((f, i) => (
                    <tr key={i} className={usaMedia ? 'text-muted' : ''}>
                      <td className="py-1.5">{usaMedia ? `· ${f.descricao} (fixa)` : f.descricao}</td>
                      <td className="py-1.5 text-right">{brl(f.valor)}</td>
                    </tr>
                  ))}
                  {!usaMedia && (
                    <tr className="font-semibold">
                      <td className="py-1.5">Total por mês</td>
                      <td className="py-1.5 text-right">{brl(somaFixas)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
              {usaMedia && <p className="text-[11px] text-muted mt-1">A média inclui as despesas fixas ({brl(somaFixas)}) e as que variam (comissões, manutenção, compras gerais). Por isso é mais fiel ao que a casa gasta de verdade.</p>}
            </div>
          </div>
          <div className="border-t border-line pt-3">
            <label htmlFor="sim-festas" className="text-sm font-medium">E se eu fizer <strong>{simulado}</strong> festa{simulado === 1 ? '' : 's'} por mês?</label>
            <input id="sim-festas" type="range" min={0} max={Math.max(12, (nec ?? 6) * 2)} value={simulado} onChange={(e) => setSim(Number(e.target.value))} className="w-full accent-purple mt-1" />
            <p className="text-sm mt-1">
              Com {simulado} festa{simulado === 1 ? '' : 's'}, sobram {brl(simulado * lucroMedio.valor)} das festas e saem {brl(custoCasa)} de custo da casa: o mês teria{' '}
              <strong className={resultadoSim >= 0 ? 'text-teal' : 'text-danger'}>{resultadoSim >= 0 ? 'lucro' : 'prejuízo'} de {brl(Math.abs(resultadoSim))}</strong>.
            </p>
          </div>
        </div>
      )}
    </Card>
  )
}

// ======================= Projeção do caixa =======================

interface Movimento { dia: string; tipo: 'receber' | 'conta' | 'fixa' | 'festa'; descricao: string; valor: number; atrasado: boolean }
interface Saldo { unit_id: string; amount: number; informed_at: string; informed_by: string | null }

export function ProjecaoCaixa({ unitId, unitDbIds }: { unitId: string | null; unitDbIds: Record<string, { unitId: string }> }) {
  const [movs, setMovs] = useState<Movimento[] | null>(null)
  const [saldos, setSaldos] = useState<Saldo[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [horizonte, setHorizonte] = useState<30 | 60 | 90>(() => {
    try {
      const v = Number(localStorage.getItem('fin-projecao-horizonte'))
      return v === 60 || v === 90 ? v : 30
    } catch {
      return 30
    }
  })
  const [editando, setEditando] = useState<Record<string, string>>({})
  const [salvando, setSalvando] = useState<string | null>(null)
  const [recarga, setRecarga] = useState(0)

  const unidades = useMemo(
    () => UNITS.filter((u) => unitDbIds[u.id] && (!unitId || unitDbIds[u.id].unitId === unitId)).map((u) => ({ slug: u.id, nome: u.name, id: unitDbIds[u.id].unitId })),
    [unitId, unitDbIds],
  )

  useEffect(() => {
    let vivo = true
    setErro(null)
    Promise.all([
      supabase.rpc('cash_projection', { p_unit: unitId, p_days: 90 }),
      supabase.from('cash_balances').select('unit_id, amount, informed_at, informed_by'),
    ]).then(([proj, sal]) => {
      if (!vivo) return
      if (proj.error) {
        setErro(/cash_projection/.test(proj.error.message) ? FALTA_089 : friendlyDbError(proj.error.message))
        setMovs([])
        return
      }
      setMovs(((proj.data ?? []) as any[]).map((m) => ({ dia: m.dia, tipo: m.tipo, descricao: m.descricao, valor: Number(m.valor), atrasado: !!m.atrasado })).sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : b.valor - a.valor)))
      setSaldos(((sal.data ?? []) as any[]).map((s) => ({ ...s, amount: Number(s.amount) })))
    })
    return () => {
      vivo = false
    }
  }, [unitId, recarga])

  function trocarHorizonte(h: 30 | 60 | 90) {
    setHorizonte(h)
    try {
      localStorage.setItem('fin-projecao-horizonte', String(h))
    } catch {
      /* só não lembra */
    }
  }

  const saldosDasUnidades = unidades.map((u) => ({ ...u, saldo: saldos.find((s) => s.unit_id === u.id) ?? null }))
  const informados = saldosDasUnidades.filter((u) => u.saldo)
  const todosInformados = informados.length === unidades.length && unidades.length > 0
  const saldoHoje = informados.reduce((s, u) => s + (u.saldo?.amount ?? 0), 0)

  async function salvarSaldo(unidade: { slug: string; id: string }) {
    const v = parseDecimal(editando[unidade.slug] ?? '')
    if (v === null) return setErro('Digite o saldo, por exemplo 9150 ou 9.150,00.')
    setSalvando(unidade.slug)
    const { error } = await supabase.rpc('set_cash_balance', { p_unit: unidade.id, p_amount: v })
    setSalvando(null)
    if (error) return setErro(/set_cash_balance/.test(error.message) ? FALTA_089 : friendlyDbError(error.message))
    setEditando((p) => {
      const { [unidade.slug]: _x, ...resto } = p
      return resto
    })
    setRecarga((n) => n + 1)
  }

  const { dias, lista, minimo, primeiroNegativo } = useMemo(() => {
    const hoje = new Date()
    const fim = format(addDays(hoje, horizonte), 'yyyy-MM-dd')
    const lista = (movs ?? []).filter((m) => m.dia <= fim)
    const porDia = new Map<string, number>()
    for (const m of lista) porDia.set(m.dia, (porDia.get(m.dia) ?? 0) + m.valor)
    const dias: { dia: string; rotulo: string; saldo: number }[] = []
    let s = saldoHoje
    for (let i = 0; i <= horizonte; i++) {
      const d = format(addDays(hoje, i), 'yyyy-MM-dd')
      s += porDia.get(d) ?? 0
      dias.push({ dia: d, rotulo: dm(d), saldo: Math.round(s * 100) / 100 })
    }
    const minimo = dias.reduce((a, b) => (b.saldo < a.saldo ? b : a), dias[0])
    const primeiroNegativo = dias.find((d) => d.saldo < 0) ?? null
    return { dias, lista, minimo, primeiroNegativo }
  }, [movs, horizonte, saldoHoje])

  const entra = lista.filter((m) => m.valor > 0).reduce((s, m) => s + m.valor, 0)
  const sai = lista.filter((m) => m.valor < 0).reduce((s, m) => s - m.valor, 0)
  let acumulado = saldoHoje
  const corTipo = { receber: 'bg-teal', conta: 'bg-danger', fixa: 'bg-danger', festa: 'bg-amber' } as const

  return (
    <Card title="Projeção do caixa">
      <p className="text-xs text-muted mb-3">
        Soma o saldo em conta de hoje, as parcelas a receber, as contas a pagar, as despesas fixas dos próximos meses e os custos das festas já vendidas. Não inclui festas que ainda não foram vendidas.
      </p>
      {erro && <p className="text-sm bg-danger-light text-danger rounded-lg px-3 py-2 mb-3">{erro}</p>}

      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div className="space-y-2">
          <p className="text-sm font-medium">Quanto tem na conta hoje?</p>
          {saldosDasUnidades.map((u) => {
            const emEdicao = editando[u.slug] !== undefined || !u.saldo
            return (
              <div key={u.slug} className="flex flex-wrap items-center gap-2 text-sm">
                {unidades.length > 1 && <span className="w-36 text-muted">{u.nome}</span>}
                {emEdicao ? (
                  <>
                    <input
                      inputMode="decimal"
                      value={editando[u.slug] ?? ''}
                      onChange={(e) => setEditando((p) => ({ ...p, [u.slug]: e.target.value }))}
                      placeholder="Ex.: 9.150,00"
                      className="w-36 border border-line rounded-lg px-3 py-1.5 text-sm"
                      aria-label={`Saldo em conta ${u.nome}`}
                    />
                    <Button type="button" className="px-3 py-1.5" onClick={() => salvarSaldo(u)} disabled={salvando === u.slug}>
                      {salvando === u.slug ? 'Salvando…' : 'Salvar'}
                    </Button>
                    {u.saldo && <button type="button" className="text-xs text-muted" onClick={() => setEditando((p) => { const { [u.slug]: _x, ...r } = p; return r })}>Cancelar</button>}
                  </>
                ) : (
                  <>
                    <strong>{brl2(u.saldo!.amount)}</strong>
                    <span className="text-xs text-muted">informado em {format(parseISO(u.saldo!.informed_at), 'dd/MM HH:mm')}{u.saldo!.informed_by ? ` por ${u.saldo!.informed_by}` : ''}</span>
                    <button type="button" className="text-xs font-medium text-purple" onClick={() => setEditando((p) => ({ ...p, [u.slug]: String(u.saldo!.amount).replace('.', ',') }))}>Atualizar</button>
                  </>
                )}
              </div>
            )
          })}
          <p className="text-[11px] text-muted">O sistema não vê o banco: você informa o saldo e atualiza quando quiser. Todos os usuários veem o mesmo valor.</p>
        </div>
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5 gap-0.5" role="tablist" aria-label="Quantos dias">
          {([30, 60, 90] as const).map((h) => (
            <button key={h} type="button" role="tab" aria-selected={horizonte === h} onClick={() => trocarHorizonte(h)} className={`px-2.5 h-8 rounded-md text-xs font-medium ${horizonte === h ? 'bg-purple text-white' : 'text-ink/70 hover:bg-paper'}`}>
              {h} dias
            </button>
          ))}
        </div>
      </div>

      {movs === null ? (
        <p className="text-sm text-muted py-6 text-center">Calculando…</p>
      ) : (
        <>
          {todosInformados ? (
            <div className={`rounded-lg px-4 py-3 mb-3 text-white ${primeiroNegativo ? 'bg-danger' : 'bg-teal'}`}>
              <p className="text-[11px] font-semibold uppercase tracking-wide opacity-90">{primeiroNegativo ? 'Atenção' : 'Tudo certo'} nos próximos {horizonte} dias</p>
              <p className="text-lg font-display font-semibold">{primeiroNegativo ? `O caixa fica negativo em ${dm(primeiroNegativo.dia)} (${brl(primeiroNegativo.saldo)})` : 'O caixa não fica negativo'}</p>
              <p className="text-xs opacity-95 mt-0.5">
                Menor saldo previsto: {brl(minimo.saldo)} em {dm(minimo.dia)}.{' '}
                {horizonte >= 60 ? 'Os meses mais distantes costumam parecer piores porque ainda há poucas festas vendidas para eles. Isso é falta de vendas até agora, não prejuízo.' : 'Cada novo sinal recebido melhora esse número.'}
              </p>
            </div>
          ) : (
            <p className="text-sm bg-amber-light text-amber rounded-lg px-3 py-2 mb-3">
              Informe o saldo em conta{unidades.length > 1 ? ' de cada unidade' : ''} para o sistema avisar se o caixa vai ficar negativo. Sem o saldo, o gráfico mostra só o que entra e sai a partir de zero.
            </p>
          )}

          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="bg-paper rounded-lg px-3 py-2"><p className="text-[11px] text-muted">Deve entrar</p><p className="font-display font-semibold text-teal">{brl(entra)}</p></div>
            <div className="bg-paper rounded-lg px-3 py-2"><p className="text-[11px] text-muted">Deve sair</p><p className="font-display font-semibold text-danger">{brl(sai)}</p></div>
            <div className="bg-paper rounded-lg px-3 py-2"><p className="text-[11px] text-muted">Saldo no fim ({dm(dias[dias.length - 1].dia)})</p><p className={`font-display font-semibold ${dias[dias.length - 1].saldo < 0 ? 'text-danger' : ''}`}>{brl(dias[dias.length - 1].saldo)}</p></div>
          </div>

          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={dias}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2DBEE" vertical={false} />
              <XAxis dataKey="rotulo" tick={{ fontSize: 12, fill: '#6E6880' }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
              <YAxis tick={{ fontSize: 12, fill: '#6E6880' }} axisLine={false} tickLine={false} width={64} tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : String(v))} />
              <Tooltip formatter={(v: number) => brl2(v)} labelFormatter={(l) => `Dia ${l}`} contentStyle={{ borderRadius: 8, borderColor: '#E2DBEE', fontSize: 13 }} />
              <ReferenceLine y={0} stroke="#B23A3A" strokeDasharray="5 4" />
              <Area type="stepAfter" dataKey="saldo" name="Saldo previsto" stroke="rgb(var(--c-purple))" fill="rgb(var(--c-purple))" fillOpacity={0.12} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
          <LegendaAjuda
            itens={[
              { nome: 'Saldo previsto', cor: 'rgb(var(--c-purple))', linha: true, ajuda: 'O saldo de cada dia: o que você informou hoje, mais o que deve entrar e menos o que deve sair até aquele dia.' },
              { nome: 'Linha de zero', cor: '#B23A3A', linha: true, tracejada: true, ajuda: 'Abaixo desta linha o caixa fica negativo: faltaria dinheiro para pagar as contas daquele dia.' },
            ]}
          />

          <h3 className="text-sm font-semibold mt-4 mb-2">Próximos movimentos ({lista.length})</h3>
          {lista.length === 0 ? (
            <p className="text-sm text-muted">Nada previsto para os próximos {horizonte} dias.</p>
          ) : (
            <div className="max-h-80 overflow-y-auto border border-line rounded-lg">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="text-left text-xs text-muted border-b border-line">
                    <th className="py-2 px-3 font-medium">Dia</th>
                    <th className="py-2 px-3 font-medium">O que é</th>
                    <th className="py-2 px-3 font-medium text-right">Valor</th>
                    <th className="py-2 px-3 font-medium text-right">Saldo depois</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {lista.map((m, i) => {
                    acumulado += m.valor
                    return (
                      <tr key={i}>
                        <td className="py-2 px-3 text-muted whitespace-nowrap">{dm(m.dia)}</td>
                        <td className="py-2 px-3">
                          <span className={`inline-block w-2 h-2 rounded-full mr-2 ${corTipo[m.tipo]}`} aria-hidden />
                          {m.descricao}
                          {m.atrasado && <span className="ml-2"><Badge tone="danger">atrasada</Badge></span>}
                        </td>
                        <td className={`py-2 px-3 text-right whitespace-nowrap ${m.valor > 0 ? 'text-teal' : 'text-danger'}`}>{m.valor > 0 ? '+' : '−'}{brl2(Math.abs(m.valor))}</td>
                        <td className={`py-2 px-3 text-right whitespace-nowrap ${todosInformados && acumulado < 0 ? 'text-danger font-medium' : ''}`}>{brl(acumulado)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-muted mt-2">
            Verde: parcelas e saldos de festas a receber. Vermelho: contas e despesas fixas. Amarelo: custos lançados nas festas, na data da festa. Contas e parcelas atrasadas aparecem no dia de hoje.
          </p>
        </>
      )}
    </Card>
  )
}

export const nomeMesAtual = () => format(new Date(), "MMMM 'de' yyyy", { locale: ptBR })
