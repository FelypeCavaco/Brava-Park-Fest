import { FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2, X } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { supabase } from '../../lib/supabaseClient'
import { brl, friendlyDbError, parseDecimal, todayIso } from '../../lib/format'
import type { PainelDados } from './platformApi'
import { dataBr, MESES_CURTOS, mesCurto } from './platformTypes'
import { Numero } from './PlatVisaoGeral'

// Financeiro do Festou: o dinheiro do seu negócio (não das casas).
//   Este mês: todas as mensalidades com vencimento no mês, pagas ou não.
//   Mês a mês: quanto entrou, quanto custou manter o sistema e o que sobrou.
//   Custos da plataforma: o que você paga por mês para manter o Festou no ar.

type Aba = 'mes' | 'meses' | 'custos'
interface Cobranca { company_id: string; nome: string; vencimento: string; valor: number; pago: boolean; pago_em: string | null; forma: string | null; valor_pago: number | null }
interface Mes { mes: string; mensalidades: number; implantacoes: number; custos: number; casas_pagantes: number }
interface Custo { id: string; descricao: string; valor: number; como: string | null; inicio: string; fim: string | null }

const primeiroDoMes = (iso: string) => `${iso.slice(0, 7)}-01`
const somaMeses = (iso: string, n: number) => { const [a, m] = iso.split('-').map(Number); const d = new Date(a, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }
const nomeMes = (iso: string) => `${['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'][Number(iso.slice(5, 7)) - 1]} de ${iso.slice(0, 4)}`
const FORMAS: Record<string, string> = { pix: 'Pix', boleto: 'Boleto', cartao: 'Cartão', transferencia: 'Transferência', dinheiro: 'Dinheiro', asaas: 'Asaas' }

export function PlatFinanceiro({ d }: { d: PainelDados }) {
  const [aba, setAba] = useState<Aba>('mes')
  const [custos, setCustos] = useState<Custo[]>([])

  async function carregarCustos() {
    const { data } = await supabase.rpc('platform_costs_list')
    setCustos(((data ?? []) as Custo[]).map((c) => ({ ...c, valor: Number(c.valor) })))
  }
  useEffect(() => { carregarCustos() }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Financeiro do Festou</h1>
        <p className="text-sm text-muted mt-1">O dinheiro do seu negócio (não das casas): mensalidades e implantações que entram, custos para manter o sistema no ar e quanto sobra.</p>
      </div>
      <div className="flex flex-wrap rounded-xl border border-line bg-surface p-1 gap-1 w-fit" role="tablist">
        {([['mes', 'Cobranças do mês'], ['meses', 'Mês a mês'], ['custos', 'Custos da plataforma']] as const).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={aba === k} onClick={() => setAba(k)}
            className={`px-3 h-9 rounded-lg text-sm font-medium ${aba === k ? 'bg-purple text-white' : 'text-ink/70 hover:bg-paper'}`}>{l}</button>
        ))}
      </div>
      {aba === 'mes' && <CobrancasDoMes d={d} custos={custos} />}
      {aba === 'meses' && <MesAMes />}
      {aba === 'custos' && <Custos custos={custos} onChanged={carregarCustos} />}
    </div>
  )
}

function custoDoMes(custos: Custo[], mes: string) {
  return custos.filter((c) => c.inicio <= mes && (!c.fim || c.fim >= mes)).reduce((t, c) => t + c.valor, 0)
}

function CobrancasDoMes({ d, custos }: { d: PainelDados; custos: Custo[] }) {
  const [mes, setMes] = useState(primeiroDoMes(todayIso()))
  const [lista, setLista] = useState<Cobranca[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    setLista(null)
    supabase.rpc('platform_finance_charges', { p_mes: mes }).then(({ data, error }) => {
      if (error) return setErro(friendlyDbError(error.message))
      setLista(((data ?? []) as Cobranca[]).map((c) => ({ ...c, valor: Number(c.valor), valor_pago: c.valor_pago === null ? null : Number(c.valor_pago) })))
    })
  }, [mes])

  const hoje = todayIso()
  const previsto = (lista ?? []).reduce((t, c) => t + c.valor, 0)
  const recebido = (lista ?? []).filter((c) => c.pago).reduce((t, c) => t + (c.valor_pago ?? c.valor), 0)
  const atrasadas = (lista ?? []).filter((c) => !c.pago && c.vencimento < hoje)
  const custo = custoDoMes(custos, mes)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={() => setMes(somaMeses(mes, -1))} className="w-8 h-8 rounded-lg border border-line flex items-center justify-center hover:bg-paper" aria-label="Mês anterior"><ChevronLeft className="w-4 h-4" /></button>
        <p className="font-semibold min-w-[160px] text-center">{nomeMes(mes)}</p>
        <button onClick={() => setMes(somaMeses(mes, 1))} className="w-8 h-8 rounded-lg border border-line flex items-center justify-center hover:bg-paper" aria-label="Próximo mês"><ChevronRight className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Numero rotulo="Previsto no mês" valor={brl(previsto)} nota={`${lista?.length ?? 0} mensalidades`} />
        <Numero rotulo="Já recebido" valor={brl(recebido)} nota={previsto ? `${Math.round((recebido / previsto) * 100)}% do previsto` : undefined} />
        <Numero rotulo="Atrasado" valor={brl(atrasadas.reduce((t, c) => t + c.valor, 0))} nota={`${atrasadas.length} ${atrasadas.length === 1 ? 'casa' : 'casas'}`} alerta={atrasadas.length > 0} />
        <Numero rotulo="Sobra prevista" valor={brl(previsto - custo)} nota={`previsto menos ${brl(custo)} de custos`} />
      </div>
      <Card title="Mensalidades do mês">
        <p className="text-xs text-muted mb-3">Todas as casas com vencimento neste mês. Com a cobrança do Asaas ligada, o pagamento entra aqui sozinho.</p>
        {erro ? <p className="text-sm text-danger">{erro}</p> : lista === null ? <p className="text-sm text-muted">Carregando...</p> : lista.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma mensalidade com vencimento neste mês.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="pb-2 font-medium">Casa</th><th className="pb-2 font-medium">Vencimento</th><th className="pb-2 pr-4 font-medium text-right">Valor</th><th className="pb-2 font-medium">Situação</th><th className="pb-2 font-medium">Como pagou</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {lista.map((c) => {
                  const atrasada = !c.pago && c.vencimento < hoje
                  const casa = d.empresas.find((e) => e.id === c.company_id)
                  return (
                    <tr key={c.company_id + c.vencimento}>
                      <td className="py-2"><Link to={`/plataforma/casas/${c.company_id}?aba=mensalidade`} className="font-medium text-purple hover:underline">{c.nome}</Link>{casa && !casa.active && <span className="text-[11px] text-danger ml-1">(suspensa)</span>}</td>
                      <td className="py-2 tabular-nums">{dataBr(c.vencimento)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{brl(c.valor)}</td>
                      <td className="py-2">{c.pago ? <Badge tone="teal">Paga em {dataBr(c.pago_em).slice(0, 5)}</Badge> : atrasada ? <Badge tone="danger">Atrasada</Badge> : <Badge tone="amber">A vencer</Badge>}</td>
                      <td className="py-2 text-muted">{c.pago ? (FORMAS[c.forma ?? ''] ?? c.forma ?? '—') : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function MesAMes() {
  const [meses, setMeses] = useState<Mes[] | null>(null)
  const [qtd, setQtd] = useState(12)

  useEffect(() => {
    setMeses(null)
    supabase.rpc('platform_finance_months', { p_meses: qtd }).then(({ data }) =>
      setMeses(((data ?? []) as Mes[]).map((m) => ({ ...m, mensalidades: Number(m.mensalidades), implantacoes: Number(m.implantacoes), custos: Number(m.custos) }))))
  }, [qtd])

  const tot = (meses ?? []).reduce((t, m) => ({ men: t.men + m.mensalidades, imp: t.imp + m.implantacoes, cus: t.cus + m.custos }), { men: 0, imp: 0, cus: 0 })

  return (
    <Card title="Mês a mês" action={
      <div className="inline-flex rounded-lg border border-line bg-surface p-0.5 gap-0.5">
        {[6, 12, 24].map((n) => <button key={n} onClick={() => setQtd(n)} aria-pressed={qtd === n} className={`px-3 h-8 rounded-md text-xs font-medium ${qtd === n ? 'bg-purple text-white' : 'text-ink/70 hover:bg-paper'}`}>{n} meses</button>)}
      </div>
    }>
      <p className="text-xs text-muted mb-3">Mensalidades pela data em que foram pagas, implantações pagas e os custos em vigor em cada mês. O mês atual ainda está em andamento.</p>
      {!meses ? <p className="text-sm text-muted">Carregando...</p> : (
        <>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={meses.map((m) => ({ ...m, rotulo: mesCurto(m.mes), sobra: m.mensalidades + m.implantacoes - m.custos }))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgb(var(--c-line))" />
                <XAxis dataKey="rotulo" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `R$ ${Math.round(v).toLocaleString('pt-BR')}`} width={70} />
                <Tooltip formatter={(v: number, n: string) => [brl(v), n]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="mensalidades" name="Mensalidades" stackId="e" fill="rgb(var(--c-purple))" />
                <Bar dataKey="implantacoes" name="Implantações" stackId="e" fill="rgb(var(--c-green))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="custos" name="Custos" fill="#d97757" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="pb-2 font-medium">Mês</th><th className="pb-2 font-medium text-right">Casas que pagaram</th><th className="pb-2 font-medium text-right">Mensalidades</th><th className="pb-2 font-medium text-right">Implantações</th><th className="pb-2 font-medium text-right">Custos</th><th className="pb-2 font-medium text-right">Sobra</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[...meses].reverse().map((m, i) => {
                  const s = m.mensalidades + m.implantacoes - m.custos
                  return (
                    <tr key={m.mes}>
                      <td className="py-2">{MESES_CURTOS[Number(m.mes.slice(5, 7)) - 1]}/{m.mes.slice(0, 4)}{i === 0 && <span className="text-[11px] text-muted"> (até hoje)</span>}</td>
                      <td className="py-2 text-right tabular-nums">{m.casas_pagantes}</td>
                      <td className="py-2 text-right tabular-nums">{brl(m.mensalidades)}</td>
                      <td className="py-2 text-right tabular-nums">{brl(m.implantacoes)}</td>
                      <td className="py-2 text-right tabular-nums text-danger">−{brl(m.custos)}</td>
                      <td className={`py-2 text-right tabular-nums font-semibold ${s >= 0 ? 'text-teal' : 'text-danger'}`}>{brl(s)}</td>
                    </tr>
                  )
                })}
                <tr className="font-semibold border-t-2 border-purple">
                  <td className="py-2">Total</td><td /><td className="py-2 text-right tabular-nums">{brl(tot.men)}</td><td className="py-2 text-right tabular-nums">{brl(tot.imp)}</td><td className="py-2 text-right tabular-nums">−{brl(tot.cus)}</td>
                  <td className={`py-2 text-right tabular-nums ${tot.men + tot.imp - tot.cus >= 0 ? 'text-teal' : 'text-danger'}`}>{brl(tot.men + tot.imp - tot.cus)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  )
}

function Custos({ custos, onChanged }: { custos: Custo[]; onChanged: () => Promise<void> }) {
  const vazio = { id: '', descricao: '', valor: '', como: '', inicio: todayIso().slice(0, 7), fim: '' }
  const [f, setF] = useState<typeof vazio | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const mesAtual = primeiroDoMes(todayIso())
  const ativos = custos.filter((c) => c.inicio <= mesAtual && (!c.fim || c.fim >= mesAtual))
  const total = ativos.reduce((t, c) => t + c.valor, 0)

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (!f) return
    const valor = parseDecimal(f.valor)
    if (valor === null || valor < 0) return setErro('Informe o valor por mês.')
    const { error } = await supabase.rpc('platform_cost_save', { p_dados: { id: f.id, descricao: f.descricao, valor, como: f.como, inicio: f.inicio ? `${f.inicio}-01` : '', fim: f.fim ? `${f.fim}-01` : '' } })
    if (error) return setErro(friendlyDbError(error.message))
    setF(null)
    setErro(null)
    await onChanged()
  }

  async function apagar(c: Custo) {
    if (!window.confirm(`Apagar "${c.descricao}"? Ele sai também dos meses passados. Se o custo só acabou, prefira editar e colocar o mês de fim.`)) return
    await supabase.rpc('platform_cost_delete', { p_id: c.id })
    await onChanged()
  }

  return (
    <Card title="Custos da plataforma" action={<Button onClick={() => { setErro(null); setF(vazio) }}><Plus className="w-4 h-4" /> Novo custo</Button>}>
      <p className="text-xs text-muted mb-3">O que você paga por mês para manter o Festou no ar (banco de dados, domínio, e-mails, taxas). Cadastre uma vez: entra todo mês na conta da sobra, do mês de início até o mês de fim.</p>
      {custos.length === 0 ? <p className="text-sm text-muted">Nenhum custo cadastrado ainda.</p> : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-line">
              <th className="pb-2 font-medium">Custo</th><th className="pb-2 font-medium">Como é cobrado</th><th className="pb-2 font-medium">Vale de</th><th className="pb-2 font-medium text-right">Por mês</th><th className="pb-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {custos.map((c) => {
              const ativo = ativos.includes(c)
              return (
                <tr key={c.id} className={ativo ? '' : 'opacity-60'}>
                  <td className="py-2 font-medium">{c.descricao}</td>
                  <td className="py-2 text-muted">{c.como || '—'}</td>
                  <td className="py-2 text-muted whitespace-nowrap">{mesCurto(c.inicio)}{c.fim ? ` até ${mesCurto(c.fim)}` : ' em diante'}</td>
                  <td className="py-2 text-right tabular-nums">{brl(c.valor)}</td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <button onClick={() => { setErro(null); setF({ id: c.id, descricao: c.descricao, valor: String(c.valor).replace('.', ','), como: c.como ?? '', inicio: c.inicio.slice(0, 7), fim: c.fim ? c.fim.slice(0, 7) : '' }) }} className="text-muted hover:text-purple mr-2" aria-label="Editar"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => apagar(c)} className="text-muted hover:text-danger" aria-label="Apagar"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              )
            })}
            <tr className="font-semibold border-t-2 border-purple"><td className="py-2" colSpan={3}>Total por mês (custos em vigor)</td><td className="py-2 text-right tabular-nums">{brl(total)}</td><td /></tr>
          </tbody>
        </table>
      )}

      {f && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setF(null)} />
          <form onSubmit={salvar} className="relative w-full max-w-md bg-surface rounded-card p-6 shadow-xl space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-display font-semibold">{f.id ? 'Editar custo' : 'Novo custo'}</h2>
              <button type="button" onClick={() => setF(null)} className="text-muted hover:text-ink" aria-label="Fechar"><X className="w-5 h-5" /></button>
            </div>
            {erro && <p className="text-sm bg-danger-light text-danger rounded-lg px-3 py-2">{erro}</p>}
            <div><label className="block text-xs text-muted mb-1">Custo *</label><input required autoFocus value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} placeholder="Ex.: Supabase (banco de dados)" className="w-full border border-line rounded-lg px-3 py-2 text-sm" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs text-muted mb-1">Valor por mês (R$) *</label><input required value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} inputMode="decimal" className="w-full border border-line rounded-lg px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs text-muted mb-1">Como é cobrado</label><input value={f.como} onChange={(e) => setF({ ...f, como: e.target.value })} placeholder="Ex.: mensal, em dólar" className="w-full border border-line rounded-lg px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs text-muted mb-1">Começou em</label><input type="month" value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} className="w-full border border-line rounded-lg px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs text-muted mb-1">Acabou em (opcional)</label><input type="month" value={f.fim} onChange={(e) => setF({ ...f, fim: e.target.value })} className="w-full border border-line rounded-lg px-3 py-2 text-sm" /></div>
            </div>
            <p className="text-[11px] text-muted">Custo anual (ex.: domínio de R$ 40/ano)? Divida por 12 e cadastre o valor por mês.</p>
            <Button type="submit" className="w-full justify-center">Salvar</Button>
          </form>
        </div>
      )}
    </Card>
  )
}
