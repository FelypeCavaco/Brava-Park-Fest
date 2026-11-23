import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Timer, MapPin, Hourglass, Check, LogOut, KeyRound, AlertTriangle, PauseCircle } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { QrImg } from '../components/recreacao/QrRec'
import { brl, friendlyDbError } from '../lib/format'
import { cronometro, fmtMin, horaMin, linkPais } from '../lib/recreacao'

// Página do responsável: abre pelo link que a recepção manda no WhatsApp. Sem login.
// Mostra só o que o responsável já sabe (nome da criança, tempo, valor e código).
interface Crianca {
  id: string; nome: string; status: 'dentro' | 'saiu'; entrada_em: string; saida_em: string | null; pulseira: string | null
  plano: string; cobranca: 'entrada' | 'saida'; incl: number | null; extensao_min: number; pago_entrada: number
  pausado: boolean; seg_cobrado: number; total: number; proxima: { em: number; total: number } | null
  chegando_em: string | null; pedido_min: number | null
  ocorrencias: { tipo: string; descricao: string; providencia: string | null; em: string }[]
}
interface Pagina {
  agora: string; casa: { nome: string; logo_url: string | null }; unidade: string | null; responsavel: string
  codigo: string | null; qr: boolean; funcoes: { chegando: boolean; pedirTempo: boolean }; visitas: Crianca[]
  desligada?: boolean; encerrada?: boolean
}

export function RecreacaoPais() {
  const { token } = useParams<{ token: string }>()
  const [pag, setPag] = useState<Pagina | null | undefined>(undefined)
  const [buscadoEm, setBuscadoEm] = useState(Date.now())
  const [agora, setAgora] = useState(Date.now())
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const [pedindo, setPedindo] = useState<string | null>(null)
  const ocupado = useRef(false)

  const carregar = useCallback(async () => {
    if (!token || ocupado.current) return
    ocupado.current = true
    const { data, error } = await supabase.rpc('rec_publico', { p_token: token })
    ocupado.current = false
    if (error) return setPag((p) => (p === undefined ? null : p))
    setPag((data as Pagina | null) ?? null); setBuscadoEm(Date.now())
  }, [token])
  useEffect(() => { carregar(); const t = setInterval(carregar, 15000); return () => clearInterval(t) }, [carregar])
  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 1000); return () => clearInterval(t) }, [])

  const passou = (agora - buscadoEm) / 1000
  const seg = (c: Crianca) => (c.status !== 'dentro' || c.pausado ? c.seg_cobrado : c.seg_cobrado + passou)
  // virou o valor: busca de novo para a conta certa vir do servidor
  useEffect(() => { if (pag?.visitas?.some((c) => c.status === 'dentro' && c.proxima && !c.pausado && seg(c) >= c.proxima.em)) carregar() }, [agora]) // eslint-disable-line react-hooks/exhaustive-deps

  async function chegando() {
    const { error } = await supabase.rpc('rec_publico_chegando', { p_token: token })
    if (error) return setMsg({ ok: false, texto: friendlyDbError(error.message) })
    setMsg({ ok: true, texto: 'Pronto! A recepção já sabe que você está chegando.' }); carregar()
  }
  async function pedir(c: Crianca, min: number) {
    const { error } = await supabase.rpc('rec_publico_pedir_tempo', { p_token: token, p_visita: c.id, p_minutos: min })
    if (error) return setMsg({ ok: false, texto: friendlyDbError(error.message) })
    setPedindo(null); setMsg({ ok: true, texto: `Pedido enviado. A recepção vai confirmar o tempo a mais de ${c.nome.split(' ')[0]}.` }); carregar()
  }

  if (pag === undefined) return <Tela><p className="text-sm text-muted text-center py-16">Carregando...</p></Tela>
  if (pag === null) return <Tela><Aviso icone={<AlertTriangle className="w-8 h-8 text-amber" />} titulo="Link não encontrado" texto="Confira se o endereço foi copiado inteirinho. Se precisar, peça um novo na recepção." /></Tela>
  if (pag.desligada) return <Tela casa={pag.casa}><Aviso icone={<Timer className="w-8 h-8 text-purple" />} titulo="Esta página não está disponível" texto="Fale com a recepção para saber o tempo e o valor." /></Tela>
  if (pag.encerrada) return <Tela casa={pag.casa}><Aviso icone={<Check className="w-8 h-8 text-teal" />} titulo="Visita encerrada" texto="Obrigado pela visita! Esperamos vocês de novo." /></Tela>

  const dentro = pag.visitas.filter((c) => c.status === 'dentro')
  const jaAvisou = dentro.find((c) => c.chegando_em)?.chegando_em
  return (
    <Tela casa={pag.casa} unidade={pag.unidade}>
      <div className="space-y-4">
        <div>
          <p className="text-sm text-muted">Olá, {pag.responsavel}!</p>
          <h1 className="text-2xl font-semibold leading-tight">{dentro.length ? (dentro.length > 1 ? 'Seus pequenos estão se divertindo' : `${dentro[0].nome.split(' ')[0]} está se divertindo`) : 'Visita encerrada'}</h1>
        </div>

        {msg && <div className={`text-sm rounded-xl px-4 py-2.5 flex justify-between gap-2 ${msg.ok ? 'bg-teal-light text-teal' : 'bg-danger-light text-danger'}`}>{msg.texto}<button type="button" onClick={() => setMsg(null)} aria-label="Fechar aviso">✕</button></div>}

        {pag.visitas.map((c) => <CartaoCrianca key={c.id} c={c} seg={seg(c)} agora={agora} aberto={pedindo === c.id} podePedir={pag.funcoes.pedirTempo} onAbrir={() => setPedindo(pedindo === c.id ? null : c.id)} onPedir={(m) => pedir(c, m)} />)}

        {dentro.length > 0 && (pag.codigo || pag.qr) && (
          <section className="rounded-2xl bg-surface border border-line p-5 text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted flex items-center justify-center gap-1.5"><KeyRound className="w-3.5 h-3.5" />Para retirar na saída</p>
            {pag.qr && token && <QrImg texto={linkPais(token)} tamanho={176} className="mx-auto mt-3 rounded-xl bg-white p-1.5 border border-line" />}
            {pag.codigo && <p className="font-display text-4xl font-black tracking-[0.3em] mt-3">{pag.codigo}</p>}
            <p className="text-xs text-muted mt-2">Mostre o QR ou diga o código na recepção. Só entregamos a criança com ele.</p>
          </section>
        )}

        {dentro.length > 0 && pag.funcoes.chegando && (
          jaAvisou
            ? <div className="rounded-2xl bg-teal-light text-teal p-4 flex items-center gap-3"><Check className="w-5 h-5 shrink-0" /><p className="text-sm font-semibold">A recepção foi avisada às {horaMin(jaAvisou)}. É só chegar!</p></div>
            : <button type="button" onClick={chegando} className="w-full h-14 rounded-2xl bg-gradient-to-br from-purple to-purple-dark text-white font-semibold text-lg shadow-lg shadow-purple/30 flex items-center justify-center gap-2 active:scale-[0.99]"><MapPin className="w-5 h-5" />Estou chegando</button>
        )}
        <p className="text-[11px] text-muted text-center">O valor e o tempo são os do relógio da casa e se atualizam sozinhos. Itens do balcão entram na hora da saída.</p>
      </div>
    </Tela>
  )
}

function CartaoCrianca({ c, seg, agora, aberto, podePedir, onAbrir, onPedir }: { c: Crianca; seg: number; agora: number; aberto: boolean; podePedir: boolean; onAbrir: () => void; onPedir: (m: number) => void }) {
  const nome = c.nome.split(' ')[0]
  if (c.status === 'saiu') {
    return (
      <section className="rounded-2xl bg-surface border border-line p-4 flex items-center gap-3">
        <span className="w-11 h-11 rounded-xl bg-line/60 text-muted font-bold flex items-center justify-center shrink-0"><LogOut className="w-5 h-5" /></span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold">{c.nome}</p>
          <p className="text-xs text-muted">Saiu às {horaMin(c.saida_em!)} · ficou {fmtMin(Math.round(c.seg_cobrado / 60))}</p>
        </div>
        <p className="text-right"><span className="block text-[11px] text-muted">Total</span><b>{brl(Number(c.total))}</b></p>
      </section>
    )
  }
  const total = c.proxima && seg >= c.proxima.em ? c.proxima.total : Number(c.total)
  const pagar = Math.max(0, total - Number(c.pago_entrada))
  const resto = c.cobranca === 'entrada' && c.incl != null ? (c.incl + c.extensao_min) * 60 - seg : null
  const perto = resto != null && resto > 0 && resto <= 600
  const estourou = resto != null && resto <= 0
  const cor = c.pausado ? 'border-line' : estourou ? 'border-danger' : perto ? 'border-amber' : 'border-line'
  return (
    <section className={`rounded-2xl bg-surface border-2 ${cor} p-4 space-y-3`}>
      <div className="flex items-center gap-3">
        <span className="w-11 h-11 rounded-xl bg-purple-light text-purple font-bold flex items-center justify-center shrink-0">{c.nome.charAt(0)}</span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold leading-tight">{c.nome}</p>
          <p className="text-xs text-muted">Entrou às {horaMin(c.entrada_em)} · {c.plano}{c.pulseira ? ` · pulseira ${c.pulseira}` : ''}</p>
        </div>
      </div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] text-muted">Tempo de brincadeira</p>
          <p className={`font-display text-4xl font-bold tabular-nums ${c.pausado ? 'text-muted' : estourou ? 'text-danger' : perto ? 'text-amber' : 'text-ink'}`}>{cronometro(seg)}</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-muted">Valor até agora</p>
          <p className="font-display text-2xl font-bold tabular-nums">{brl(total)}</p>
        </div>
      </div>
      {c.pausado && <p className="text-sm rounded-xl bg-line/50 text-muted px-3 py-2 flex items-center gap-2"><PauseCircle className="w-4 h-4 shrink-0" />O tempo de {nome} está parado e não está sendo cobrado.</p>}
      {!c.pausado && resto != null && <p className={`text-sm ${estourou ? 'text-danger font-semibold' : perto ? 'text-amber font-semibold' : ''}`}>{resto > 0 ? `Faltam ${fmtMin(Math.ceil(resto / 60))} · até ${horaMin(agora + resto * 1000)}` : 'O tempo combinado acabou: o tempo a mais é cobrado.'}</p>}
      {!c.pausado && c.proxima && c.proxima.em > seg && c.proxima.em - seg <= 600 && <p className="text-xs text-amber font-semibold">Às {horaMin(agora + (c.proxima.em - seg) * 1000)} o valor passa para {brl(c.proxima.total)}.</p>}
      <p className="text-xs text-muted">{Number(c.pago_entrada) > 0 ? `Já pago ${brl(Number(c.pago_entrada))} · ` : ''}{pagar > 0 ? `a pagar na saída ${brl(pagar)}` : 'nada a pagar na saída por enquanto'}</p>
      {c.ocorrencias.map((o, i) => (
        <p key={i} className="text-xs rounded-xl bg-amber-light text-amber px-3 py-2"><b>{o.tipo}</b> às {horaMin(o.em)}: {o.descricao}{o.providencia ? ` (${o.providencia})` : ''}</p>
      ))}
      {c.pedido_min ? (
        <p className="text-sm rounded-xl bg-amber-light text-amber px-3 py-2 flex items-center gap-2 font-semibold"><Hourglass className="w-4 h-4 shrink-0" />Pedido de mais {fmtMin(c.pedido_min)} enviado. A recepção vai confirmar.</p>
      ) : podePedir && c.cobranca === 'entrada' && c.incl != null && (
        <div>
          <button type="button" onClick={onAbrir} className="text-sm font-semibold text-purple hover:underline flex items-center gap-1.5"><Hourglass className="w-4 h-4" />Pedir mais tempo para {nome}</button>
          {aberto && (
            <div className="flex flex-wrap gap-2 mt-2">
              {[15, 30, 60].map((m) => <button key={m} type="button" onClick={() => onPedir(m)} className="px-4 h-10 rounded-full border border-purple/40 bg-purple-light/50 text-purple font-semibold text-sm hover:bg-purple-light">+ {fmtMin(m)}</button>)}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function Tela({ children, casa, unidade }: { children: React.ReactNode; casa?: { nome: string; logo_url: string | null }; unidade?: string | null }) {
  return (
    <div className="min-h-screen bg-paper">
      <header className="bg-gradient-to-br from-purple to-purple-dark text-white px-4 pt-6 pb-6">
        <div className="max-w-md mx-auto flex items-center gap-3">
          {casa?.logo_url ? <img src={casa.logo_url} alt="" className="w-10 h-10 rounded-xl object-cover bg-white" /> : <span className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center"><Timer className="w-5 h-5" /></span>}
          <div className="min-w-0">
            <p className="font-semibold leading-tight truncate">{casa?.nome || 'Recreação'}</p>
            <p className="text-xs text-white/80">Recreação{unidade ? ` · ${unidade}` : ''}</p>
          </div>
        </div>
      </header>
      <main className="max-w-md mx-auto px-4 pt-5 pb-10">{children}</main>
    </div>
  )
}

function Aviso({ icone, titulo, texto }: { icone: React.ReactNode; titulo: string; texto: string }) {
  return (
    <div className="bg-surface rounded-2xl border border-line p-8 text-center shadow-sm">
      <div className="flex justify-center mb-3">{icone}</div>
      <p className="text-lg font-semibold mb-1">{titulo}</p>
      <p className="text-sm text-muted">{texto}</p>
    </div>
  )
}
