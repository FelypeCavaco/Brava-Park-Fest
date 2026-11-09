import { FormEvent, useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { X, CheckCircle2, Copy } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { supabase } from '../lib/supabaseClient'
import { useCompany } from '../lib/CompanyContext'
import { friendlyDbError } from '../lib/format'
import type { Empresa, ItensImplantacao, Mensalidade, PlanoDaCasa } from '../components/platform/platformTypes'
import { erroDaFuncao, normalizarPlano, senhaProvisoria, type CopiaExcluida, type PainelDados } from '../components/platform/platformApi'
import { PlatVisaoGeral } from '../components/platform/PlatVisaoGeral'
import { PlatCasas } from '../components/platform/PlatCasas'
import { PlatFicha } from '../components/platform/PlatFicha'
import { PlatFinanceiro } from '../components/platform/PlatFinanceiro'
import { PlatPlanos } from '../components/platform/PlatPlanos'
import { PlatInteressados } from '../components/platform/PlatInteressados'
import { PlatConfig } from '../components/platform/PlatConfig'

// Painel do administrador geral (Festou), dividido em páginas:
//   /plataforma                → Visão geral
//   /plataforma/casas          → Casas (clientes)   /plataforma/casas/:id → ficha
//   /plataforma/financeiro     → Financeiro do Festou
//   /plataforma/planos         → Planos e funções
//   /plataforma/interessados   → Interessados
//   /plataforma/configuracoes  → Configurações
// Só quem está na lista de administradores gerais vê (no banco dos clientes).

export function Platform() {
  const { isPlatformAdmin, brandLoading, enterCompany } = useCompany()
  const location = useLocation()
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [mensalidades, setMensalidades] = useState<Record<string, Mensalidade>>({})
  const [implantacao, setImplantacao] = useState<Record<string, ItensImplantacao>>({})
  const [planos, setPlanos] = useState<PainelDados['planos']>([])
  const [planosDaCasa, setPlanosDaCasa] = useState<Record<string, PlanoDaCasa>>({})
  const [copias, setCopias] = useState<CopiaExcluida[]>([])
  const [sem094, setSem094] = useState(false)
  const [abrindo, setAbrindo] = useState<string | null>(null)

  const [nova, setNova] = useState<{ empresa: string; admin_nome: string; email: string; senha: string } | null>(null)
  const [depoisDeCriar, setDepoisDeCriar] = useState<(() => void) | null>(null)
  const [criada, setCriada] = useState<{ empresa: string; email: string; senha: string } | null>(null)
  const [salvando, setSalvando] = useState(false)

  const recarregar = useCallback(async () => {
    const [emp, cop, men, imp, pl, pdc] = await Promise.all([
      supabase.rpc('platform_list_companies'), supabase.rpc('platform_list_deleted_companies'),
      supabase.rpc('platform_billing_list'), supabase.rpc('platform_setup_status'),
      supabase.rpc('platform_plans_list'), supabase.rpc('platform_billing_plans'),
    ])
    setCarregando(false)
    if (emp.error) return setErro(friendlyDbError(emp.error.message))
    setEmpresas((emp.data ?? []) as Empresa[])
    setCopias((cop.data ?? []) as CopiaExcluida[])
    setMensalidades(Object.fromEntries(((men.data ?? []) as Mensalidade[]).map((m) => [m.company_id, { ...m, valor_em_aberto: Number(m.valor_em_aberto), mensalidade: m.mensalidade === null ? null : Number(m.mensalidade) }])))
    setImplantacao(Object.fromEntries(((imp.data ?? []) as { company_id: string; itens: ItensImplantacao }[]).map((i) => [i.company_id, i.itens])))
    setSem094(!!pl.error)
    setPlanos(((pl.data ?? []) as Record<string, unknown>[]).map(normalizarPlano))
    setPlanosDaCasa(Object.fromEntries(((pdc.data ?? []) as ({ company_id: string } & PlanoDaCasa)[]).map((p) => [p.company_id, { plano_id: p.plano_id, modulos_extras: p.modulos_extras ?? [] }])))
  }, [])

  useEffect(() => {
    if (isPlatformAdmin) recarregar()
  }, [isPlatformAdmin, recarregar])

  async function abrirEmpresa(id: string) {
    setAbrindo(id)
    const e = await enterCompany(id)
    if (e) {
      setAbrindo(null)
      setErro(e)
    }
  }

  function novaCasa(dados?: { empresa?: string; admin_nome?: string; email?: string }, depois?: () => void) {
    setErro(null)
    setNova({ empresa: dados?.empresa ?? '', admin_nome: dados?.admin_nome ?? '', email: dados?.email ?? '', senha: senhaProvisoria() })
    setDepoisDeCriar(() => depois ?? null)
  }

  async function criarEmpresa(e: FormEvent) {
    e.preventDefault()
    if (!nova) return
    if (nova.senha.length < 8) return setErro('A senha provisória precisa ter pelo menos 8 caracteres.')
    setSalvando(true)
    const { data, error } = await supabase.functions.invoke('platform-admin', { body: { action: 'create_company', ...nova } })
    setSalvando(false)
    const msg = await erroDaFuncao(data, error, 'Não foi possível criar a empresa. Confira se a função "platform-admin" foi publicada no Supabase.')
    if (msg) return setErro(msg)
    setCriada({ empresa: nova.empresa, email: nova.email, senha: nova.senha })
    setNova(null)
    setErro(null)
    depoisDeCriar?.()
    setDepoisDeCriar(null)
    await recarregar()
  }

  if (brandLoading) return <p className="text-sm text-muted">Carregando...</p>
  if (!isPlatformAdmin) return <Card><p className="text-sm text-muted">Esta área é só do administrador geral da plataforma.</p></Card>

  const dados: PainelDados = {
    carregando, empresas, mensalidades, implantacao, planos, planosDaCasa, copias, sem094,
    recarregar, abrirEmpresa, abrindo, novaCasa, setErro,
  }
  const partes = location.pathname.replace(/\/+$/, '').split('/').slice(2) // depois de /plataforma
  const pagina = partes[0] ?? ''

  return (
    <div className="space-y-6">
      {erro && !nova && (
        <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5 flex justify-between gap-3">
          <span>{erro}</span>
          <button onClick={() => setErro(null)} aria-label="Fechar"><X className="w-4 h-4" /></button>
        </div>
      )}

      {criada && (
        <Card className="border-teal/40">
          <p className="font-semibold text-sm flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-teal" /> {criada.empresa} criada</p>
          <p className="text-sm mt-2">Em <strong>Casas</strong>, clique em <strong>Abrir</strong> para configurar a casa (unidades, pacotes, cardápio). Este é o login do administrador do cliente — passe para ele trocar a senha no primeiro acesso:</p>
          <div className="mt-2 bg-paper rounded-lg px-3 py-2 text-sm font-mono flex flex-wrap items-center gap-3">
            <span>{criada.email}</span>
            <span>senha: {criada.senha}</span>
            <button onClick={() => navigator.clipboard?.writeText(`${criada.email} / ${criada.senha}`).catch(() => {})} className="text-purple text-xs font-sans flex items-center gap-1"><Copy className="w-3.5 h-3.5" /> Copiar</button>
          </div>
          <p className="text-xs text-muted mt-2">Guarde agora: por segurança a senha não aparece de novo.</p>
          <button onClick={() => setCriada(null)} className="text-xs text-muted mt-2">Fechar</button>
        </Card>
      )}

      {sem094 && !carregando && pagina !== '' && pagina !== 'casas' && pagina !== 'configuracoes' && (
        <p className="text-sm bg-amber-light text-amber rounded-lg px-4 py-2.5">Esta página precisa da migração <b>094_painel_festou.sql</b> no banco dos clientes. Rode-a no Supabase e recarregue.</p>
      )}

      {pagina === '' && <PlatVisaoGeral d={dados} />}
      {pagina === 'casas' && !partes[1] && <PlatCasas d={dados} />}
      {pagina === 'casas' && partes[1] && <PlatFicha key={partes[1]} d={dados} empresaId={partes[1]} />}
      {pagina === 'financeiro' && !sem094 && <PlatFinanceiro d={dados} />}
      {pagina === 'planos' && !sem094 && <PlatPlanos d={dados} />}
      {pagina === 'interessados' && !sem094 && <PlatInteressados d={dados} />}
      {pagina === 'configuracoes' && <PlatConfig d={dados} />}

      {nova && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setNova(null)} />
          <div className="relative w-full max-w-md bg-surface rounded-card p-6 shadow-xl max-h-[90vh] overflow-y-auto overscroll-contain">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-display font-semibold">Nova casa</h2>
              <button onClick={() => setNova(null)} className="text-muted hover:text-ink" aria-label="Fechar"><X className="w-5 h-5" /></button>
            </div>
            {erro && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5 mb-3">{erro}</div>}
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
              <p className="text-xs text-muted bg-paper rounded-lg px-3 py-2">A casa nasce com o perfil Administrador, as formas de pagamento e o visual padrão. Depois, na ficha dela, cadastre a mensalidade e o plano, e clique em Abrir para cadastrar as unidades e configurar o resto antes de entregar ao cliente.</p>
              <Button type="submit" className="w-full justify-center" disabled={salvando}>{salvando ? 'Criando...' : 'Criar casa'}</Button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
