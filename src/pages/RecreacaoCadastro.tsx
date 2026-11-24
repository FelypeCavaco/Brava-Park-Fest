import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Check, Plus, Trash2, UserRound, Baby, ShieldCheck } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { friendlyDbError } from '../lib/format'
import { mascaraCpf, mascaraTelefone } from '../lib/recreacao'

// Autocadastro: o responsável preenche os próprios dados pelo QR da casa.
// O envio não cria a família: a recepção confere e aprova. Esta página só
// ENVIA; ela nunca mostra dados de ninguém.

interface Casa { ok: boolean; casa?: { nome: string; logo: string | null }; termo?: string }
interface Kid { nome: string; nascimento: string; cuidados: string }
interface Aut { nome: string; parentesco: string }

export function RecreacaoCadastro() {
  const { token } = useParams<{ token: string }>()
  const [casa, setCasa] = useState<Casa | null | undefined>(undefined)
  const inicio = useRef(Date.now())
  const [resp, setResp] = useState({ responsavel: '', cpf: '', telefone: '', email: '' })
  const [kids, setKids] = useState<Kid[]>([{ nome: '', nascimento: '', cuidados: '' }])
  const [auts, setAuts] = useState<Aut[]>([])
  const [termo, setTermo] = useState(false)
  const [imagem, setImagem] = useState(false)
  const [isca, setIsca] = useState('') // campo-isca: pessoa de verdade nunca preenche
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState(false)

  useEffect(() => {
    if (!token) return setCasa(null)
    supabase.rpc('rec_autocad_casa', { p_token: token }).then(({ data, error }) => setCasa(error ? null : (data as Casa)))
  }, [token])

  const setK = (i: number, p: Partial<Kid>) => setKids((k) => k.map((x, j) => (j === i ? { ...x, ...p } : x)))
  const setA = (i: number, p: Partial<Aut>) => setAuts((k) => k.map((x, j) => (j === i ? { ...x, ...p } : x)))

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    if (!termo) return setErro('Para continuar, aceite o termo de responsabilidade.')
    setEnviando(true)
    const { error } = await supabase.rpc('rec_autocad_enviar', {
      p_token: token,
      p_dados: { ...resp, termo_aceito: termo, imagem_autorizada: imagem, criancas: kids, autorizados: auts.filter((a) => a.nome.trim()) },
      p_hp: isca, p_ms: Date.now() - inicio.current,
    })
    setEnviando(false)
    if (error) return setErro(friendlyDbError(error.message))
    setEnviado(true)
    window.scrollTo({ top: 0 })
  }

  if (casa === undefined) return <Tela><p className="text-center text-muted py-16">Carregando...</p></Tela>
  if (!casa || !casa.ok) {
    return (
      <Tela>
        <div className="text-center py-16 px-6">
          <div className="w-14 h-14 rounded-2xl bg-purple-light text-purple flex items-center justify-center mx-auto mb-3"><UserRound className="w-7 h-7" strokeWidth={1.75} /></div>
          <h1 className="text-xl font-semibold">Este cadastro não está disponível</h1>
          <p className="text-sm text-muted mt-2">O link pode ter sido trocado ou o cadastro pelo celular está desligado. Fale com a recepção, que faz o seu cadastro no balcão.</p>
        </div>
      </Tela>
    )
  }

  const nomeCasa = casa.casa?.nome ?? 'Recreação'
  if (enviado) {
    return (
      <Tela casa={casa}>
        <div className="text-center py-10 px-4">
          <div className="w-16 h-16 rounded-full bg-teal-light text-teal flex items-center justify-center mx-auto mb-4"><Check className="w-8 h-8" /></div>
          <h1 className="text-2xl font-semibold">Recebemos seu cadastro!</h1>
          <p className="text-muted mt-2 max-w-sm mx-auto">Agora é só falar com a recepção da {nomeCasa}. Eles conferem os dados em instantes e liberam a entrada das crianças.</p>
        </div>
      </Tela>
    )
  }

  return (
    <Tela casa={casa}>
      <form onSubmit={enviar} className="space-y-5 pb-8">
        <div>
          <h1 className="text-2xl font-semibold">Cadastro rápido</h1>
          <p className="text-sm text-muted mt-1">Preencha uma vez e a entrada das crianças fica bem mais rápida. A recepção confere tudo antes de liberar.</p>
        </div>

        <Secao icone={UserRound} titulo="Seus dados">
          <Campo rotulo="Nome completo"><input className="campo" required autoComplete="name" maxLength={120} value={resp.responsavel} onChange={(e) => setResp({ ...resp, responsavel: e.target.value })} /></Campo>
          <Campo rotulo="CPF"><input className="campo" required inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" value={resp.cpf} onChange={(e) => setResp({ ...resp, cpf: mascaraCpf(e.target.value) })} /></Campo>
          <Campo rotulo="WhatsApp com DDD"><input className="campo" required inputMode="tel" autoComplete="tel" placeholder="(00) 00000-0000" value={resp.telefone} onChange={(e) => setResp({ ...resp, telefone: mascaraTelefone(e.target.value) })} /></Campo>
          <Campo rotulo="E-mail (opcional)"><input className="campo" type="email" autoComplete="email" maxLength={120} value={resp.email} onChange={(e) => setResp({ ...resp, email: e.target.value })} /></Campo>
        </Secao>

        <Secao icone={Baby} titulo="As crianças">
          {kids.map((k, i) => (
            <div key={i} className="rounded-xl border border-line bg-surface p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Criança {i + 1}</p>
                {kids.length > 1 && <button type="button" onClick={() => setKids(kids.filter((_, j) => j !== i))} className="text-xs text-danger inline-flex items-center gap-1" aria-label={`Remover criança ${i + 1}`}><Trash2 className="w-3.5 h-3.5" />remover</button>}
              </div>
              <Campo rotulo="Nome"><input className="campo" required maxLength={120} value={k.nome} onChange={(e) => setK(i, { nome: e.target.value })} /></Campo>
              <Campo rotulo="Data de nascimento"><input className="campo" required type="date" max={new Date().toISOString().slice(0, 10)} value={k.nascimento} onChange={(e) => setK(i, { nascimento: e.target.value })} /></Campo>
              <Campo rotulo="Alergia ou cuidado (se houver)"><input className="campo" maxLength={300} placeholder="Ex.: alergia a amendoim" value={k.cuidados} onChange={(e) => setK(i, { cuidados: e.target.value })} /></Campo>
            </div>
          ))}
          {kids.length < 6 && <button type="button" onClick={() => setKids([...kids, { nome: '', nascimento: '', cuidados: '' }])} className="text-sm font-semibold text-purple inline-flex items-center gap-1.5"><Plus className="w-4 h-4" />Adicionar outra criança</button>}
        </Secao>

        <Secao icone={ShieldCheck} titulo="Quem mais pode buscar (opcional)">
          {auts.map((a, i) => (
            <div key={i} className="grid grid-cols-[1fr_7rem_auto] gap-2 items-end">
              <Campo rotulo="Nome"><input className="campo" maxLength={120} value={a.nome} onChange={(e) => setA(i, { nome: e.target.value })} /></Campo>
              <Campo rotulo="Parentesco"><input className="campo" maxLength={40} placeholder="avó" value={a.parentesco} onChange={(e) => setA(i, { parentesco: e.target.value })} /></Campo>
              <button type="button" onClick={() => setAuts(auts.filter((_, j) => j !== i))} className="h-11 w-9 text-danger flex items-center justify-center" aria-label="Remover"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          {auts.length < 4 && <button type="button" onClick={() => setAuts([...auts, { nome: '', parentesco: '' }])} className="text-sm font-semibold text-purple inline-flex items-center gap-1.5"><Plus className="w-4 h-4" />Adicionar pessoa</button>}
          <p className="text-xs text-muted">A criança só sai com o código de retirada, mesmo para essas pessoas.</p>
        </Secao>

        <div className="rounded-xl bg-paper p-4 space-y-3">
          <p className="text-xs text-ink/80 whitespace-pre-line max-h-40 overflow-y-auto">{casa.termo}</p>
          <label className="flex items-start gap-3 text-sm font-semibold cursor-pointer"><input type="checkbox" className="mt-0.5 w-5 h-5 accent-[rgb(var(--c-purple))]" checked={termo} onChange={(e) => setTermo(e.target.checked)} />Li e aceito o termo de responsabilidade</label>
          <label className="flex items-start gap-3 text-sm cursor-pointer"><input type="checkbox" className="mt-0.5 w-5 h-5 accent-[rgb(var(--c-purple))]" checked={imagem} onChange={(e) => setImagem(e.target.checked)} />Autorizo fotos das crianças nas redes da casa (opcional)</label>
        </div>

        {/* campo-isca: escondido de quem usa a tela, robôs costumam preencher */}
        <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
          <label>Não preencha este campo<input tabIndex={-1} autoComplete="off" value={isca} onChange={(e) => setIsca(e.target.value)} /></label>
        </div>

        {erro && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-3" role="alert">{erro}</div>}
        <button type="submit" disabled={enviando} className="w-full h-12 rounded-xl bg-purple text-white font-semibold text-base disabled:opacity-60">{enviando ? 'Enviando...' : 'Enviar cadastro'}</button>
        <p className="text-[11px] text-muted text-center">Seus dados são usados só pela {nomeCasa} para controlar a entrada e a saída das crianças.</p>
      </form>
    </Tela>
  )
}

function Tela({ children, casa }: { children: React.ReactNode; casa?: Casa }) {
  return (
    <div className="min-h-screen bg-bg">
      <header className="bg-gradient-to-br from-purple to-purple-dark text-white px-4 py-5">
        <div className="max-w-md mx-auto flex items-center gap-3">
          {casa?.casa?.logo ? <img src={casa.casa.logo} alt="" className="w-11 h-11 rounded-xl bg-white/90 object-contain p-1" /> : <span className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center font-bold">{(casa?.casa?.nome ?? 'R').charAt(0)}</span>}
          <div><p className="font-semibold leading-tight">{casa?.casa?.nome ?? 'Recreação'}</p><p className="text-xs text-white/80">Cadastro da recreação</p></div>
        </div>
      </header>
      <main className="max-w-md mx-auto px-4 py-5">{children}</main>
    </div>
  )
}

function Secao({ icone: Ic, titulo, children }: { icone: typeof UserRound; titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-semibold flex items-center gap-2"><span className="w-7 h-7 rounded-lg bg-purple-light text-purple flex items-center justify-center"><Ic className="w-4 h-4" /></span>{titulo}</h2>
      {children}
    </section>
  )
}
const Campo = ({ rotulo, children }: { rotulo: string; children: React.ReactNode }) => <label className="block text-xs font-medium text-muted">{rotulo}<span className="block mt-1 text-ink">{children}</span></label>
