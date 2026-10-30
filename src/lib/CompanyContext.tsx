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
}

// Enquanto carrega (frações de segundo) mostra só o nome neutro do sistema.
const NEUTRO: CompanyBrand = { name: '', logoUrl: null, tagline: null, teamWhatsapp: null, mascotEnabled: false, portalTheme: 'padrao', disabledModules: [], active: true }

interface CompanyContextValue {
  brand: CompanyBrand
  brandLoading: boolean
  reloadBrand: () => Promise<void>
  // Quem está logado administra a plataforma (painel de empresas)?
  isPlatformAdmin: boolean
}

const CompanyContext = createContext<CompanyContextValue>({ brand: NEUTRO, brandLoading: true, reloadBrand: async () => {}, isPlatformAdmin: false })

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

  useEffect(() => {
    if (brand.name) document.title = brand.name
    setEmpresaMensagens(brand.name)
  }, [brand.name])

  return <CompanyContext.Provider value={{ brand, brandLoading, reloadBrand, isPlatformAdmin }}>{children}</CompanyContext.Provider>
}

export function useCompany() {
  return useContext(CompanyContext)
}

// Iniciais para quando a empresa ainda não enviou logo (ex.: "Festa Feliz" → "FF").
export function brandInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '•'
}
