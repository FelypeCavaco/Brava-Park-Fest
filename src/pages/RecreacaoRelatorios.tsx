import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Users, Wallet, Clock, Percent, XCircle, AlertTriangle, Copy } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useUnit } from '../lib/UnitContext'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { brl, friendlyDbError } from '../lib/format'
import { RelatoriosMais } from '../components/recreacao/RelatoriosMais'
import { useCompany } from '../lib/CompanyContext'
import { fmtMin, horaMin, nomeForma } from '../lib/recreacao'

interface Rel {
  periodo: { ini: string; fim: string }
  resumo: { visitas: number; criancas: number; familias: number; cancelamentos: number; descontos: number; itens: number; tempo_medio_min: number; ainda_dentro: number; ocorrencias: number }
  recebido: number
  por_forma: { forma: string; valor: number }[]
  por_dia: { dia: string; visitas: number; recebido: number }[]
  por_hora: { hora: number; visitas: number }[]
  por_plano: { plano: string; visitas: number; total: number; tempo_medio_min: number }[]
  por_atendente: { atendente: string; recebido: number; lancamentos: number }[]
  caixas: { id: string; dia: string; aberto_por: string; fechado_por: string | null; status: string; diferenca_total: number | null; obs: string | null }[]
  cancelamentos: { em: string; crianca: string; por: string; motivo: string }[]
  descontos_lista: { em: string; crianca: string; valor: number; motivo: string; por: string }[]
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const dataBr = (d: string) => d.split('-').reverse().join('/')
const dm = (d: string) => d.split('-').reverse().slice(0, 2).join('/')

function periodos() {
  const h = new Date(), ontem = new Date(h); ontem.setDate(h.getDate() - 1)
  const s7 = new Date(h); s7.setDate(h.getDate() - 6)
  const m0 = new Date(h.getFullYear(), h.getMonth(), 1), pm0 = new Date(h.getFullYear(), h.getMonth() - 1, 1), pm1 = new Date(h.getFullYear(), h.getMonth(), 0)
  return [
    { k: 'hoje', l: 'Hoje', ini: iso(h), fim: iso(h) },
    { k: 'ontem', l: 'Ontem', ini: iso(ontem), fim: iso(ontem) },
    { k: '7', l: 'Últimos 7 dias', ini: iso(s7), fim: iso(h) },
    { k: 'mes', l: 'Este mês', ini: iso(m0), fim: iso(h) },
    { k: 'mespas', l: 'Mês passado', ini: iso(pm0), fim: iso(pm1) },
  ]
}

export function RecreacaoRelatorios() {
  const { selectedUnit, unitDbIds } = useUnit()
  const { brand } = useCompany()
  const unitId = selectedUnit === 'todas' ? null : unitDbIds[selectedUnit]?.unitId ?? null
  const lista = useMemo(periodos, [])
  const [sel, setSel] = useState('7')
  const [livre, setLivre] = useState<{ ini: string; fim: string }>({ ini: lista[2].ini, fim: lista[2].fim })
  const per = sel === 'livre' ? livre : lista.find((p) => p.k === sel)!
  const [r, setR] = useState<Rel | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!per.ini || !per.fim) return
    setR(null)
    supabase.rpc('rec_relatorio', { p_ini: per.ini, p_fim: per.fim, p_unit: unitId }).then(({ data, error }) => {
      if (error) return setErro(friendlyDbError(error.message))
      setErro(null); setR(data as Rel)
    })
  }, [per.ini, per.fim, unitId])

  const maxDia = Math.max(1, ...(r?.por_dia ?? []).map((d) => d.visitas))
  const maxHora = Math.max(1, ...(r?.por_hora ?? []).map((h) => h.visitas))
  const horas = (r?.por_hora ?? []).filter((h) => h.hora >= 6)
  const pico = r?.por_hora.reduce((a, h) => (h.visitas > a.visitas ? h : a), { hora: 0, visitas: 0 })
  const ticket = r && r.resumo.visitas ? Number(r.recebido) / r.resumo.visitas : 0
  const difTotal = (r?.caixas ?? []).reduce((a, c) => a + Number(c.diferenca_total ?? 0), 0)

  const texto = () => r ? [
    `Recreação — ${dataBr(r.periodo.ini)} a ${dataBr(r.periodo.fim)}`,
    `${r.resumo.visitas} entradas (${r.resumo.criancas} crianças, ${r.resumo.familias} famílias)`,
    `Recebido: ${brl(Number(r.recebido))} · ticket médio ${brl(ticket)} · tempo médio ${fmtMin(r.resumo.tempo_medio_min)}`,
    ...r.por_forma.map((f) => `${nomeForma(f.forma)}: ${brl(Number(f.valor))}`),
    `Cancelamentos: ${r.resumo.cancelamentos} · descontos: ${brl(Number(r.resumo.descontos))} · ocorrências: ${r.resumo.ocorrencias}`,
  ].join('\n') : ''

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex flex-wrap items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple to-purple-dark text-white flex items-center justify-center shadow-lg shadow-purple/30 shrink-0"><BarChart3 className="w-6 h-6" strokeWidth={1.75} /></div>
        <div className="flex-1 min-w-[14rem]">
          <h1 className="text-2xl font-semibold">Relatórios da recreação</h1>
          <p className="text-sm text-muted">Movimento, dinheiro e horários de pico. Muda com a unidade escolhida no menu.</p>
        </div>
        {r && <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(texto())}><Copy className="w-4 h-4" />Copiar resumo</Button>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {lista.map((p) => <button key={p.k} type="button" onClick={() => setSel(p.k)} className={`px-3 h-9 rounded-full text-sm font-semibold border ${sel === p.k ? 'bg-purple text-white border-purple' : 'border-line bg-surface'}`}>{p.l}</button>)}
        <button type="button" onClick={() => setSel('livre')} className={`px-3 h-9 rounded-full text-sm font-semibold border ${sel === 'livre' ? 'bg-purple text-white border-purple' : 'border-line bg-surface'}`}>Escolher datas</button>
        {sel === 'livre' && (
          <span className="flex items-center gap-2 text-sm">
            <input type="date" className="campo !py-1.5" value={livre.ini} onChange={(e) => setLivre({ ...livre, ini: e.target.value })} aria-label="De" />
            até <input type="date" className="campo !py-1.5" value={livre.fim} onChange={(e) => setLivre({ ...livre, fim: e.target.value })} aria-label="Até" />
          </span>
        )}
      </div>

      {erro && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5">{erro}</div>}
      {!r && !erro && <Card><p className="text-sm text-muted text-center py-6">Carregando...</p></Card>}

      {r && (
        <>
          <p className="text-sm text-muted">{r.periodo.ini === r.periodo.fim ? dataBr(r.periodo.ini) : `${dataBr(r.periodo.ini)} a ${dataBr(r.periodo.fim)}`}{r.resumo.ainda_dentro ? ` · ${r.resumo.ainda_dentro} ainda dentro` : ''}</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Numero icone={Wallet} rotulo="Recebido" valor={brl(Number(r.recebido))} dica={`ticket médio ${brl(ticket)}`} />
            <Numero icone={Users} rotulo="Entradas" valor={String(r.resumo.visitas)} dica={`${r.resumo.criancas} crianças · ${r.resumo.familias} famílias`} />
            <Numero icone={Clock} rotulo="Tempo médio" valor={r.resumo.tempo_medio_min ? fmtMin(r.resumo.tempo_medio_min) : '—'} dica={pico && pico.visitas ? `pico às ${pico.hora}h (${pico.visitas})` : 'sem movimento'} />
            <Numero icone={Percent} rotulo="Descontos" valor={brl(Number(r.resumo.descontos))} dica={`${r.resumo.cancelamentos} cancelamento${r.resumo.cancelamentos === 1 ? '' : 's'} · ${r.resumo.ocorrencias} ocorrência${r.resumo.ocorrencias === 1 ? '' : 's'}`} />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <h2 className="font-semibold mb-3">Entradas por dia</h2>
              {r.por_dia.length > 31 ? <p className="text-sm text-muted">Período longo: escolha até 31 dias para ver o gráfico.</p> : (
                <div className="flex items-end gap-1 h-36" role="img" aria-label="Entradas por dia">
                  {r.por_dia.map((d) => (
                    <div key={d.dia} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full group" title={`${dataBr(d.dia)}: ${d.visitas} entradas, ${brl(Number(d.recebido))}`}>
                      <span className="text-[10px] text-muted opacity-0 group-hover:opacity-100">{d.visitas}</span>
                      <div className="w-full rounded-t bg-purple/80 min-h-[2px]" style={{ height: `${(d.visitas / maxDia) * 100}%` }} />
                    </div>
                  ))}
                </div>
              )}
              {r.por_dia.length <= 31 && <div className="flex justify-between text-[10px] text-muted mt-1"><span>{dm(r.por_dia[0].dia)}</span><span>{dm(r.por_dia[r.por_dia.length - 1].dia)}</span></div>}
            </Card>
            <Card>
              <h2 className="font-semibold mb-3">Horário de entrada</h2>
              <div className="flex items-end gap-1 h-36" role="img" aria-label="Entradas por hora">
                {horas.map((h) => (
                  <div key={h.hora} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full group" title={`${h.hora}h: ${h.visitas} entradas`}>
                    <span className="text-[10px] text-muted opacity-0 group-hover:opacity-100">{h.visitas}</span>
                    <div className={`w-full rounded-t min-h-[2px] ${pico && h.hora === pico.hora && h.visitas > 0 ? 'bg-teal' : 'bg-purple/80'}`} style={{ height: `${(h.visitas / maxHora) * 100}%` }} />
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-[10px] text-muted mt-1"><span>{horas[0]?.hora}h</span><span>{horas[horas.length - 1]?.hora}h</span></div>
            </Card>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <h2 className="font-semibold mb-3">Por plano</h2>
              {r.por_plano.length === 0 ? <Vazio /> : (
                <table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted"><th className="py-1 font-semibold">Plano</th><th className="font-semibold text-right">Entradas</th><th className="font-semibold text-right">Tempo médio</th><th className="font-semibold text-right">Faturado</th></tr></thead>
                  <tbody>{r.por_plano.map((p) => <tr key={p.plano} className="border-t border-line"><td className="py-2 font-semibold">{p.plano}</td><td className="text-right">{p.visitas}</td><td className="text-right">{p.tempo_medio_min ? fmtMin(p.tempo_medio_min) : '—'}</td><td className="text-right font-bold">{brl(Number(p.total))}</td></tr>)}</tbody></table>
              )}
            </Card>
            <Card>
              <h2 className="font-semibold mb-3">Por forma de pagamento</h2>
              {r.por_forma.length === 0 ? <Vazio /> : (
                <ul className="space-y-2.5">{r.por_forma.map((f) => {
                  const tot = r.por_forma.reduce((a, x) => a + Math.max(0, Number(x.valor)), 0) || 1
                  return (
                    <li key={f.forma}>
                      <div className="flex justify-between text-sm"><span className="font-semibold">{nomeForma(f.forma)}</span><span className="font-bold">{brl(Number(f.valor))}</span></div>
                      <div className="h-2 rounded-full bg-line mt-1 overflow-hidden"><div className="h-full bg-purple rounded-full" style={{ width: `${Math.max(0, (Number(f.valor) / tot) * 100)}%` }} /></div>
                    </li>
                  )
                })}</ul>
              )}
              {r.por_atendente.length > 0 && (
                <>
                  <h3 className="font-semibold text-sm mt-5 mb-2">Por atendente</h3>
                  <ul className="divide-y divide-line text-sm">{r.por_atendente.map((a) => <li key={a.atendente} className="py-1.5 flex justify-between"><span>{a.atendente} <span className="text-xs text-muted">· {a.lancamentos} lançamento{a.lancamentos === 1 ? '' : 's'}</span></span><span className="font-semibold">{brl(Number(a.recebido))}</span></li>)}</ul>
                </>
              )}
            </Card>
          </div>

          <RelatoriosMais ini={per.ini} fim={per.fim} unitId={unitId} casa={brand.name || 'a recreação'} />

          <Card>
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <h2 className="font-semibold flex-1">Caixas do período</h2>
              {r.caixas.some((c) => c.status === 'fechado') && <span className="text-sm font-bold">{difTotal === 0 ? <span className="text-teal">Tudo bateu</span> : <span className="text-danger">{difTotal > 0 ? 'Sobrou' : 'Faltou'} {brl(Math.abs(difTotal))} no total</span>}</span>}
            </div>
            {r.caixas.length === 0 ? <Vazio texto="Nenhum caixa neste período." /> : (
              <ul className="divide-y divide-line text-sm">{r.caixas.map((c) => (
                <li key={c.id} className="py-2 flex flex-wrap gap-x-4 gap-y-0.5 items-center">
                  <span className="font-semibold w-24">{dataBr(c.dia)}</span>
                  <span className="text-muted flex-1 min-w-[10rem]">{c.aberto_por}{c.fechado_por && c.fechado_por !== c.aberto_por ? ` → ${c.fechado_por}` : ''}{c.obs ? ` · ${c.obs}` : ''}</span>
                  <span className="text-xs font-bold">{c.status === 'aberto' ? <span className="text-amber">Aberto</span> : Number(c.diferenca_total ?? 0) === 0 ? <span className="text-teal">Bateu</span> : <span className="text-danger">{Number(c.diferenca_total) > 0 ? 'Sobrou' : 'Faltou'} {brl(Math.abs(Number(c.diferenca_total)))}</span>}</span>
                </li>
              ))}</ul>
            )}
          </Card>

          {(r.cancelamentos.length > 0 || r.descontos_lista.length > 0) && (
            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <h2 className="font-semibold mb-3 flex items-center gap-2"><XCircle className="w-4 h-4 text-danger" />Cancelamentos</h2>
                {r.cancelamentos.length === 0 ? <Vazio texto="Nenhum." /> : <ul className="divide-y divide-line text-sm">{r.cancelamentos.map((c, i) => <li key={i} className="py-2"><p><span className="font-semibold">{c.crianca}</span> <span className="text-xs text-muted">· {c.por} · {horaMin(c.em)}</span></p><p className="text-muted">{c.motivo}</p></li>)}</ul>}
              </Card>
              <Card>
                <h2 className="font-semibold mb-3 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber" />Descontos dados</h2>
                {r.descontos_lista.length === 0 ? <Vazio texto="Nenhum." /> : <ul className="divide-y divide-line text-sm">{r.descontos_lista.map((c, i) => <li key={i} className="py-2"><p><span className="font-semibold">{c.crianca}</span> · {brl(Number(c.valor))} <span className="text-xs text-muted">· {c.por} · {horaMin(c.em)}</span></p><p className="text-muted">{c.motivo}</p></li>)}</ul>}
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Numero({ icone: Ic, rotulo, valor, dica }: { icone: typeof Wallet; rotulo: string; valor: string; dica?: string }) {
  return (
    <div className="bg-surface border border-line rounded-card p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted flex items-center gap-1.5"><Ic className="w-3.5 h-3.5" />{rotulo}</p>
      <p className="font-display font-bold text-xl mt-1 truncate">{valor}</p>
      {dica && <p className="text-[11px] text-muted mt-0.5">{dica}</p>}
    </div>
  )
}
const Vazio = ({ texto = 'Sem movimento neste período.' }: { texto?: string }) => <p className="text-sm text-muted py-2">{texto}</p>
