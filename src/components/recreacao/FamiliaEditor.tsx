import { useEffect, useRef, useState } from 'react'
import { UserRound, Baby, ShieldCheck, ScrollText, Plus, Trash2, Camera, AlertTriangle, X, Check, Save, Undo2, GitMerge, ChevronDown } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../lib/AuthContext'
import { useCompany } from '../../lib/CompanyContext'
import { Button } from '../ui/Button'
import { friendlyDbError } from '../../lib/format'
import {
  cpfValido, idadeAnos, idadeTexto, mascaraCpf, mascaraTelefone, soDigitos,
  type AutorizadoRec, type CriancaRec, type FamiliaRec, type FuncoesRec, type Parecida,
} from '../../lib/recreacao'

// Cadastro de uma família da recreação (nova ou existente). Usado na tela de
// Famílias e, na etapa 3, na entrada das crianças.

type Crianca = CriancaRec & { chave: string }
type Autorizado = AutorizadoRec & { chave: string }
interface Props {
  familiaId: string | null
  funcoes: FuncoesRec
  regras: Record<string, string | number>
  termo: string
  onSalvo: (id: string) => void
  onFechar: () => void
  onAbrirOutra: (id: string) => void
}

const novaChave = () => Math.random().toString(36).slice(2)
const vazia = (): Crianca => ({ chave: novaChave(), nome: '', nascimento: '', cuidados: '', ativo: true })

// Reduz a foto antes de enviar (o celular tira fotos enormes).
export async function reduzir(arquivo: File): Promise<Blob> {
  const url = URL.createObjectURL(arquivo)
  try {
    const img = await new Promise<HTMLImageElement>((ok, erro) => { const i = new Image(); i.onload = () => ok(i); i.onerror = erro; i.src = url })
    const lado = 720, esc = Math.min(1, lado / Math.max(img.width, img.height))
    const c = document.createElement('canvas')
    c.width = Math.round(img.width * esc); c.height = Math.round(img.height * esc)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return await new Promise<Blob>((ok, erro) => c.toBlob((b) => (b ? ok(b) : erro(new Error('foto'))), 'image/jpeg', 0.82))
  } finally { URL.revokeObjectURL(url) }
}

export function FamiliaEditor({ familiaId, funcoes, regras, termo, onSalvo, onFechar, onAbrirOutra }: Props) {
  const { can } = useAuth()
  const { brand } = useCompany()
  const pode = can('action:recreacao.familias_editar')
  const podeJuntar = can('action:recreacao.familias_juntar')
  const [carregando, setCarregando] = useState(!!familiaId)
  const [original, setOriginal] = useState<FamiliaRec | null>(null)
  const [resp, setResp] = useState({ responsavel: '', cpf: '', telefone: '', email: '', observacoes: '' })
  const [imagem, setImagem] = useState(false)
  const [termoOk, setTermoOk] = useState(false)
  const [verTermo, setVerTermo] = useState(false)
  const [criancas, setCriancas] = useState<Crianca[]>([vazia()])
  const [autorizados, setAutorizados] = useState<Autorizado[]>([])
  const [fotos, setFotos] = useState<Record<string, string>>({}) // chave -> url para mostrar
  const pendentes = useRef<Record<string, Blob>>({}) // chave -> foto ainda não enviada
  const [parecidas, setParecidas] = useState<Parecida[]>([])
  const [ignoradas, setIgnoradas] = useState<string[]>([])
  const [juntando, setJuntando] = useState<{ outra: Parecida; fica: 'este' | 'outro'; motivo: string } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  // ---------- carregar ----------
  useEffect(() => {
    if (!familiaId) return
    let vivo = true
    supabase.rpc('rec_familia_get', { p_id: familiaId }).then(async ({ data, error }) => {
      if (!vivo) return
      if (error || !data) { setErro(error ? friendlyDbError(error.message) : 'Família não encontrada.'); setCarregando(false); return }
      const f = data as FamiliaRec
      setOriginal(f)
      setResp({ responsavel: f.responsavel, cpf: mascaraCpf(f.cpf), telefone: mascaraTelefone(f.telefone), email: f.email ?? '', observacoes: f.observacoes ?? '' })
      setImagem(f.imagem_autorizada); setTermoOk(!!f.termo_aceito_em)
      const cs = f.criancas.map((c) => ({ ...c, cuidados: c.cuidados ?? '', chave: c.id! }))
      setCriancas(cs.length ? cs : [vazia()])
      setAutorizados(f.autorizados.map((a) => ({ ...a, chave: a.id! })))
      const comFoto = cs.filter((c) => c.foto_path)
      if (comFoto.length) {
        const { data: urls } = await supabase.storage.from('recreacao-fotos').createSignedUrls(comFoto.map((c) => c.foto_path!), 3600)
        if (vivo && urls) setFotos(Object.fromEntries(comFoto.map((c, i) => [c.chave, urls[i]?.signedUrl ?? ''])))
      }
      setCarregando(false)
    })
    return () => { vivo = false }
  }, [familiaId])

  // ---------- aviso de duplicado (enquanto digita) ----------
  const chaveBusca = JSON.stringify([soDigitos(resp.cpf), soDigitos(resp.telefone), resp.responsavel.trim(), criancas.filter((c) => c.ativo).map((c) => [c.nome.trim(), c.nascimento])])
  useEffect(() => {
    if (carregando) return
    const cpf = soDigitos(resp.cpf), tel = soDigitos(resp.telefone)
    if (cpf.length < 11 && tel.length < 10 && resp.responsavel.trim().length < 5 && !criancas.some((c) => c.nascimento && c.nome.trim().length > 2)) { setParecidas([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('rec_familia_parecidas', {
        p_ignorar: familiaId, p_cpf: cpf.length === 11 ? cpf : null, p_telefone: tel.length >= 10 ? tel : null, p_responsavel: resp.responsavel,
        p_criancas: criancas.filter((c) => c.ativo && c.nascimento).map((c) => ({ nome: c.nome, nascimento: c.nascimento })),
      })
      setParecidas((data ?? []) as Parecida[])
    }, 450)
    return () => clearTimeout(t)
  }, [chaveBusca, carregando]) // eslint-disable-line react-hooks/exhaustive-deps

  const cpfDig = soDigitos(resp.cpf)
  const cpfErrado = cpfDig.length > 0 && (cpfDig.length < 11 || !cpfValido(cpfDig))
  const bloqueio = parecidas.find((p) => p.bloqueia)
  const avisos = parecidas.filter((p) => !p.bloqueia && !ignoradas.includes(p.id))
  const ativas = criancas.filter((c) => c.ativo)
  const idMin = Number(regras.idMin ?? 0), idMax = Number(regras.idMax ?? 17)

  // ---------- foto ----------
  async function escolherFoto(chave: string, arquivo: File | undefined) {
    if (!arquivo) return
    try {
      const blob = await reduzir(arquivo)
      pendentes.current[chave] = blob
      setFotos((f) => ({ ...f, [chave]: URL.createObjectURL(blob) }))
    } catch { setErro('Não consegui ler a foto. Tente de novo.') }
  }
  async function enviarFotos(familia: FamiliaRec) {
    for (const [chave, blob] of Object.entries(pendentes.current)) {
      const local = criancas.find((c) => c.chave === chave)
      const salva = familia.criancas.find((c) => (local?.id ? c.id === local.id : c.nome.trim() === local?.nome.trim() && c.nascimento === local?.nascimento))
      if (!salva?.id || !brand.companyId) continue
      const path = `${brand.companyId}/${salva.id}.jpg`
      const up = await supabase.storage.from('recreacao-fotos').upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
      if (up.error) { setErro('O cadastro foi salvo, mas a foto não subiu. Tente tirar de novo.'); continue }
      await supabase.rpc('rec_crianca_foto', { p_crianca: salva.id, p_path: path })
      delete pendentes.current[chave]
    }
  }

  // ---------- salvar ----------
  async function salvar() {
    setErro(null)
    if (cpfErrado) return setErro('Confira o CPF.')
    if (!familiaId && !termoOk) return setErro('Marque que o responsável aceitou o termo de responsabilidade.')
    if (funcoes.foto !== 'nao' && funcoes.fotoObrig && funcoes.foto === 'cadastro' && ativas.some((c) => !fotos[c.chave])) return setErro('Tire a foto de cada criança.')
    setSalvando(true)
    const { data, error } = await supabase.rpc('rec_familia_salvar', {
      p_id: familiaId,
      p_dados: {
        responsavel: resp.responsavel, cpf: cpfDig || null, telefone: soDigitos(resp.telefone), email: resp.email || null,
        imagem_autorizada: imagem, termo_aceito: termoOk, observacoes: resp.observacoes,
        criancas: criancas.filter((c) => c.id || (c.ativo && (c.nome.trim() || c.nascimento))).map(({ id, nome, nascimento, cuidados, ativo }) => ({ id, nome, nascimento, cuidados, ativo })),
        autorizados: autorizados.filter((a) => a.id || a.nome.trim()).map(({ id, nome, documento, parentesco, ativo }) => ({ id, nome, documento, parentesco, ativo })),
      },
    })
    if (error) { setSalvando(false); return setErro(friendlyDbError(error.message)) }
    const id = data as string
    if (Object.keys(pendentes.current).length) {
      const { data: f } = await supabase.rpc('rec_familia_get', { p_id: id })
      if (f) await enviarFotos(f as FamiliaRec)
    }
    setSalvando(false)
    onSalvo(id)
  }

  async function juntar() {
    if (!juntando || !familiaId) return
    const fica = juntando.fica === 'este' ? familiaId : juntando.outra.id
    const sai = juntando.fica === 'este' ? juntando.outra.id : familiaId
    const { error } = await supabase.rpc('rec_familias_juntar', { p_ficar: fica, p_sair: sai, p_motivo: juntando.motivo })
    if (error) return setErro(friendlyDbError(error.message))
    setJuntando(null)
    onAbrirOutra(fica)
  }

  if (carregando) return <div className="py-10 text-center text-sm text-muted">Carregando...</div>

  const setC = (chave: string, p: Partial<Crianca>) => setCriancas((l) => l.map((c) => (c.chave === chave ? { ...c, ...p } : c)))
  const setA = (chave: string, p: Partial<Autorizado>) => setAutorizados((l) => l.map((a) => (a.chave === chave ? { ...a, ...p } : a)))

  return (
    <div className="space-y-6">
      {/* avisos de duplicado */}
      {(bloqueio || avisos.length > 0) && (
        <div className="space-y-2">
          {bloqueio && (
            <div className="rounded-xl bg-danger-light text-danger px-4 py-3 text-sm">
              <p className="font-semibold">Este CPF já é de {bloqueio.responsavel}.</p>
              <p className="text-xs mt-0.5">Crianças: {bloqueio.criancas.join(', ') || '—'}. Não dá para cadastrar o mesmo CPF duas vezes.</p>
              <button type="button" onClick={() => onAbrirOutra(bloqueio.id)} className="mt-2 text-xs font-semibold underline">Abrir o cadastro de {bloqueio.responsavel.split(' ')[0]}</button>
            </div>
          )}
          {avisos.map((p) => (
            <div key={p.id} className="rounded-xl bg-amber-light text-amber px-4 py-3 text-sm">
              <p className="font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" />Pode ser a família de {p.responsavel}{p.cpf ? ` (CPF ${p.cpf})` : ''}</p>
              <p className="text-xs mt-0.5">{p.motivos.join(' · ')}. Crianças: {p.criancas.join(', ') || '—'}.</p>
              <div className="flex flex-wrap gap-3 mt-2 text-xs font-semibold">
                <button type="button" onClick={() => onAbrirOutra(p.id)} className="underline">É a mesma: abrir esse cadastro</button>
                {familiaId && podeJuntar && <button type="button" onClick={() => setJuntando({ outra: p, fica: 'este', motivo: '' })} className="underline inline-flex items-center gap-1"><GitMerge className="w-3.5 h-3.5" />Juntar os dois cadastros</button>}
                <button type="button" onClick={() => setIgnoradas((l) => [...l, p.id])} className="opacity-80">É outra família</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {juntando && familiaId && (
        <div className="rounded-xl border-2 border-purple/30 bg-purple-light/40 p-4 space-y-3 animate-card-in">
          <p className="font-semibold flex items-center gap-2"><GitMerge className="w-4 h-4 text-purple" />Juntar com o cadastro de {juntando.outra.responsavel}</p>
          <p className="text-xs text-muted">As crianças e as pessoas autorizadas dos dois cadastros ficam num só. O outro cadastro não é apagado: fica marcado como juntado.</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {(['este', 'outro'] as const).map((k) => (
              <button key={k} type="button" onClick={() => setJuntando({ ...juntando, fica: k })} aria-pressed={juntando.fica === k}
                className={`text-left rounded-lg border-2 px-3 py-2 text-sm ${juntando.fica === k ? 'border-purple bg-surface' : 'border-line bg-surface/60'}`}>
                Fica o cadastro de <b>{k === 'este' ? resp.responsavel || 'este' : juntando.outra.responsavel}</b>
              </button>
            ))}
          </div>
          <input className="campo" value={juntando.motivo} onChange={(e) => setJuntando({ ...juntando, motivo: e.target.value })} placeholder="Motivo (ex.: cadastro feito duas vezes)" />
          <div className="flex gap-2">
            <Button onClick={juntar} disabled={juntando.motivo.trim().length < 3}><GitMerge className="w-4 h-4" />Juntar</Button>
            <Button variant="ghost" onClick={() => setJuntando(null)}>Cancelar</Button>
          </div>
        </div>
      )}

      <fieldset disabled={!pode} className="space-y-6 min-w-0">
        {/* responsável */}
        <Secao icone={UserRound} titulo="Responsável">
          <div className="grid sm:grid-cols-2 gap-3">
            <Campo label="Nome completo"><input className="campo" value={resp.responsavel} onChange={(e) => setResp({ ...resp, responsavel: e.target.value })} autoComplete="off" /></Campo>
            <Campo label="CPF" erro={cpfErrado ? 'CPF incompleto ou inválido' : undefined}>
              <input className="campo" inputMode="numeric" value={resp.cpf} onChange={(e) => setResp({ ...resp, cpf: mascaraCpf(e.target.value) })} placeholder="000.000.000-00" />
            </Campo>
            <Campo label="WhatsApp"><input className="campo" inputMode="tel" value={resp.telefone} onChange={(e) => setResp({ ...resp, telefone: mascaraTelefone(e.target.value) })} placeholder="(00) 00000-0000" /></Campo>
            <Campo label="E-mail (opcional)"><input className="campo" inputMode="email" value={resp.email} onChange={(e) => setResp({ ...resp, email: e.target.value })} /></Campo>
          </div>
        </Secao>

        {/* crianças */}
        <Secao icone={Baby} titulo={`Crianças (${ativas.length})`}>
          <div className="space-y-3">
            {criancas.map((c) => {
              if (!c.ativo) return null
              const anos = c.nascimento ? idadeAnos(c.nascimento) : null
              const fora = anos != null && (anos < idMin || anos > idMax)
              return (
                <div key={c.chave} className="rounded-xl border border-line bg-paper/50 p-3 flex flex-col sm:flex-row gap-3">
                  {funcoes.foto !== 'nao' && (
                    <label className={`relative w-20 h-20 rounded-xl shrink-0 overflow-hidden flex items-center justify-center cursor-pointer border-2 border-dashed ${fotos[c.chave] ? 'border-transparent' : 'border-line bg-surface hover:border-purple/40'}`} title="Tirar ou trocar a foto">
                      {fotos[c.chave] ? <img src={fotos[c.chave]} alt={`Foto de ${c.nome}`} className="w-full h-full object-cover" /> : <span className="flex flex-col items-center text-[10px] text-muted"><Camera className="w-5 h-5 mb-0.5" />foto</span>}
                      <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => escolherFoto(c.chave, e.target.files?.[0])} />
                    </label>
                  )}
                  <div className="flex-1 grid sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3 min-w-0">
                    <Campo label="Nome da criança"><input className="campo" value={c.nome} onChange={(e) => setC(c.chave, { nome: e.target.value })} /></Campo>
                    <Campo label={`Nascimento${c.nascimento ? ` · ${idadeTexto(c.nascimento)}` : ''}`}>
                      <input className="campo" type="date" value={c.nascimento} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setC(c.chave, { nascimento: e.target.value })} />
                    </Campo>
                    <div className="sm:col-span-2">
                      <Campo label="Alergias, remédios e cuidados">
                        <input className={`campo ${c.cuidados ? '!border-danger/40 !bg-danger-light/40' : ''}`} value={c.cuidados ?? ''} onChange={(e) => setC(c.chave, { cuidados: e.target.value })} placeholder="Deixe em branco se não tiver" />
                      </Campo>
                      {fora && <p className="text-[11px] text-amber mt-1">Fora da idade da casa ({idMin} a {idMax} anos).</p>}
                    </div>
                  </div>
                  {pode && ativas.length > 1 && (
                    <button type="button" onClick={() => (c.id ? setC(c.chave, { ativo: false }) : setCriancas((l) => l.filter((x) => x.chave !== c.chave)))}
                      className="self-start text-muted hover:text-danger" title="Tirar do cadastro" aria-label={`Tirar ${c.nome || 'criança'} do cadastro`}><Trash2 className="w-4 h-4" /></button>
                  )}
                </div>
              )
            })}
            {pode && (
              <button type="button" onClick={() => setCriancas((l) => [...l, vazia()])} className="w-full rounded-xl border-2 border-dashed border-line py-2.5 text-sm font-semibold text-purple hover:border-purple/40 hover:bg-purple-light/30 inline-flex items-center justify-center gap-1.5">
                <Plus className="w-4 h-4" />Adicionar criança
              </button>
            )}
            {criancas.some((c) => !c.ativo) && (
              <p className="text-[11px] text-muted">Fora do cadastro (ficam no histórico): {criancas.filter((c) => !c.ativo).map((c) => c.nome).join(', ')}
                {pode && <> · <button type="button" className="underline" onClick={() => setCriancas((l) => l.map((c) => ({ ...c, ativo: true })))}>voltar todas</button></>}
              </p>
            )}
          </div>
        </Secao>

        {/* autorizados */}
        <Secao icone={ShieldCheck} titulo="Quem mais pode buscar" dica="Além do responsável. Na saída, a recepção confere o nome e o documento.">
          <div className="space-y-2">
            {autorizados.filter((a) => a.ativo).map((a) => (
              <div key={a.chave} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 items-end rounded-xl sm:rounded-none border sm:border-0 border-line p-2 sm:p-0">
                <Campo label="Nome"><input className="campo" value={a.nome} onChange={(e) => setA(a.chave, { nome: e.target.value })} /></Campo>
                <Campo label="Documento"><input className="campo" value={a.documento ?? ''} onChange={(e) => setA(a.chave, { documento: e.target.value })} placeholder="RG ou CPF" /></Campo>
                <Campo label="Parentesco"><input className="campo" value={a.parentesco ?? ''} onChange={(e) => setA(a.chave, { parentesco: e.target.value })} placeholder="avó, tio, babá" /></Campo>
                {pode && <button type="button" onClick={() => (a.id ? setA(a.chave, { ativo: false }) : setAutorizados((l) => l.filter((x) => x.chave !== a.chave)))} className="mb-2.5 text-muted hover:text-danger" aria-label={`Tirar ${a.nome || 'pessoa'}`}><Trash2 className="w-4 h-4" /></button>}
              </div>
            ))}
            {pode && <button type="button" onClick={() => setAutorizados((l) => [...l, { chave: novaChave(), nome: '', documento: '', parentesco: '', ativo: true }])} className="text-sm font-semibold text-purple inline-flex items-center gap-1"><Plus className="w-4 h-4" />Autorizar outra pessoa</button>}
          </div>
        </Secao>

        {/* termo */}
        <Secao icone={ScrollText} titulo="Termo e autorização de imagem">
          {original?.termo_aceito_em ? (
            <p className="text-sm flex items-center gap-2 text-teal"><Check className="w-4 h-4" />Termo aceito em {new Date(original.termo_aceito_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}{original.termo_registrado_por ? ` · registrado por ${original.termo_registrado_por}` : ''}</p>
          ) : (
            <div className="rounded-xl border border-line bg-paper/50 p-3">
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input type="checkbox" className="mt-0.5" checked={termoOk} onChange={(e) => setTermoOk(e.target.checked)} />
                <span>O responsável leu e aceitou o termo de responsabilidade{!familiaId && <span className="text-danger"> *</span>}</span>
              </label>
              <button type="button" onClick={() => setVerTermo((v) => !v)} className="mt-1 ml-6 text-xs text-purple inline-flex items-center gap-1">{verTermo ? 'Esconder' : 'Ler'} o termo<ChevronDown className={`w-3 h-3 transition-transform ${verTermo ? 'rotate-180' : ''}`} /></button>
              {verTermo && <p className="mt-2 ml-6 text-xs text-muted whitespace-pre-line leading-relaxed">{termo}</p>}
            </div>
          )}
          <label className="flex items-start gap-2 text-sm cursor-pointer mt-3">
            <input type="checkbox" className="mt-0.5" checked={imagem} onChange={(e) => setImagem(e.target.checked)} />
            <span>Autoriza fotos das crianças nas redes da casa</span>
          </label>
          <div className="mt-4" /><Campo label="Observações (só a equipe vê)"><textarea className="campo min-h-[60px]" value={resp.observacoes} onChange={(e) => setResp({ ...resp, observacoes: e.target.value })} /></Campo>
        </Secao>
      </fieldset>

      {erro && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5 flex justify-between gap-2">{erro}<button onClick={() => setErro(null)} aria-label="Fechar aviso"><X className="w-4 h-4" /></button></div>}

      <div className="flex flex-wrap items-center gap-2 pt-4 border-t border-line">
        {pode && <Button onClick={salvar} disabled={salvando || !!bloqueio}><Save className="w-4 h-4" />{salvando ? 'Salvando...' : familiaId ? 'Salvar alterações' : 'Cadastrar família'}</Button>}
        <Button variant="ghost" onClick={onFechar}><Undo2 className="w-4 h-4" />{pode ? 'Cancelar' : 'Fechar'}</Button>
        {original?.atualizado_em && (
          <span className="text-[11px] text-muted ml-auto">
            Cadastrado {original.criado_por ? `por ${original.criado_por} ` : ''}em {new Date(original.criado_em!).toLocaleDateString('pt-BR')}
            {original.atualizado_por && original.atualizado_em !== original.criado_em ? ` · alterado por ${original.atualizado_por} em ${new Date(original.atualizado_em).toLocaleDateString('pt-BR')}` : ''}
          </span>
        )}
      </div>
    </div>
  )
}

function Secao({ icone: Icone, titulo, dica, children }: { icone: typeof UserRound; titulo: string; dica?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <span className="w-7 h-7 rounded-lg bg-purple-light text-purple flex items-center justify-center"><Icone className="w-4 h-4" /></span>
        <div><h3 className="font-semibold leading-tight">{titulo}</h3>{dica && <p className="text-[11px] text-muted">{dica}</p>}</div>
      </div>
      {children}
    </section>
  )
}

function Campo({ label, erro, children }: { label: string; erro?: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="block text-xs font-medium text-muted mb-1">{label}</span>
      {children}
      {erro && <span className="block text-[11px] text-danger mt-1">{erro}</span>}
    </label>
  )
}
