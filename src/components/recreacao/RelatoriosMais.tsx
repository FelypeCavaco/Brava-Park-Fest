import { useEffect, useState, type ReactNode } from 'react'
import { Crown, HeartHandshake, CalendarDays, Cake, ShoppingBag, Siren, UserX, MessageCircle } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { Card } from '../ui/Card'
import { brl, friendlyDbError } from '../../lib/format'
import { fmtMin, linkWhatsApp, mascaraTelefone } from '../../lib/recreacao'

// Relatórios extras da recreação (migração 114): quem mais vem, quando, com que idade,
// o que mais se vende e quem sumiu.

interface Mais {
  criancas_top: { nome: string; visitas: number; tempo_min: number; gasto: number }[]
  familias_top: { responsavel: string; visitas: number; dias: number; gasto: number }[]
  dias_semana: { dow: number; visitas: number; dias: number; recebido: number }[]
  faixas_idade: { faixa: string; visitas: number; criancas: number }[]
  itens_top: { item: string; quantidade: number; total: number }[]
  ocorrencias_tipo: { tipo: string; quantidade: number }[]
  sumidos: { responsavel: string; telefone: string | null; ultima: string; visitas: number; dias_fora: number }[]
}

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const Vazio = ({ texto = 'Sem movimento neste período.' }: { texto?: string }) => <p className="text-sm text-muted py-2">{texto}</p>

function Barras({ itens }: { itens: { rotulo: string; valor: number; dica?: ReactNode }[] }) {
  const max = Math.max(1, ...itens.map((i) => i.valor))
  return (
    <ul className="space-y-2.5">{itens.map((i) => (
      <li key={i.rotulo}>
        <div className="flex justify-between gap-3 text-sm"><span className="font-semibold truncate">{i.rotulo}</span><span className="text-muted shrink-0">{i.dica}</span></div>
        <div className="h-2 rounded-full bg-line mt-1 overflow-hidden"><div className="h-full bg-purple rounded-full" style={{ width: `${(i.valor / max) * 100}%` }} /></div>
      </li>
    ))}</ul>
  )
}

export function RelatoriosMais({ ini, fim, unitId, casa }: { ini: string; fim: string; unitId: string | null; casa: string }) {
  const [m, setM] = useState<Mais | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => {
    setM(null)
    supabase.rpc('rec_relatorio_mais', { p_ini: ini, p_fim: fim, p_unit: unitId }).then(({ data, error }) => {
      if (error) return setErro(friendlyDbError(error.message))
      setErro(null); setM(data as Mais)
    })
  }, [ini, fim, unitId])

  if (erro) return <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5">{erro}</div>
  if (!m) return null
  const titulo = (Ic: typeof Crown, t: string) => <h2 className="font-semibold mb-3 flex items-center gap-2"><Ic className="w-4 h-4 text-purple" />{t}</h2>
  const semana = m.dias_semana.map((d) => ({ rotulo: DIAS[d.dow], valor: d.dias ? d.visitas / d.dias : 0, dica: d.visitas ? `${d.visitas} entradas · média ${(d.visitas / d.dias).toFixed(1).replace('.', ',')} por dia` : '—' }))

  return (
    <>
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          {titulo(Crown, 'Crianças que mais vieram')}
          {m.criancas_top.length === 0 ? <Vazio /> : (
            <ol className="divide-y divide-line text-sm">{m.criancas_top.map((c, i) => (
              <li key={c.nome} className="py-2 flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-purple-light text-purple text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                <span className="flex-1 min-w-0 truncate font-semibold">{c.nome}</span>
                <span className="text-xs text-muted shrink-0">{c.tempo_min ? `${fmtMin(c.tempo_min)} no total · ` : ''}{brl(Number(c.gasto))}</span>
                <span className="font-bold shrink-0 w-16 text-right">{c.visitas}×</span>
              </li>
            ))}</ol>
          )}
        </Card>
        <Card>
          {titulo(HeartHandshake, 'Famílias mais frequentes')}
          {m.familias_top.length === 0 ? <Vazio /> : (
            <ol className="divide-y divide-line text-sm">{m.familias_top.map((f, i) => (
              <li key={f.responsavel} className="py-2 flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-purple-light text-purple text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                <span className="flex-1 min-w-0 truncate font-semibold">{f.responsavel}</span>
                <span className="text-xs text-muted shrink-0">{f.visitas} entradas · {brl(Number(f.gasto))}</span>
                <span className="font-bold shrink-0 w-20 text-right">{f.dias} dia{f.dias === 1 ? '' : 's'}</span>
              </li>
            ))}</ol>
          )}
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          {titulo(CalendarDays, 'Dias da semana')}
          {semana.every((d) => d.valor === 0) ? <Vazio /> : <Barras itens={semana} />}
          <p className="text-[11px] text-muted mt-3">A barra mostra a média de entradas por dia naquele dia da semana.</p>
        </Card>
        <Card>
          {titulo(Cake, 'Faixas de idade')}
          {m.faixas_idade.length === 0 ? <Vazio /> : <Barras itens={m.faixas_idade.map((f) => ({ rotulo: f.faixa, valor: f.visitas, dica: `${f.visitas} entradas · ${f.criancas} criança${f.criancas === 1 ? '' : 's'}` }))} />}
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          {titulo(ShoppingBag, 'Itens do balcão mais vendidos')}
          {m.itens_top.length === 0 ? <Vazio texto="Nenhum item vendido neste período." /> : <Barras itens={m.itens_top.map((i) => ({ rotulo: i.item, valor: Number(i.quantidade), dica: `${Number(i.quantidade)} un. · ${brl(Number(i.total))}` }))} />}
        </Card>
        <Card>
          {titulo(Siren, 'Ocorrências por tipo')}
          {m.ocorrencias_tipo.length === 0 ? <Vazio texto="Nenhuma ocorrência neste período." /> : <Barras itens={m.ocorrencias_tipo.map((o) => ({ rotulo: o.tipo, valor: o.quantidade, dica: `${o.quantidade}` }))} />}
        </Card>
      </div>

      <Card>
        <h2 className="font-semibold mb-1 flex items-center gap-2"><UserX className="w-4 h-4 text-amber" />Famílias que não voltam há mais de 30 dias</h2>
        <p className="text-xs text-muted mb-3">Olha todo o histórico, não só o período escolhido. Só entram famílias que já vieram 2 vezes ou mais.</p>
        {m.sumidos.length === 0 ? <Vazio texto="Ninguém sumido por enquanto." /> : (
          <ul className="divide-y divide-line text-sm">{m.sumidos.map((s) => (
            <li key={s.responsavel + s.ultima} className="py-2 flex flex-wrap items-center gap-x-4 gap-y-0.5">
              <span className="font-semibold flex-1 min-w-[10rem]">{s.responsavel}</span>
              <span className="text-xs text-muted">{s.telefone ? mascaraTelefone(s.telefone) : 'sem telefone'}</span>
              <span className="text-xs text-muted">{s.visitas} visitas · última há {s.dias_fora} dias</span>
              {s.telefone && (
                <a className="inline-flex items-center gap-1 text-xs font-bold text-teal hover:underline" target="_blank" rel="noreferrer"
                  href={linkWhatsApp(s.telefone, `Oi, ${s.responsavel.split(' ')[0]}! Aqui é da ${casa}. Faz um tempinho que não vemos vocês por aqui e sentimos saudade. Vamos brincar de novo?`)}>
                  <MessageCircle className="w-3.5 h-3.5" />Chamar
                </a>
              )}
            </li>
          ))}</ul>
        )}
      </Card>
    </>
  )
}
