import { FormEvent, useEffect, useState } from 'react'
import { Plus, X, Building2, Ban, CheckCircle2, Copy, LogIn, AlertTriangle, Trash2, Download } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { supabase } from '../lib/supabaseClient'
import { useCompany } from '../lib/CompanyContext'
import { friendlyDbError } from '../lib/format'
import { MODULOS } from '../lib/modules'

// Painel do administrador geral: casas de festa que usam o sistema. Só quem
// está na lista de administradores gerais vê (no banco dos clientes).

interface Empresa {
  id: string
  name: string
  active: boolean
  created_at: string
  disabled_modules: string[]
  usuarios: number
  unidades: number
  festas: number
  festas_30d: number
  ultima_atividade: string | null
}

const dataBr = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—')
const diasSemUso = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null)
const SEM_USO_ALERTA = 14

interface CopiaExcluida {
  id: string
  nome: string
  excluida_em: string
  arquivos: number
  logins: number
  tamanho_kb: number
}

// Erro de regra da função de servidor volta no corpo da resposta (status 400).
async function erroDaFuncao(data: unknown, err: unknown, padrao: string): Promise<string | null> {
  let msg: string | null = (data as { error?: string } | null)?.error ?? null
  if (err && !msg) {
    try {
      const corpo = await (err as { context?: Response }).context?.json()
      msg = corpo?.error ?? null
    } catch {
      // sem corpo legível
    }
    msg = msg ?? padrao
  }
  return msg
}

// Baixa a cópia guardada de uma empresa excluída (arquivo .json com todos os dados).
async function baixarCopia(id: string, nome: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('platform_deleted_company_copy', { p_id: id })
  if (error || !data) return 'Não foi possível baixar a cópia. Tente de novo em "Cópias de empresas excluídas".'
  const slug = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `copia-${slug}-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
  return null
}

// Senha provisória fácil de ditar (o cliente troca depois).
function senhaProvisoria() {
  const letras = 'abcdefghjkmnpqrstuvwxyz'
  const r = (n: number) => Array.from({ length: n }, () => letras[Math.floor(Math.random() * letras.length)]).join('')
  return `${r(4)}-${Math.floor(1000 + Math.random() * 9000)}-${r(4)}`
}

export function Platform() {
  const { isPlatformAdmin, brandLoading, brand, enterCompany } = useCompany()
  const [abrindo, setAbrindo] = useState<string | null>(null)
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editando, setEditando] = useState<Empresa | null>(null)
  const [nova, setNova] = useState<{ empresa: string; admin_nome: string; email: string; senha: string } | null>(null)
  const [criada, setCriada] = useState<{ empresa: string; email: string; senha: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [produto, setProduto] = useState({ name: '', tagline: '', logo_url: '' })
  const [produtoMsg, setProdutoMsg] = useState<string | null>(null)
  const [copias, setCopias] = useState<CopiaExcluida[]>([])
  const [confirmaNome, setConfirmaNome] = useState('')
  const [excluindo, setExcluindo] = useState(false)
  const [excluida, setExcluida] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const [{ data, error: err }, { data: cfg }, { data: cop }] = await Promise.all([
      supabase.rpc('platform_list_companies'), supabase.rpc('platform_get_settings'), supabase.rpc('platform_list_deleted_companies'),
    ])
    setLoading(false)
    setCopias((cop ?? []) as CopiaExcluida[]) // vazio antes da migração 076
    if (err) return setError(friendlyDbError(err.message))
    setEmpresas((data ?? []) as Empresa[])
    const c = ((cfg ?? []) as { name: string; tagline: string | null; logo_url: string | null }[])[0]
    if (c) setProduto({ name: c.name, tagline: c.tagline ?? '', logo_url: c.logo_url ?? '' })
  }

  useEffect(() => {
    if (isPlatformAdmin) load()
  }, [isPlatformAdmin])

  async function salvarEmpresa(e: FormEvent) {
    e.preventDefault()
    if (!editando) return
    setSaving(true)
    const { error: err } = await supabase.rpc('platform_update_company', {
      p_company: editando.id, p_name: editando.name, p_active: editando.active, p_disabled_modules: editando.disabled_modules,
    })
    setSaving(false)
    if (err) return setError(friendlyDbError(err.message))
    setEditando(null)
    setError(null)
    await load()
  }

  async function criarEmpresa(e: FormEvent) {
    e.preventDefault()
    if (!nova) return
    if (nova.senha.length < 8) return setError('A senha provisória precisa ter pelo menos 8 caracteres.')
    setSaving(true)
    const { data, error: err } = await supabase.functions.invoke('platform-admin', { body: { action: 'create_company', ...nova } })
    setSaving(false)
    const msg = await erroDaFuncao(data, err, 'Não foi possível criar a empresa. Confira se a função "platform-admin" foi publicada no Supabase.')
    if (msg) return setError(msg)
    setCriada({ empresa: nova.empresa, email: nova.email, senha: nova.senha })
    setNova(null)
    setError(null)
    await load()
  }

  async function excluirEmpresa() {
    if (!editando) return
    const nome = editando.name
    setExcluindo(true)
    const { data, error: err } = await supabase.functions.invoke('platform-admin', {
      body: { action: 'delete_company', company_id: editando.id, confirm_name: confirmaNome },
    })
    const msg = await erroDaFuncao(data, err, 'Não foi possível excluir. Confira se a migração 076 rodou e se a função "platform-admin" foi atualizada no Supabase.')
    if (msg) {
      setExcluindo(false)
      return setError(msg)
    }
    const r = data as { copia_id: string; arquivos_apagados: number; arquivos_falha: number; logins_apagados: number; logins_falha: number }
    const erroCopia = await baixarCopia(r.copia_id, nome)
    setExcluindo(false)
    setEditando(null)
    setConfirmaNome('')
    setError(erroCopia)
    const falhas = r.arquivos_falha + r.logins_falha
    setExcluida(`${nome} foi excluída: ${r.arquivos_apagados} ${r.arquivos_apagados === 1 ? 'arquivo apagado' : 'arquivos apagados'} e ${r.logins_apagados} ${r.logins_apagados === 1 ? 'login apagado' : 'logins apagados'}.`
      + (erroCopia ? '' : ' A cópia dos dados foi baixada para o seu computador.')
      + (falhas > 0 ? ` Atenção: ${falhas} ${falhas === 1 ? 'item não pôde' : 'itens não puderam'} ser apagado(s); os dados da empresa já saíram, então ninguém acessa.` : ''))
    await load()
  }

  async function apagarCopia(c: CopiaExcluida) {
    if (!window.confirm(`Apagar de vez a cópia guardada de "${c.nome}"? Depois disso os dados dela só existem no arquivo que você baixou.`)) return
    const { error: err } = await supabase.rpc('platform_drop_deleted_copy', { p_id: c.id })
    if (err) return setError(friendlyDbError(err.message))
    await load()
  }

  async function salvarProduto(e: FormEvent) {
    e.preventDefault()
    const { error: err } = await supabase.rpc('platform_save_settings', { p_name: produto.name, p_logo_url: produto.logo_url, p_tagline: produto.tagline })
    setProdutoMsg(err ? friendlyDbError(err.message) : 'Salvo. A tela de login mostra este nome para quem ainda não entrou.')
  }

  async function abrir(c: Empresa) {
    setAbrindo(c.id)
    const erro = await enterCompany(c.id)
    if (erro) {
      setAbrindo(null)
      setError(erro)
    }
  }

  const ativas = empresas.filter((c) => c.active)
  const paradas = ativas.filter((c) => (diasSemUso(c.ultima_atividade) ?? 9999) >= SEM_USO_ALERTA)
  const resumo = [
    { rotulo: 'Empresas ativas', valor: ativas.length, alerta: false },
    { rotulo: 'Suspensas', valor: empresas.length - ativas.length, alerta: empresas.length - ativas.length > 0 },
    { rotulo: 'Festas novas (30 dias)', valor: empresas.reduce((t, c) => t + c.festas_30d, 0), alerta: false },
    { rotulo: `Sem uso há ${SEM_USO_ALERTA}+ dias`, valor: paradas.length, alerta: paradas.length > 0 },
  ]

  if (brandLoading) return <p className="text-sm text-muted">Carregando...</p>
  if (!isPlatformAdmin) {
    return <Card><p className="text-sm text-muted">Esta área é só do administrador geral da plataforma.</p></Card>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Painel da plataforma</h1>
          <p className="text-sm text-muted mt-1">
            Casas de festa que usam o sistema. Aqui aparecem só os números gerais; para trabalhar dentro de uma empresa, clique em <strong>Abrir</strong>.
            {brand.companyId && <> Você está com <strong>{brand.name}</strong> aberta.</>}
          </p>
        </div>
        <Button onClick={() => setNova({ empresa: '', admin_nome: '', email: '', senha: senhaProvisoria() })}><Plus className="w-4 h-4" /> Nova empresa</Button>
      </div>

      {error && !nova && !editando && (
        <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5 flex justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Fechar"><X className="w-4 h-4" /></button>
        </div>
      )}

      {excluida && (
        <Card className="border-teal/40">
          <p className="text-sm flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-teal shrink-0 mt-0.5" /> {excluida}</p>
          <button onClick={() => setExcluida(null)} className="text-xs text-muted mt-2">Fechar</button>
        </Card>
      )}

      {criada && (
        <Card className="border-teal/40">
          <p className="font-semibold text-sm flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-teal" /> {criada.empresa} criada</p>
          <p className="text-sm mt-2">Clique em <strong>Abrir</strong> na lista para configurar a empresa (unidades, pacotes, cardápio). Este é o login do administrador do cliente — passe para ele trocar a senha no primeiro acesso:</p>
          <div className="mt-2 bg-paper rounded-lg px-3 py-2 text-sm font-mono flex flex-wrap items-center gap-3">
            <span>{criada.email}</span>
            <span>senha: {criada.senha}</span>
            <button onClick={() => navigator.clipboard?.writeText(`${criada.email} / ${criada.senha}`).catch(() => {})} className="text-purple text-xs font-sans flex items-center gap-1"><Copy className="w-3.5 h-3.5" /> Copiar</button>
          </div>
          <p className="text-xs text-muted mt-2">Guarde agora: por segurança a senha não aparece de novo.</p>
          <button onClick={() => setCriada(null)} className="text-xs text-muted mt-2">Fechar</button>
        </Card>
      )}

      {!loading && empresas.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {resumo.map((r) => (
            <div key={r.rotulo} className={`rounded-card border px-4 py-3 bg-surface ${r.alerta ? 'border-amber/50' : 'border-line'}`}>
              <p className="text-xs text-muted">{r.rotulo}</p>
              <p className={`text-2xl font-display font-semibold tabular-nums ${r.alerta ? 'text-amber' : ''}`}>{r.valor}</p>
            </div>
          ))}
        </div>
      )}

      <Card title={`Empresas${empresas.length ? ` · ${empresas.length}` : ''}`}>
        {loading ? (
          <p className="text-sm text-muted py-6 text-center">Carregando...</p>
        ) : empresas.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma empresa ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="pb-3 font-medium">Empresa</th>
                  <th className="pb-3 font-medium">Situação</th>
                  <th className="pb-3 font-medium text-right">Usuários</th>
                  <th className="pb-3 font-medium text-right">Unidades</th>
                  <th className="pb-3 font-medium text-right">Festas</th>
                  <th className="pb-3 font-medium text-right">Novas 30 dias</th>
                  <th className="pb-3 font-medium">Último uso</th>
                  <th className="pb-3 font-medium">Desde</th>
                  <th className="pb-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {empresas.map((c) => (
                  <tr key={c.id}>
                    <td className="py-3 font-medium">
                      <span className="flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5 text-muted" /> {c.name}</span>
                      {c.disabled_modules.length > 0 && (
                        <span className="block text-[11px] text-muted font-normal">Desligado: {c.disabled_modules.map((id) => MODULOS.find((m) => m.id === id)?.label ?? id).join(', ')}</span>
                      )}
                    </td>
                    <td className="py-3">{c.active ? <Badge tone="teal">Ativa</Badge> : <Badge tone="danger">Suspensa</Badge>}</td>
                    <td className="py-3 text-right tabular-nums">{c.usuarios}</td>
                    <td className="py-3 text-right tabular-nums">{c.unidades}</td>
                    <td className="py-3 text-right tabular-nums">{c.festas}</td>
                    <td className="py-3 text-right tabular-nums">{c.festas_30d}</td>
                    <td className="py-3">
                      {(() => {
                        const d = diasSemUso(c.ultima_atividade)
                        const alerta = c.active && (d === null || d >= SEM_USO_ALERTA)
                        return (
                          <span className={`flex items-center gap-1 ${alerta ? 'text-amber font-medium' : 'text-muted'}`}>
                            {alerta && <AlertTriangle className="w-3.5 h-3.5" />}
                            {d === null ? 'nunca usou' : d === 0 ? 'hoje' : d === 1 ? 'ontem' : `há ${d} dias`}
                          </span>
                        )
                      })()}
                    </td>
                    <td className="py-3 text-muted">{dataBr(c.created_at)}</td>
                    <td className="py-3 text-right whitespace-nowrap">
                      <span className="inline-flex gap-2">
                        <Button className="text-xs px-3 py-1.5" disabled={abrindo !== null} onClick={() => abrir(c)}>
                          <LogIn className="w-3.5 h-3.5" /> {abrindo === c.id ? 'Abrindo...' : brand.companyId === c.id ? 'Aberta' : 'Abrir'}
                        </Button>
                        <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={() => setEditando({ ...c, disabled_modules: [...c.disabled_modules] })}>Gerenciar</Button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {copias.length > 0 && (
        <Card title="Cópias de empresas excluídas">
          <p className="text-xs text-muted mb-3">Os dados de cada empresa excluída ficam guardados aqui para você baixar de novo se precisar. Quando não precisar mais, apague a cópia (pela LGPD, não guarde dados de clientes sem necessidade).</p>
          <div className="divide-y divide-line">
            {copias.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                <div>
                  <p className="font-medium">{c.nome}</p>
                  <p className="text-xs text-muted">Excluída em {dataBr(c.excluida_em)} · {c.tamanho_kb < 1024 ? `${Math.max(c.tamanho_kb, 1)} KB` : `${(c.tamanho_kb / 1024).toFixed(1).replace('.', ',')} MB`}</p>
                </div>
                <span className="inline-flex gap-2">
                  <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={async () => setError(await baixarCopia(c.id, c.nome))}><Download className="w-3.5 h-3.5" /> Baixar cópia</Button>
                  <button onClick={() => apagarCopia(c)} className="text-xs text-muted hover:text-danger px-2">Apagar cópia</button>
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="Produto (tela de login)">
        <form onSubmit={salvarProduto} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div>
            <label className="block text-xs text-muted mb-1">Nome do sistema *</label>
            <input required value={produto.name} onChange={(e) => setProduto({ ...produto, name: e.target.value })} placeholder="Ex: Gestão de Festas" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Frase (opcional)</label>
            <input value={produto.tagline} onChange={(e) => setProduto({ ...produto, tagline: e.target.value })} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Endereço da logo (opcional)</label>
            <input value={produto.logo_url} onChange={(e) => setProduto({ ...produto, logo_url: e.target.value })} placeholder="https://..." className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="md:col-span-3 flex items-center gap-3">
            <Button type="submit">Salvar</Button>
            {produtoMsg && <span className="text-xs text-muted">{produtoMsg}</span>}
          </div>
        </form>
        <p className="text-xs text-muted mt-2">Quem ainda não entrou não sabe de qual empresa é, então a tela de login mostra o nome do sistema. Depois de entrar, cada um vê o nome e a logo da própria empresa.</p>
      </Card>

      {nova && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setNova(null)} />
          <div className="relative w-full max-w-md bg-surface rounded-card p-6 shadow-xl max-h-[90vh] overflow-y-auto overscroll-contain">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-display font-semibold">Nova empresa</h2>
              <button onClick={() => setNova(null)} className="text-muted hover:text-ink" aria-label="Fechar"><X className="w-5 h-5" /></button>
            </div>
            {error && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5 mb-3">{error}</div>}
            <form onSubmit={criarEmpresa} className="space-y-3">
              <div>
                <label className="block text-xs text-muted mb-1">Nome da casa de festas *</label>
                <input autoFocus required value={nova.empresa} onChange={(e) => setNova({ ...nova, empresa: e.target.value })} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Nome do administrador *</label>
                <input required value={nova.admin_nome} onChange={(e) => setNova({ ...nova, admin_nome: e.target.value })} placeholder="Quem vai administrar o sistema lá" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">E-mail de login *</label>
                <input required type="email" value={nova.email} onChange={(e) => setNova({ ...nova, email: e.target.value })} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Senha provisória *</label>
                <input required value={nova.senha} onChange={(e) => setNova({ ...nova, senha: e.target.value })} className="w-full border border-line rounded-lg px-3 py-2 text-sm font-mono" />
                <p className="text-[11px] text-muted mt-1">Você usa para configurar e depois o cliente troca.</p>
              </div>
              <p className="text-xs text-muted bg-paper rounded-lg px-3 py-2">A empresa nasce com o perfil Administrador, as formas de pagamento e o visual padrão. Depois, clique em Abrir para cadastrar as unidades e configurar o resto antes de entregar ao cliente.</p>
              <Button type="submit" className="w-full justify-center" disabled={saving}>{saving ? 'Criando...' : 'Criar empresa'}</Button>
            </form>
          </div>
        </div>
      )}

      {editando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => { setEditando(null); setConfirmaNome('') }} />
          <div className="relative w-full max-w-lg bg-surface rounded-card p-6 shadow-xl max-h-[90vh] overflow-y-auto overscroll-contain">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-display font-semibold">{editando.name}</h2>
              <button onClick={() => { setEditando(null); setConfirmaNome('') }} className="text-muted hover:text-ink" aria-label="Fechar"><X className="w-5 h-5" /></button>
            </div>
            {error && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5 mb-3">{error}</div>}
            <form onSubmit={salvarEmpresa} className="space-y-4">
              <div>
                <label className="block text-xs text-muted mb-1">Nome da empresa</label>
                <input required value={editando.name} onChange={(e) => setEditando({ ...editando, name: e.target.value })} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <p className="text-xs text-muted mb-2">Funções ligadas para esta empresa</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {MODULOS.map((m) => {
                    const ligado = !editando.disabled_modules.includes(m.id)
                    return (
                      <label key={m.id} className="flex items-start gap-2 text-sm bg-paper rounded-lg px-3 py-2 cursor-pointer">
                        <input type="checkbox" checked={ligado} className="mt-0.5"
                          onChange={(e) => setEditando({ ...editando, disabled_modules: e.target.checked ? editando.disabled_modules.filter((x) => x !== m.id) : [...editando.disabled_modules, m.id] })} />
                        <span>{m.label}<span className="block text-[11px] text-muted">{m.descricao}</span></span>
                      </label>
                    )
                  })}
                </div>
              </div>
              <label className={`flex items-start gap-2 text-sm rounded-lg px-3 py-2.5 cursor-pointer ${editando.active ? 'bg-paper' : 'bg-danger-light'}`}>
                <input type="checkbox" checked={!editando.active} onChange={(e) => setEditando({ ...editando, active: !e.target.checked })} className="mt-0.5" />
                <span className="flex items-center gap-1.5"><Ban className="w-4 h-4 text-danger" /> Suspender acesso
                  <span className="block text-[11px] text-muted ml-1">Ninguém da empresa consegue entrar (ex.: pagamento atrasado). Os dados ficam guardados.</span>
                </span>
              </label>
              <Button type="submit" className="w-full justify-center" disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button>
            </form>

            <div className="mt-6 border-t border-line pt-4">
              <p className="text-sm font-semibold text-danger flex items-center gap-1.5"><Trash2 className="w-4 h-4" /> Excluir empresa</p>
              {empresas.find((c) => c.id === editando.id)?.active ? (
                <p className="text-xs text-muted mt-1">Só dá para excluir uma empresa suspensa. Marque "Suspender acesso" acima, salve, e depois volte aqui.</p>
              ) : (
                <div className="mt-2 space-y-2">
                  <p className="text-xs bg-danger-light text-danger rounded-lg px-3 py-2">
                    Apaga <b>de vez</b> todos os dados desta empresa (festas, clientes, pagamentos, estoque, histórico), os arquivos (logo, contratos, comprovantes) e os logins dos funcionários dela. Não dá para desfazer. Logo depois, o sistema baixa para o seu computador uma cópia dos dados (os arquivos em si não vão na cópia).
                  </p>
                  <label className="block text-xs text-muted">Para confirmar, digite o nome da empresa: <b className="text-ink">{empresas.find((c) => c.id === editando.id)?.name}</b></label>
                  <input value={confirmaNome} onChange={(e) => setConfirmaNome(e.target.value)} autoComplete="off" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
                  <button type="button" onClick={excluirEmpresa}
                    disabled={excluindo || confirmaNome.trim().toLowerCase() !== (empresas.find((c) => c.id === editando.id)?.name ?? '').trim().toLowerCase()}
                    className="w-full rounded-lg bg-danger text-white text-sm font-medium py-2.5 disabled:opacity-40">
                    {excluindo ? 'Excluindo...' : 'Excluir empresa de vez'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
