import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Home, UtensilsCrossed, Users, CreditCard, Menu as MenuIcon, ChevronLeft, ChevronRight, Check, X, Info, Clock,
  Copy, Upload, Lock, Star, MapPin, Download, Music2, AlertTriangle,
} from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { brl, parseDecimal, friendlyDbError } from '../lib/format'
import { downloadPdf } from '../lib/pdfExport'
import { openWhatsApp, TEAM_WHATSAPP } from '../lib/whatsapp'
import logo from '../assets/logo-brava-park-fest.png'
import theo from '../assets/theo-vermelho.png'

// Portal do cliente: link sem login (o token da festa). Tudo o que o cliente
// faz aqui grava direto na festa e aparece para a equipe no Painel.

const OUTRO_SABOR = 'Outro sabor (combinar com a equipe)'

const C = {
  azul: '#2148C0',
  marinho: '#16267A',
  vermelho: '#D62C2C',
  amarelo: '#F5C83A',
  fundo: '#EDF1FA',
  borda: '#DCE3F3',
  linha: '#EAEFF8',
  texto: '#172040',
  muted: '#59627F',
}

interface PortalData {
  cliente: string
  cliente_nome: string
  crianca: string | null
  idade: number | null
  tema: string | null
  data: string
  inicio: string
  fim: string
  status: string
  unidade: string
  vila: boolean
  endereco: string | null
  pix: string | null
  google_review_link: string | null
  hora_extra: number | null
  pacote: string | null
  convidados_limite: number
  pratos_inclusos: number
  pratos_adicionais: number
  pratos: string[]
  bolo_sabor: string | null
  bolo_massa: string | null
  cardapio_confirmado_em: string | null
  cardapio_apos_prazo: boolean
  musica: 'equipe' | 'cliente' | null
  playlist: string | null
  prazo_cardapio: string
  prazo_convidados: string
  prazo_pagamento: string
  hoje: string
  festa_terminou: boolean
  valor_total: number
  pago: number
  saldo: number
  pagamentos: { data: string; valor: number; forma: string | null; obs: string | null }[]
  comprovantes: { id: string; valor: number; status: 'em_analise' | 'lancado' | 'recusado'; motivo: string | null; enviado_em: string }[]
  contrato: { gerado_em: string | null; texto: string | null } | null
  mensagens: { de_cliente: boolean; autor: string | null; texto: string; em: string }[]
  historico: { em: string; texto: string }[]
  avaliou: boolean
  menu: { pratos: string[]; massas: string[]; sabores: string[] }
}

type Tab = 'inicio' | 'cardapio' | 'convidados' | 'pagamento' | 'mais' | 'musica' | 'historico' | 'contrato' | 'programacao' | 'regras' | 'chegar' | 'equipe' | 'avaliacao'

const TITULOS: Record<Tab, string> = {
  inicio: 'Minha festa', cardapio: 'Cardápio', convidados: 'Lista de convidados', pagamento: 'Pagamento', mais: 'Mais',
  musica: 'Música da festa', historico: 'Histórico de alterações', contrato: 'Contrato', programacao: 'Programação sugerida',
  regras: 'Regras da casa', chegar: 'Como chegar', equipe: 'Falar com a equipe', avaliacao: 'Avaliar a festa',
}

const FORMA: Record<string, string> = {
  pix: 'Pix', cartao_credito: 'Cartão de crédito', cartao_debito: 'Cartão de débito', dinheiro: 'Dinheiro', boleto: 'Boleto', transferencia: 'Transferência', outro: 'Outro',
}

const dataBr = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '')

// Idade a partir da qual a criança conta como convidado, por unidade.
const idadeConta = (unidade: string) => (unidade === 'São Vicente' ? 3 : 5)
const diaMes = (iso: string) => iso.slice(5, 10).split('-').reverse().join('/')
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

function somaMinutos(hhmm: string, min: number) {
  const [h, m] = hhmm.split(':').map(Number)
  const t = h * 60 + m + min
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}h${String(t % 60).padStart(2, '0')}`
}
const hora = (hhmm: string) => hhmm.replace(':', 'h')

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function ClientPortal() {
  const { token } = useParams()
  const [data, setData] = useState<PortalData | null>(null)
  const [guests, setGuests] = useState<{ id: string; name: string; arrived: boolean }[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [tab, setTab] = useState<Tab>('inicio')
  const [voltarPara, setVoltarPara] = useState<Tab>('mais')
  const [aviso, setAviso] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // cardápio
  const [pratos, setPratos] = useState<string[]>([])
  const [massa, setMassa] = useState('')
  const [sabor, setSabor] = useState('')
  // convidados
  const [novoNome, setNovoNome] = useState('')
  const [colar, setColar] = useState('')
  // música
  const [musica, setMusica] = useState<'equipe' | 'cliente' | null>(null)
  const [playlist, setPlaylist] = useState('')
  // pagamento
  const [copiado, setCopiado] = useState(false)
  const [valorComprovante, setValorComprovante] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const [arquivo, setArquivo] = useState<File | null>(null)
  // avaliação
  const [notas, setNotas] = useState<Record<string, number>>({})
  const [comentario, setComentario] = useState('')

  useEffect(() => {
    if (token) load(true)
  }, [token])

  async function load(first = false) {
    if (first) setLoading(true)
    const [{ data: d, error }, { data: gs }] = await Promise.all([
      supabase.rpc('portal_get', { p_token: token }),
      supabase.rpc('portal_list_guests', { p_token: token }),
    ])
    if (error || !d) {
      setNotFound(true)
      setLoading(false)
      return
    }
    const p = d as PortalData
    setData(p)
    setGuests((gs ?? []) as { id: string; name: string; arrived: boolean }[])
    if (first) {
      setPratos(p.pratos ?? [])
      setMassa(p.bolo_massa ?? '')
      setSabor(p.bolo_sabor ?? '')
      setMusica(p.musica)
      setPlaylist(p.playlist ?? '')
      setValorComprovante(p.saldo > 0 ? String(p.saldo.toFixed(2)).replace('.', ',') : '')
    }
    setLoading(false)
  }

  function go(t: Tab) {
    setVoltarPara(tab)
    setTab(t)
    setAviso(null)
    setOk(null)
    window.scrollTo({ top: 0 })
  }

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>, sucesso: string) {
    setBusy(true)
    setAviso(null)
    setOk(null)
    const { error } = await fn()
    setBusy(false)
    if (error) {
      setAviso(friendlyDbError(error.message))
      return false
    }
    setOk(sucesso)
    await load()
    return true
  }

  const derived = useMemo(() => {
    if (!data) return null
    const hoje = data.hoje
    const dias = Math.round((new Date(`${data.data}T00:00:00`).getTime() - new Date(`${hoje}T00:00:00`).getTime()) / 86400000)
    const limitePratos = data.pratos_inclusos + data.pratos_adicionais
    return {
      dias,
      limitePratos,
      cardapioAposPrazo: hoje > data.prazo_cardapio,
      cardapioFechado: hoje > data.data,
      convidadosFechado: hoje > data.prazo_convidados,
      pagamentoVencido: hoje > data.prazo_pagamento,
    }
  }, [data])

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-sm" style={{ background: C.fundo, color: C.muted }}>Carregando...</div>
  }
  if (notFound || !data || !derived) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center" style={{ background: C.fundo }}>
        <div>
          <img src={logo} alt="Brava Park Fest" className="w-16 h-16 rounded-full mx-auto mb-3" />
          <p className="font-display font-semibold text-lg" style={{ color: C.texto }}>Link não encontrado</p>
          <p className="text-sm mt-1" style={{ color: C.muted }}>Confira se o endereço foi copiado certinho ou peça um novo link à equipe.</p>
        </div>
      </div>
    )
  }

  const d = data
  const x = derived
  const isSub = !['inicio', 'cardapio', 'convidados', 'pagamento', 'mais'].includes(tab)

  const tarefas = [
    {
      titulo: 'Cardápio (pratos quentes e bolo)', tab: 'cardapio' as Tab, done: !!d.cardapio_confirmado_em,
      detalhe: d.cardapio_confirmado_em
        ? d.cardapio_apos_prazo ? 'Enviado após o prazo' : 'Confirmado'
        : x.cardapioAposPrazo ? `Prazo encerrado em ${diaMes(d.prazo_cardapio)} — ainda dá para enviar` : `Escolher até ${diaMes(d.prazo_cardapio)}`,
      atrasado: !d.cardapio_confirmado_em && x.cardapioAposPrazo,
    },
    {
      titulo: 'Lista de convidados', tab: 'convidados' as Tab, done: guests.length > 0,
      detalhe: `${guests.length} ${guests.length === 1 ? 'nome' : 'nomes'} · enviar até ${diaMes(d.prazo_convidados)}`,
      atrasado: guests.length === 0 && x.convidadosFechado,
    },
    ...(d.vila
      ? [{ titulo: 'Música da festa', tab: 'musica' as Tab, done: !!d.musica, detalhe: d.musica === 'equipe' ? 'Músicas sugeridas pela equipe' : d.musica === 'cliente' ? 'Playlist enviada' : 'Opcional', atrasado: false }]
      : []),
    {
      titulo: 'Pagamento do saldo', tab: 'pagamento' as Tab, done: d.saldo <= 0.005,
      detalhe: d.saldo <= 0.005 ? 'Tudo pago' : `${brl(d.saldo)} · até ${diaMes(d.prazo_pagamento)}`,
      atrasado: d.saldo > 0.005 && x.pagamentoVencido,
    },
    { titulo: 'Contrato', tab: 'contrato' as Tab, done: !!d.contrato, detalhe: d.contrato ? `Gerado em ${dataBr(d.contrato.gerado_em)}` : 'A equipe vai disponibilizar', atrasado: false },
  ]
  const feitas = tarefas.filter((t) => t.done).length
  const progresso = Math.round((feitas / tarefas.length) * 100)

  const maisItens: { titulo: string; detalhe: string; tab: Tab }[] = [
    ...(d.vila ? [{ titulo: 'Música da festa', detalhe: 'Equipe escolhe ou você envia sua playlist', tab: 'musica' as Tab }] : []),
    { titulo: 'Histórico de alterações', detalhe: 'Tudo o que foi feito neste portal', tab: 'historico' },
    { titulo: 'Contrato', detalhe: 'Ver resumo e baixar em PDF', tab: 'contrato' },
    { titulo: 'Programação sugerida', detalhe: 'Parabéns, pratos quentes e bolo', tab: 'programacao' },
    { titulo: 'Regras da casa', detalhe: 'Conforme o contrato', tab: 'regras' },
    { titulo: 'Como chegar', detalhe: 'Endereço e rota', tab: 'chegar' },
    { titulo: 'Falar com a equipe', detalhe: 'Conversar pelo WhatsApp', tab: 'equipe' },
    { titulo: 'Avaliar a festa', detalhe: d.avaliou ? 'Avaliação enviada' : d.festa_terminou ? 'Disponível agora' : 'Libera ao fim da festa', tab: 'avaliacao' },
  ]

  // ---------- ações ----------
  function chamarNoWhatsApp(assunto?: string) {
    const festa = d.crianca ? `a festa ${/a$/i.test(d.crianca.trim()) ? 'da' : 'do'} ${d.crianca}` : 'minha festa'
    openWhatsApp(TEAM_WHATSAPP, `Olá! Aqui é ${d.cliente_nome}, sobre ${festa} do dia ${dataBr(d.data)} (${d.unidade}).${assunto ? ` ${assunto}` : ''}`)
  }

  function avisarPrazoCardapio() {
    setAviso('A festa já aconteceu. Para alterar o cardápio, fale com a equipe.')
  }

  function togglePrato(nome: string) {
    if (x.cardapioFechado) return avisarPrazoCardapio()
    setPratos((prev) => {
      if (prev.includes(nome)) return prev.filter((p) => p !== nome)
      if (x.limitePratos === 1) return [nome]
      if (prev.length >= x.limitePratos) return prev
      return [...prev, nome]
    })
  }

  const cardapioIncompleto = pratos.length !== x.limitePratos || !massa || !sabor
  const cardapioMudou =
    !d.cardapio_confirmado_em || massa !== (d.bolo_massa ?? '') || sabor !== (d.bolo_sabor ?? '') || [...pratos].sort().join('|') !== [...d.pratos].sort().join('|')

  async function salvarCardapio() {
    if (x.cardapioFechado || cardapioIncompleto) return
    await run(
      () => supabase.rpc('portal_save_menu', { p_token: token, p_pratos: pratos, p_massa: massa, p_sabor: sabor }),
      x.cardapioAposPrazo ? 'Cardápio enviado! A equipe recebeu o aviso de que foi depois do prazo.' : 'Cardápio confirmado! A equipe já recebeu.',
    )
  }

  async function addConvidado(e: FormEvent) {
    e.preventDefault()
    const nome = novoNome.trim()
    if (!nome) return
    if (await run(() => supabase.rpc('portal_add_guests', { p_token: token, p_names: [nome] }), `${nome} entrou na lista.`)) setNovoNome('')
  }

  async function addColados() {
    const nomes = colar.split('\n').map((n) => n.trim()).filter(Boolean)
    if (nomes.length === 0) return
    if (await run(() => supabase.rpc('portal_add_guests', { p_token: token, p_names: nomes }), `${nomes.length} nomes adicionados.`)) setColar('')
  }

  async function removerConvidado(id: string) {
    await run(() => supabase.rpc('portal_remove_guest', { p_token: token, p_entry_id: id }), 'Nome removido.')
  }

  async function salvarMusica(escolha: 'equipe' | 'cliente') {
    await run(
      () => supabase.rpc('portal_set_music', { p_token: token, p_choice: escolha, p_url: escolha === 'cliente' ? playlist : null }),
      escolha === 'equipe' ? 'Combinado! A equipe cuida da trilha sonora.' : 'Playlist salva. A equipe já recebeu.',
    )
  }

  async function copiarPix() {
    try {
      await navigator.clipboard.writeText(d.pix ?? '')
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      // sem permissão de área de transferência: a chave fica visível para copiar à mão
    }
  }

  async function enviarComprovante(e: FormEvent) {
    e.preventDefault()
    const valor = parseDecimal(valorComprovante)
    if (!arquivo) return setAviso('Escolha a foto ou o PDF do comprovante.')
    if (!valor || valor <= 0) return setAviso('Informe o valor que você pagou.')
    if (arquivo.size > 10 * 1024 * 1024) return setAviso('O arquivo é muito grande (máximo 10 MB).')
    setBusy(true)
    setAviso(null)
    const ext = (arquivo.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
    const path = `${token}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { error: upErr } = await supabase.storage.from('portal-comprovantes').upload(path, arquivo, { contentType: arquivo.type || undefined, upsert: false })
    if (upErr) {
      setBusy(false)
      setAviso('Não foi possível enviar o arquivo. Tente uma foto (JPG ou PNG) ou um PDF.')
      return
    }
    setBusy(false)
    if (await run(() => supabase.rpc('portal_submit_receipt', { p_token: token, p_amount: valor, p_path: path }), 'Comprovante enviado! A equipe confere e o pagamento aparece aqui.')) {
      setArquivo(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }



  const categoriasAval = [
    { id: 'pratos', label: 'Pratos quentes' }, { id: 'bolo', label: 'Bolo' }, { id: 'doces', label: 'Docinhos' },
    { id: 'salgados', label: 'Salgadinhos' }, { id: 'atendimento', label: 'Atendimento' },
  ]
  const avaliacaoCompleta = categoriasAval.every((c) => notas[c.id])

  async function enviarAvaliacao() {
    if (!avaliacaoCompleta) return
    await run(
      () => supabase.rpc('portal_submit_review', { p_token: token, p_pratos: notas.pratos, p_bolo: notas.bolo, p_doces: notas.doces, p_salgados: notas.salgados, p_atendimento: notas.atendimento, p_comment: comentario }),
      'Obrigado pela avaliação!',
    )
  }

  async function baixarContrato() {
    if (!d.contrato?.texto) return
    const body = `<div class="contrato">${escapeHtml(d.contrato.texto)}</div>`
    await downloadPdf(body, '.contrato{white-space:pre-wrap;font-family:Arial,sans-serif;font-size:11px;line-height:1.5;color:#111}', `contrato-${d.data}.pdf`)
  }

  // ---------- peças visuais ----------
  const card = 'bg-white border rounded-2xl'
  const secaoTitulo = (t: string) => <h2 className="text-xs font-semibold tracking-wider uppercase mb-2" style={{ color: C.muted }}>{t}</h2>
  const radio = (selected: boolean) => (
    <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center" style={{ border: `1.5px solid ${selected ? C.azul : '#B9C5DE'}` }}>
      <span className="w-2.5 h-2.5 rounded-full" style={{ background: selected ? C.azul : 'transparent' }} />
    </span>
  )

  const navPrincipal: { tab: Tab; label: string; icon: typeof Home }[] = [
    { tab: 'inicio', label: 'Início', icon: Home },
    { tab: 'cardapio', label: 'Cardápio', icon: UtensilsCrossed },
    { tab: 'convidados', label: 'Convidados', icon: Users },
    { tab: 'pagamento', label: 'Pagamento', icon: CreditCard },
  ]

  const horarios = [
    { hora: hora(d.inicio), titulo: 'Início da festa', detalhe: 'A recepção confere os nomes da lista na entrada.', cor: C.azul },
    { hora: somaMinutos(d.inicio, 90), titulo: 'Parabéns', detalhe: '1h30 após o início.', cor: C.vermelho },
    ...(x.limitePratos > 0 ? [{ hora: somaMinutos(d.inicio, 100), titulo: 'Pratos quentes', detalhe: 'Servidos logo após o parabéns.', cor: C.azul }] : []),
    { hora: somaMinutos(d.inicio, 120), titulo: 'Bolo', detalhe: 'Servido 30 minutos após o parabéns.', cor: C.azul },
    { hora: hora(d.fim), titulo: 'Encerramento', detalhe: `Hora extra pode ser contratada com a equipe${d.hora_extra ? ` (${brl(d.hora_extra)} por hora)` : ''}.`, cor: C.azul },
  ]

  const regras = [
    { titulo: 'Limite de convidados', texto: `Até ${d.convidados_limite} pessoas, contando a partir de ${idadeConta(d.unidade)} anos. O excedente depende de aprovação e tem cobrança adicional.` },
    { titulo: 'Horário', texto: 'Respeitar início e término. Tempo excedente é cobrado por hora adicional, conforme disponibilidade.' },
    { titulo: 'Itens de fora', texto: 'Não é permitida a entrada de bebidas alcoólicas, comidas, decorações ou equipamentos externos sem autorização prévia.' },
    { titulo: 'Bebidas alcoólicas', texto: 'Não estão inclusas no pacote; podem ser adquiridas no local.' },
    { titulo: 'Segurança das crianças', texto: 'A presença de pais ou responsáveis é obrigatória durante toda a festa. A equipe orienta o uso dos brinquedos, mas a responsabilidade pelas crianças é dos responsáveis.' },
    { titulo: 'Danos', texto: 'Danos ao espaço, brinquedos ou equipamentos, causados por convidados ou prestadores externos, são cobrados conforme orçamento.' },
    { titulo: 'Cancelamento e troca de data', texto: 'Até 30 dias antes: retenção de 20%. De 15 a 29 dias: 50%. Menos de 15 dias: sem devolução. Troca de data uma única vez, com 15 dias de antecedência.' },
  ]

  const vagas = d.convidados_limite - guests.length

  return (
    <div className="min-h-screen" style={{ background: C.fundo, color: C.texto }}>
      <header className="sticky top-0 z-20" style={{ background: C.azul, borderBottom: `3px solid ${C.vermelho}` }}>
        <div className="max-w-6xl mx-auto h-14 md:h-16 px-4 md:px-7 flex items-center gap-3">
          {isSub ? (
            <button onClick={() => go(voltarPara === tab ? 'mais' : voltarPara)} className="md:hidden -ml-2 w-9 h-9 flex items-center justify-center text-white" aria-label="Voltar">
              <ChevronLeft className="w-5 h-5" />
            </button>
          ) : null}
          <img src={logo} alt="Brava Park Fest" className={`w-8 h-8 rounded-full bg-white ${isSub ? 'hidden md:block' : ''}`} />
          <p className="flex-1 font-display font-semibold text-white">{TITULOS[tab]}</p>
          <span className="text-[11px] font-semibold rounded-full px-2.5 py-1" style={{ background: C.amarelo, color: C.marinho }}>{d.unidade}</span>
        </div>
      </header>

      <div className="max-w-6xl mx-auto md:px-7 md:py-6 md:flex md:gap-6 md:items-start">
        {/* Menu lateral (computador) */}
        <aside className="hidden md:flex md:flex-col gap-3 w-60 shrink-0 sticky top-24">
          <nav aria-label="Seções do portal" className={`${card} p-2 flex flex-col gap-0.5`} style={{ borderColor: C.borda }}>
            {navPrincipal.map((n) => (
              <button key={n.tab} onClick={() => go(n.tab)} aria-current={tab === n.tab ? 'page' : undefined}
                className="h-10 rounded-lg px-3 flex items-center gap-2.5 text-sm font-medium text-left"
                style={{ background: tab === n.tab ? '#E3EAFB' : 'transparent', color: tab === n.tab ? C.marinho : '#3C4566' }}>
                <n.icon className="w-4 h-4" /> {n.label}
              </button>
            ))}
            <div className="h-px my-1.5 mx-1" style={{ background: C.linha }} />
            {maisItens.map((m) => (
              <button key={m.tab} onClick={() => go(m.tab)} className="min-h-[36px] rounded-lg px-3 text-[13px] text-left"
                style={{ background: tab === m.tab ? '#E3EAFB' : 'transparent', color: tab === m.tab ? C.marinho : '#3C4566', fontWeight: tab === m.tab ? 600 : 500 }}>
                {m.titulo}
              </button>
            ))}
          </nav>
        </aside>

        <main className="flex-1 min-w-0 max-w-3xl px-4 py-4 md:p-0 pb-28 md:pb-0 space-y-4">
          {aviso && (
            <div role="alert" className="rounded-xl px-3 py-2.5 flex gap-2.5 items-start text-sm" style={{ background: '#FCF1DF', border: '1px solid #F1DDB8', color: '#6B4306' }}>
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <p className="flex-1">
                {aviso}
                {/fale com a equipe/i.test(aviso) && (
                  <button onClick={() => chamarNoWhatsApp()} className="block mt-1 font-semibold underline">Chamar a equipe no WhatsApp</button>
                )}
              </p>
              <button onClick={() => setAviso(null)} aria-label="Fechar aviso"><X className="w-4 h-4" /></button>
            </div>
          )}
          {ok && (
            <div role="status" className="rounded-xl px-3 py-2.5 flex gap-2.5 items-start text-sm" style={{ background: '#E6F2EC', color: '#14523D' }}>
              <Check className="w-4 h-4 mt-0.5 shrink-0" />
              <p className="flex-1">{ok}</p>
              <button onClick={() => setOk(null)} aria-label="Fechar"><X className="w-4 h-4" /></button>
            </div>
          )}

          {/* ===== INÍCIO ===== */}
          {tab === 'inicio' && (
            <>
              <section className="rounded-2xl overflow-hidden text-white" style={{ background: C.marinho }}>
                <div className="flex">
                  <div className="flex-1 p-4 md:p-6 flex flex-col gap-1">
                    <p className="text-xs" style={{ color: '#C7D3F7' }}>Olá, {d.cliente}</p>
                    <h1 className="font-display font-semibold text-2xl md:text-3xl leading-tight">{d.crianca ? `Festa ${/a$/i.test(d.crianca.trim()) ? 'da' : 'do'} ${d.crianca}` : 'Sua festa'}</h1>
                    <p className="text-sm" style={{ color: '#E3E9FB' }}>{[d.idade ? `${d.idade} anos` : null, d.tema].filter(Boolean).join(' · ')}</p>
                    <p className="text-xs mt-2" style={{ color: '#C7D3F7' }}>
                      {new Date(`${d.data}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
                      <br />
                      {hora(d.inicio)} às {hora(d.fim)}
                    </p>
                  </div>
                  <img src={theo} alt="Urso Theo, mascote da Brava Park Fest" className="w-32 md:w-56 h-40 md:h-52 object-cover shrink-0" style={{ objectPosition: 'center 12%' }} />
                </div>
                <div className="grid grid-cols-3" style={{ background: C.azul }}>
                  {[
                    { v: x.dias < 0 ? '✓' : String(x.dias), l: x.dias < 0 ? 'festa realizada' : x.dias === 1 ? 'dia para a festa' : 'dias para a festa' },
                    { v: `${progresso}%`, l: 'preparativos' },
                    { v: String(guests.length), l: 'convidados' },
                  ].map((s, i) => (
                    <div key={i} className="px-3 py-2.5" style={{ borderRight: i < 2 ? '1px solid #3A5FD0' : undefined }}>
                      <p className="font-display font-semibold text-xl" style={{ color: C.amarelo }}>{s.v}</p>
                      <p className="text-[11px]" style={{ color: '#DCE4FA' }}>{s.l}</p>
                    </div>
                  ))}
                </div>
                <div className="h-1" style={{ background: C.vermelho }} />
              </section>

              <section>
                <div className="flex justify-between items-baseline">
                  {secaoTitulo('Preparativos')}
                  <span className="text-xs" style={{ color: C.muted }}>{feitas} de {tarefas.length} concluídos</span>
                </div>
                <div className={`${card} overflow-hidden`} style={{ borderColor: C.borda }}>
                  {tarefas.map((t) => (
                    <button key={t.titulo} onClick={() => go(t.tab)} className="w-full flex items-center gap-3 text-left px-4 py-3 min-h-[60px]" style={{ borderBottom: `1px solid ${C.linha}` }}>
                      <span className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center"
                        style={{ border: `1.5px solid ${t.done ? '#1F7A5C' : t.atrasado ? '#B23A3A' : '#B9C5DE'}`, background: t.done ? '#1F7A5C' : 'transparent' }}>
                        {t.done && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
                      </span>
                      <span className="flex-1">
                        <span className="block font-medium text-sm">{t.titulo}</span>
                        <span className="block text-xs" style={{ color: t.atrasado ? '#B23A3A' : C.muted }}>{t.detalhe}</span>
                      </span>
                      <ChevronRight className="w-4 h-4" style={{ color: '#9AA3BD' }} />
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}

          {/* ===== CARDÁPIO ===== */}
          {tab === 'cardapio' && (
            <>
              <div className="rounded-xl px-3 py-2.5 flex gap-2.5 items-start text-sm" style={{ background: x.cardapioFechado ? '#F8E5E5' : x.cardapioAposPrazo ? '#FCF1DF' : '#E3EAFB', color: x.cardapioFechado ? '#B23A3A' : x.cardapioAposPrazo ? '#6B4306' : C.marinho }}>
                <Clock className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  {x.cardapioFechado
                    ? 'A festa já aconteceu. Para alterar o cardápio, fale com a equipe.'
                    : x.cardapioAposPrazo
                      ? `O prazo era ${diaMes(d.prazo_cardapio)} (1 semana antes da festa). Você ainda pode enviar, mas a equipe será avisada de que foi enviado depois do prazo.`
                      : `Escolha até ${diaMes(d.prazo_cardapio)} — 1 semana antes da festa.`}
                  {d.cardapio_confirmado_em && d.cardapio_apos_prazo && <span className="block mt-0.5 font-medium">Seu cardápio foi enviado após o prazo.</span>}
                </span>
              </div>

              <section>
                <div className="flex justify-between items-baseline mb-2">
                  <h2 className="font-display font-semibold text-lg">Pratos quentes</h2>
                  <span className="text-sm font-semibold" style={{ color: C.azul }}>{pratos.length} de {x.limitePratos}</span>
                </div>
                <div className={`${card} px-4 py-2.5 mb-2 text-sm space-y-1`} style={{ borderColor: C.borda, color: '#3C4566' }}>
                  <div className="flex justify-between"><span>Inclusos no plano {d.pacote ?? ''}</span><strong>{d.pratos_inclusos}</strong></div>
                  <div className="flex justify-between"><span>Adicionais contratados</span><strong>{d.pratos_adicionais}</strong></div>
                </div>
                {x.limitePratos === 0 ? (
                  <p className="text-sm" style={{ color: C.muted }}>Seu plano não inclui pratos quentes. Para incluir, fale com a equipe.</p>
                ) : (
                  <div className={`${card} overflow-hidden`} style={{ borderColor: C.borda }}>
                    {d.menu.pratos.map((nome) => {
                      const sel = pratos.includes(nome)
                      return (
                        <button key={nome} onClick={() => togglePrato(nome)} aria-pressed={sel} className="w-full flex items-center gap-3 text-left px-4 py-2.5 min-h-[46px] text-sm"
                          style={{ borderBottom: `1px solid ${C.linha}`, background: sel ? '#E8EEFC' : 'white', color: x.cardapioFechado && !sel ? '#717A96' : C.texto }}>
                          {radio(sel)} {nome}
                        </button>
                      )
                    })}
                  </div>
                )}
              </section>

              <section>
                <h2 className="font-display font-semibold text-lg mb-2">Bolo</h2>
                {secaoTitulo('Massa')}
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {d.menu.massas.map((m) => (
                    <button key={m} onClick={() => (x.cardapioFechado ? avisarPrazoCardapio() : setMassa(m))} aria-pressed={massa === m} className="h-11 rounded-xl text-sm font-medium"
                      style={{ border: `1.5px solid ${massa === m ? C.azul : '#B9C5DE'}`, background: massa === m ? C.azul : 'white', color: massa === m ? 'white' : C.texto }}>
                      {m}
                    </button>
                  ))}
                </div>
                {secaoTitulo('Recheio')}
                <div className={`${card} overflow-hidden`} style={{ borderColor: C.borda }}>
                  {[...d.menu.sabores, OUTRO_SABOR].map((s) => (
                    <button key={s} onClick={() => (x.cardapioFechado ? avisarPrazoCardapio() : setSabor(s))} aria-pressed={sabor === s} className="w-full flex items-center gap-3 text-left px-4 py-2.5 min-h-[44px] text-sm"
                      style={{ borderBottom: `1px solid ${C.linha}`, background: sabor === s ? '#E8EEFC' : 'white' }}>
                      {radio(sabor === s)} {s}
                    </button>
                  ))}
                </div>
                {sabor === OUTRO_SABOR && (
                  <p className="text-xs mt-2 rounded-lg px-3 py-2" style={{ background: '#FFF6DB', color: '#5C4300' }}>
                    Ao confirmar, a equipe recebe o aviso e combina o sabor com você.
                    <button onClick={() => chamarNoWhatsApp('Quero combinar um sabor de bolo fora da lista.')} className="block mt-1.5 font-semibold underline">Combinar pelo WhatsApp agora</button>
                  </p>
                )}
              </section>

              <button onClick={salvarCardapio} disabled={busy || x.cardapioFechado || cardapioIncompleto || !cardapioMudou}
                className="w-full h-12 rounded-xl font-semibold text-white disabled:opacity-100"
                style={{ background: x.cardapioFechado || cardapioIncompleto ? '#DCE3F3' : !cardapioMudou ? '#1F7A5C' : C.vermelho, color: x.cardapioFechado || cardapioIncompleto ? '#717A96' : 'white' }}>
                {x.cardapioFechado ? 'A festa já aconteceu'
                  : pratos.length !== x.limitePratos ? (x.limitePratos === 1 ? 'Escolha o prato quente' : `Escolha ${x.limitePratos} pratos quentes`)
                  : !massa ? 'Escolha a massa do bolo' : !sabor ? 'Escolha o recheio do bolo'
                  : !cardapioMudou ? (d.cardapio_apos_prazo ? 'Enviado após o prazo' : 'Cardápio confirmado') : busy ? 'Salvando...' : x.cardapioAposPrazo ? 'Enviar mesmo após o prazo' : 'Confirmar cardápio'}
              </button>
              {!x.cardapioFechado && !x.cardapioAposPrazo && <p className="text-xs text-center" style={{ color: C.muted }}>Depois de confirmar, você ainda pode trocar até o prazo.</p>}
            </>
          )}

          {/* ===== CONVIDADOS ===== */}
          {tab === 'convidados' && (
            <>
              <section className={`${card} px-4 py-3 space-y-2`} style={{ borderColor: C.borda }}>
                <div className="flex justify-between items-baseline">
                  <p className="font-display font-semibold text-2xl">{guests.length} <span className="text-sm font-medium" style={{ color: C.muted }}>de {d.convidados_limite}</span></p>
                  <span className="text-xs font-medium" style={{ color: vagas >= 0 ? '#1F7A5C' : '#B23A3A' }}>{vagas >= 0 ? `${vagas} vagas` : `${-vagas} acima do limite`}</span>
                </div>
                <div className="h-1 rounded-full overflow-hidden" style={{ background: C.borda }}>
                  <div className="h-1" style={{ background: C.azul, width: `${Math.min(100, d.convidados_limite ? (guests.length / d.convidados_limite) * 100 : 0)}%` }} />
                </div>
                <p className="text-xs" style={{ color: x.convidadosFechado ? '#B23A3A' : C.muted }}>
                  {x.convidadosFechado ? 'Lista fechada (prazo: 1 dia antes da festa). Para incluir alguém, fale com a equipe.' : `Pode alterar até ${diaMes(d.prazo_convidados)} (1 dia antes da festa).`}
                </p>
              </section>
              <div className="rounded-xl px-3 py-2.5 flex gap-2.5 text-[13px]" style={{ background: '#E8EEFC', color: C.marinho }}>
                <Info className="w-4 h-4 mt-0.5 shrink-0" />
                <p>Coloque <strong>todas as pessoas que estarão presentes</strong>, incluindo você e o aniversariante. Contamos como convidado quem tem <strong>{idadeConta(d.unidade)} anos ou mais</strong>.</p>
              </div>
              {!x.convidadosFechado && (
                <>
                  <form onSubmit={addConvidado} className="flex gap-2">
                    <input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Nome e sobrenome" aria-label="Nome do convidado"
                      className="flex-1 min-w-0 h-11 rounded-xl px-3 text-sm bg-white" style={{ border: '1px solid #D3DCEE' }} />
                    <button type="submit" disabled={busy} className="h-11 px-4 rounded-xl text-white font-semibold text-sm" style={{ background: C.azul }}>Adicionar</button>
                  </form>
                  <details className={`${card} px-3`} style={{ borderColor: C.borda }}>
                    <summary className="min-h-[44px] flex items-center text-[13px] font-medium cursor-pointer" style={{ color: C.azul }}>Colar vários nomes de uma vez</summary>
                    <div className="pb-3 space-y-2">
                      <textarea value={colar} onChange={(e) => setColar(e.target.value)} rows={4} placeholder="Um nome por linha (dá para colar do WhatsApp)" aria-label="Vários nomes"
                        className="w-full rounded-lg p-2.5 text-sm" style={{ border: '1px solid #D3DCEE' }} />
                      <button onClick={addColados} disabled={busy} className="h-10 px-3.5 rounded-lg text-[13px] font-semibold bg-white" style={{ border: '1px solid #C5D3F5', color: C.azul }}>Adicionar todos</button>
                    </div>
                  </details>
                </>
              )}
              <section className={`${card} overflow-hidden`} style={{ borderColor: C.borda }}>
                {guests.length === 0 && <p className="text-sm p-4" style={{ color: C.muted }}>Nenhum nome ainda.</p>}
                {guests.map((g, i) => (
                  <div key={g.id} className="flex items-center gap-3 pl-4 pr-1 min-h-[46px] text-sm" style={{ borderBottom: `1px solid ${C.linha}` }}>
                    <span className="w-6 text-xs" style={{ color: '#9AA3BD' }}>{i + 1}</span>
                    <span className="flex-1">{g.name}</span>
                    {!x.convidadosFechado && !g.arrived && (
                      <button onClick={() => removerConvidado(g.id)} aria-label={`Remover ${g.name}`} className="w-11 h-11 flex items-center justify-center" style={{ color: '#717A96' }}>
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </section>
              <p className="text-[11px] text-center" style={{ color: '#717A96' }}>Cada nome salvo já aparece na lista da recepção.</p>
            </>
          )}

          {/* ===== MÚSICA ===== */}
          {tab === 'musica' && d.vila && (
            <>
              <div>
                <h1 className="font-display font-semibold text-xl">A trilha sonora do grande dia</h1>
                <p className="text-sm mt-1" style={{ color: C.muted }}>Opcional. Escolha como prefere a música da festa.</p>
              </div>
              <div className={`${card} overflow-hidden`} style={{ borderColor: C.borda }}>
                <button onClick={() => { setMusica('equipe'); salvarMusica('equipe') }} className="w-full flex gap-3 items-start text-left p-4" style={{ borderBottom: `1px solid ${C.linha}`, background: musica === 'equipe' ? '#E8EEFC' : 'white' }}>
                  {radio(musica === 'equipe')}
                  <span><span className="block font-medium text-sm">Músicas sugeridas pela equipe</span><span className="block text-xs" style={{ color: C.muted }}>Seleção infantil e de festa, pensada para cada momento.</span></span>
                </button>
                <button onClick={() => setMusica('cliente')} className="w-full flex gap-3 items-start text-left p-4" style={{ background: musica === 'cliente' ? '#E8EEFC' : 'white' }}>
                  {radio(musica === 'cliente')}
                  <span><span className="block font-medium text-sm">Quero enviar minha playlist</span><span className="block text-xs" style={{ color: C.muted }}>Cole o link de uma playlist do Spotify.</span></span>
                </button>
              </div>
              {musica === 'cliente' && (
                <div className="space-y-2">
                  <label htmlFor="playlist" className="text-[13px] font-medium flex items-center gap-1.5"><Music2 className="w-4 h-4" /> Link da playlist</label>
                  <input id="playlist" value={playlist} onChange={(e) => setPlaylist(e.target.value)} placeholder="https://open.spotify.com/playlist/..."
                    className="w-full h-11 rounded-xl px-3 text-sm bg-white" style={{ border: '1px solid #D3DCEE' }} />
                  <button onClick={() => salvarMusica('cliente')} disabled={busy} className="w-full h-11 rounded-xl text-white font-semibold" style={{ background: C.azul }}>Salvar playlist</button>
                </div>
              )}
            </>
          )}

          {/* ===== PAGAMENTO ===== */}
          {tab === 'pagamento' && (
            <>
              <section className={`${card} p-4 space-y-3`} style={{ borderColor: C.borda }}>
                <div>
                  <p className="text-xs" style={{ color: C.muted }}>Saldo a pagar</p>
                  <p className="font-display font-semibold text-3xl">{brl(d.saldo)}</p>
                  <p className="text-xs mt-0.5" style={{ color: d.saldo > 0.005 && x.pagamentoVencido ? '#B23A3A' : C.muted }}>
                    {d.saldo <= 0.005 ? 'Tudo pago. Obrigado!' : x.pagamentoVencido ? 'Prazo encerrado (até 1 dia antes da festa). Fale com a equipe.' : `Quitar até ${diaMes(d.prazo_pagamento)}, 1 dia antes da festa.`}
                  </p>
                </div>
                <div className="h-1 rounded-full overflow-hidden" style={{ background: C.borda }}>
                  <div className="h-1" style={{ background: '#1F7A5C', width: `${d.valor_total > 0 ? Math.min(100, (d.pago / d.valor_total) * 100) : 0}%` }} />
                </div>
                <div className="grid grid-cols-2 gap-2 text-[13px]">
                  <div><p style={{ color: C.muted }}>Valor da festa</p><p className="font-medium">{brl(d.valor_total)}</p></div>
                  <div><p style={{ color: C.muted }}>Pago</p><p className="font-medium">{brl(d.pago)}</p></div>
                </div>
              </section>

              {d.saldo > 0.005 && (
                <section className={`${card} p-4 space-y-3`} style={{ borderColor: C.borda }}>
                  <p className="font-semibold">Pagar com Pix</p>
                  {d.pix ? (
                    <div className="flex items-center gap-2 rounded-xl pl-3 pr-1.5 py-1.5" style={{ border: `1px solid ${C.borda}` }}>
                      <span className="flex-1 text-[13px] break-all" style={{ color: '#3C4566' }}>{d.pix}</span>
                      <button onClick={copiarPix} className="h-9 px-3 rounded-lg text-[13px] font-semibold bg-white flex items-center gap-1.5" style={{ border: '1px solid #C5D3F5', color: C.azul }}>
                        <Copy className="w-3.5 h-3.5" /> {copiado ? 'Copiado' : 'Copiar'}
                      </button>
                    </div>
                  ) : (
                    <p className="text-sm" style={{ color: C.muted }}>Peça a chave Pix à equipe.</p>
                  )}
                  <form onSubmit={enviarComprovante} className="space-y-2 pt-1">
                    <p className="text-[13px] font-medium">Enviar comprovante</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input value={valorComprovante} onChange={(e) => setValorComprovante(e.target.value)} inputMode="decimal" placeholder="Valor pago (R$)" aria-label="Valor pago"
                        className="h-11 rounded-xl px-3 text-sm bg-white" style={{ border: '1px solid #D3DCEE' }} />
                      <label className="h-11 rounded-xl px-3 text-sm bg-white flex items-center gap-2 cursor-pointer" style={{ border: '1px dashed #9AB0E6', color: C.azul }}>
                        <Upload className="w-4 h-4" />
                        <span className="truncate">{arquivo ? arquivo.name : 'Foto ou PDF'}</span>
                        <input ref={fileRef} type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
                      </label>
                    </div>
                    <button type="submit" disabled={busy} className="w-full h-11 rounded-xl text-white font-semibold" style={{ background: C.azul }}>{busy ? 'Enviando...' : 'Enviar comprovante'}</button>
                    <p className="text-xs" style={{ color: C.muted }}>A equipe confere e o pagamento aparece aqui.</p>
                  </form>
                </section>
              )}

              {d.comprovantes.length > 0 && (
                <section>
                  {secaoTitulo('Comprovantes enviados')}
                  <div className={`${card} px-4`} style={{ borderColor: C.borda }}>
                    {d.comprovantes.map((c) => (
                      <div key={c.id} className="py-3 text-sm" style={{ borderBottom: `1px solid ${C.linha}` }}>
                        <div className="flex justify-between">
                          <span>{brl(c.valor)} · {dataHora(c.enviado_em)}</span>
                          <span className="text-xs font-semibold" style={{ color: c.status === 'lancado' ? '#1F7A5C' : c.status === 'recusado' ? '#B23A3A' : '#B8720A' }}>
                            {c.status === 'lancado' ? 'Confirmado' : c.status === 'recusado' ? 'Recusado' : 'Em análise'}
                          </span>
                        </div>
                        {c.status === 'recusado' && c.motivo && <p className="text-xs mt-0.5" style={{ color: '#B23A3A' }}>Motivo: {c.motivo}. Envie outro comprovante ou fale com a equipe.</p>}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section>
                {secaoTitulo('Pagamentos registrados')}
                <div className={`${card} px-4`} style={{ borderColor: C.borda }}>
                  {d.pagamentos.length === 0 && <p className="text-sm py-3" style={{ color: C.muted }}>Nenhum pagamento registrado ainda.</p>}
                  {d.pagamentos.map((p, i) => (
                    <div key={i} className="flex justify-between items-center min-h-[52px] text-sm" style={{ borderBottom: `1px solid ${C.linha}` }}>
                      <div><p className="font-medium">{p.obs || 'Pagamento'}</p><p className="text-xs" style={{ color: C.muted }}>{dataBr(p.data)}{p.forma ? ` · ${FORMA[p.forma] ?? p.forma}` : ''}</p></div>
                      <span className="font-medium tabular-nums">{brl(p.valor)}</span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

          {/* ===== MAIS (celular) ===== */}
          {tab === 'mais' && (
            <div className={`${card} overflow-hidden`} style={{ borderColor: C.borda }}>
              {maisItens.map((m) => (
                <button key={m.tab} onClick={() => go(m.tab)} className="w-full flex items-center gap-3 text-left px-4 py-3 min-h-[58px]" style={{ borderBottom: `1px solid ${C.linha}` }}>
                  <span className="flex-1"><span className="block font-medium text-sm">{m.titulo}</span><span className="block text-xs" style={{ color: C.muted }}>{m.detalhe}</span></span>
                  <ChevronRight className="w-4 h-4" style={{ color: '#9AA3BD' }} />
                </button>
              ))}
            </div>
          )}

          {/* ===== HISTÓRICO ===== */}
          {tab === 'historico' && (
            <>
              <p className="text-sm" style={{ color: C.muted }}>Tudo o que foi feito neste portal fica registrado aqui e também chega para a equipe.</p>
              <div className={`${card} px-4`} style={{ borderColor: C.borda }}>
                {d.historico.length === 0 && <p className="text-sm py-3" style={{ color: C.muted }}>Nada registrado ainda.</p>}
                {d.historico.map((h, i) => (
                  <div key={i} className="flex gap-3 py-2.5 text-[13px]" style={{ borderBottom: `1px solid ${C.linha}` }}>
                    <span className="w-24 shrink-0 text-xs tabular-nums" style={{ color: '#717A96' }}>{dataHora(h.em)}</span>
                    <span className="flex-1">{h.texto}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ===== CONTRATO ===== */}
          {tab === 'contrato' && (
            <>
              {d.contrato ? (
                <p className="text-sm font-medium flex items-center gap-2" style={{ color: '#1F7A5C' }}><Check className="w-4 h-4" /> Contrato gerado em {dataBr(d.contrato.gerado_em)}</p>
              ) : (
                <p className="text-sm" style={{ color: C.muted }}>O contrato ainda não foi disponibilizado. A equipe avisa quando estiver pronto.</p>
              )}
              <section className={`${card} px-4 text-[13px]`} style={{ borderColor: C.borda }}>
                {[
                  ['Plano', d.pacote ?? '—'],
                  ['Pratos quentes', `${d.pratos_inclusos} do plano${d.pratos_adicionais ? ` + ${d.pratos_adicionais} adicional(is)` : ''}`],
                  ['Data e horário', `${dataBr(d.data)} · ${hora(d.inicio)} às ${hora(d.fim)}`],
                  ['Convidados', `até ${d.convidados_limite}`],
                  ['Valor', brl(d.valor_total)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 py-2.5" style={{ borderBottom: `1px solid ${C.linha}` }}>
                    <span style={{ color: C.muted }}>{k}</span><span className="font-medium text-right">{v}</span>
                  </div>
                ))}
              </section>
              {d.contrato?.texto && (
                <button onClick={baixarContrato} className="w-full h-12 rounded-xl text-white font-semibold flex items-center justify-center gap-2" style={{ background: C.azul }}>
                  <Download className="w-4 h-4" /> Baixar contrato (PDF)
                </button>
              )}
            </>
          )}

          {/* ===== PROGRAMAÇÃO ===== */}
          {tab === 'programacao' && (
            <section className={`${card} p-4`} style={{ borderColor: C.borda }}>
              {horarios.map((h, i) => (
                <div key={h.titulo} className="flex gap-3.5">
                  <div className="w-12 shrink-0 font-display font-semibold text-sm pt-0.5">{h.hora}</div>
                  <div className="flex flex-col items-center shrink-0">
                    <span className="w-2.5 h-2.5 rounded-full mt-1.5" style={{ background: h.cor }} />
                    {i < horarios.length - 1 && <span className="flex-1 w-px" style={{ background: C.borda }} />}
                  </div>
                  <div className="pb-4">
                    <p className="font-medium text-sm">{h.titulo}</p>
                    <p className="text-xs" style={{ color: C.muted }}>{h.detalhe}</p>
                  </div>
                </div>
              ))}
              <p className="text-[11px]" style={{ color: '#717A96' }}>Horários sugeridos — a equipe ajusta no dia conforme o andamento da festa.</p>
            </section>
          )}

          {/* ===== REGRAS ===== */}
          {tab === 'regras' && (
            <>
              <p className="text-sm" style={{ color: C.muted }}>As mesmas regras do seu contrato, em resumo.</p>
              <div className={`${card} px-4`} style={{ borderColor: C.borda }}>
                {regras.map((r) => (
                  <div key={r.titulo} className="py-3" style={{ borderBottom: `1px solid ${C.linha}` }}>
                    <p className="font-medium text-sm">{r.titulo}</p>
                    <p className="text-[13px] mt-0.5" style={{ color: '#3C4566' }}>{r.texto}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ===== COMO CHEGAR ===== */}
          {tab === 'chegar' && (
            <>
              <section className={`${card} p-4 space-y-1`} style={{ borderColor: C.borda }}>
                <p className="font-semibold flex items-center gap-2"><MapPin className="w-4 h-4" style={{ color: C.vermelho }} /> Brava Park Fest · {d.unidade}</p>
                <p className="text-[13px]" style={{ color: C.muted }}>{d.endereco ?? 'Peça o endereço à equipe.'}</p>
              </section>
              {d.endereco && (
                <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d.endereco)}`} target="_blank" rel="noreferrer"
                  className="w-full h-12 rounded-xl text-white font-semibold flex items-center justify-center" style={{ background: C.azul }}>
                  Abrir rota no mapa
                </a>
              )}
            </>
          )}

          {/* ===== FALAR COM A EQUIPE (só WhatsApp) ===== */}
          {tab === 'equipe' && (
            <section className={`${card} p-5 text-center space-y-3`} style={{ borderColor: C.borda }}>
              <p className="font-display font-semibold text-lg">Fale com a equipe pelo WhatsApp</p>
              <p className="text-sm" style={{ color: C.muted }}>Dúvidas, pedidos ou ajustes da festa: é só chamar. A conversa já abre com os dados da sua festa.</p>
              <button onClick={() => chamarNoWhatsApp()} className="w-full h-12 rounded-xl text-white font-semibold" style={{ background: '#1F7A5C' }}>
                Chamar no WhatsApp
              </button>
              <p className="text-xs" style={{ color: '#717A96' }}>(47) 99226-1550 · atende as duas unidades</p>
            </section>
          )}

          {/* ===== AVALIAÇÃO ===== */}
          {tab === 'avaliacao' && (
            <>
              {!d.festa_terminou ? (
                <section className={`${card} p-6 text-center space-y-1.5`} style={{ borderColor: C.borda }}>
                  <Lock className="w-7 h-7 mx-auto" style={{ color: '#9AA3BD' }} />
                  <p className="font-semibold">Disponível ao fim da festa</p>
                  <p className="text-[13px]" style={{ color: C.muted }}>A avaliação libera no dia {dataBr(d.data)}, às {hora(d.fim)}.</p>
                </section>
              ) : d.avaliou ? (
                <section className={`${card} p-6 text-center space-y-2`} style={{ borderColor: C.borda }}>
                  <p className="font-display font-semibold text-lg">Obrigado pela avaliação!</p>
                  <p className="text-[13px]" style={{ color: C.muted }}>Se puder, deixe também sua opinião no Google — ajuda outras famílias a nos conhecer.</p>
                  {d.google_review_link && (
                    <a href={d.google_review_link} target="_blank" rel="noreferrer" className="inline-flex h-11 px-5 rounded-xl text-white font-semibold items-center" style={{ background: C.azul }}>Avaliar no Google</a>
                  )}
                </section>
              ) : (
                <>
                  <section className={`${card} px-4`} style={{ borderColor: C.borda }}>
                    {categoriasAval.map((c) => (
                      <div key={c.id} className="flex items-center justify-between min-h-[50px]" style={{ borderBottom: `1px solid ${C.linha}` }}>
                        <span className="font-medium text-sm">{c.label}</span>
                        <div className="flex">
                          {[1, 2, 3, 4, 5].map((n) => (
                            <button key={n} onClick={() => setNotas((prev) => ({ ...prev, [c.id]: n }))} aria-label={`${c.label}: nota ${n}`} className="w-8 h-11 flex items-center justify-center">
                              <Star className="w-5 h-5" fill={(notas[c.id] ?? 0) >= n ? '#F5B700' : 'none'} style={{ color: (notas[c.id] ?? 0) >= n ? '#F5B700' : '#C9D2E6' }} />
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </section>
                  <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={3} placeholder="Quer contar mais alguma coisa? (opcional)" aria-label="Comentário"
                    className="w-full rounded-xl p-3 text-sm bg-white" style={{ border: '1px solid #D3DCEE' }} />
                  <button onClick={enviarAvaliacao} disabled={!avaliacaoCompleta || busy} className="w-full h-12 rounded-xl font-semibold"
                    style={{ background: avaliacaoCompleta ? C.azul : '#DCE3F3', color: avaliacaoCompleta ? 'white' : '#717A96' }}>
                    {avaliacaoCompleta ? (busy ? 'Enviando...' : 'Enviar avaliação') : 'Dê uma nota para cada item'}
                  </button>
                </>
              )}
            </>
          )}
        </main>
      </div>

      {/* Barra de abas (celular) */}
      <nav aria-label="Seções do portal" className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-white grid grid-cols-5 px-1 pt-1 pb-2" style={{ borderTop: `1px solid ${C.borda}` }}>
        {[...navPrincipal, { tab: 'mais' as Tab, label: 'Mais', icon: MenuIcon }].map((n) => {
          const ativa = n.tab === 'mais' ? isSub || tab === 'mais' : tab === n.tab
          return (
            <button key={n.tab} onClick={() => go(n.tab)} aria-current={ativa ? 'page' : undefined} className="h-14 flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium"
              style={{ color: ativa ? C.azul : '#717A96' }}>
              <n.icon className="w-5 h-5" strokeWidth={1.75} />
              {n.label}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
