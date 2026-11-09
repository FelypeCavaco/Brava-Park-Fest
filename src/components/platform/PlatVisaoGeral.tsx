import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card } from '../ui/Card'
import { supabase } from '../../lib/supabaseClient'
import { brl } from '../../lib/format'
import type { PainelDados } from './platformApi'
import { diasSemUso, emTeste, mesCurto, pagante, SEM_USO_ALERTA } from './platformTypes'

// Visão geral do Festou: quanto entra por mês, quem está atrasado e o que
// precisa da sua atenção (do mais urgente para o menos).

interface Mes { mes: string; mensalidades: number; implantacoes: number; custos: number; casas_pagantes: number }
interface Aviso { cor: 'danger' | 'amber' | 'purple'; titulo: string; detalhe: string; acao: string; ir: string }

export function PlatVisaoGeral({ d }: { d: PainelDados }) {
  const navigate = useNavigate()
  const [meses, setMeses] = useState<Mes[] | null>(null)
  const [novosInteressados, setNovosInteressados] = useState(0)

  useEffect(() => {
    if (d.sem094) return
    supabase.rpc('platform_finance_months', { p_meses: 6 }).then(({ data }) =>
      setMeses(((data ?? []) as Mes[]).map((m) => ({ ...m, mensalidades: Number(m.mensalidades), implantacoes: Number(m.implantacoes), custos: Number(m.custos) }))))
    supabase.rpc('platform_leads_list').then(({ data }) => setNovosInteressados(((data ?? []) as { status: string }[]).filter((l) => l.status === 'novo').length))
  }, [d.sem094])

  if (d.carregando) return <p className="text-sm text-muted">Carregando...</p>

  const M = d.mensalidades
  const ativas = d.empresas.filter((c) => c.active)
  const pagantes = d.empresas.filter((c) => pagante(c, M[c.id]))
  const mrr = pagantes.reduce((t, c) => t + Number(M[c.id]?.mensalidade || 0), 0)
  const emTesteLista = ativas.filter((c) => emTeste(M[c.id]) !== null)
  const atrasadas = ativas.filter((c) => M[c.id]?.situacao === 'atrasada')
  const valorAtrasado = atrasadas.reduce((t, c) => t + Number(M[c.id].valor_em_aberto), 0)
  const mesPassado = meses && meses.length >= 2 ? meses[meses.length - 2] : null
  const planoDe = (id: string) => d.planos.find((p) => p.id === d.planosDaCasa[id]?.plano_id)

  const avisos: Aviso[] = []
  for (const c of atrasadas) {
    const m = M[c.id]
    avisos.push({
      cor: 'danger', titulo: `${c.name}: mensalidade atrasada há ${m.dias_atraso} ${m.dias_atraso === 1 ? 'dia' : 'dias'}`,
      detalhe: m.bloqueada ? 'Passou da tolerância: o acesso está bloqueado até pagar.' : `Em aberto: ${brl(Number(m.valor_em_aberto))}. Tolerância de ${m.tolerancia_dias ?? 7} dias antes de bloquear.`,
      acao: 'Ver ficha', ir: `/plataforma/casas/${c.id}?aba=mensalidade`,
    })
  }
  for (const c of emTesteLista) {
    const dias = emTeste(M[c.id])!
    if (dias <= 5) avisos.push({ cor: 'amber', titulo: `${c.name}: teste grátis acaba ${dias <= 1 ? 'amanhã' : `em ${dias} dias`}`, detalhe: `Cadastrou ${c.festas_30d} ${c.festas_30d === 1 ? 'festa' : 'festas'} nos últimos 30 dias. Bom momento para ligar e confirmar o plano.`, acao: 'Ver ficha', ir: `/plataforma/casas/${c.id}` })
  }
  for (const c of ativas) {
    const dias = diasSemUso(c.ultima_atividade)
    if (dias === null || dias >= SEM_USO_ALERTA) avisos.push({ cor: 'amber', titulo: `${c.name}: ${dias === null ? 'ainda não usou o sistema' : `sem usar o sistema há ${dias} dias`}`, detalhe: 'Casa parada costuma cancelar. Vale uma ligação para ver se precisa de ajuda.', acao: 'Ver ficha', ir: `/plataforma/casas/${c.id}` })
  }
  for (const c of ativas) {
    const lim = M[c.id]?.usuarios_incluidos
    if (lim && c.usuarios >= lim) {
      const p = planoDe(c.id)
      avisos.push({ cor: 'purple', titulo: `${c.name}: usando ${c.usuarios} de ${lim} usuários${p ? ` do plano ${p.nome}` : ''}`, detalhe: 'Chegou no limite. Oportunidade de oferecer o plano acima ou usuários adicionais.', acao: 'Ver ficha', ir: `/plataforma/casas/${c.id}?aba=plano` })
    }
  }
  for (const c of ativas) {
    const calc = d.planosDaCasa[c.id]?.mensalidade_calculada
    const atual = Number(M[c.id]?.mensalidade || 0)
    if (calc != null && calc - atual > 0.009) {
      const extras = c.unidades - (M[c.id]?.unidades_incluidas ?? 1)
      avisos.push({ cor: 'amber', titulo: `${c.name}: ${c.unidades} unidades, mas a mensalidade não inclui ${extras > 0 ? (extras === 1 ? 'a unidade a mais' : `as ${extras} unidades a mais`) : 'o valor do plano'}`, detalhe: `Hoje paga ${brl(atual)}; pela conta do plano seria ${brl(calc)}. Se não foi um desconto combinado, recalcule na ficha.`, acao: 'Ver ficha', ir: `/plataforma/casas/${c.id}?aba=plano` })
    }
  }
  const semMensalidade = ativas.filter((c) => !M[c.id]?.cadastrada)
  if (semMensalidade.length) avisos.push({ cor: 'purple', titulo: `${semMensalidade.length} ${semMensalidade.length === 1 ? 'casa ativa sem mensalidade cadastrada' : 'casas ativas sem mensalidade cadastrada'}`, detalhe: semMensalidade.map((c) => c.name).join(', '), acao: 'Ver casas', ir: '/plataforma/casas' })
  if (novosInteressados) avisos.push({ cor: 'purple', titulo: `${novosInteressados} ${novosInteressados === 1 ? 'interessado novo' : 'interessados novos'} sem resposta`, detalhe: 'Quanto antes você responder, maior a chance de fechar.', acao: 'Ver interessados', ir: '/plataforma/interessados' })

  const corBorda = { danger: 'border-l-danger', amber: 'border-l-amber', purple: 'border-l-purple' }
  const porPlano = [...d.planos.map((p) => ({ nome: p.nome, casas: pagantes.filter((c) => d.planosDaCasa[c.id]?.plano_id === p.id) })),
    { nome: 'Sem plano da lista', casas: pagantes.filter((c) => !planoDe(c.id)) }].filter((g) => g.casas.length > 0 || g.nome !== 'Sem plano da lista')

  return (
    <div className="space-y-6">
      <div>
        <img src="/marca/festou.png" alt="Festou" className="h-8 w-auto mb-2" draggable={false} />
        <h1 className="text-2xl font-semibold">Visão geral</h1>
        <p className="text-sm text-muted mt-1">Como está o Festou hoje: quanto entra por mês, quem está atrasado e o que precisa da sua atenção.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Numero rotulo="Receita mensal recorrente" valor={brl(mrr)} nota={`${pagantes.length} ${pagantes.length === 1 ? 'casa pagante' : 'casas pagantes'}${pagantes.length ? ` · média ${brl(mrr / pagantes.length)}` : ''}`} />
        <Numero rotulo="Em teste grátis" valor={String(emTesteLista.length)} nota={emTesteLista.length ? `podem virar ${brl(emTesteLista.reduce((t, c) => t + Number(M[c.id]?.mensalidade || 0), 0))}/mês` : 'nenhuma agora'} />
        <Numero rotulo="Mensalidades atrasadas" valor={atrasadas.length ? `${atrasadas.length} · ${brl(valorAtrasado)}` : '0'} nota={atrasadas.length ? 'veja os avisos abaixo' : 'tudo em dia'} alerta={atrasadas.length > 0} />
        <Numero rotulo={mesPassado ? `Sobra do Festou em ${mesCurto(mesPassado.mes)}` : 'Sobra do mês passado'} valor={mesPassado ? brl(mesPassado.mensalidades + mesPassado.implantacoes - mesPassado.custos) : '—'} nota="recebido menos custos da plataforma" />
      </div>

      <Card title="Precisa da sua atenção">
        {avisos.length === 0 ? (
          <p className="text-sm text-muted">Nada pendente. Todas as casas em dia e usando o sistema.</p>
        ) : (
          <div className="space-y-2">
            {avisos.map((a, i) => (
              <div key={i} className={`flex flex-wrap items-center justify-between gap-3 border border-line border-l-4 ${corBorda[a.cor]} rounded-lg px-3 py-2.5`}>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{a.titulo}</p>
                  <p className="text-xs text-muted">{a.detalhe}</p>
                </div>
                <button onClick={() => navigate(a.ir)} className="text-xs font-medium border border-line rounded-lg px-3 py-1.5 hover:bg-paper shrink-0">{a.acao}</button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Receita recebida por mês">
          <p className="text-xs text-muted mb-3">Mensalidades e implantações que entraram, pela data do pagamento. O mês atual ainda está em andamento.</p>
          {d.sem094 ? <p className="text-sm text-muted">Disponível depois da migração 094.</p> : !meses ? <p className="text-sm text-muted">Carregando...</p> : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={meses.map((m) => ({ ...m, rotulo: mesCurto(m.mes) }))}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgb(var(--c-line))" />
                  <XAxis dataKey="rotulo" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `R$ ${Math.round(v).toLocaleString('pt-BR')}`} width={70} />
                  <Tooltip formatter={(v: number, n: string) => [brl(v), n]} labelFormatter={(l) => `Mês ${l}`} />
                  <Bar dataKey="mensalidades" name="Mensalidades" stackId="r" fill="rgb(var(--c-purple))" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="implantacoes" name="Implantações" stackId="r" fill="rgb(var(--c-green))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card title="Casas por plano">
          <p className="text-xs text-muted mb-3">Só casas pagantes (sem teste grátis e sem suspensas).</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="pb-2 font-medium">Plano</th><th className="pb-2 font-medium text-right">Casas</th><th className="pb-2 font-medium text-right">Por mês</th><th className="pb-2 font-medium text-right">% da receita</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {porPlano.map((g) => {
                const v = g.casas.reduce((t, c) => t + Number(M[c.id]?.mensalidade || 0), 0)
                return (
                  <tr key={g.nome}>
                    <td className="py-2 font-medium">{g.nome}</td>
                    <td className="py-2 text-right tabular-nums">{g.casas.length}</td>
                    <td className="py-2 text-right tabular-nums">{brl(v)}</td>
                    <td className="py-2 text-right tabular-nums">{mrr ? Math.round((v / mrr) * 100) : 0}%</td>
                  </tr>
                )
              })}
              <tr className="font-semibold border-t-2 border-purple">
                <td className="py-2">Total</td><td className="py-2 text-right tabular-nums">{pagantes.length}</td><td className="py-2 text-right tabular-nums">{brl(mrr)}</td><td className="py-2 text-right">100%</td>
              </tr>
            </tbody>
          </table>
          {d.empresas.length - ativas.length > 0 && <p className="text-xs text-muted mt-3">Suspensas: <b>{d.empresas.length - ativas.length}</b> ({d.empresas.filter((c) => !c.active).map((c) => c.name).join(', ')}).</p>}
        </Card>
      </div>
    </div>
  )
}

export function Numero({ rotulo, valor, nota, alerta = false }: { rotulo: string; valor: string; nota?: string; alerta?: boolean }) {
  return (
    <div className={`rounded-card border px-4 py-3 bg-surface ${alerta ? 'border-amber/50' : 'border-line'}`}>
      <p className="text-xs text-muted">{rotulo}</p>
      <p className={`text-2xl font-display font-semibold tabular-nums ${alerta ? 'text-amber' : ''}`}>{valor}</p>
      {nota && <p className="text-xs text-muted mt-0.5">{nota}</p>}
    </div>
  )
}
