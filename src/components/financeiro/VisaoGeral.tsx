import { useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Card } from '../ui/Card'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../lib/AuthContext'
import { currentMonthValue, addMonthsToValue } from '../../lib/monthUtils'
import { loadMonthViews, type MonthViews } from '../../pages/FinanceViews'

// Aba "Visão geral" do Financeiro: o que a pessoa precisa saber hoje, em uma
// tela. Lucro parcial do mês, os números principais e o que pede atenção.

export type AbaFinanceiro = 'geral' | 'lancamentos' | 'resultado' | 'planejamento' | 'comparativos'

interface Resumo {
  entradas: number
  acertos: number
  contasPagas: number
  custosFestas: number
  aPagar: number
  atrasado: number
  recebimentosPrevistos: number
  saldoProjetado: number
}

interface ContaAtrasada { id: string; descricao: string; valor: number; vencimento: string }
interface Alerta { nivel: 'alta' | 'media' | 'baixa'; titulo: string; detalhe: string; acao?: { rotulo: string; aba: AbaFinanceiro; sub?: string } }

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}
const dm = (iso: string) => format(parseISO(iso), 'dd/MM')

export function VisaoGeral({ unitId, resumo, contasAtrasadas, onIr }: {
  unitId: string | null
  resumo: Resumo | null
  contasAtrasadas: ContaAtrasada[]
  onIr: (aba: AbaFinanceiro, sub?: string) => void
}) {
  const { can } = useAuth()
  const mes = currentMonthValue()
  const [atual, setAtual] = useState<MonthViews | null>(null)
  const [anterior, setAnterior] = useState<MonthViews | null>(null)
  const [parcelasAtrasadas, setParcelasAtrasadas] = useState<{ cliente: string; aberto: number; dias: number }[]>([])

  useEffect(() => {
    let vivo = true
    loadMonthViews(mes, unitId).then((d) => vivo && setAtual(d)).catch(() => vivo && setAtual(null))
    loadMonthViews(addMonthsToValue(mes, -1), unitId).then((d) => vivo && setAnterior(d)).catch(() => vivo && setAnterior(null))
    supabase.rpc('installments_attention', { p_days: 0 }).then(({ data }) => {
      if (!vivo) return
      const lista = ((data ?? []) as any[])
        .filter((p) => Number(p.dias_atraso) > 0 && (!unitId || p.unit_id === unitId))
        .map((p) => ({ cliente: p.cliente as string, aberto: Number(p.aberto), dias: Number(p.dias_atraso) }))
        .sort((a, b) => b.dias - a.dias)
      setParcelasAtrasadas(lista)
    })
    // Projeção do caixa dos próximos 30 dias (migração 089): só avisa se o
    // saldo em conta de todas as unidades da tela foi informado.
    Promise.all([
      supabase.rpc('cash_projection', { p_unit: unitId, p_days: 30 }),
      supabase.from('cash_balances').select('unit_id, amount'),
      supabase.from('units').select('id'),
    ]).then(([proj, sal, uni]) => {
      if (!vivo || proj.error || sal.error) return
      const saldos = (sal.data ?? []) as { unit_id: string; amount: number }[]
      // Todas as unidades da tela precisam ter o saldo informado, senão a soma engana.
      const unidades = unitId ? [unitId] : ((uni.data ?? []) as { id: string }[]).map((u) => u.id)
      if (unidades.length === 0 || unidades.some((u) => !saldos.find((s) => s.unit_id === u))) return setNegativo(null)
      let s = saldos.filter((x) => unidades.includes(x.unit_id)).reduce((t, x) => t + Number(x.amount), 0)
      const porDia = new Map<string, number>()
      for (const m of (proj.data ?? []) as any[]) porDia.set(m.dia, (porDia.get(m.dia) ?? 0) + Number(m.valor))
      for (const dia of [...porDia.keys()].sort()) {
        s += porDia.get(dia)!
        if (s < 0) return setNegativo({ dia, saldo: s })
      }
      setNegativo(null)
    })
    return () => {
      vivo = false
    }
  }, [mes, unitId])
  const [negativo, setNegativo] = useState<{ dia: string; saldo: number } | null>(null)

  const r = atual?.resultado
  const lucro = r ? Number(r.resultado) : null
  const nomeMes = format(parseISO(`${mes}-01`), 'MMMM', { locale: ptBR }).replace(/^./, (c) => c.toUpperCase())
  const hoje = atual?.corte ? dm(atual.corte) : format(new Date(), 'dd/MM')

  const alertas = useMemo(() => {
    const out: Alerta[] = []
    if (negativo)
      out.push({
        nivel: 'alta',
        titulo: `O caixa previsto fica negativo em ${dm(negativo.dia)} (${brl(negativo.saldo)})`,
        detalhe: 'Considera o saldo em conta informado e tudo o que já está lançado para os próximos 30 dias.',
        acao: { rotulo: 'Ver a projeção', aba: 'planejamento' },
      })
    else if (resumo && resumo.saldoProjetado < 0)
      out.push({
        nivel: 'alta',
        titulo: `O saldo previsto do mês fica negativo (${brl(resumo.saldoProjetado)})`,
        detalhe: 'Somando o que ainda vai entrar e o que ainda vai sair neste mês, falta dinheiro. Veja o planejamento.',
        acao: { rotulo: 'Ver o planejamento', aba: 'planejamento' },
      })
    if (contasAtrasadas.length > 0) {
      const total = contasAtrasadas.reduce((s, c) => s + c.valor, 0)
      const lista = contasAtrasadas.slice(0, 3).map((c) => `${c.descricao} (${brl(c.valor)}, venceu ${dm(c.vencimento)})`).join('; ')
      out.push({
        nivel: 'alta',
        titulo: `${contasAtrasadas.length} conta${contasAtrasadas.length === 1 ? ' atrasada' : 's atrasadas'}: ${brl(total)}`,
        detalhe: lista + (contasAtrasadas.length > 3 ? ` e mais ${contasAtrasadas.length - 3}.` : '.'),
        acao: { rotulo: 'Ver contas a pagar', aba: 'lancamentos', sub: 'pagar' },
      })
    }
    const vistos = new Set<string>()
    const parciais = [...(atual?.festas ?? []), ...(anterior?.festas ?? [])].filter((f) => f.status === 'parcial' && !vistos.has(f.id) && vistos.add(f.id))
    if (parciais.length > 0)
      out.push({
        nivel: 'media',
        titulo: `${parciais.length} festa${parciais.length === 1 ? ' realizada está' : 's realizadas estão'} com dados incompletos`,
        detalhe: `${parciais.slice(0, 3).map((f) => `${f.cliente} (${dm(f.data)})`).join(', ')}${parciais.length > 3 ? '…' : ''}. Sem custos lançados ou consumo finalizado, o lucro aparece maior do que o real.`,
        acao: can('page:lucro_por_festa') ? { rotulo: 'Ver as festas', aba: 'resultado', sub: 'festa' } : undefined,
      })
    if (parcelasAtrasadas.length > 0) {
      const total = parcelasAtrasadas.reduce((s, p) => s + p.aberto, 0)
      out.push({
        nivel: 'baixa',
        titulo: `${parcelasAtrasadas.length} parcela${parcelasAtrasadas.length === 1 ? '' : 's'} de cliente atrasada${parcelasAtrasadas.length === 1 ? '' : 's'}: ${brl(total)}`,
        detalhe: parcelasAtrasadas.slice(0, 3).map((p) => `${p.cliente} (${brl(p.aberto)}, há ${p.dias} dia${p.dias === 1 ? '' : 's'})`).join('; ') + '. Os lembretes de cobrança estão no Painel.',
      })
    }
    return out
  }, [resumo, contasAtrasadas, atual, anterior, parcelasAtrasadas, can, negativo])

  const corNivel = { alta: '#B23A3A', media: '#B8720A', baixa: 'rgb(var(--c-purple))' } as const

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">O que você precisa saber hoje: se o mês está dando lucro, como está o caixa e o que pede atenção. Os detalhes ficam nas outras abas.</p>

      <Card className={lucro === null ? '' : lucro >= 0 ? 'border-teal' : 'border-danger'}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs text-muted font-semibold uppercase tracking-wide">
              {lucro === null ? 'Resultado do mês' : lucro >= 0 ? 'Lucro' : 'Prejuízo'} parcial de {nomeMes} (até {hoje})
            </p>
            <p className={`text-3xl font-display font-semibold mt-1 ${lucro === null ? '' : lucro >= 0 ? 'text-teal' : 'text-danger'}`}>
              {lucro === null ? '…' : brl(Math.abs(lucro))}
            </p>
          </div>
          {r && (
            <p className="text-sm text-muted max-w-xl">
              {Number(r.festas) === 0
                ? 'Nenhuma festa realizada ainda neste mês. '
                : `${r.festas} festa${Number(r.festas) === 1 ? ' realizada somou' : 's realizadas somaram'} ${brl(Number(r.receita))}; sobraram ${brl(Number(r.resultado_direto))} depois dos custos delas. `}
              As despesas gerais pagas ({brl(Number(r.despesas_gerais))}) {Number(r.efeito_cancelamentos) !== 0 ? `e os cancelamentos (${brl(Number(r.efeito_cancelamentos))}) ` : ''}deixaram o resultado em {brl(lucro ?? 0)}. O mês ainda não terminou.{' '}
              <button type="button" onClick={() => onIr('resultado', 'festas')} className="text-purple font-medium underline">Ver como chegamos nesse número</button>
            </p>
          )}
        </div>
      </Card>

      {resumo && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <p className="text-xs text-muted">Entrou no caixa</p>
            <p className="text-xl font-display font-semibold mt-1 text-teal">{brl(resumo.entradas + resumo.acertos)}</p>
            <p className="text-[11px] text-muted mt-0.5">{brl(resumo.entradas)} de clientes{resumo.acertos > 0 ? ` + ${brl(resumo.acertos)} de outras entradas` : ''}</p>
          </Card>
          <Card>
            <p className="text-xs text-muted">Saiu do caixa</p>
            <p className="text-xl font-display font-semibold mt-1 text-danger">{brl(resumo.contasPagas + resumo.custosFestas)}</p>
            <p className="text-[11px] text-muted mt-0.5">{brl(resumo.contasPagas)} de contas + {brl(resumo.custosFestas)} de custos das festas</p>
          </Card>
          <Card>
            <p className="text-xs text-muted">A receber neste mês</p>
            <p className="text-xl font-display font-semibold mt-1">{brl(resumo.recebimentosPrevistos)}</p>
            <p className="text-[11px] text-muted mt-0.5">saldo das festas deste mês que ainda não foi pago</p>
          </Card>
          <Card className={resumo.atrasado > 0 ? 'border-danger' : ''}>
            <p className="text-xs text-muted">A pagar</p>
            <p className={`text-xl font-display font-semibold mt-1 ${resumo.atrasado > 0 ? 'text-danger' : 'text-amber'}`}>{brl(resumo.aPagar + resumo.atrasado)}</p>
            <p className="text-[11px] text-muted mt-0.5">{resumo.atrasado > 0 ? `${brl(resumo.atrasado)} atrasado` : 'nenhuma conta atrasada'}</p>
          </Card>
        </div>
      )}

      <Card title="Pede atenção">
        {alertas.length === 0 ? (
          <p className="text-sm text-muted py-2">Nada pedindo atenção agora.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted -mt-1 mb-1">Do mais urgente para o menos urgente.</p>
            {alertas.map((a, i) => (
              <div key={i} className="flex flex-wrap items-start justify-between gap-3 border border-line border-l-4 rounded-lg px-3 py-2.5" style={{ borderLeftColor: corNivel[a.nivel] }}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{a.titulo}</p>
                  <p className="text-xs text-muted mt-0.5">{a.detalhe}</p>
                </div>
                {a.acao && (
                  <button type="button" onClick={() => onIr(a.acao!.aba, a.acao!.sub)} className="text-xs font-medium text-purple whitespace-nowrap">
                    {a.acao.rotulo} →
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
