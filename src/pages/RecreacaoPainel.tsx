import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { filaEnviar, filaLer, filaSalvar, ehErroDeRede, type ItemFila } from '../lib/recOffline'
import { WifiOff, Wallet, Timer, LogIn, KeyRound, AlertTriangle, Pause, Play, Clock, MessageCircle, LogOut, Plus, X, Check, MoreHorizontal, Search, Users, MapPin, Hourglass, ScanLine, Send } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import { useUnit } from '../lib/UnitContext'
import { useCompany } from '../lib/CompanyContext'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { EntradaRec } from '../components/recreacao/EntradaRec'
import { ReenviarLink } from '../components/recreacao/ReenviarLink'
import { SaidaRec } from '../components/recreacao/SaidaRec'
import { LeitorQr, podeLerQr } from '../components/recreacao/QrRec'
import { brl, friendlyDbError } from '../lib/format'
import { limparFotosVencidas, cronometro, fmtMin, horaMin, idadeTexto, linkWhatsApp, tokenDoTexto, type FuncoesRec, type VisitaRec } from '../lib/recreacao'

interface Config { ligada: boolean; funcoes: FuncoesRec; regras: Record<string, string | number>; termo: string }
type Estado = { cor: 'vd' | 'am' | 'vm' | 'cz'; etiqueta: string; info: string; valor: number }
type Acao = { tipo: 'pausa' | 'estender' | 'ocorrencia' | 'cancelar' | 'avisar' | 'reenviar'; v: VisitaRec } | null

const COR = {
  vd: { borda: 'border-line', chip: 'bg-teal-light text-teal', rel: 'text-ink' },
  am: { borda: 'border-amber', chip: 'bg-amber-light text-amber', rel: 'text-amber' },
  vm: { borda: 'border-danger', chip: 'bg-danger-light text-danger', rel: 'text-danger' },
  cz: { borda: 'border-line', chip: 'bg-line/60 text-muted', rel: 'text-muted' },
}

export function RecreacaoPainel() {
  const { can } = useAuth()
  const { brand } = useCompany()
  const { selectedUnit, unitDbIds, units } = useUnit()
  const [cfg, setCfg] = useState<Config | null>(null)
  const [lista, setLista] = useState<VisitaRec[] | null>(null)
  const [buscadoEm, setBuscadoEm] = useState(Date.now())
  const [agora, setAgora] = useState(Date.now())
  const [fotos, setFotos] = useState<Record<string, string>>({})
  const [filtro, setFiltro] = useState<'todos' | 'am' | 'vm' | 'cuidado' | 'chegando'>('todos')
  const [lendo, setLendo] = useState(false)
  const [busca, setBusca] = useState('')
  const [painel, setPainel] = useState<null | { tipo: 'entrada' } | { tipo: 'saida'; visitas: string[]; marcadas: string[]; codigo?: string }>(null)
  const [acao, setAcao] = useState<Acao>(null)
  const [texto, setTexto] = useState({ a: '', b: '', c: 'Queda ou machucado leve' })
  // cada ação começa com o texto em branco (o motivo de uma criança não passa para outra)
  const abrir = (a: Acao) => { setTexto({ a: '', b: '', c: 'Queda ou machucado leve' }); setAcao(a) }
  const [codigo, setCodigo] = useState('')
  const codigoOk = /^\d{4}$/.test(codigo) || !!tokenDoTexto(codigo)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const pedindo = useRef(false)

  const emp = brand.companyId ?? ''
  const usaOffline = cfg?.funcoes.offline === true && !!emp
  const [semNet, setSemNet] = useState(false)
  const [fila, setFila] = useState<ItemFila[]>([])
  const unitId = selectedUnit === 'todas' ? null : unitDbIds[selectedUnit]?.unitId ?? null
  const unidades = units.map((u) => ({ id: unitDbIds[u.id]?.unitId, nome: u.name })).filter((u) => !!u.id) as { id: string; nome: string }[]
  const pode = can('action:recreacao.operar')
  const aviso = Number(cfg?.regras.aviso ?? 10)
  const lotacao = Number(cfg?.regras.lotacao ?? 40)

  useEffect(() => { supabase.rpc('rec_config_get').then(({ data, error }) => (error ? setErro(friendlyDbError(error.message)) : setCfg(data as Config))) }, [])

  const carregar = useCallback(async () => {
    if (pedindo.current) return
    pedindo.current = true
    const { data, error } = await supabase.rpc('rec_painel', { p_unit: unitId })
    pedindo.current = false
    if (error) {
      // sem sinal: o painel continua na tela com os últimos dados (os cronômetros seguem andando)
      if (ehErroDeRede(error.message) && usaOffline) { setSemNet(true); return }
      return setErro(friendlyDbError(error.message))
    }
    setSemNet(false); setErro(null)
    const l = (data ?? []) as VisitaRec[]
    setLista(l); setBuscadoEm(Date.now())
    const faltam = l.filter((v) => v.crianca.foto_path && !fotos[v.crianca.foto_path])
    if (faltam.length) {
      const { data: urls } = await supabase.storage.from('recreacao-fotos').createSignedUrls(faltam.map((v) => v.crianca.foto_path!), 3600)
      if (urls) setFotos((f) => ({ ...f, ...Object.fromEntries(faltam.map((v, i) => [v.crianca.foto_path!, urls[i]?.signedUrl ?? ''])) }))
    }
  }, [unitId, usaOffline]) // eslint-disable-line react-hooks/exhaustive-deps

  // fila de entradas feitas sem internet: some da tela quando o servidor aceita
  const sincronizar = useCallback(async () => {
    if (!usaOffline || !filaLer(emp).length) return
    const r = await filaEnviar(emp)
    if (r.enviadas) { setMsg({ ok: true, texto: `${r.enviadas} entrada${r.enviadas > 1 ? 's' : ''} feita${r.enviadas > 1 ? 's' : ''} sem internet ${r.enviadas > 1 ? 'foram enviadas' : 'foi enviada'}.` }); carregar() }
    if (r.semRede) setSemNet(true)
  }, [emp, usaOffline, carregar])
  useEffect(() => {
    if (!usaOffline) return
    const ler = () => setFila(filaLer(emp))
    ler(); sincronizar()
    const on = () => { setSemNet(false); sincronizar(); carregar() }, off = () => setSemNet(true)
    window.addEventListener('rec-fila', ler); window.addEventListener('online', on); window.addEventListener('offline', off)
    const t = setInterval(sincronizar, 20000)
    return () => { window.removeEventListener('rec-fila', ler); window.removeEventListener('online', on); window.removeEventListener('offline', off); clearInterval(t) }
  }, [usaOffline, emp, sincronizar]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { carregar(); const t = setInterval(carregar, 15000); return () => clearInterval(t) }, [carregar])

  // apaga as fotos de entrada que passaram do prazo da casa (uma vez ao abrir o painel)
  useEffect(() => {
    if (!pode || cfg?.funcoes.foto !== 'entrada') return
    limparFotosVencidas().catch(() => {})
  }, [pode, cfg?.funcoes.foto]) // eslint-disable-line react-hooks/exhaustive-deps

  // situação do caixa da unidade (avisa quando está fechado ou esquecido de ontem)
  const [caixa, setCaixa] = useState<{ aberto: boolean; obrigatorio: boolean; decidir?: boolean } | null>(null)
  useEffect(() => {
    if (!unitId || !can('page:recreacao_caixa')) { setCaixa(null); return }
    const ler = () => supabase.rpc('rec_caixa_atual', { p_unit: unitId }).then(({ data }) => setCaixa((data as typeof caixa) ?? null))
    ler(); const t = setInterval(ler, 30000); return () => clearInterval(t)
  }, [unitId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 1000); return () => clearInterval(t) }, [])

  // tempo andando entre uma busca e outra (pausado não anda)
  const passou = (agora - buscadoEm) / 1000
  const segTotal = (v: VisitaRec) => v.seg_total + passou
  const segCob = (v: VisitaRec) => (v.pausa ? v.seg_cobrado : v.seg_cobrado + passou)
  // virou o valor: busca de novo para trazer a conta certa do banco
  useEffect(() => { if (lista?.some((v) => v.proxima && !v.pausa && segCob(v) >= v.proxima.em)) carregar() }, [agora]) // eslint-disable-line react-hooks/exhaustive-deps

  function estado(v: VisitaRec): Estado {
    const s = segCob(v), p = v.plano
    const valor = v.proxima && s >= v.proxima.em ? v.proxima.total : Number(v.conta.total)
    if (v.pausa) return { cor: 'cz', etiqueta: 'Pausado', info: `Tempo parado: ${v.pausa.motivo.toLowerCase()}`, valor }
    if (p.limite && segTotal(v) / 60 > p.limite) return { cor: 'vm', etiqueta: 'Passou do limite', info: `Limite do plano: ${fmtMin(p.limite)}`, valor }
    if (p.cobranca === 'entrada') {
      if (p.incl == null) return { cor: 'vd', etiqueta: 'Sem limite', info: 'Livre até o fechamento', valor }
      const resto = (p.incl + v.extensao_min) * 60 - s
      const aMais = valor - Number(p.valor ?? 0)
      if (resto > 0) {
        const perto = resto <= aviso * 60
        return { cor: perto ? 'am' : 'vd', etiqueta: perto ? 'Acabando' : v.extensao_min ? 'Estendido' : 'No tempo', info: `Faltam ${fmtMin(Math.ceil(resto / 60))} · até ${horaMin(agora + resto * 1000)}${aMais > 0 ? ` · a mais ${brl(aMais)}` : ''}`, valor }
      }
      const tol = (p.incl + (p.tolIncl ?? 0)) * 60 - s
      if (aMais <= 0 && tol > 0) return { cor: 'am', etiqueta: 'Na tolerância', info: `Mais ${fmtMin(Math.ceil(tol / 60))} sem cobrar a mais`, valor }
      return { cor: 'vm', etiqueta: 'Excedente', info: `A mais até agora: ${brl(aMais)}${v.proxima ? ` · ${brl(v.proxima.total - Number(p.valor ?? 0))} às ${horaMin(agora + (v.proxima.em - s) * 1000)}` : ''}`, valor }
    }
    const prox = v.proxima && v.proxima.em > s ? v.proxima : null
    if (prox && prox.em - s <= aviso * 60) return { cor: 'am', etiqueta: 'Vai mudar', info: `${brl(valor)} agora · ${brl(prox.total)} às ${horaMin(agora + (prox.em - s) * 1000)}`, valor }
    return { cor: 'vd', etiqueta: 'Paga na saída', info: `Até agora ${brl(valor)}${prox ? ` · ${brl(prox.total)} às ${horaMin(agora + (prox.em - s) * 1000)}` : ''}`, valor }
  }

  const estados = useMemo(() => Object.fromEntries((lista ?? []).map((v) => [v.id, estado(v)])), [lista, agora]) // eslint-disable-line react-hooks/exhaustive-deps
  const visiveis = (lista ?? []).filter((v) => {
    const e = estados[v.id]
    if (filtro === 'am' && e?.cor !== 'am') return false
    if (filtro === 'vm' && e?.cor !== 'vm') return false
    if (filtro === 'cuidado' && !v.crianca.cuidados) return false
    if (filtro === 'chegando' && !v.chegando_em) return false
    const t = busca.trim().toLowerCase()
    return !t || v.crianca.nome.toLowerCase().includes(t) || (v.pulseira ?? '') === t || v.familia.responsavel.toLowerCase().includes(t)
  })
  const n = lista?.length ?? 0
  const nAm = Object.values(estados).filter((e) => e.cor === 'am').length
  const nVm = Object.values(estados).filter((e) => e.cor === 'vm').length

  async function rodar(fn: string, args: Record<string, unknown>, ok: string) {
    const { data, error } = await supabase.rpc(fn, args)
    if (error) { setMsg({ ok: false, texto: friendlyDbError(error.message) }); return null }
    setMsg({ ok: true, texto: ok }); setAcao(null); setTexto({ a: '', b: '', c: 'Queda ou machucado leve' }); carregar()
    return data ?? true
  }
  // Vale o código de 4 dígitos digitado, ou o QR (lido pela câmera ou pelo leitor de mesa,
  // que "digita" o link): ler o QR prova que o responsável tem o celular com o link.
  async function porCodigo(texto = codigo) {
    const t = texto.trim()
    const token = tokenDoTexto(t)
    let ids: string[] = [], cod = t
    if (token) {
      const { data, error } = await supabase.rpc('rec_visitas_por_token', { p_token: token })
      if (error) return setMsg({ ok: false, texto: friendlyDbError(error.message) })
      const r = data as { codigo: string | null; visitas: string[] } | null
      ids = r?.visitas ?? []; cod = r?.codigo ?? ''
      if (!ids.length) return setMsg({ ok: false, texto: 'Esse QR não tem ninguém dentro agora (a saída já foi feita ou o link é antigo).' })
    } else {
      const { data, error } = await supabase.rpc('rec_visitas_por_codigo', { p_codigo: t })
      if (error) return setMsg({ ok: false, texto: friendlyDbError(error.message) })
      ids = (data ?? []) as string[]
      if (!ids.length) return setMsg({ ok: false, texto: 'Nenhuma criança dentro com esse código. Confira com o responsável.' })
    }
    setPainel({ tipo: 'saida', visitas: ids, marcadas: ids, codigo: cod }); setCodigo('')
  }
  function abrirSaida(v: VisitaRec) {
    const grupo = (lista ?? []).filter((x) => x.grupo === v.grupo).map((x) => x.id)
    setPainel({ tipo: 'saida', visitas: grupo, marcadas: [v.id] })
  }

  if (cfg && !cfg.ligada) return <Card><p className="text-sm text-muted py-4 text-center">A recreação não está ligada para esta casa.</p></Card>

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple to-purple-dark text-white flex items-center justify-center shadow-lg shadow-purple/30 shrink-0"><Timer className="w-6 h-6" strokeWidth={1.75} /></div>
        <div className="flex-1 min-w-[14rem]">
          <h1 className="text-2xl font-semibold">Recreação agora</h1>
          <p className="text-sm text-muted">O tempo é o do servidor. A conta de cada criança é a mesma que sai na saída.</p>
        </div>
        {pode && (
          <div className="flex flex-wrap gap-2">
            <form onSubmit={(e) => { e.preventDefault(); if (codigoOk) porCodigo() }} className="flex items-center gap-1.5 rounded-xl border border-line bg-surface pl-3 pr-1 h-11">
              <KeyRound className="w-4 h-4 text-muted" />
              {/* aceita os 4 dígitos ou o link do QR (leitor de mesa) */}
              <input className={`w-20 bg-transparent outline-none placeholder:tracking-normal placeholder:font-normal ${/^\d*$/.test(codigo) ? 'font-display font-bold tracking-[0.3em]' : 'text-xs'}`} inputMode="text" maxLength={120} placeholder="Código" value={codigo} onChange={(e) => setCodigo(e.target.value)} aria-label="Código de retirada" />
              <Button type="submit" variant="secondary" className="!py-1.5 !px-3" disabled={!codigoOk}><LogOut className="w-4 h-4" />Saída</Button>
              {cfg?.funcoes.qr !== false && podeLerQr() && <button type="button" onClick={() => setLendo(true)} className="h-8 px-2 gap-1.5 rounded-lg text-purple hover:bg-purple-light flex items-center justify-center text-xs font-bold" aria-label="Ler QR com a câmera" title="Ler QR com a câmera"><ScanLine className="w-4 h-4" />Ler QR</button>}
            </form>
            <Button onClick={() => setPainel({ tipo: 'entrada' })} className="!h-11"><LogIn className="w-4 h-4" />Nova entrada</Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Numero rotulo="Dentro agora" valor={`${n} de ${lotacao}`}><div className="h-2 rounded-full bg-line mt-2 overflow-hidden"><div className="h-full bg-purple rounded-full transition-all" style={{ width: `${Math.min(100, (n / lotacao) * 100)}%` }} /></div></Numero>
        <Numero rotulo="Perto de mudar o valor" valor={String(nAm)} dica={`aviso ${aviso} min antes`} cor={nAm ? 'text-amber' : undefined} />
        <Numero rotulo="Cobrando a mais" valor={String(nVm)} dica="excedente ou limite" cor={nVm ? 'text-danger' : undefined} />
        <Numero rotulo="Com alergia ou cuidado" valor={String((lista ?? []).filter((v) => v.crianca.cuidados).length)} dica="aparecem em vermelho" />
      </div>

      {(semNet || fila.length > 0) && usaOffline && (
        <div className="rounded-card border-2 border-amber bg-amber-light p-4 space-y-2">
          <p className="font-semibold text-amber flex items-center gap-2"><WifiOff className="w-5 h-5 shrink-0" />{semNet ? 'Sem internet.' : 'Entradas aguardando envio.'}</p>
          {semNet && <p className="text-sm text-ink">O painel segue contando o tempo com os últimos dados. Novas entradas ficam guardadas neste aparelho e vão sozinhas quando o sinal voltar. A saída só funciona com internet, porque a conta é a do servidor.</p>}
          {fila.map((i) => (
            <div key={i.local} className="rounded-lg bg-surface/70 px-3 py-2 text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-semibold">{i.nomes.map((n) => n.split(' ')[0]).join(' e ')}</span>
              <span className="text-muted">entrou às {horaMin(i.entrada_em)} · código {i.codigo}</span>
              {i.erro ? <span className="text-danger font-semibold flex-1 min-w-[10rem]">Não foi aceita: {friendlyDbError(i.erro)}</span> : <span className="text-amber font-semibold">aguardando</span>}
              {i.erro && <>
                <button type="button" className="rounded-lg border border-line px-2.5 py-1 font-semibold" onClick={() => { filaSalvar(emp, filaLer(emp).map((x) => (x.local === i.local ? { ...x, erro: undefined } : x))); sincronizar() }}>Tentar de novo</button>
                <button type="button" className="rounded-lg border border-danger/40 text-danger px-2.5 py-1 font-semibold" onClick={() => { if (window.confirm('Descartar esta entrada? Ela não será registrada no sistema. Faça isso só se a criança já foi registrada de outra forma.')) filaSalvar(emp, filaLer(emp).filter((x) => x.local !== i.local)) }}>Descartar</button>
              </>}
            </div>
          ))}
        </div>
      )}
      {caixa && (!caixa.aberto || caixa.decidir) && (caixa.obrigatorio || caixa.decidir) && (
        <Link to="/recreacao/caixa" className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold ${caixa.aberto ? 'bg-amber-light text-amber' : 'bg-danger-light text-danger'}`}>
          <Wallet className="w-4 h-4 shrink-0" />
          {caixa.aberto ? 'O caixa de um dia anterior continua aberto. Toque para fechar ou manter aberto.' : 'O caixa está fechado. Toque para abrir antes de dar entrada.'}
        </Link>
      )}
      {erro && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5">{erro}</div>}
      {msg && <div className={`text-sm rounded-lg px-4 py-2.5 flex justify-between gap-2 ${msg.ok ? 'bg-teal-light text-teal' : 'bg-danger-light text-danger'}`}>{msg.texto}<button onClick={() => setMsg(null)} aria-label="Fechar aviso"><X className="w-4 h-4" /></button></div>}

      {acao?.tipo === 'reenviar' && cfg && <ReenviarLink key={acao.v.id} v={acao.v} funcoes={cfg.funcoes} regras={cfg.regras} nomeCasa={brand.name || 'Recreação'} fechar={() => setAcao(null)} />}
      {acao && acao.tipo !== 'reenviar' && <PainelAcao acao={acao} texto={texto} setTexto={setTexto} cfg={cfg} rodar={rodar} fechar={() => setAcao(null)} />}

      <div className="flex flex-wrap items-center gap-2">
        {([['todos', 'Todos'], ['am', 'Perto de mudar'], ['vm', 'Cobrando a mais'], ['cuidado', 'Alergia ou cuidado'], ...((lista ?? []).some((v) => v.chegando_em) ? [['chegando', `Chegando (${(lista ?? []).filter((v) => v.chegando_em).length})`]] : [])] as [typeof filtro, string][]).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setFiltro(k)} className={`px-3 h-8 rounded-full text-sm font-semibold border ${filtro === k ? 'bg-purple text-white border-purple' : 'border-line bg-surface'}`}>{l}</button>
        ))}
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input className="campo !pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Criança, responsável ou pulseira" aria-label="Procurar" />
        </div>
      </div>

      {!lista ? <Card><p className="text-sm text-muted text-center py-6">Carregando...</p></Card> : visiveis.length === 0 ? (
        <Card><div className="text-center py-8"><Users className="w-8 h-8 mx-auto text-purple/40 mb-2" strokeWidth={1.5} /><p className="text-sm text-muted">{n ? 'Ninguém com esse filtro.' : 'Nenhuma criança na recreação agora.'}</p>{pode && !n && <Button className="mt-3" onClick={() => setPainel({ tipo: 'entrada' })}><LogIn className="w-4 h-4" />Dar a primeira entrada</Button>}</div></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visiveis.map((v) => {
            const e = estados[v.id], c = COR[e.cor]
            const foto = v.crianca.foto_path ? fotos[v.crianca.foto_path] : null
            return (
              <article key={v.id} className={`bg-surface rounded-card border-2 ${c.borda} p-4 flex flex-col gap-2 transition-colors`}>
                <div className="flex items-start gap-3">
                  {foto ? <img src={foto} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0" /> : <span className="w-12 h-12 rounded-xl bg-purple-light text-purple font-bold flex items-center justify-center shrink-0">{v.crianca.nome.charAt(0)}</span>}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold leading-tight truncate">{v.crianca.nome}</p>
                    <p className="text-xs text-muted truncate">{idadeTexto(v.crianca.nascimento)} · {v.familia.responsavel}</p>
                  </div>
                  {v.pulseira && <span className="text-xs font-bold rounded-lg bg-purple-light text-purple px-2 py-1 whitespace-nowrap">nº {v.pulseira}</span>}
                </div>
                {v.crianca.cuidados && <p className="text-xs font-bold text-danger bg-danger-light rounded-lg px-2 py-1"><AlertTriangle className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />{v.crianca.cuidados}</p>}
                {v.ocorrencias.length > 0 && <p className="text-xs font-semibold text-amber">{v.ocorrencias.length} ocorrência{v.ocorrencias.length > 1 ? 's' : ''}: {v.ocorrencias[v.ocorrencias.length - 1].tipo.toLowerCase()}</p>}
                {v.chegando_em && <p className="text-xs font-bold text-teal bg-teal-light rounded-lg px-2 py-1"><MapPin className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />Responsável chegando para buscar · avisou às {horaMin(v.chegando_em)}</p>}
                {v.pedido_min && (
                  <div className="rounded-lg bg-amber-light text-amber px-2.5 py-2 text-xs font-bold flex flex-wrap items-center gap-x-2 gap-y-1.5">
                    <span className="flex-1 min-w-[9rem]"><Hourglass className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />{v.familia.responsavel.split(' ')[0]} pediu mais {fmtMin(v.pedido_min)}</span>
                    {pode && <>
                      <button type="button" className="rounded-lg bg-amber text-white px-2.5 py-1 hover:opacity-90" onClick={() => rodar('rec_estender', { p_visita: v.id, p_minutos: v.pedido_min }, `Tempo de ${v.crianca.nome.split(' ')[0]} estendido em ${fmtMin(v.pedido_min!)}.`)}>Aceitar</button>
                      <button type="button" className="rounded-lg border border-amber/40 px-2.5 py-1 hover:bg-white/60" onClick={() => rodar('rec_pedido_recusar', { p_visita: v.id }, 'Pedido recusado.')}>Recusar</button>
                    </>}
                  </div>
                )}
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`font-display text-3xl font-bold tabular-nums ${c.rel}`}>{cronometro(segTotal(v))}</span>
                  <span className={`text-xs font-bold rounded-full px-2.5 py-1 ${c.chip}`}>{e.etiqueta}</span>
                </div>
                <p className="text-sm">{e.info}</p>
                <p className="text-[11px] text-muted">Entrou às {horaMin(v.entrada_em)} · {v.plano.nome}{Number(v.pago_entrada) > 0 ? ` · pago ${brl(Number(v.pago_entrada))}` : ''}{Math.abs(segTotal(v) - segCob(v)) > 30 ? ` · cobrado ${cronometro(segCob(v))}` : ''}</p>
                {pode && (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    <Button className="!px-3 !py-1.5" onClick={() => abrirSaida(v)}><LogOut className="w-3.5 h-3.5" />Saída</Button>
                    <Botao onClick={() => abrir({ tipo: 'avisar', v })}><MessageCircle className="w-3.5 h-3.5" />Avisar</Botao>
                    {(cfg?.funcoes.codigo !== false || cfg?.funcoes.paginaPais !== false) && <Botao onClick={() => abrir({ tipo: 'reenviar', v })} titulo="Reenviar o link e o código para o responsável"><Send className="w-3.5 h-3.5" />Reenviar link</Botao>}
                    {v.plano.pausa && (v.pausa
                      ? <Botao onClick={() => rodar('rec_retomar', { p_visita: v.id }, `Tempo de ${v.crianca.nome.split(' ')[0]} retomado.`)}><Play className="w-3.5 h-3.5" />Retomar</Botao>
                      : <Botao onClick={() => abrir({ tipo: 'pausa', v })}><Pause className="w-3.5 h-3.5" />Pausar</Botao>)}
                    {v.plano.cobranca === 'entrada' && v.plano.incl != null && <Botao onClick={() => abrir({ tipo: 'estender', v })}><Clock className="w-3.5 h-3.5" />Estender</Botao>}
                    {cfg?.funcoes.ocorr !== false && <Botao onClick={() => abrir({ tipo: 'ocorrencia', v })}><Plus className="w-3.5 h-3.5" />Ocorrência</Botao>}
                    {can('action:recreacao.cancelar') && <Botao onClick={() => abrir({ tipo: 'cancelar', v })} titulo="Cancelar entrada"><MoreHorizontal className="w-3.5 h-3.5" /></Botao>}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}

      {lendo && <LeitorQr onFechar={() => setLendo(false)} onLido={(t) => { setLendo(false); porCodigo(t) }} />}

      {painel && cfg && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-6 overflow-y-auto">
          <div className="fixed inset-0 bg-ink/40" onClick={() => setPainel(null)} />
          <div className="relative w-full max-w-3xl bg-surface rounded-2xl shadow-xl p-5 sm:p-6 my-auto animate-card-in">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-semibold flex items-center gap-2">{painel.tipo === 'entrada' ? <><LogIn className="w-5 h-5 text-purple" />Nova entrada</> : <><LogOut className="w-5 h-5 text-purple" />Saída</>}</h2>
              <button type="button" onClick={() => setPainel(null)} className="text-muted hover:text-ink" aria-label="Fechar"><X className="w-5 h-5" /></button>
            </div>
            {painel.tipo === 'entrada' ? (
              <EntradaRec unidades={unidades} unidadeInicial={unitId} funcoes={cfg.funcoes} regras={cfg.regras} termo={cfg.termo} nomeCasa={brand.name || 'Recreação'}
                dentro={(lista ?? []).map((v) => v.crianca.id)} onFechar={() => setPainel(null)} onConcluida={carregar} />
            ) : (
              <SaidaRec visitas={painel.visitas} marcadas={painel.marcadas} codigoLido={painel.codigo} funcoes={cfg.funcoes} regras={cfg.regras} nomeCasa={brand.name || 'Recreação'}
                onFechar={() => setPainel(null)} onConcluida={(t) => { setPainel(null); setMsg({ ok: true, texto: t }); carregar() }} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function PainelAcao({ acao, texto, setTexto, cfg, rodar, fechar }: {
  acao: NonNullable<Acao>; texto: { a: string; b: string; c: string }; setTexto: (t: { a: string; b: string; c: string }) => void
  cfg: Config | null; rodar: (fn: string, args: Record<string, unknown>, ok: string) => Promise<unknown>; fechar: () => void
}) {
  const v = acao.v, nome = v.crianca.nome.split(' ')[0], resp = v.familia.responsavel.split(' ')[0]
  const [ultima, setUltima] = useState<string | null>(null)
  const base = 'rounded-card border-2 border-purple/30 bg-purple-light/30 p-4 space-y-3 animate-card-in'
  if (acao.tipo === 'avisar') {
    const fim = v.plano.cobranca === 'entrada' && v.plano.incl != null
      ? `O tempo de ${nome} acaba às ${horaMin(Date.now() + ((v.plano.incl + v.extensao_min) * 60 - v.seg_cobrado) * 1000)}.`
      : `${nome} está com a gente há ${fmtMin(Math.round(v.seg_total / 60))}.`
    const t = `Oi, ${resp}! ${fim} Quer estender o tempo? É só responder aqui.`
    return (
      <div className={base}>
        <p className="font-semibold">Mensagem para {v.familia.responsavel}</p>
        <div className="rounded-xl bg-[#e7f6ec] text-[#1b3a28] p-3 text-sm max-w-lg">{t}</div>
        <div className="flex gap-2"><a href={linkWhatsApp(v.familia.telefone, t)} target="_blank" rel="noreferrer"><Button><MessageCircle className="w-4 h-4" />Abrir no WhatsApp</Button></a><Button variant="ghost" onClick={fechar}>Fechar</Button></div>
        <p className="text-xs text-muted">Avisar não muda a cobrança.</p>
      </div>
    )
  }
  if (acao.tipo === 'pausa' || acao.tipo === 'cancelar') {
    const pausa = acao.tipo === 'pausa'
    return (
      <div className={base}>
        <p className="font-semibold">{pausa ? `Pausar o tempo de ${nome}` : `Cancelar a entrada de ${nome}`}</p>
        {!pausa && <p className="text-xs text-muted">Use quando a entrada foi registrada por engano. {Number(v.pago_entrada) > 0 ? `O pagamento de ${brl(Number(v.pago_entrada))} é estornado.` : ''} Fica no histórico.</p>}
        <input className="campo" autoFocus value={texto.a} onChange={(e) => setTexto({ ...texto, a: e.target.value })} placeholder={pausa ? 'Motivo (ex.: lanche com a mãe)' : 'Motivo (ex.: entrada na criança errada)'} />
        <div className="flex gap-2">
          <Button disabled={texto.a.trim().length < 3} onClick={() => (pausa
            ? rodar('rec_pausar', { p_visita: v.id, p_motivo: texto.a }, `Tempo de ${nome} pausado. O tempo pausado não é cobrado.`)
            : rodar('rec_cancelar', { p_visita: v.id, p_motivo: texto.a }, `Entrada de ${nome} cancelada.`))}>{pausa ? <><Pause className="w-4 h-4" />Pausar</> : 'Cancelar entrada'}</Button>
          <Button variant="ghost" onClick={fechar}>Voltar</Button>
        </div>
        <p className="text-xs text-muted">O motivo é obrigatório e fica registrado com o seu nome.</p>
      </div>
    )
  }
  if (acao.tipo === 'estender') {
    return (
      <div className={base}>
        <p className="font-semibold">Estender o tempo de {nome}</p>
        <p className="text-xs text-muted">O painel passa a contar até o novo horário. O valor segue a regra de excedente do plano ({v.plano.nome}).</p>
        <div className="flex flex-wrap gap-2">
          {[15, 30, 60].map((m) => (
            <Button key={m} variant="secondary" onClick={async () => {
              const r = (await rodar('rec_estender', { p_visita: v.id, p_minutos: m }, `+${fmtMin(m)} para ${nome}.`)) as { efeito: number } | null
              if (r && typeof r === 'object') setUltima(`Se sair no novo horário, paga ${brl(Number(r.efeito))} a mais.`)
            }}>+{fmtMin(m)}</Button>
          ))}
          <Button variant="ghost" onClick={fechar}>Voltar</Button>
        </div>
        {ultima && <p className="text-sm text-teal flex items-center gap-1"><Check className="w-4 h-4" />{ultima}</p>}
      </div>
    )
  }
  // ocorrência
  const msgPai = `Oi, ${resp}! Aqui é da recreação. ${nome} teve uma ocorrência: ${texto.c.toLowerCase()}. ${texto.a}.${texto.b ? ` O que fizemos: ${texto.b}.` : ''} A equipe está acompanhando.`
  return (
    <div className={base}>
      <p className="font-semibold">Ocorrência com {nome}</p>
      <div className="grid sm:grid-cols-2 gap-2">
        <select className="campo" value={texto.c} onChange={(e) => setTexto({ ...texto, c: e.target.value })}>
          {['Queda ou machucado leve', 'Machucado que precisou de cuidado', 'Briga ou mordida', 'Mal-estar (febre, vômito, enjoo)', 'Choro que não passou', 'Perdeu ou quebrou um objeto', 'Outro'].map((o) => <option key={o}>{o}</option>)}
        </select>
        <input className="campo" value={texto.b} onChange={(e) => setTexto({ ...texto, b: e.target.value })} placeholder="O que a equipe fez (ex.: gelo e curativo)" />
        <textarea className="campo sm:col-span-2 min-h-[60px]" value={texto.a} onChange={(e) => setTexto({ ...texto, a: e.target.value })} placeholder="O que aconteceu" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={texto.a.trim().length < 3} onClick={() => rodar('rec_ocorrencia', { p_visita: v.id, p_tipo: texto.c, p_descricao: texto.a, p_providencia: texto.b }, `Ocorrência registrada.${cfg?.funcoes.ocorrCiente !== false ? ' Na saída, o responsável confirma que está ciente.' : ''}`)}>Registrar</Button>
        {texto.a.trim().length >= 3 && <a href={linkWhatsApp(v.familia.telefone, msgPai)} target="_blank" rel="noreferrer"><Button variant="secondary"><MessageCircle className="w-4 h-4" />Avisar {resp} no WhatsApp</Button></a>}
        <Button variant="ghost" onClick={fechar}>Voltar</Button>
      </div>
    </div>
  )
}

function Numero({ rotulo, valor, dica, cor, children }: { rotulo: string; valor: string; dica?: string; cor?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-card bg-surface border border-line px-4 py-3">
      <p className="text-xs text-muted">{rotulo}</p>
      <p className={`font-display text-2xl font-bold tabular-nums ${cor ?? ''}`}>{valor}</p>
      {dica && <p className="text-[11px] text-muted">{dica}</p>}
      {children}
    </div>
  )
}

function Botao({ onClick, titulo, children }: { onClick: () => void; titulo?: string; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} title={titulo} aria-label={titulo} className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold hover:border-purple/40 hover:text-purple">{children}</button>
}
