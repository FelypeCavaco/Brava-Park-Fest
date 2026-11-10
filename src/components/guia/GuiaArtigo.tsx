import { useEffect, useState } from 'react'
import { MapPin, Play, Lightbulb, ThumbsUp, ThumbsDown } from 'lucide-react'
import { useCompany } from '../../lib/CompanyContext'
import { moduloLigado } from '../../lib/modules'
import { useFornecedor } from '../TermosTexto'
import { GUIA, NOME_PLANO, type ArtigoGuia } from '../../lib/guiaConteudo'

// Partes comuns do Guia Festou (página e painel lateral de ajuda).

// Artigos que a casa enxerga: some o que é de função desligada no plano dela.
export function useArtigosVisiveis() {
  const { brand } = useCompany()
  return GUIA.filter((a) => !a.modulo || moduloLigado(a.modulo, brand.disabledModules))
}

const ZAP_PADRAO = '5547992245959'

// Link do WhatsApp do suporte do Festou, com o assunto já escrito.
export function useLinkSuporte() {
  const f = useFornecedor()
  return (artigo?: ArtigoGuia) => {
    let n = String(f?.whatsapp ?? '').replace(/\D/g, '') || ZAP_PADRAO
    if (n.length <= 11) n = `55${n}`
    const texto = artigo
      ? `Olá! Estou no Guia Festou, no artigo "${artigo.titulo}", e não consegui resolver. Pode me ajudar?`
      : 'Olá! Estou no Guia Festou e não encontrei o que procurava. Pode me ajudar?'
    return `https://wa.me/${n}?text=${encodeURIComponent(texto)}`
  }
}

function IconeZap({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className} fill="currentColor">
      <path d="M16 3a13 13 0 0 0-11.2 19.6L3 29l6.6-1.7A13 13 0 1 0 16 3zm0 23.6c-2 0-4-.6-5.7-1.6l-.4-.2-3.9 1 1-3.8-.3-.4A10.6 10.6 0 1 1 16 26.6zm5.8-7.9c-.3-.2-1.9-.9-2.2-1-.3-.1-.5-.2-.7.2l-1 1.2c-.2.2-.4.2-.7.1a8.7 8.7 0 0 1-4.3-3.8c-.3-.6.3-.5.9-1.7.1-.2 0-.4 0-.5l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6a1.2 1.2 0 0 0-.9.4 3.7 3.7 0 0 0-1.1 2.7 6.4 6.4 0 0 0 1.3 3.4 14.7 14.7 0 0 0 5.6 5c2.1.9 2.9 1 4 .8.6-.1 1.9-.8 2.2-1.5.3-.7.3-1.4.2-1.5-.1-.2-.3-.3-.6-.4z" />
    </svg>
  )
}

// Caixa "Não conseguiu resolver? Falar com o suporte".
export function AjudaWhatsApp({ artigo, destaque = false }: { artigo?: ArtigoGuia; destaque?: boolean }) {
  const link = useLinkSuporte()
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-card border bg-surface px-4 py-3.5 transition-shadow ${destaque ? 'border-[#25D366] ring-4 ring-[#25D366]/15' : 'border-line'}`}>
      <div className="min-w-0">
        <p className="font-semibold">{artigo ? 'Não conseguiu resolver?' : 'Não encontrou o que procurava?'}</p>
        <p className="text-sm text-muted">Fale com o suporte do Festou no WhatsApp. A mensagem já vai com o assunto.</p>
      </div>
      <a href={link(artigo)} target="_blank" rel="noreferrer"
        className="inline-flex items-center gap-2 rounded-lg bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-white hover:brightness-95 whitespace-nowrap">
        <IconeZap className="w-5 h-5" /> Falar com o suporte
      </a>
    </div>
  )
}

export function EtiquetaPlano({ artigo }: { artigo: ArtigoGuia }) {
  if (artigo.plano === 'todos') return null
  return (
    <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap ${artigo.plano === 'master' ? 'bg-purple text-white' : 'bg-purple-light text-purple'}`}>
      {artigo.plano === 'master' ? 'Master' : 'Profissional'}
    </span>
  )
}

// O vídeo do artigo (sem texto e sem áudio). Enquanto não existe, mostra o espaço reservado.
function Video({ artigo }: { artigo: ArtigoGuia }) {
  if (artigo.video) {
    return (
      <video className="w-full aspect-video rounded-card bg-ink" src={`/guia/videos/${artigo.id}.mp4`} controls playsInline muted preload="metadata" />
    )
  }
  return (
    <div className="w-full aspect-video rounded-card grid place-items-center text-white relative overflow-hidden"
      style={{ background: 'radial-gradient(500px 300px at 70% 30%, rgba(140,90,210,.5), transparent 60%), linear-gradient(150deg, #2a1a4e, #1b1033)' }}>
      <span className="w-16 h-16 rounded-full border-2 border-white/50 bg-white/10 grid place-items-center"><Play className="w-7 h-7 ml-1" /></span>
      <span className="absolute bottom-3 left-4 text-xs font-medium text-white/80">Vídeo em produção</span>
    </div>
  )
}

export function CorpoArtigo({ artigo, compacto = false }: { artigo: ArtigoGuia; compacto?: boolean }) {
  const [ajudou, setAjudou] = useState<'sim' | 'nao' | null>(null)
  useEffect(() => setAjudou(null), [artigo.id])

  return (
    <div className="space-y-4">
      <div>
        {compacto ? <h2 className="text-lg font-semibold pr-8">{artigo.titulo}</h2> : <h1 className="text-2xl font-semibold">{artigo.titulo}</h1>}
        <p className="text-muted mt-1">{artigo.resumo}</p>
        <div className="flex flex-wrap gap-2 mt-3">
          <span className="inline-flex items-center gap-1.5 text-xs rounded-full border border-line bg-surface px-2.5 py-1 text-muted"><MapPin className="w-3.5 h-3.5 text-purple" /> <b className="text-ink font-semibold">{artigo.onde}</b></span>
          <span className="text-xs rounded-full border border-line bg-surface px-2.5 py-1 text-muted">{NOME_PLANO[artigo.plano]}</span>
        </div>
      </div>
      <Video artigo={artigo} />
      <ol className="space-y-2.5">
        {artigo.passos.map((p, i) => (
          <li key={i} className="flex gap-3 rounded-lg border border-line bg-surface px-3.5 py-3 text-sm">
            <span className="w-7 h-7 shrink-0 rounded-full bg-purple text-white text-xs font-bold grid place-items-center">{i + 1}</span>
            <span className="pt-1">{p}</span>
          </li>
        ))}
      </ol>
      {artigo.dicas.length > 0 && (
        <div className="rounded-lg bg-amber-light px-4 py-3 text-sm">
          <p className="flex items-center gap-1.5 font-semibold text-amber text-xs uppercase tracking-wide"><Lightbulb className="w-4 h-4" /> Dicas</p>
          <ul className="list-disc pl-5 mt-1.5 space-y-1">{artigo.dicas.map((d, i) => <li key={i}>{d}</li>)}</ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
        Isso resolveu?
        {ajudou === 'sim' ? <span className="text-teal">Que bom! 🎉</span> : (
          <>
            <button onClick={() => setAjudou('sim')} className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-1.5 hover:bg-paper"><ThumbsUp className="w-4 h-4" /> Sim</button>
            <button onClick={() => setAjudou('nao')} className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-1.5 hover:bg-paper"><ThumbsDown className="w-4 h-4" /> Não</button>
          </>
        )}
      </div>
      <AjudaWhatsApp artigo={artigo} destaque={ajudou === 'nao'} />
    </div>
  )
}
