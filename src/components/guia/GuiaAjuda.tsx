import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { HelpCircle, X } from 'lucide-react'
import { artigoDaTela } from '../../lib/guiaConteudo'
import { CorpoArtigo, useArtigosVisiveis } from './GuiaArtigo'

// Botão "Ajuda" na barra do topo: abre, na lateral, o artigo do Guia Festou
// da tela em que a pessoa está (sem sair dela). Sem artigo para a tela, leva
// ao Guia.
export function GuiaAjuda() {
  const location = useLocation()
  const visiveis = useArtigosVisiveis()
  const [aberto, setAberto] = useState(false)
  const artigo = (() => {
    const a = artigoDaTela(location.pathname)
    return a && visiveis.some((v) => v.id === a.id) ? a : undefined
  })()

  useEffect(() => setAberto(false), [location.pathname])
  useEffect(() => {
    if (!aberto) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false) }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [aberto])

  if (location.pathname.startsWith('/guia')) return null

  const botao = 'relative w-10 h-10 rounded-full flex items-center justify-center border bg-surface border-line text-muted hover:text-purple hover:border-purple/40 transition-colors shrink-0'
  if (!artigo) {
    return <Link to="/guia" className={botao} aria-label="Guia Festou" title="Guia Festou"><HelpCircle className="w-5 h-5" /></Link>
  }
  return (
    <>
      <button onClick={() => setAberto(true)} className={botao} aria-label="Ajuda desta tela" title="Ajuda desta tela"><HelpCircle className="w-5 h-5" /></button>
      {aberto && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-ink/30" onClick={() => setAberto(false)} />
          <aside className="absolute right-0 top-0 bottom-0 w-full max-w-md bg-paper shadow-2xl overflow-y-auto p-5 animate-card-in" role="dialog" aria-label={`Ajuda: ${artigo.titulo}`}>
            <button onClick={() => setAberto(false)} className="absolute right-4 top-4 w-8 h-8 rounded-full bg-surface border border-line grid place-items-center text-muted hover:text-ink" aria-label="Fechar"><X className="w-4 h-4" /></button>
            <p className="text-xs font-semibold text-purple uppercase tracking-wide mb-2">📘 Guia Festou</p>
            <CorpoArtigo artigo={artigo} compacto />
            <Link to={`/guia?a=${artigo.id}`} className="inline-block mt-4 text-sm font-medium text-purple">Abrir no Guia completo →</Link>
          </aside>
        </div>
      )}
    </>
  )
}
