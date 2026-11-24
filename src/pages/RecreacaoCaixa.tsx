import { useCallback, useEffect, useState } from 'react'
import { Wallet, LockOpen, Lock, ArrowDownToLine, ArrowUpFromLine, Repeat, History, AlertTriangle, Check, X, Clock, ArrowLeft, Copy, EyeOff, Users } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import { useUnit } from '../lib/UnitContext'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { brl, friendlyDbError } from '../lib/format'
import { FORMAS_REC, horaMin, nomeForma } from '../lib/recreacao'

interface Forma { entradas: number; saidas: number; estornos: number; liquido: number }
interface Situacao {
  aberto: boolean; obrigatorio: boolean
  ultimo?: { id: string; fechado_em: string; fechado_por: string; diferenca_total: number | null } | null
  caixa?: { id: string; dia: string; aberto_em: string; aberto_por: string; fundo: number }
  turno?: { id: string; atendente: string; inicio: string }
  turnos?: { atendente: string; inicio: string; fim: string | null }[]
  de_outro_dia?: boolean; decidir?: boolean; manter_motivo?: string | null
  cego?: boolean; ver_esperado?: boolean
  recebido?: number | null; formas?: Record<string, Forma> | null
  fundo?: number; sangrias?: number; suprimentos?: number; dinheiro_esperado?: number | null
  dentro?: number
  movs?: { tipo: 'sangria' | 'suprimento'; valor: number; motivo: string; em: string; por: string }[]
  lembrete?: { ligado: boolean; hora: string; min: number }
  troca?: boolean; troca_conta?: boolean
}
interface Relatorio {
  caixa: { id: string; unidade: string; dia: string; aberto_em: string; aberto_por: string; fechado_em: string | null; fechado_por: string | null; fundo: number; status: string; obs: string | null; manter_motivo: string | null }
  totais: { formas: Record<string, Forma>; fundo: number; sangrias: number; suprimentos: number; dinheiro_esperado: number; recebido: number }
  esperado: Record<string, number> | null; contado: Record<string, number> | null; diferenca: Record<string, number> | null; diferenca_total: number | null
  turnos: { atendente: string; inicio: string; fim: string | null; contado: number | null; esperado: number | null; diferenca: number | null; recebido: number }[]
  movs: { tipo: string; valor: number; motivo: string; em: string; por: string }[]
  resumo: { entradas: number; saidas: number; cancelamentos: number; descontos: number; itens: number; ocorrencias: number; ainda_dentro: number }
}
interface Hist { id: string; dia: string; aberto_em: string; aberto_por: string; fechado_em: string | null; fechado_por: string | null; status: string; fundo: number; diferenca_total: number | null; obs: string | null; recebido: number }

const num = (s: string) => { const n = Number(s.replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : NaN }
const dataBr = (d: string) => d.split('-').reverse().join('/')
const Dif = ({ v }: { v: number | null | undefined }) => v == null ? null : <span className={v === 0 ? 'text-teal' : 'text-danger'}>{v === 0 ? 'Bateu' : `${v > 0 ? 'Sobrou' : 'Faltou'} ${brl(Math.abs(v))}`}</span>

export function RecreacaoCaixa() {
  const { can } = useAuth()
  const { selectedUnit, unitDbIds, units } = useUnit()
  const unidades = units.map((u) => ({ id: unitDbIds[u.id]?.unitId, nome: u.name })).filter((u) => !!u.id) as { id: string; nome: string }[]
  const [escolhida, setEscolhida] = useState<string | null>(null)
  const unitId = (selectedUnit !== 'todas' ? unitDbIds[selectedUnit]?.unitId : null) ?? escolhida ?? (unidades.length === 1 ? unidades[0].id : null)
  const nomeUnidade = unidades.find((u) => u.id === unitId)?.nome ?? ''
  const pode = can('action:recreacao.caixa')

  const [ligada, setLigada] = useState(true)
  const [s, setS] = useState<Situacao | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [agora, setAgora] = useState(Date.now())
  const [tela, setTela] = useState<'caixa' | 'historico'>('caixa')
  const [painel, setPainel] = useState<null | 'mov' | 'troca' | 'fechar' | 'manter'>(null)
  const [rel, setRel] = useState<Relatorio | null>(null)
  const [hist, setHist] = useState<Hist[] | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const [fundo, setFundo] = useState('')
  const [mov, setMov] = useState({ tipo: 'sangria' as 'sangria' | 'suprimento', valor: '', motivo: '' })
  const [troca, setTroca] = useState('')
  const [manter, setManter] = useState('')
  const [contado, setContado] = useState<Record<string, string>>({})
  const [obs, setObs] = useState('')

  useEffect(() => { supabase.rpc('rec_config_get').then(({ data }) => setLigada((data as { ligada?: boolean } | null)?.ligada !== false)) }, [])
  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 30000); return () => clearInterval(t) }, [])

  const carregar = useCallback(async () => {
    if (!unitId) return
    const { data, error } = await supabase.rpc('rec_caixa_atual', { p_unit: unitId })
    if (error) return setErro(friendlyDbError(error.message))
    setErro(null); setS(data as Situacao)
  }, [unitId])
  useEffect(() => { setS(null); setRel(null); setPainel(null); carregar() }, [carregar])
  useEffect(() => { const t = setInterval(carregar, 30000); return () => clearInterval(t) }, [carregar])

  async function chamar(fn: string, args: Record<string, unknown>, ok: string) {
    setOcupado(true)
    const { data, error } = await supabase.rpc(fn, args)
    setOcupado(false)
    if (error) { setErro(friendlyDbError(error.message)); return null }
    setErro(null); setMsg(ok)
    return data
  }

  async function abrir() {
    const v = fundo.trim() === '' ? 0 : num(fundo)
    if (Number.isNaN(v) || v < 0) return setErro('Informe o troco inicial (pode ser zero).')
    const r = await chamar('rec_caixa_abrir', { p_unit: unitId, p_fundo: v }, 'Caixa aberto. Boas vendas!')
    if (r) { setS(r as Situacao); setFundo('') }
  }
  async function lancarMov() {
    const v = num(mov.valor)
    if (!(v > 0)) return setErro('Informe um valor maior que zero.')
    const r = await chamar('rec_caixa_mov', { p_caixa: s!.caixa!.id, p_tipo: mov.tipo, p_valor: v, p_motivo: mov.motivo }, mov.tipo === 'sangria' ? 'Retirada registrada.' : 'Reforço registrado.')
    if (r) { setS(r as Situacao); setPainel(null); setMov({ tipo: 'sangria', valor: '', motivo: '' }) }
  }
  async function trocar() {
    const v = s!.troca_conta ? num(troca) : null
    if (s!.troca_conta && !(v != null && v >= 0)) return setErro('Conte o dinheiro da gaveta e informe o valor.')
    const r = await chamar('rec_caixa_assumir', { p_caixa: s!.caixa!.id, p_contado: v }, 'Você assumiu o caixa.')
    if (r) { setS(r as Situacao); setPainel(null); setTroca('') }
  }
  async function manterAberto() {
    const r = await chamar('rec_caixa_manter', { p_caixa: s!.caixa!.id, p_motivo: manter }, 'Combinado: o caixa continua aberto.')
    if (r) { setS(r as Situacao); setPainel(null); setManter('') }
  }
  async function fechar() {
    const c: Record<string, number> = {}
    for (const [k] of FORMAS_REC) {
      const v = (contado[k] ?? '').trim() === '' ? NaN : num(contado[k])
      if (Number.isNaN(v) || v < 0) return setErro(`Informe quanto foi contado em ${nomeForma(k).toLowerCase()} (pode ser zero).`)
      c[k] = v
    }
    const r = await chamar('rec_caixa_fechar', { p_caixa: s!.caixa!.id, p_contado: c, p_obs: obs }, 'Caixa fechado e lançado no Financeiro.')
    if (r) { setRel(r as Relatorio); setPainel(null); setContado({}); setObs(''); carregar() }
  }
  async function abrirRelatorio(id: string) {
    const { data, error } = await supabase.rpc('rec_caixa_relatorio', { p_caixa: id })
    if (error) return setErro(friendlyDbError(error.message))
    setRel(data as Relatorio)
  }
  async function abrirHistorico() {
    setTela('historico'); setRel(null)
    const { data, error } = await supabase.rpc('rec_caixa_historico', { p_unit: unitId, p_limite: 40 })
    if (error) return setErro(friendlyDbError(error.message))
    setHist((data ?? []) as Hist[])
  }

  if (!ligada) return <Card><p className="text-sm text-muted py-4 text-center">A recreação não está ligada para esta casa.</p></Card>

  // lembrete de fechar: dentro da janela antes do fim do expediente (ou já passou)
  let lembrete: string | null = null
  if (s?.aberto && s.lembrete?.ligado && /^\d\d:\d\d$/.test(s.lembrete.hora ?? '')) {
    const [hh, mm] = s.lembrete.hora.split(':').map(Number)
    const fim = new Date(agora); fim.setHours(hh, mm, 0, 0)
    const faltam = Math.round((fim.getTime() - agora) / 60000)
    if (faltam <= s.lembrete.min && faltam > -180) lembrete = faltam > 0 ? `O expediente termina às ${s.lembrete.hora} (faltam ${faltam} min). Não esqueça de fechar o caixa.` : `O expediente terminou às ${s.lembrete.hora}. Feche o caixa quando encerrar.`
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex flex-wrap items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple to-purple-dark text-white flex items-center justify-center shadow-lg shadow-purple/30 shrink-0"><Wallet className="w-6 h-6" strokeWidth={1.75} /></div>
        <div className="flex-1 min-w-[14rem]">
          <h1 className="text-2xl font-semibold">Caixa da recreação</h1>
          <p className="text-sm text-muted">{nomeUnidade ? `${nomeUnidade}. ` : ''}Tudo o que a recreação recebe passa por aqui e fecha com conferência.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => { setTela('caixa'); setRel(null) }} className={`px-3 h-9 rounded-full text-sm font-semibold border ${tela === 'caixa' ? 'bg-purple text-white border-purple' : 'border-line bg-surface'}`}>Caixa de hoje</button>
          {can('page:recreacao_caixa') && <button type="button" onClick={abrirHistorico} className={`px-3 h-9 rounded-full text-sm font-semibold border inline-flex items-center gap-1.5 ${tela === 'historico' ? 'bg-purple text-white border-purple' : 'border-line bg-surface'}`}><History className="w-4 h-4" />Histórico</button>}
        </div>
      </div>

      {!unitId && (
        <Card>
          <p className="text-sm font-semibold mb-3">De qual unidade é o caixa?</p>
          <div className="flex flex-wrap gap-2">{unidades.map((u) => <Button key={u.id} variant="secondary" onClick={() => setEscolhida(u.id)}>{u.nome}</Button>)}</div>
        </Card>
      )}

      {erro && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5 flex justify-between gap-2"><span>{erro}</span><button onClick={() => setErro(null)} aria-label="Fechar aviso"><X className="w-4 h-4" /></button></div>}
      {msg && <div className="bg-teal-light text-teal text-sm rounded-lg px-4 py-2.5 flex justify-between gap-2"><span className="flex items-center gap-2"><Check className="w-4 h-4" />{msg}</span><button onClick={() => setMsg(null)} aria-label="Fechar aviso"><X className="w-4 h-4" /></button></div>}

      {rel ? <RelatorioView r={rel} onVoltar={() => setRel(null)} />
        : tela === 'historico' ? (
          <Card>
            <h2 className="text-lg font-semibold mb-3">Caixas anteriores</h2>
            {!hist ? <p className="text-sm text-muted py-4 text-center">Carregando...</p> : hist.length === 0 ? <p className="text-sm text-muted py-4 text-center">Nenhum caixa ainda.</p> : (
              <ul className="divide-y divide-line">
                {hist.map((h) => (
                  <li key={h.id}>
                    <button type="button" onClick={() => abrirRelatorio(h.id)} className="w-full text-left py-3 flex flex-wrap items-center gap-x-4 gap-y-1 hover:bg-bg/60 px-1 rounded-lg">
                      <span className="font-semibold w-24">{dataBr(h.dia)}</span>
                      <span className="text-sm text-muted flex-1 min-w-[10rem]">{h.aberto_por} · {horaMin(h.aberto_em)}{h.fechado_em ? ` até ${horaMin(h.fechado_em)}` : ' · aberto'}</span>
                      <span className="text-sm font-semibold">{brl(Number(h.recebido))}</span>
                      <span className="text-xs font-bold w-28 text-right">{h.status === 'aberto' ? <span className="text-amber">Aberto</span> : <Dif v={h.diferenca_total == null ? null : Number(h.diferenca_total)} />}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : !unitId ? null : !s ? <Card><p className="text-sm text-muted text-center py-6">Carregando...</p></Card> : !s.aberto ? (
          <Card>
            <div className="text-center py-4 max-w-sm mx-auto">
              <div className="w-14 h-14 rounded-2xl bg-purple-light text-purple flex items-center justify-center mx-auto mb-3"><Lock className="w-7 h-7" strokeWidth={1.75} /></div>
              <h2 className="text-xl font-semibold">O caixa está fechado</h2>
              <p className="text-sm text-muted mt-1">{s.obrigatorio ? 'Para dar entrada nas crianças, abra o caixa primeiro.' : 'Abra o caixa para controlar o dinheiro do dia.'}</p>
              {s.ultimo && <p className="text-xs text-muted mt-2">Último fechamento: {horaMin(s.ultimo.fechado_em)} de {new Date(s.ultimo.fechado_em).toLocaleDateString('pt-BR')}, por {s.ultimo.fechado_por}.</p>}
              {pode ? (
                <div className="mt-5 text-left">
                  <label className="text-sm font-semibold" htmlFor="fundo">Troco inicial na gaveta</label>
                  <div className="flex gap-2 mt-1.5">
                    <input id="fundo" className="campo !py-3 !text-base flex-1" inputMode="decimal" placeholder="R$ 0,00" value={fundo} onChange={(e) => setFundo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && abrir()} />
                    <Button onClick={abrir} disabled={ocupado} className="!px-5"><LockOpen className="w-4 h-4" />Abrir caixa</Button>
                  </div>
                  <p className="text-xs text-muted mt-1.5">Conte as notas e moedas da gaveta antes de abrir.</p>
                </div>
              ) : <p className="text-sm text-muted mt-4">Peça para quem tem acesso ao caixa abrir.</p>}
            </div>
          </Card>
        ) : (
          <>
            {s.decidir && (
              <div className="rounded-card border-2 border-amber bg-amber-light p-4 space-y-3">
                <p className="font-semibold text-amber flex items-center gap-2"><AlertTriangle className="w-5 h-5" />Este caixa foi aberto em {dataBr(s.caixa!.dia)} e continua aberto.</p>
                <p className="text-sm text-ink">Quer fechar agora ou manter aberto? Se mantiver, escreva o motivo.</p>
                {painel === 'manter' ? (
                  <div className="flex flex-wrap gap-2">
                    <input className="campo flex-1 min-w-[14rem]" placeholder="Motivo (ex.: festa que vai até tarde)" value={manter} onChange={(e) => setManter(e.target.value)} aria-label="Motivo para manter o caixa aberto" />
                    <Button onClick={manterAberto} disabled={ocupado || manter.trim().length < 3}>Manter aberto</Button>
                    <Button variant="secondary" onClick={() => setPainel(null)}>Voltar</Button>
                  </div>
                ) : pode && <div className="flex gap-2"><Button onClick={() => setPainel('fechar')}><Lock className="w-4 h-4" />Fechar agora</Button><Button variant="secondary" onClick={() => setPainel('manter')}>Manter aberto</Button></div>}
              </div>
            )}
            {s.de_outro_dia && !s.decidir && s.manter_motivo && <div className="text-sm rounded-lg bg-amber-light text-amber px-4 py-2.5 font-semibold">Caixa de {dataBr(s.caixa!.dia)} mantido aberto: {s.manter_motivo}</div>}
            {lembrete && <div className="text-sm rounded-lg bg-amber-light text-amber px-4 py-2.5 font-semibold flex items-center gap-2"><Clock className="w-4 h-4 shrink-0" />{lembrete}</div>}

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Cartao rotulo="Aberto por" valor={s.caixa!.aberto_por} dica={`às ${horaMin(s.caixa!.aberto_em)} · troco ${brl(Number(s.caixa!.fundo))}`} />
              <Cartao rotulo="Atendente agora" valor={s.turno!.atendente} dica={`desde ${horaMin(s.turno!.inicio)}${(s.turnos?.length ?? 1) > 1 ? ` · ${s.turnos!.length} turnos` : ''}`} />
              <Cartao rotulo="Recebido no dia" valor={s.ver_esperado ? brl(Number(s.recebido ?? 0)) : '•••'} dica={s.ver_esperado ? 'entradas + saídas − estornos' : 'escondido até contar'} oculto={!s.ver_esperado} />
              <Cartao rotulo="Dinheiro esperado" valor={s.ver_esperado ? brl(Number(s.dinheiro_esperado ?? 0)) : '•••'} dica={s.ver_esperado ? 'troco + dinheiro − retiradas' : 'fechamento cego'} oculto={!s.ver_esperado} />
            </div>
            {(s.dentro ?? 0) > 0 && <p className="text-xs text-muted flex items-center gap-1.5"><Users className="w-3.5 h-3.5" />{s.dentro} criança{s.dentro! > 1 ? 's' : ''} ainda na recreação. Quem sair depois do fechamento precisa de um caixa aberto para pagar.</p>}

            {pode && painel === null && (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => { setMov({ tipo: 'sangria', valor: '', motivo: '' }); setPainel('mov') }}><ArrowUpFromLine className="w-4 h-4" />Retirada ou reforço</Button>
                {s.troca && <Button variant="secondary" onClick={() => setPainel('troca')}><Repeat className="w-4 h-4" />Trocar de atendente</Button>}
                <Button onClick={() => setPainel('fechar')}><Lock className="w-4 h-4" />Fechar o caixa</Button>
              </div>
            )}

            {painel === 'mov' && (
              <Card>
                <h2 className="font-semibold mb-3">Retirada ou reforço de dinheiro</h2>
                <div className="flex gap-2 mb-3">
                  {([['sangria', 'Retirada (sangria)', ArrowUpFromLine], ['suprimento', 'Reforço de troco', ArrowDownToLine]] as const).map(([k, l, Ic]) => (
                    <button key={k} type="button" onClick={() => setMov({ ...mov, tipo: k })} className={`flex-1 h-11 rounded-xl border-2 text-sm font-semibold inline-flex items-center justify-center gap-2 ${mov.tipo === k ? 'border-purple bg-purple-light text-purple' : 'border-line'}`}><Ic className="w-4 h-4" />{l}</button>
                  ))}
                </div>
                <div className="grid sm:grid-cols-[10rem_1fr] gap-2">
                  <input className="campo !py-2.5" inputMode="decimal" placeholder="Valor R$" value={mov.valor} onChange={(e) => setMov({ ...mov, valor: e.target.value })} aria-label="Valor" autoFocus />
                  <input className="campo !py-2.5" placeholder={mov.tipo === 'sangria' ? 'Para onde foi o dinheiro?' : 'De onde veio o troco?'} value={mov.motivo} onChange={(e) => setMov({ ...mov, motivo: e.target.value })} aria-label="Motivo" />
                </div>
                <div className="flex gap-2 mt-3"><Button onClick={lancarMov} disabled={ocupado || mov.motivo.trim().length < 3}>Registrar</Button><Button variant="secondary" onClick={() => setPainel(null)}>Cancelar</Button></div>
              </Card>
            )}

            {painel === 'troca' && (
              <Card>
                <h2 className="font-semibold">Trocar de atendente</h2>
                <p className="text-sm text-muted mt-1 mb-3">O caixa continua aberto. Você assume como atendente e o que entrar daqui para a frente fica no seu turno.</p>
                {s.troca_conta && (
                  <>
                    <label className="text-sm font-semibold" htmlFor="troca">Conte o dinheiro da gaveta agora</label>
                    <input id="troca" className="campo !py-3 !text-base mt-1.5 max-w-xs" inputMode="decimal" placeholder="R$ 0,00" value={troca} onChange={(e) => setTroca(e.target.value)} autoFocus />
                    <p className="text-xs text-muted mt-1.5">A diferença, se houver, fica registrada no turno de quem saiu.</p>
                  </>
                )}
                <div className="flex gap-2 mt-3"><Button onClick={trocar} disabled={ocupado}><Repeat className="w-4 h-4" />Assumir o caixa</Button><Button variant="secondary" onClick={() => setPainel(null)}>Cancelar</Button></div>
              </Card>
            )}

            {painel === 'fechar' && (
              <Card>
                <h2 className="text-lg font-semibold">Fechar o caixa</h2>
                <p className="text-sm text-muted mt-1 mb-4">
                  {s.cego && !s.ver_esperado ? 'Conte o dinheiro da gaveta e confira os totais da maquininha e do Pix. O valor esperado só aparece depois de fechar.' : 'Informe quanto foi contado em cada forma de pagamento.'}
                </p>
                <div className="grid sm:grid-cols-2 gap-3">
                  {FORMAS_REC.slice().sort((a, b) => (a[0] === 'dinheiro' ? -1 : b[0] === 'dinheiro' ? 1 : 0)).map(([k, l]) => (
                    <div key={k}>
                      <label className="text-sm font-semibold" htmlFor={`c-${k}`}>{k === 'dinheiro' ? 'Dinheiro na gaveta (com o troco)' : `${l} — total do dia`}</label>
                      <input id={`c-${k}`} className="campo !py-3 !text-base mt-1.5" inputMode="decimal" placeholder="R$ 0,00" value={contado[k] ?? ''} onChange={(e) => setContado({ ...contado, [k]: e.target.value })} />
                      {s.ver_esperado && <p className="text-[11px] text-muted mt-1">Esperado: {brl(k === 'dinheiro' ? Number(s.dinheiro_esperado ?? 0) : Number(s.formas?.[k]?.liquido ?? 0))}</p>}
                    </div>
                  ))}
                </div>
                <div className="mt-4">
                  <label className="text-sm font-semibold" htmlFor="obs">Observações (obrigatório se houver diferença)</label>
                  <textarea id="obs" className="campo mt-1.5 min-h-[4.5rem]" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: faltou troco do cliente das 15h" />
                </div>
                {(s.dentro ?? 0) > 0 && <p className="text-sm text-amber font-semibold mt-3"><AlertTriangle className="w-4 h-4 inline -mt-0.5 mr-1" />Ainda há {s.dentro} criança{s.dentro! > 1 ? 's' : ''} na recreação. Quem sair depois precisará de um novo caixa aberto para pagar.</p>}
                <div className="flex gap-2 mt-4"><Button onClick={fechar} disabled={ocupado}><Lock className="w-4 h-4" />Fechar caixa</Button><Button variant="secondary" onClick={() => setPainel(null)}>Voltar</Button></div>
              </Card>
            )}

            {s.ver_esperado && s.formas && (
              <Card>
                <h2 className="font-semibold mb-3">Por forma de pagamento</h2>
                {Object.keys(s.formas).length === 0 ? <p className="text-sm text-muted">Ainda não entrou nenhum pagamento.</p> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="text-left text-xs text-muted"><th className="py-1.5 font-semibold">Forma</th><th className="font-semibold text-right">Entradas</th><th className="font-semibold text-right">Saídas</th><th className="font-semibold text-right">Estornos</th><th className="font-semibold text-right">Total</th></tr></thead>
                      <tbody>{Object.entries(s.formas).map(([k, f]) => (
                        <tr key={k} className="border-t border-line"><td className="py-2 font-semibold">{nomeForma(k)}</td><td className="text-right">{brl(Number(f.entradas))}</td><td className="text-right">{brl(Number(f.saidas))}</td><td className="text-right">{Number(f.estornos) ? brl(Number(f.estornos)) : '—'}</td><td className="text-right font-bold">{brl(Number(f.liquido))}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </Card>
            )}
            {!s.ver_esperado && <p className="text-xs text-muted flex items-center gap-1.5"><EyeOff className="w-3.5 h-3.5" />Fechamento cego ligado: os totais ficam escondidos até a contagem, para a conferência valer.</p>}

            {(s.movs?.length ?? 0) > 0 && (
              <Card>
                <h2 className="font-semibold mb-2">Retiradas e reforços de hoje</h2>
                <ul className="divide-y divide-line text-sm">{s.movs!.map((m, i) => (
                  <li key={i} className="py-2 flex flex-wrap gap-x-3 gap-y-0.5 items-center">
                    <span className={`font-bold ${m.tipo === 'sangria' ? 'text-danger' : 'text-teal'}`}>{m.tipo === 'sangria' ? '−' : '+'} {brl(Number(m.valor))}</span>
                    <span className="flex-1 min-w-[8rem]">{m.motivo}</span>
                    <span className="text-xs text-muted">{m.por} · {horaMin(m.em)}</span>
                  </li>
                ))}</ul>
              </Card>
            )}
          </>
        )}
    </div>
  )
}

function Cartao({ rotulo, valor, dica, oculto }: { rotulo: string; valor: string; dica?: string; oculto?: boolean }) {
  return (
    <div className="bg-surface border border-line rounded-card p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted">{rotulo}</p>
      <p className={`font-display font-bold text-xl mt-1 truncate ${oculto ? 'text-muted' : ''}`}>{valor}</p>
      {dica && <p className="text-[11px] text-muted mt-0.5">{dica}</p>}
    </div>
  )
}

function RelatorioView({ r, onVoltar }: { r: Relatorio; onVoltar: () => void }) {
  const fechado = r.caixa.status === 'fechado'
  const formas = Object.entries(r.totais.formas)
  const todas = Array.from(new Set(['dinheiro', ...formas.map(([k]) => k)]))
  const texto = () => [
    `Fechamento do caixa — ${r.caixa.unidade}, ${dataBr(r.caixa.dia)}`,
    `Aberto por ${r.caixa.aberto_por} às ${horaMin(r.caixa.aberto_em)}${r.caixa.fechado_em ? ` · fechado por ${r.caixa.fechado_por} às ${horaMin(r.caixa.fechado_em)}` : ''}`,
    `Recebido: ${brl(Number(r.totais.recebido))}`,
    ...todas.map((k) => `${nomeForma(k)}: esperado ${brl(Number(r.esperado?.[k] ?? 0))} · contado ${brl(Number(r.contado?.[k] ?? 0))}${r.diferenca?.[k] ? ` (${Number(r.diferenca[k]) > 0 ? 'sobrou' : 'faltou'} ${brl(Math.abs(Number(r.diferenca[k])))})` : ''}`),
    `Crianças: ${r.resumo.entradas} entradas, ${r.resumo.saidas} saídas, ${r.resumo.cancelamentos} cancelamentos, ${r.resumo.ocorrencias} ocorrências`,
    r.caixa.obs ? `Obs.: ${r.caixa.obs}` : '',
  ].filter(Boolean).join('\n')
  return (
    <div className="space-y-4">
      <button type="button" onClick={onVoltar} className="text-sm text-muted hover:text-purple inline-flex items-center gap-1"><ArrowLeft className="w-4 h-4" />Voltar</button>
      <Card>
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-[12rem]">
            <h2 className="text-xl font-semibold">{fechado ? 'Relatório do expediente' : 'Caixa em andamento'}</h2>
            <p className="text-sm text-muted">{r.caixa.unidade} · {dataBr(r.caixa.dia)} · aberto por {r.caixa.aberto_por} às {horaMin(r.caixa.aberto_em)}{r.caixa.fechado_em ? ` · fechado por ${r.caixa.fechado_por} às ${horaMin(r.caixa.fechado_em)}` : ''}</p>
          </div>
          {fechado && r.diferenca_total != null && <span className="text-sm font-bold rounded-full px-3 py-1 bg-bg border border-line"><Dif v={Number(r.diferenca_total)} /></span>}
          <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(texto())}><Copy className="w-4 h-4" />Copiar resumo</Button>
        </div>
        {r.caixa.obs && <p className="mt-3 text-sm rounded-lg bg-amber-light text-amber px-3 py-2"><strong>Observação:</strong> {r.caixa.obs}</p>}
        {r.caixa.manter_motivo && <p className="mt-2 text-xs text-muted">Ficou aberto de um dia para o outro: {r.caixa.manter_motivo}</p>}

        <div className="overflow-x-auto mt-4">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted"><th className="py-1.5 font-semibold">Forma</th><th className="font-semibold text-right">Esperado</th><th className="font-semibold text-right">Contado</th><th className="font-semibold text-right">Diferença</th></tr></thead>
            <tbody>{todas.map((k) => (
              <tr key={k} className="border-t border-line"><td className="py-2 font-semibold">{nomeForma(k)}</td>
                <td className="text-right">{brl(Number(r.esperado?.[k] ?? (k === 'dinheiro' ? r.totais.dinheiro_esperado : r.totais.formas[k]?.liquido ?? 0)))}</td>
                <td className="text-right">{r.contado ? brl(Number(r.contado[k] ?? 0)) : '—'}</td>
                <td className="text-right font-semibold">{r.diferenca ? <Dif v={Number(r.diferenca[k] ?? 0)} /> : '—'}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <p className="text-xs text-muted mt-2">Dinheiro esperado = troco {brl(Number(r.totais.fundo))} + dinheiro recebido{Number(r.totais.suprimentos) ? ` + reforços ${brl(Number(r.totais.suprimentos))}` : ''}{Number(r.totais.sangrias) ? ` − retiradas ${brl(Number(r.totais.sangrias))}` : ''}.</p>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Cartao rotulo="Recebido" valor={brl(Number(r.totais.recebido))} />
        <Cartao rotulo="Entradas" valor={String(r.resumo.entradas)} dica={`${r.resumo.saidas} saídas`} />
        <Cartao rotulo="Cancelamentos" valor={String(r.resumo.cancelamentos)} dica={Number(r.resumo.descontos) ? `descontos ${brl(Number(r.resumo.descontos))}` : 'sem descontos'} />
        <Cartao rotulo="Ocorrências" valor={String(r.resumo.ocorrencias)} dica={r.resumo.ainda_dentro ? `${r.resumo.ainda_dentro} ainda dentro` : 'ninguém dentro'} />
      </div>

      {r.turnos.length > 0 && (
        <Card>
          <h3 className="font-semibold mb-2">Turnos</h3>
          <ul className="divide-y divide-line text-sm">{r.turnos.map((t, i) => (
            <li key={i} className="py-2 flex flex-wrap gap-x-4 gap-y-0.5 items-center">
              <span className="font-semibold w-32">{t.atendente}</span>
              <span className="text-muted flex-1 min-w-[8rem]">{horaMin(t.inicio)}{t.fim ? ` até ${horaMin(t.fim)}` : ' · em andamento'}</span>
              <span>recebeu {brl(Number(t.recebido))}</span>
              {t.diferenca != null && <span className="text-xs font-bold"><Dif v={Number(t.diferenca)} /></span>}
            </li>
          ))}</ul>
        </Card>
      )}
      {r.movs.length > 0 && (
        <Card>
          <h3 className="font-semibold mb-2">Retiradas e reforços</h3>
          <ul className="divide-y divide-line text-sm">{r.movs.map((m, i) => (
            <li key={i} className="py-2 flex flex-wrap gap-x-3"><span className={`font-bold ${m.tipo === 'sangria' ? 'text-danger' : 'text-teal'}`}>{m.tipo === 'sangria' ? '−' : '+'} {brl(Number(m.valor))}</span><span className="flex-1">{m.motivo}</span><span className="text-xs text-muted">{m.por} · {horaMin(m.em)}</span></li>
          ))}</ul>
        </Card>
      )}
    </div>
  )
}
