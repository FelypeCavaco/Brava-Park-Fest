// Visões "Resultado das festas" e "Ponte e compromissos" do Financeiro.
// Só leitura: os números vêm das funções finance_month_views e
// finance_commitments (migração 063), que não criam nem alteram lançamentos.
import { Fragment, ReactNode, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { AlertTriangle, ChevronDown, ChevronUp, Info, Lightbulb } from 'lucide-react'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import { UNITS } from '../lib/UnitContext'
import { addMonthsToValue } from '../lib/monthUtils'

// ---------- tipos do retorno das funções ----------
interface FestaRealizada {
  id: string; data: string; cliente: string; unit_id: string; valor_firmado: number; extras: number; consumo: number
  receita: number; recebido: number; a_receber: number; custos: number; insumos: number; itens_sem_custo: number
  consumo_finalizado: boolean; taxa: number; lucro: number; status: 'completo' | 'parcial'
}
interface FestaPrevista {
  id: string; data: string; cliente: string; unit_id: string; receita: number; recebido: number; a_receber: number
  custos: number; insumos_previstos: number | null; sem_media: boolean; lucro_estimado: number
}
interface Cancelamento {
  id: string; data: string; data_estimada: boolean; data_festa: string; cliente: string; unit_id: string
  pago: number; devolvido: number; multa: number; custos: number; efeito: number
}
interface ItemPonte { data: string; descricao: string; valor: number; reservation_id?: string }
interface LinhaPonte { chave: string; valor: number; itens: ItemPonte[] }
export interface MonthViews {
  mes: string; hoje: string; corte: string; mes_atual: boolean
  caixa: { entradas: number; acertos_recebidos: number; contas_pagas: number; custos_festas: number; saldo: number }
  resultado: {
    festas: number; receita: number; custos_lancados: number; insumos: number; taxa: number; resultado_direto: number
    despesas_gerais: number; efeito_cancelamentos: number; resultado: number; compras_estoque: number
  }
  festas: FestaRealizada[]; previstas: FestaPrevista[]; cancelamentos: Cancelamento[]; ponte: LinhaPonte[]; diferenca: number
}
interface Commitments {
  hoje: string; recebido: number; custos_previstos: number; reserva: number; reserva_custos_lancados: number
  reserva_insumos_estimados: number; festas_sem_media: number
  festas: { id: string; data: string; cliente: string; unit_id: string; contratado: number; devido: number; recebido: number
    a_receber: number; custos_lancados: number; insumos_estimados: number | null; sem_media: boolean; custos_previstos: number }[]
}

// O Postgres devolve numeric como número no JSON; garante number mesmo assim.
function n(v: unknown) {
  return Number(v ?? 0)
}
export function brl(v: number) {
  return n(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function dataCurta(iso: string) {
  return format(parseISO(iso), 'dd/MM/yyyy')
}
export function nomeMes(monthValue: string) {
  return format(parseISO(`${monthValue}-01`), "MMMM 'de' yyyy", { locale: ptBR })
}
function unidadeNome(unitId: string, unitDbIds: Record<string, { unitId: string }>) {
  const slug = Object.keys(unitDbIds).find((s) => unitDbIds[s]?.unitId === unitId)
  return UNITS.find((u) => u.id === slug)?.name ?? '—'
}

export async function loadMonthViews(monthValue: string, unitId: string | null): Promise<MonthViews> {
  const { data, error } = await supabase.rpc('finance_month_views', { p_month: `${monthValue}-01`, p_unit: unitId })
  if (error) throw error
  return data as MonthViews
}

// ---------- peças comuns ----------

// Quadro "O que esta tela mostra": aberto por padrão; a escolha de recolher
// fica guardada no navegador, por usuário.
export function ExplainBox({ id, titulo, children, naoE, exemplo }: { id: string; titulo: string; children: ReactNode; naoE: string; exemplo: ReactNode }) {
  const { session } = useAuth()
  const key = `fin-explica-${id}-${session?.user?.id ?? 'anon'}`
  const [aberto, setAberto] = useState(true)
  const [verExemplo, setVerExemplo] = useState(false)
  useEffect(() => {
    try {
      setAberto(localStorage.getItem(key) !== 'recolhido')
    } catch {
      setAberto(true)
    }
  }, [key])
  function alternar() {
    const novo = !aberto
    setAberto(novo)
    try {
      localStorage.setItem(key, novo ? 'aberto' : 'recolhido')
    } catch {
      /* navegador sem armazenamento: só não lembra */
    }
  }
  return (
    <div className="bg-purple-light/40 border border-purple/20 rounded-card px-4 py-3 text-sm">
      <button onClick={alternar} className="w-full flex items-center justify-between gap-2 text-left">
        <span className="font-semibold flex items-center gap-1.5"><Info className="w-4 h-4 text-purple" /> O que esta tela mostra</span>
        <span className="text-xs text-purple flex items-center gap-1">{aberto ? <>Recolher <ChevronUp className="w-3.5 h-3.5" /></> : <>Mostrar <ChevronDown className="w-3.5 h-3.5" /></>}</span>
      </button>
      {aberto && (
        <div className="mt-2 space-y-2 leading-relaxed">
          <p className="font-semibold">{titulo}</p>
          {children}
          <p><strong>Não é:</strong> {naoE}</p>
          <button onClick={() => setVerExemplo((v) => !v)} className="text-xs font-medium text-purple flex items-center gap-1">
            <Lightbulb className="w-3.5 h-3.5" /> {verExemplo ? 'Fechar o exemplo' : 'Entenda com um exemplo'}
          </button>
          {verExemplo && (
            <div className="bg-surface border border-line rounded-lg px-3 py-2 space-y-1">
              <p className="text-[11px] text-muted uppercase tracking-wide">Exemplo ilustrativo, não são os seus dados</p>
              {exemplo}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export const EXEMPLO_FESTA = (
  <>
    <p>Festa de R$ 5.000. O cliente pagou tudo em setembro. A festa foi em outubro e custou R$ 2.000.</p>
    <p>• Caixa de setembro: + R$ 5.000.</p>
    <p>• Caixa de outubro: nenhuma entrada dessa festa e − R$ 2.000 de custo.</p>
    <p>• Resultado das festas de outubro: receita R$ 5.000 − custo R$ 2.000 = <strong>+ R$ 3.000</strong>.</p>
    <p>No caixa de outubro essa festa parece prejuízo (− R$ 2.000). No resultado, ela deu R$ 3.000. Os dois números estão certos.</p>
  </>
)

const AVISO_MESES_PASSADOS =
  'Meses anteriores são recalculados com os dados de hoje: se uma festa daquele mês for alterada ou cancelada depois, ou se um pagamento ou conta for lançado com data retroativa, o número daquele mês muda. O sistema usa o valor atual de cada festa (não guarda versões antigas do valor).'

function Stat({ titulo, valor, legenda, tom, destaque }: { titulo: string; valor: number | string; legenda: ReactNode; tom?: 'teal' | 'danger' | 'amber'; destaque?: boolean }) {
  const cor = tom === 'teal' ? 'text-teal' : tom === 'danger' ? 'text-danger' : tom === 'amber' ? 'text-amber' : ''
  return (
    <Card className={destaque ? (tom === 'danger' ? 'border-danger' : 'border-teal') : ''}>
      <p className="text-xs text-muted">{titulo}</p>
      <p className={`text-xl font-display font-semibold mt-1 ${cor}`}>{typeof valor === 'number' ? brl(valor) : valor}</p>
      <p className="text-[11px] text-muted mt-1 leading-snug">{legenda}</p>
    </Card>
  )
}

function margemBadge(lucro: number, receita: number) {
  if (receita <= 0) return <span className="text-muted">—</span>
  const m = (lucro / receita) * 100
  return <Badge tone={m >= 25 ? 'teal' : m >= 10 ? 'amber' : 'danger'}>{m.toFixed(0)}%{m < 10 ? ' · baixa' : ''}</Badge>
}

function MonthPicker({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const opcoes = useMemo(() => {
    const atual = format(new Date(), 'yyyy-MM')
    return Array.from({ length: 24 }, (_, i) => addMonthsToValue(atual, -i))
  }, [])
  return (
    <label className="text-sm flex items-center gap-2">
      <span className="text-muted">Mês</span>
      <select value={month} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-lg border border-line bg-surface px-2 text-sm capitalize">
        {opcoes.map((m) => <option key={m} value={m} className="capitalize">{nomeMes(m)}</option>)}
      </select>
    </label>
  )
}

function useMonthViews(month: string, unitId: string | null) {
  const [data, setData] = useState<MonthViews | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    setLoading(true)
    setError(null)
    loadMonthViews(month, unitId)
      .then((d) => vivo && setData(d))
      .catch((e) => vivo && setError(/permiss/i.test(String(e?.message)) ? 'Você não tem permissão para ver o Financeiro.' : 'Não foi possível carregar os números deste mês.'))
      .finally(() => vivo && setLoading(false))
    return () => {
      vivo = false
    }
  }, [month, unitId])
  return { data, loading, error }
}

function Estado({ loading, error }: { loading: boolean; error: string | null }) {
  if (error) return <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5">{error}</div>
  if (loading) return <Card><p className="text-sm text-muted py-6 text-center">Carregando...</p></Card>
  return null
}

// ================= VISÃO 2 — RESULTADO DAS FESTAS =================
export function ResultadoFestasView({ month, onMonthChange, unitId, unitDbIds, mostrarUnidade }: {
  month: string; onMonthChange: (m: string) => void; unitId: string | null
  unitDbIds: Record<string, { unitId: string }>; mostrarUnidade: boolean
}) {
  const { data, loading, error } = useMonthViews(month, unitId)
  const [serie, setSerie] = useState<{ mes: string; mesValue: string; receita: number; custos: number; resultado: number }[]>([])

  useEffect(() => {
    let vivo = true
    const meses = Array.from({ length: 6 }, (_, i) => addMonthsToValue(month, i - 5))
    Promise.all(meses.map((m) => loadMonthViews(m, unitId).catch(() => null))).then((lista) => {
      if (!vivo) return
      setSerie(
        lista.map((d, i) => ({
          mes: format(parseISO(`${meses[i]}-01`), 'MMM', { locale: ptBR }).replace(/^\w/, (c) => c.toUpperCase()),
          mesValue: meses[i],
          receita: n(d?.resultado.receita),
          custos: n(d?.resultado.custos_lancados) + n(d?.resultado.insumos) + n(d?.resultado.taxa),
          resultado: n(d?.resultado.resultado),
        })),
      )
    })
    return () => {
      vivo = false
    }
  }, [month, unitId])

  const r = data?.resultado
  const custosFestas = r ? n(r.custos_lancados) + n(r.insumos) : 0
  const estimadoReceita = (data?.previstas ?? []).reduce((s, f) => s + n(f.receita), 0)
  const estimadoCustos = (data?.previstas ?? []).reduce((s, f) => s + n(f.custos) + n(f.insumos_previstos), 0)
  const estimadoLucro = (data?.previstas ?? []).reduce((s, f) => s + n(f.lucro_estimado), 0)
  const parciais = (data?.festas ?? []).filter((f) => f.status === 'parcial').length
  const somaLucroFestas = (data?.festas ?? []).reduce((s, f) => s + n(f.lucro), 0)

  let resumo = ''
  if (data && r) {
    const mes = nomeMes(data.mes)
    if (r.festas === 0 && n(r.resultado) === 0) resumo = `Em ${mes}, nenhuma festa foi realizada${data.mes_atual ? ' até hoje' : ''} e não há despesas gerais pagas.`
    else if (r.festas === 0) resumo = `Em ${mes}, nenhuma festa foi realizada${data.mes_atual ? ' até hoje' : ''}. Com as despesas gerais e cancelamentos, o resultado do mês foi de ${brl(r.resultado)}.`
    else {
      resumo = `Em ${mes}, ${r.festas} ${r.festas === 1 ? 'festa aconteceu' : 'festas aconteceram'}${data.mes_atual ? ' até hoje' : ''} e ${n(r.resultado_direto) >= 0 ? 'deixaram' : 'deram prejuízo de'} ${brl(Math.abs(n(r.resultado_direto)))} antes das despesas gerais. `
      resumo += n(r.resultado) >= 0
        ? `Depois das despesas gerais, o resultado do mês foi de ${brl(r.resultado)}.`
        : `Depois das despesas gerais, o resultado do mês foi de ${brl(r.resultado)}: as festas não cobriram os custos e as despesas gerais do mês.`
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Resultado das festas</h2>
        <MonthPicker month={month} onChange={onMonthChange} />
      </div>

      <ExplainBox
        id="resultado"
        titulo="Resultado das festas — as festas que aconteceram neste mês deram lucro?"
        naoE="o saldo da conta nem o dinheiro disponível. Também não é o lucro contábil (não inclui impostos sobre o lucro, depreciação nem outros encargos que não estejam lançados como conta)."
        exemplo={EXEMPLO_FESTA}
      >
        <p>Aqui cada festa conta no mês em que ela acontece, <strong>não importa quando o cliente pagou</strong>. Uma festa paga em agosto e realizada em outubro entra no resultado de outubro. O valor da festa aparece aqui como receita da festa e <strong>não é dinheiro novo</strong>: não se soma às entradas do caixa.</p>
        <p>Festa realizada = já aconteceu até hoje (nos meses que já passaram, até o último dia do mês). As despesas gerais contam pela data em que a conta foi paga.</p>
        <p className="text-xs text-muted">{AVISO_MESES_PASSADOS}</p>
      </ExplainBox>

      <Estado loading={loading} error={error} />
      {data && r && !loading && (
        <>
          <p className="text-sm bg-surface border border-line rounded-card px-4 py-3">{resumo}</p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat titulo="Festas realizadas" valor={String(r.festas)} legenda="Quantidade de festas que já aconteceram neste mês." />
            <Stat titulo="Receita das festas" valor={r.receita} tom="teal" legenda="Valor das festas feitas neste mês (contrato + extras vendidos + consumo cobrado), já recebido ou não." />
            <Stat titulo="Custos das festas" valor={custosFestas} tom="danger"
              legenda={<>Equipe, despesas fixas das festas e insumos consumidos dessas festas ({brl(r.custos_lancados)} lançados + {brl(r.insumos)} de insumos).</>} />
            <Stat titulo="Taxa da maquininha (estimada)" valor={r.taxa} tom="danger" legenda="Taxa configurada para cada forma de pagamento, sobre o que os clientes dessas festas já pagaram. É estimativa." />
            <Card className={n(r.resultado_direto) >= 0 ? 'border-teal' : 'border-danger'}>
              <p className="text-xs text-muted">Resultado direto das festas</p>
              <p className={`text-xl font-display font-semibold mt-1 ${n(r.resultado_direto) >= 0 ? 'text-teal' : 'text-danger'}`}>{brl(r.resultado_direto)}</p>
              <p className="text-[11px] text-muted mt-1 leading-snug">Receita − custos − taxa. Quanto as festas deixaram antes das despesas gerais da casa.</p>
              <div className="mt-1">{margemBadge(n(r.resultado_direto), n(r.receita))}</div>
            </Card>
            <Stat titulo="Despesas gerais" valor={r.despesas_gerais} tom="danger"
              legenda="Aluguel, salários, impostos e outras contas gerais pagas neste mês. Não entram: compras de estoque, acertos entre unidades, estornos e contas que pagam custos já lançados nas festas." />
            {(n(r.efeito_cancelamentos) !== 0 || data.cancelamentos.length > 0) && (
              <Stat titulo="Festas canceladas" valor={r.efeito_cancelamentos} tom={n(r.efeito_cancelamentos) >= 0 ? 'teal' : 'danger'}
                legenda="Multa retida (pago − devolvido) das festas canceladas neste mês, menos custos já lançados nelas." />
            )}
            <Stat titulo="Resultado do mês" valor={r.resultado} tom={n(r.resultado) >= 0 ? 'teal' : 'danger'} destaque
              legenda="O que sobrou das festas depois das despesas gerais." />
          </div>

          <p className="text-xs text-muted">
            Estoque: compras pagas no mês {brl(r.compras_estoque)} × consumo das festas do mês {brl(r.insumos)}. O caixa conta a compra; aqui conta só o que as festas consumiram.
          </p>

          {parciais > 0 && (
            <div className="bg-amber-light text-amber text-sm rounded-lg px-4 py-2.5 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{parciais} {parciais === 1 ? 'festa está' : 'festas estão'} com dados <strong>parciais</strong> (falta finalizar o consumo, definir o custo de algum item ou lançar os custos). O resultado pode estar acima do real.</span>
            </div>
          )}

          <Card title="Festas realizadas no mês">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="text-left text-muted border-b border-line">
                  <th className="pb-2 font-medium">Data</th>
                  <th className="pb-2 font-medium">Cliente</th>
                  {mostrarUnidade && <th className="pb-2 font-medium">Unidade</th>}
                  <th className="pb-2 font-medium">Receita da festa</th>
                  <th className="pb-2 font-medium">Custos lançados</th>
                  <th className="pb-2 font-medium">Insumos</th>
                  <th className="pb-2 font-medium">Lucro da festa</th>
                  <th className="pb-2 font-medium">Margem</th>
                  <th className="pb-2 font-medium">Dados</th>
                </tr>
              </thead>
              <tbody>
                {data.festas.map((f) => (
                  <tr key={f.id} className="border-b border-line last:border-0 align-top">
                    <td className="py-2 whitespace-nowrap">{dataCurta(f.data)}</td>
                    <td className="py-2"><Link to={`/reservas/${f.id}`} className="text-purple hover:underline">{f.cliente}</Link></td>
                    {mostrarUnidade && <td className="py-2">{unidadeNome(f.unit_id, unitDbIds)}</td>}
                    <td className="py-2">
                      {brl(f.receita)}
                      {n(f.a_receber) > 0.009 && (
                        <span className="block text-[11px] text-amber" title={`O cliente ainda deve ${brl(f.a_receber)}. A festa conta no resultado, mas o dinheiro ainda não entrou.`}>
                          a receber {brl(f.a_receber)}
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-danger">{brl(f.custos)}</td>
                    <td className="py-2 text-danger">{brl(f.insumos)}{f.itens_sem_custo > 0 && <span className="block text-[11px] text-amber">{f.itens_sem_custo} item(ns) sem custo</span>}</td>
                    <td className={`py-2 font-medium ${n(f.lucro) >= 0 ? 'text-teal' : 'text-danger'}`}>{brl(f.lucro)}</td>
                    <td className="py-2">{margemBadge(n(f.lucro), n(f.receita))}</td>
                    <td className="py-2">
                      {f.status === 'completo' ? <Badge tone="teal">completo</Badge> : (
                        <span title={!f.consumo_finalizado ? 'Consumo pós-festa não finalizado' : f.itens_sem_custo > 0 ? 'Item consumido sem custo' : 'Nenhum custo lançado'}>
                          <Badge tone="amber">parcial</Badge>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {data.festas.length === 0 && (
                  <tr><td colSpan={mostrarUnidade ? 9 : 8} className="py-4 text-center text-muted">Nenhuma festa realizada neste mês{data.mes_atual ? ' até hoje' : ''}.</td></tr>
                )}
              </tbody>
            </table>
            {data.festas.length > 0 && (
              <p className="text-[11px] text-muted mt-3">
                Soma do lucro das festas {brl(somaLucroFestas)} − taxa {brl(r.taxa)} − despesas gerais {brl(r.despesas_gerais)}
                {n(r.efeito_cancelamentos) !== 0 ? ` + festas canceladas ${brl(r.efeito_cancelamentos)}` : ''} = resultado do mês {brl(r.resultado)}.
                {' '}<strong>Completo:</strong> todos os custos lançados. <strong>Parcial:</strong> falta lançar algo, então o lucro pode estar acima do real.
              </p>
            )}
          </Card>

          {data.cancelamentos.length > 0 && (
            <Card title="Festas canceladas neste mês">
              <table className="w-full text-sm min-w-[600px]">
                <thead>
                  <tr className="text-left text-muted border-b border-line">
                    <th className="pb-2 font-medium">Cancelada em</th><th className="pb-2 font-medium">Cliente</th>
                    <th className="pb-2 font-medium">Pago</th><th className="pb-2 font-medium">Devolvido</th>
                    <th className="pb-2 font-medium">Multa retida</th><th className="pb-2 font-medium">Custos lançados</th>
                  </tr>
                </thead>
                <tbody>
                  {data.cancelamentos.map((c) => (
                    <tr key={c.id} className="border-b border-line last:border-0">
                      <td className="py-2">{dataCurta(c.data)}{c.data_estimada && <span className="block text-[11px] text-amber">sem data de cancelamento: usada a data da festa</span>}</td>
                      <td className="py-2"><Link to={`/reservas/${c.id}`} className="text-purple hover:underline">{c.cliente}</Link></td>
                      <td className="py-2">{brl(c.pago)}</td><td className="py-2">{brl(c.devolvido)}</td>
                      <td className="py-2 text-teal">{brl(c.multa)}</td><td className="py-2 text-danger">{brl(c.custos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[11px] text-muted mt-2">Festa cancelada não é festa realizada: aqui conta só a parte que ficou com a casa. O valor devolvido não é descontado de novo.</p>
            </Card>
          )}

          {data.previstas.length > 0 && (
            <Card title="Estimado — festas que ainda vão acontecer neste mês" className="border-dashed">
              <p className="text-[11px] text-muted mb-2">Festas que ainda vão acontecer neste mês. São valores previstos e podem mudar. Não entram nos números acima.</p>
              <table className="w-full text-sm min-w-[600px]">
                <thead>
                  <tr className="text-left text-muted border-b border-line">
                    <th className="pb-2 font-medium">Data</th><th className="pb-2 font-medium">Cliente</th>
                    <th className="pb-2 font-medium">Receita prevista</th><th className="pb-2 font-medium">Custos lançados</th>
                    <th className="pb-2 font-medium">Insumos estimados</th><th className="pb-2 font-medium">Lucro estimado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.previstas.map((f) => (
                    <tr key={f.id} className="border-b border-line last:border-0">
                      <td className="py-2">{dataCurta(f.data)}</td>
                      <td className="py-2"><Link to={`/reservas/${f.id}`} className="text-purple hover:underline">{f.cliente}</Link></td>
                      <td className="py-2">{brl(f.receita)}</td><td className="py-2">{brl(f.custos)}</td>
                      <td className="py-2">{f.sem_media ? <span className="text-[11px] text-muted">sem média de consumo</span> : brl(n(f.insumos_previstos))}</td>
                      <td className="py-2">{brl(f.lucro_estimado)} <Badge tone="neutral">estimado</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-sm mt-3">
                Previsto das próximas festas: receita {brl(estimadoReceita)} − custos {brl(estimadoCustos)} = <strong>{brl(estimadoLucro)}</strong>.
                {' '}Resultado estimado do mês completo (realizadas + restantes): <strong>{brl(n(r.resultado) + estimadoLucro)}</strong>.
              </p>
            </Card>
          )}

          <Card title="Resultado das festas — últimos 6 meses">
            <p className="text-xs text-muted mb-2">Receita × custos das festas realizadas em cada mês (custos = lançados + insumos + taxa) e a linha do resultado do mês. Clique num mês para ver as festas dele.</p>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={serie} onClick={(e: any) => e?.activePayload?.[0]?.payload?.mesValue && onMonthChange(e.activePayload[0].payload.mesValue)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2DBEE" vertical={false} />
                <XAxis dataKey="mes" tick={{ fontSize: 12, fill: '#6E6880' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#6E6880' }} axisLine={false} tickLine={false} width={48} />
                <Tooltip formatter={(v: number) => brl(v)} contentStyle={{ borderRadius: 8, borderColor: '#E2DBEE', fontSize: 13 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="receita" name="Receita das festas" fill="#1F7A5C" radius={[4, 4, 0, 0]} cursor="pointer" />
                <Bar dataKey="custos" name="Custos das festas" fill="#B23A3A" radius={[4, 4, 0, 0]} cursor="pointer" />
                <Line dataKey="resultado" name="Resultado do mês" stroke="#5B3FA0" strokeWidth={2} dot />
              </ComposedChart>
            </ResponsiveContainer>
          </Card>
        </>
      )}
    </div>
  )
}

// ================= VISÃO 3 — PONTE E COMPROMISSOS =================
// Cada linha diz o que aconteceu com o dinheiro e por que, na ponte, o valor
// é somado ao saldo do caixa ou tirado dele para chegar ao resultado.
const LINHAS: Record<string, { titulo: string; sentido: (v: number, d: MonthViews) => string }> = {
  anterior: { titulo: 'Recebido neste mês de festas de meses anteriores', sentido: (v) => `${brl(Math.abs(v))} entraram na conta neste mês, mas são de festas que já tinham acontecido (o cliente pagou depois da festa). A festa contou no resultado do mês dela, por isso esse valor sai daqui.` },
  futura: { titulo: 'Adiantado de festas futuras', sentido: (v) => `${brl(Math.abs(v))} entraram na conta neste mês por festas que ainda não tinham acontecido. Estão no caixa, mas ainda não são resultado de nenhuma festa realizada, por isso saem daqui.` },
  cancelada_recebido: { titulo: 'Recebido neste mês de festas canceladas', sentido: (v) => `${brl(Math.abs(v))} entraram na conta neste mês de festas que depois foram canceladas. No resultado, a festa cancelada conta só pela multa retida (linha própria), por isso esse valor sai daqui.` },
  antes: { titulo: 'Recebido antes do mês', sentido: (v) => `${brl(v)} das festas feitas neste mês foram pagos pelos clientes em meses anteriores. A festa é deste mês, mas o dinheiro não passou por ele, por isso é somado aqui.` },
  depois: { titulo: 'Recebido depois do mês', sentido: (v) => `${brl(v)} das festas feitas neste mês foram pagos depois que o mês terminou. Contam no resultado da festa, por isso são somados aqui.` },
  a_receber: { titulo: 'Ainda a receber', sentido: (v) => v >= 0 ? `Os clientes das festas realizadas ainda devem ${brl(v)}. Já contam no resultado, mas o dinheiro não entrou, por isso é somado aqui.` : `Os clientes das festas realizadas pagaram ${brl(Math.abs(v))} a mais que o valor das festas.` },
  multa: { titulo: 'Multa retida de festas canceladas', sentido: (v) => `Das festas canceladas neste mês, a casa ficou com ${brl(v)} (pago − devolvido). É a parte do cancelamento que conta no resultado.` },
  custos_canceladas: { titulo: 'Custos de festas canceladas', sentido: (v) => `${brl(Math.abs(v))} de custos já lançados nas festas canceladas neste mês. O caixa não conta esses custos; o resultado conta.` },
  estornos: { titulo: 'Estornos (devoluções) pagos', sentido: (v) => `${brl(v)} saíram da conta em devoluções de cancelamento, e o caixa já descontou esse valor. O resultado não conta a devolução (conta só a multa retida), por isso o valor volta aqui.` },
  compras_estoque: { titulo: 'Compras de estoque', sentido: (v, d) => `${brl(v)} saíram da conta em compras de insumos, e o caixa já descontou esse valor. O resultado não conta a compra, conta o que as festas consumiram (${brl(d.resultado.insumos)}, na linha de insumos). Por isso a compra volta aqui e o consumo é tirado.` },
  insumos: { titulo: 'Insumos consumidos nas festas', sentido: (v) => `As festas realizadas consumiram ${brl(Math.abs(v))} em insumos do estoque (pelo custo de quando foram comprados). Não é dinheiro saindo agora, mas é custo das festas, por isso é tirado aqui.` },
  acertos_recebidos: { titulo: 'Outras entradas (acertos entre unidades, multa e juros)', sentido: (v) => `${brl(Math.abs(v))} entraram na conta sem ser pagamento de festa: acertos vindos da outra unidade por produtos transferidos e multa e juros de parcelas pagas com atraso. Não é valor de festa, por isso saem daqui.` },
  acertos_pagos: { titulo: 'Acertos entre unidades pagos', sentido: (v) => `${brl(v)} saíram da conta para a outra unidade por produtos transferidos, e o caixa já descontou esse valor. Não é custo de festa, por isso o valor volta aqui.` },
  taxa: { titulo: 'Taxa da maquininha (estimada)', sentido: (v) => `${brl(Math.abs(v))} de taxa estimada sobre os pagamentos das festas realizadas. O caixa não desconta essa taxa; o resultado desconta, por isso é tirada aqui.` },
}
// Linhas principais aparecem sempre; os ajustes de critério só quando há valor.
const SEMPRE = ['futura', 'antes', 'a_receber']

export function PonteView({ month, onMonthChange, unitId, unitDbIds, mostrarUnidade, saldoProjetado }: {
  month: string; onMonthChange: (m: string) => void; unitId: string | null
  unitDbIds: Record<string, { unitId: string }>; mostrarUnidade: boolean; saldoProjetado: number | null
}) {
  const { data, loading, error } = useMonthViews(month, unitId)
  const [comp, setComp] = useState<Commitments | null>(null)
  const [compErro, setCompErro] = useState<string | null>(null)
  const [aberta, setAberta] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setCompErro(null)
    supabase.rpc('finance_commitments', { p_unit: unitId }).then(({ data: d, error: e }) => {
      if (!vivo) return
      if (e) setCompErro('Não foi possível carregar os compromissos com festas futuras.')
      else setComp(d as Commitments)
    })
    return () => {
      vivo = false
    }
  }, [unitId])

  const linhas = (data?.ponte ?? []).filter((l) => SEMPRE.includes(l.chave) || Math.abs(n(l.valor)) > 0.004)
  const maior = [...linhas].sort((a, b) => Math.abs(n(b.valor)) - Math.abs(n(a.valor)))[0]

  let resumo = ''
  if (data) {
    const saldo = n(data.caixa.saldo)
    const res = n(data.resultado.resultado)
    const dif = res - saldo
    resumo = `Seu caixa do mês está em ${brl(saldo)}, mas as festas realizadas deram resultado de ${brl(res)}.`
    if (Math.abs(dif) < 0.005) resumo += ' Neste mês os dois números são iguais.'
    else {
      resumo += ` A diferença de ${brl(Math.abs(dif))} vem principalmente de "${LINHAS[maior?.chave]?.titulo.toLowerCase() ?? '—'}" (${brl(n(maior?.valor))}).`
      if (saldo > res) resumo += ' O caixa está melhor que o resultado porque entrou dinheiro que ainda não é resultado de festa realizada (por exemplo, de festas futuras).'
    }
  }

  const porMes = useMemo(() => {
    const g = new Map<string, Commitments['festas']>()
    for (const f of comp?.festas ?? []) {
      const k = f.data.slice(0, 7)
      g.set(k, [...(g.get(k) ?? []), f])
    }
    return Array.from(g.entries())
  }, [comp])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Ponte e compromissos</h2>
        <MonthPicker month={month} onChange={onMonthChange} />
      </div>

      <ExplainBox
        id="ponte"
        titulo="Ponte e compromissos — por que o Caixa e o Resultado mostram números diferentes"
        naoE="saldo bancário."
        exemplo={EXEMPLO_FESTA}
      >
        <p>O caixa olha o que passou pela conta no mês. O resultado olha as festas que aconteceram no mês. Os dois estão certos, só medem coisas diferentes. A <strong>ponte</strong> mostra, linha por linha, como ir de um número ao outro. Clique numa linha para ver os lançamentos.</p>
        <p>Mais abaixo, você vê <strong>quanto do dinheiro que já entrou é de festas que ainda vão acontecer</strong> e precisa ficar guardado.</p>
        <p className="text-xs text-muted">{AVISO_MESES_PASSADOS}</p>
      </ExplainBox>

      <Estado loading={loading} error={error} />
      {data && !loading && (
        <>
          <p className="text-sm bg-surface border border-line rounded-card px-4 py-3">{resumo}</p>

          <Card title={`Do caixa ao resultado — ${nomeMes(data.mes)}`}>
            <p className="text-xs text-muted mb-3">
              Os sinais <strong>+</strong> e <strong>−</strong> não são entradas e saídas de dinheiro: mostram o que somar ou tirar do saldo do caixa para chegar ao resultado das festas. Ex.: uma compra paga já saiu da conta e o caixa já descontou; aqui ela aparece com <strong>+</strong> só porque o resultado não conta a compra (conta o consumo).
            </p>
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-muted border-b border-line">
                  <th className="pb-2 font-medium">Linha</th>
                  <th className="pb-2 font-medium text-right pr-4">Somar / tirar</th>
                  <th className="pb-2 font-medium">O que significa</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-line bg-paper/60">
                  <td className="py-2 font-semibold">Saldo do mês (caixa)</td>
                  <td className={`py-2 text-right pr-4 font-semibold whitespace-nowrap ${n(data.caixa.saldo) >= 0 ? 'text-teal' : 'text-danger'}`}>{brl(data.caixa.saldo)}</td>
                  <td className="py-2 text-muted">O que passou pela conta neste mês (valor da tela Caixa{data.mes_atual ? '' : ', como estava no último dia do mês'}).</td>
                </tr>
                {linhas.map((l) => (
                  <Fragment key={l.chave}>
                    <tr className="border-b border-line cursor-pointer hover:bg-paper/40" onClick={() => setAberta(aberta === l.chave ? null : l.chave)}>
                      <td className="py-2">
                        <span className="flex items-center gap-1">
                          {l.itens.length > 0 ? (aberta === l.chave ? <ChevronUp className="w-3.5 h-3.5 text-muted" /> : <ChevronDown className="w-3.5 h-3.5 text-muted" />) : <span className="w-3.5" />}
                          {LINHAS[l.chave]?.titulo ?? l.chave}
                        </span>
                      </td>
                      <td className={`py-2 text-right pr-4 whitespace-nowrap ${Math.abs(n(l.valor)) > 0.004 ? 'text-ink' : 'text-muted'}`}>{n(l.valor) > 0.004 ? '+ ' : n(l.valor) < -0.004 ? '− ' : ''}{brl(Math.abs(n(l.valor)))}</td>
                      <td className="py-2 text-muted text-[13px]">{LINHAS[l.chave]?.sentido(n(l.valor), data)}</td>
                    </tr>
                    {aberta === l.chave && l.itens.length > 0 && (
                      <tr className="border-b border-line bg-paper/30">
                        <td colSpan={3} className="py-2 pl-6">
                          <ul className="space-y-0.5 text-[13px]">
                            {l.itens.map((it, i) => (
                              <li key={i} className="flex justify-between gap-3">
                                <span>
                                  {dataCurta(it.data)} · {it.reservation_id ? <Link to={`/reservas/${it.reservation_id}`} className="text-purple hover:underline">{it.descricao}</Link> : it.descricao}
                                </span>
                                <span className="whitespace-nowrap">{brl(it.valor)}</span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                <tr className={`border-b border-line ${Math.abs(n(data.diferenca)) > 0.004 ? 'bg-amber-light' : ''}`}>
                  <td className="py-2">Diferença não classificada</td>
                  <td className={`py-2 text-right pr-4 whitespace-nowrap ${Math.abs(n(data.diferenca)) > 0.004 ? 'text-amber font-semibold' : 'text-muted'}`}>{brl(data.diferenca)}</td>
                  <td className="py-2 text-muted text-[13px]">
                    {Math.abs(n(data.diferenca)) > 0.004
                      ? 'Valor que o sistema não conseguiu explicar com as linhas acima. Avise o responsável pelo sistema.'
                      : 'Zero: todas as diferenças entre o caixa e o resultado estão explicadas nas linhas acima.'}
                  </td>
                </tr>
                <tr className="bg-paper/60">
                  <td className="py-2 font-semibold">= Resultado do mês</td>
                  <td className={`py-2 text-right pr-4 font-semibold whitespace-nowrap ${n(data.resultado.resultado) >= 0 ? 'text-teal' : 'text-danger'}`}>{brl(data.resultado.resultado)}</td>
                  <td className="py-2 text-muted">O mesmo valor da tela Resultado das festas.</td>
                </tr>
              </tbody>
            </table>
          </Card>
        </>
      )}

      <h3 className="text-base font-semibold pt-2">Dinheiro já comprometido com festas futuras</h3>
      {compErro && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5">{compErro}</div>}
      {comp && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {data && (
              <Stat titulo={`Adiantado em ${nomeMes(data.mes)}`} valor={Math.abs(n(data.ponte.find((l) => l.chave === 'futura')?.valor))}
                legenda="Entradas do mês escolhido referentes a festas que ainda não tinham acontecido." />
            )}
            <Stat titulo="Já recebido de festas futuras" valor={comp.recebido} tom="teal" legenda="Total que os clientes já pagaram por festas que ainda não aconteceram (a partir de amanhã)." />
            <Stat titulo="Custos previstos dessas festas" valor={comp.custos_previstos} tom="danger"
              legenda="Quanto você ainda vai gastar para realizá-las: custos já lançados nelas (equipe, despesas fixas) + insumos estimados pela média de consumo." />
            <Stat titulo="Reserva necessária" valor={comp.reserva} tom="amber" destaque
              legenda={<>Parte do dinheiro recebido que precisa ficar guardada para entregar essas festas. Não gaste como se fosse lucro. Entraram: {brl(comp.reserva_custos_lancados)} de custos lançados + {brl(comp.reserva_insumos_estimados)} de insumos estimados, só das festas que já receberam algum pagamento. É estimativa.</>} />
          </div>
          <p className="text-xs text-muted">
            {n(comp.festas_sem_media) > 0 && <>{comp.festas_sem_media} {n(comp.festas_sem_media) === 1 ? 'festa futura é' : 'festas futuras são'} de unidade que ainda não tem média de consumo por convidado: para {n(comp.festas_sem_media) === 1 ? 'ela' : 'elas'}, a reserva usa só os custos lançados.{' '}</>}
            Os insumos estimados usam a média real das últimas 10 festas finalizadas de cada unidade (a mesma do Lucro por festa), só para itens que já têm histórico.
          </p>
          {saldoProjetado != null && n(comp.reserva) > saldoProjetado && (
            <div className="bg-amber-light text-amber text-sm rounded-lg px-4 py-2.5 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Atenção: a reserva necessária ({brl(comp.reserva)}) é maior que o saldo de caixa estimado ({brl(saldoProjetado)}, o "saldo projetado" do mês na tela Caixa).</span>
            </div>
          )}

          <Card title="Festas futuras">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-left text-muted border-b border-line">
                  <th className="pb-2 font-medium">Data</th><th className="pb-2 font-medium">Cliente</th>
                  {mostrarUnidade && <th className="pb-2 font-medium">Unidade</th>}
                  <th className="pb-2 font-medium">Contratado</th><th className="pb-2 font-medium">Já recebido</th>
                  <th className="pb-2 font-medium">A receber</th><th className="pb-2 font-medium">Custos previstos</th>
                </tr>
              </thead>
              <tbody>
                {porMes.map(([mes, festas]) => (
                  <Fragment key={mes}>
                    <tr className="bg-paper/60"><td colSpan={mostrarUnidade ? 7 : 6} className="py-1.5 px-1 text-xs font-semibold capitalize">
                      {nomeMes(mes)} · recebido {brl(festas.reduce((s, f) => s + n(f.recebido), 0))}
                    </td></tr>
                    {festas.map((f) => (
                      <tr key={f.id} className="border-b border-line last:border-0">
                        <td className="py-2">{dataCurta(f.data)}</td>
                        <td className="py-2"><Link to={`/reservas/${f.id}`} className="text-purple hover:underline">{f.cliente}</Link></td>
                        {mostrarUnidade && <td className="py-2">{unidadeNome(f.unit_id, unitDbIds)}</td>}
                        <td className="py-2">{brl(f.devido)}</td>
                        <td className="py-2 text-teal">{brl(f.recebido)}</td>
                        <td className="py-2">{brl(f.a_receber)}</td>
                        <td className="py-2">
                          {brl(f.custos_previstos)}
                          <span className="block text-[11px] text-muted">
                            {brl(f.custos_lancados)} lançados{f.sem_media ? ' · sem média de consumo' : ` + ${brl(n(f.insumos_estimados))} insumos estimados`}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
                {porMes.length === 0 && <tr><td colSpan={mostrarUnidade ? 7 : 6} className="py-4 text-center text-muted">Nenhuma festa futura.</td></tr>}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  )
}

// ================= CONFERÊNCIA DA PRÉVIA (só no modo de desenvolvimento) =================
// Compara o Caixa calculado pela tela com o calculado pela função nova e
// confere a "diferença não classificada" da ponte, com os dados reais.
// Não aparece no site publicado.
export function ConferenciaPrevia({ summaryByUnit, unitDbIds, pronto }: {
  summaryByUnit: Record<string, { entradas: number; acertosRecebidos: number; totalDespesas: number; custosFestas: number; saldo: number }>
  unitDbIds: Record<string, { unitId: string }>
  pronto: boolean
}) {
  const [linhas, setLinhas] = useState<{ teste: string; ok: boolean; detalhe: string }[] | null>(null)
  const [rodando, setRodando] = useState(false)

  async function rodar() {
    setRodando(true)
    const out: { teste: string; ok: boolean; detalhe: string }[] = []
    const atual = format(new Date(), 'yyyy-MM')
    const { data: unidades } = await supabase.from('units').select('id, name').order('name')
    const chaves = Object.keys(unitDbIds)
    out.push({
      teste: 'Unidades',
      ok: true,
      detalhe:
        (unidades ?? []).map((x) => `${x.name} → ${chaves.find((k) => unitDbIds[k]?.unitId === x.id) ?? 'SEM LIGAÇÃO NA TELA'}`).join(' · ') +
        ` (ligações da tela: ${chaves.join(', ') || 'nenhuma'})`,
    })
    for (const x of unidades ?? []) {
      const slug = chaves.find((k) => unitDbIds[k]?.unitId === x.id)
      const s = slug ? summaryByUnit[slug] : undefined
      if (!s) {
        out.push({ teste: `(a) ${x.name}`, ok: false, detalhe: 'a tela Caixa não tem números separados para esta unidade' })
        continue
      }
      const d = await loadMonthViews(atual, x.id)
      const pares: [string, number, number][] = [
        ['Entradas', s.entradas, n(d.caixa.entradas)],
        ['Outras entradas (acertos, multa e juros)', s.acertosRecebidos, n(d.caixa.acertos_recebidos)],
        ['Contas pagas', s.totalDespesas, n(d.caixa.contas_pagas)],
        ['Custos das festas', s.custosFestas, n(d.caixa.custos_festas)],
        ['Saldo do mês (caixa)', s.saldo, n(d.caixa.saldo)],
      ]
      for (const [nome, tela, funcao] of pares) {
        out.push({ teste: `(a) ${x.name} · ${nome}`, ok: Math.abs(tela - funcao) < 0.005, detalhe: `tela ${brl(tela)} · função ${brl(funcao)}` })
      }
    }
    // Diagnóstico: a mesma consulta que o card "Custos das festas do mês" faz.
    {
      const ini = `${atual}-01`
      const fim = `${addMonthsToValue(atual, 1)}-01`
      const { data: fm, error: fe } = await supabase
        .from('reservations')
        .select('unit_id, event_date, reservation_costs(amount)')
        .neq('status', 'cancelada')
        .gte('event_date', ini)
        .lt('event_date', fim)
      const hojeNav = format(new Date(), 'yyyy-MM-dd')
      const resumoU = (unidades ?? []).map((x) => {
        const doU = ((fm ?? []) as any[]).filter((r) => r.unit_id === x.id)
        const real = doU.filter((r) => r.event_date <= hojeNav)
        const soma = real.reduce((s, r) => s + (r.reservation_costs ?? []).reduce((t: number, c: any) => t + Number(c.amount), 0), 0)
        const comCusto = real.filter((r) => (r.reservation_costs ?? []).length > 0).length
        return `${x.name}: ${doU.length} festas no mês, ${real.length} até hoje, ${comCusto} com custos, soma ${brl(soma)}`
      })
      out.push({ teste: 'Consulta do card', ok: !fe, detalhe: `${fe ? `ERRO: ${fe.message} · ` : ''}hoje no navegador ${hojeNav} · ${resumoU.join(' · ')}` })
    }
    for (let i = 0; i < 6; i++) {
      const mes = addMonthsToValue(atual, -i)
      for (const [nome, unitId] of [...(unidades ?? []).map((x) => [x.name, x.id] as const), ['Ambas', null] as const]) {
        const d = await loadMonthViews(mes, unitId)
        const dif = n(d.diferenca)
        out.push({
          teste: `(b) ${nomeMes(mes)} · ${nome}`,
          ok: Math.abs(dif) < 0.005,
          detalhe: `caixa ${brl(d.caixa.saldo)} → resultado ${brl(d.resultado.resultado)} · diferença não classificada ${brl(dif)}`,
        })
      }
    }
    setLinhas(out)
    setRodando(false)
  }

  return (
    <div className="border-2 border-dashed border-amber rounded-card p-4 text-sm space-y-2 bg-amber-light/30">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="font-semibold">Conferência da prévia (só aparece aqui, não vai para o site)</p>
        <button onClick={rodar} disabled={rodando || !pronto} className="h-9 px-3 rounded-lg bg-purple text-white text-sm font-medium disabled:opacity-60">
          {!pronto ? 'Aguardando a tela carregar...' : rodando ? 'Conferindo...' : 'Conferir agora'}
        </button>
      </div>
      {linhas && (
        <>
          <p className={linhas.every((l) => l.ok) ? 'text-teal font-semibold' : 'text-danger font-semibold'}>
            {linhas.filter((l) => l.ok && l.teste !== 'Unidades').length} de {linhas.filter((l) => l.teste !== 'Unidades').length} conferências OK
          </p>
          <ul className="space-y-0.5 text-[13px]">
            {linhas.map((l, i) => (
              <li key={i} className={l.ok ? '' : 'text-danger font-medium'}>
                {l.ok ? '✓' : '✗'} {l.teste} — {l.detalhe}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
