import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react'
import { supabase } from './supabaseClient'

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
}

// Usado só enquanto a migração 068 não rodou no banco da Brava (a função
// pública ainda não existe): mantém tudo exatamente como era.
const BRAVA_ANTES_DA_068: CompanyBrand = {
  name: 'Brava Park Fest',
  logoUrl: '/marca/logo-brava-park-fest.png',
  tagline: 'Aqui a diversão é garantida',
  teamWhatsapp: '47992261550',
  mascotEnabled: true,
  portalTheme: 'mario',
}

// Enquanto carrega (frações de segundo) mostra só o nome neutro do sistema.
const NEUTRO: CompanyBrand = { name: '', logoUrl: null, tagline: null, teamWhatsapp: null, mascotEnabled: false, portalTheme: 'padrao' }

interface CompanyContextValue {
  brand: CompanyBrand
  brandLoading: boolean
  reloadBrand: () => Promise<void>
}

const CompanyContext = createContext<CompanyContextValue>({ brand: NEUTRO, brandLoading: true, reloadBrand: async () => {} })

export function CompanyProvider({ children }: { children: ReactNode }) {
  const [brand, setBrand] = useState<CompanyBrand>(NEUTRO)
  const [brandLoading, setBrandLoading] = useState(true)

  const reloadBrand = useCallback(async () => {
    const { data, error } = await supabase.rpc('public_company_brand')
    const row = Array.isArray(data) ? data[0] : data
    if (error && /public_company_brand|schema cache|does not exist/i.test(error.message)) {
      setBrand(BRAVA_ANTES_DA_068)
    } else if (row) {
      setBrand({
        name: row.name,
        logoUrl: row.logo_url,
        tagline: row.tagline,
        teamWhatsapp: row.team_whatsapp,
        mascotEnabled: !!row.mascot_enabled,
        portalTheme: row.portal_theme === 'mario' ? 'mario' : 'padrao',
      })
    }
    setBrandLoading(false)
  }, [])

  useEffect(() => {
    reloadBrand()
  }, [reloadBrand])

  useEffect(() => {
    if (brand.name) document.title = brand.name
  }, [brand.name])

  return <CompanyContext.Provider value={{ brand, brandLoading, reloadBrand }}>{children}</CompanyContext.Provider>
}

export function useCompany() {
  return useContext(CompanyContext)
}

// Iniciais para quando a empresa ainda não enviou logo (ex.: "Festa Feliz" → "FF").
export function brandInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '•'
}
