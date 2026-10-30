import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react'
import { supabase } from './supabaseClient'
import { setEmpresaMensagens } from './whatsapp'

// Marca da empresa (nome, logo, WhatsApp da equipe, mascote, tema do portal),
// editável em Configurações. Lida por uma função pública porque a tela de
// login e o portal do cliente abrem sem login.
export interface CompanyBrand {
  name: string
  logoUrl: string | null
  tagline: string | null
  teamWhatsapp: string | null
  mascotEnabled: boolean
  portalTheme: 'padrao' | 'mario'
  // Funções desligadas pelo administrador geral (ver src/lib/modules.ts).
  disabledModules: string[]
  // false = empresa suspensa: ninguém dela entra.
  active: boolean
  // Empresa de quem está logado (null = administrador geral no painel, sem
  // empresa aberta, ou tela de login).
  companyId: string | null
  // Banco com administrador geral (o dos clientes): só ele mexe nas
  // configurações da empresa e das unidades.
  platformManaged: boolean
}

// Enquanto carrega (frações de segundo) mostra só o nome neutro do sistema.
const NEUTRO: CompanyBrand = { name: '', logoUrl: null, tagline: null, teamWhatsapp: null, mascotEnabled: false, portalTheme: 'padrao', disabledModules: [], active: true, companyId: null, platformManaged: false }

interface CompanyContextValue {
  brand: CompanyBrand
  brandLoading: boolean
  reloadBrand: () => Promise<void>
  // Quem está logado administra a plataforma (painel de empresas)?
  isPlatformAdmin: boolean
  // Administrador geral: abrir uma casa de festas / voltar ao painel.
  enterCompany: (id: string) => Promise<string | null>
  leaveCompany: () => Promise<void>
}

const CompanyContext = createContext<CompanyContextValue>({ brand: NEUTRO, brandLoading: true, reloadBrand: async () => {}, isPlatformAdmin: false, enterCompany: async () => null, leaveCompany: async () => {} })

export function CompanyProvider({ children }: { children: ReactNode }) {
  const [brand, setBrand] = useState<CompanyBrand>(NEUTRO)
  const [brandLoading, setBrandLoading] = useState(true)
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)

  const reloadBrand = useCallback(async () => {
    const [{ data }, { data: sessao }] = await Promise.all([supabase.rpc('public_company_brand'), supabase.auth.getSession()])
    const row = Array.isArray(data) ? data[0] : data
    if (row) {
      setBrand({
        name: row.name,
        logoUrl: row.logo_url,
        tagline: row.tagline,
        teamWhatsapp: row.team_whatsapp,
        mascotEnabled: !!row.mascot_enabled,
        portalTheme: row.portal_theme === 'mario' ? 'mario' : 'padrao',
        disabledModules: row.disabled_modules ?? [],
        active: row.active !== false,
        companyId: row.company_id ?? null,
        platformManaged: !!row.platform_managed,
      })
    }
    if (sessao.session) {
      const { data: adm } = await supabase.rpc('is_platform_admin')
      setIsPlatformAdmin(adm === true)
    } else {
      setIsPlatformAdmin(false)
    }
    setBrandLoading(false)
  }, [])

  // Recarrega ao entrar e ao sair: sem login a marca é a do produto (banco
  // compartilhado); logado, a da empresa de quem entrou.
  useEffect(() => {
    reloadBrand()
    const { data: sub } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === 'SIGNED_IN' || evento === 'SIGNED_OUT' || evento === 'USER_UPDATED') reloadBrand()
    })
    return () => sub.subscription.unsubscribe()
  }, [reloadBrand])

  // Abrir/voltar recarrega o sistema inteiro: unidades, permissões e dados
  // passam a ser os da empresa aberta.
  const enterCompany = useCallback(async (id: string) => {
    const { error } = await supabase.rpc('platform_enter_company', { p_company: id })
    if (error) return error.message.replace(/^[A-Z_]+: /, '')
    window.location.assign('/')
    return null
  }, [])
  const leaveCompany = useCallback(async () => {
    await supabase.rpc('platform_leave_company')
    window.location.assign('/plataforma')
  }, [])

  useEffect(() => {
    if (brand.name) document.title = brand.name
    setEmpresaMensagens(brand.name)
  }, [brand.name])

  return <CompanyContext.Provider value={{ brand, brandLoading, reloadBrand, isPlatformAdmin, enterCompany, leaveCompany }}>{children}</CompanyContext.Provider>
}

export function useCompany() {
  return useContext(CompanyContext)
}

// Iniciais para quando a empresa ainda não enviou logo (ex.: "Festa Feliz" → "FF").
export function brandInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '•'
}
