import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import { canAccessRoute } from '../../lib/permissions'
import { supabase } from '../../lib/supabaseClient'
import { useCompany } from '../../lib/CompanyContext'
import { ChangePasswordScreen } from './ChangePasswordScreen'
import { BillingBlockedScreen } from './BillingNotice'
import { TermsAcceptScreen } from './TermsAcceptScreen'
import { TERMOS_VERSAO } from '../../lib/termosUso'

export function RequireAuth() {
  const { session, loading, profile, profileLoading, can, permissionsLoading } = useAuth()
  const location = useLocation()
  const { brand, brandLoading, isPlatformAdmin, billing } = useCompany()
  // Empresa suspensa pelo administrador geral: sai e mostra o aviso no login.
  const suspensa = !!session && !brandLoading && brand.active === false

  // Termos de Uso: só para as casas clientes do Festou (a Brava não usa) e
  // não para o administrador geral. Sem a migração 083, não bloqueia.
  const pedeTermos = !!session && !brandLoading && brand.platformManaged && !isPlatformAdmin
  const [termos, setTermos] = useState<'aceito' | 'antiga' | 'nunca' | null>(null)
  useEffect(() => {
    if (!pedeTermos) return
    let vivo = true
    supabase.rpc('platform_terms_status', { p_version: TERMOS_VERSAO }).then(({ data, error }) => {
      if (vivo) setTermos(error ? 'aceito' : (data as 'aceito' | 'antiga' | 'nunca'))
    })
    return () => { vivo = false }
  }, [pedeTermos, session?.user?.id])

  const deactivated = !!profile && !profile.active
  const needsPermissions = !!profile && !profile.role?.isAdmin

  useEffect(() => {
    if (deactivated || suspensa) supabase.auth.signOut()
  }, [deactivated, suspensa])

  if (loading || (session && profileLoading) || (needsPermissions && permissionsLoading) || (pedeTermos && termos === null)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper">
        <div className="flex flex-col items-center gap-3">
          {(brand.platformManaged || document.documentElement.dataset.brand === 'festou') && (
            <img src="/marca/festou.png" alt="Festou" className="w-36 animate-pulse" draggable={false} />
          )}
          <p className="text-sm text-muted">Carregando...</p>
        </div>
      </div>
    )
  }

  if (!session || deactivated || suspensa) {
    return <Navigate to="/login" state={{ from: location, deactivated, suspensa }} replace />
  }

  // Mensalidade do sistema vencida além da tolerância: tela de pagamento.
  if (billing?.bloqueada && !isPlatformAdmin) return <BillingBlockedScreen billing={billing} />

  // Senha provisória: troca antes de qualquer outra tela.
  // Nas casas do Festou, os Termos são aceitos na mesma tela (caixinha obrigatória).
  if (profile?.mustChangePassword) return <ChangePasswordScreen nome={profile.name} pedirTermos={pedeTermos && termos !== 'aceito'} />

  // Termos de Uso ainda não aceitos (ou versão nova): aceite antes de entrar.
  if (pedeTermos && termos !== 'aceito') {
    return <TermsAcceptScreen nome={profile?.name ?? ''} novaVersao={termos === 'antiga'} onAceito={() => setTermos('aceito')} />
  }

  // Administrador geral sem empresa aberta: tudo leva ao painel da plataforma.
  if (isPlatformAdmin && !brand.companyId && location.pathname !== '/plataforma') {
    return <Navigate to="/plataforma" replace />
  }

  if (location.pathname !== '/' && !canAccessRoute(profile?.role ?? null, can, location.pathname)) {
    return <Navigate to="/?acesso_negado=1" replace />
  }

  return <Outlet />
}
