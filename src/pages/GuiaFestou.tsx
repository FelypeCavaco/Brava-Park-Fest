import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowLeft, ChevronRight, Search } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { GUIA_CATEGORIAS, type ArtigoGuia } from '../lib/guiaConteudo'
import { AjudaWhatsApp, CorpoArtigo, EtiquetaPlano, useArtigosVisiveis } from '../components/guia/GuiaArtigo'

// Guia Festou: como usar cada parte do sistema, passo a passo e com vídeo.
// Endereços: /guia, /guia?c=<assunto>, /guia?a=<artigo>.

const COMECE = ['primeiro-acesso', 'pacotes', 'cardapio', 'nova-reserva', 'portal-o-que-e', 'conferir-comprovante']

function semAcento(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function ItemArtigo({ a, onAbrir, curto = false }: { a: ArtigoGuia; onAbrir: (id: string) => void; curto?: boolean }) {
  return (
    <li>
      <button onClick={() => onAbrir(a.id)} className="w-full text-left flex items-center gap-3 px-2 py-3 rounded-lg hover:bg-paper">
        <span className="flex-1 min-w-0">
          <span className={`block font-medium ${curto ? 'text-sm' : ''}`}>{a.titulo}</span>
          {!curto && <span className="block text-sm text-muted">{a.resumo}</span>}
        </span>
        <EtiquetaPlano artigo={a} />
        <ChevronRight className="w-4 h-4 text-purple shrink-0" />
      </button>
    </li>
  )
}

export function GuiaFestou() {
  const [params, setParams] = useSearchParams()
  const artigos = useArtigosVisiveis()
  const [busca, setBusca] = useState('')
  const artId = params.get('a')
  const catId = params.get('c')
  const artigo = artigos.find((a) => a.id === artId)
  const cat = GUIA_CATEGORIAS.find((c) => c.id === (artigo?.cat ?? catId))

  useEffect(() => { window.scrollTo(0, 0) }, [artId, catId])

  const abrir = (id: string) => { setBusca(''); setParams({ a: id }) }
  const abrirCat = (id: string) => { setBusca(''); setParams({ c: id }) }

  const achados = useMemo(() => {
    const q = semAcento(busca.trim())
    if (!q) return []
    const palavras = q.split(/\s+/)
    return artigos.filter((a) => {
      const t = semAcento([a.titulo, a.resumo, a.onde, ...a.passos, ...a.dicas].join(' '))
      return palavras.every((p) => t.includes(p))
    })
  }, [busca, artigos])

  const cabecalho = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">📘 Guia Festou</h1>
        <p className="text-sm text-muted mt-1">Como usar cada parte do sistema, passo a passo e com vídeo.</p>
      </div>
      <label className="relative w-full sm:w-96">
        <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Busque: pagamento, convidados, estoque..." aria-label="Buscar no guia"
          className="w-full border border-line rounded-lg pl-9 pr-3 py-2.5 text-sm bg-surface" />
      </label>
    </div>
  )

  // ---------- busca ----------
  if (busca.trim()) {
    return (
      <div className="space-y-5">
        {cabecalho}
        <Card title={`${achados.length} resultado${achados.length === 1 ? '' : 's'} para "${busca.trim()}"`}>
          {achados.length ? <ul className="divide-y divide-line">{achados.map((a) => <ItemArtigo key={a.id} a={a} onAbrir={abrir} />)}</ul>
            : <p className="text-sm text-muted py-4 text-center">Nada encontrado com essa palavra. Tente outra, ou fale com o suporte.</p>}
        </Card>
        <AjudaWhatsApp />
      </div>
    )
  }

  // ---------- artigo ----------
  if (artigo && cat) {
    const outros = artigos.filter((a) => a.cat === artigo.cat && a.id !== artigo.id)
    return (
      <div className="space-y-4">
        <button onClick={() => abrirCat(cat.id)} className="text-sm text-purple font-medium inline-flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> {cat.icone} {cat.nome}</button>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-5 items-start">
          <div className="max-w-3xl"><CorpoArtigo artigo={artigo} /></div>
          {outros.length > 0 && (
            <Card title={`Mais em ${cat.nome}`} className="lg:sticky lg:top-4">
              <ul className="divide-y divide-line -my-2">{outros.map((a) => <ItemArtigo key={a.id} a={a} onAbrir={abrir} curto />)}</ul>
            </Card>
          )}
        </div>
      </div>
    )
  }

  // ---------- assunto ----------
  if (cat) {
    const lista = artigos.filter((a) => a.cat === cat.id)
    return (
      <div className="space-y-5">
        <button onClick={() => setParams({})} className="text-sm text-purple font-medium inline-flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Guia Festou</button>
        <div>
          <h1 className="text-2xl font-semibold">{cat.icone} {cat.nome}</h1>
          <p className="text-sm text-muted mt-1">{cat.desc}</p>
        </div>
        <Card><ul className="divide-y divide-line -my-2">{lista.map((a) => <ItemArtigo key={a.id} a={a} onAbrir={abrir} />)}</ul></Card>
        <AjudaWhatsApp />
      </div>
    )
  }

  // ---------- início ----------
  const comece = COMECE.map((id) => artigos.find((a) => a.id === id)).filter(Boolean) as ArtigoGuia[]
  return (
    <div className="space-y-5">
      {cabecalho}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {GUIA_CATEGORIAS.map((c) => {
          const n = artigos.filter((a) => a.cat === c.id).length
          if (!n) return null
          return (
            <button key={c.id} onClick={() => abrirCat(c.id)}
              className="text-left bg-surface border border-line rounded-card p-4 hover:-translate-y-0.5 hover:shadow-lg hover:border-purple/30 transition-all">
              <span className="text-2xl">{c.icone}</span>
              <span className="block font-semibold mt-2">{c.nome}</span>
              <span className="block text-sm text-muted">{c.desc}</span>
              <span className="inline-block mt-3 text-xs font-semibold text-purple bg-purple-light rounded-full px-2.5 py-0.5">{n} {n === 1 ? 'artigo' : 'artigos'}</span>
            </button>
          )
        })}
      </div>
      <Card title="Comece por aqui">
        <ul className="divide-y divide-line -my-2">{comece.map((a) => <ItemArtigo key={a.id} a={a} onAbrir={abrir} />)}</ul>
      </Card>
      <AjudaWhatsApp />
    </div>
  )
}
