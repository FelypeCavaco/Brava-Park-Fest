import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import { canAccessRoute } from '../../lib/permissions'
import { supabase } from '../../lib/supabaseClient'
import { useCompany } from '../../lib/CompanyContext'

export function RequireAuth() {
  const { session, loading, profile, profileLoading, can, permissionsLoading } = useAuth()
  const location = useLocation()
  const { brand, brandLoading, isPlatformAdmin } = useCompany()
  // Empresa suspensa pelo administrador geral: sai e mostra o aviso no login.
  const suspensa = !!session && !brandLoading && brand.active === false

  const deactivated = !!profile && !profile.active
  const needsPermissions = !!profile && !profile.role?.isAdmin

  useEffect(() => {
    if (deactivated || suspensa) supabase.auth.signOut()
  }, [deactivated, suspensa])

  if (loading || (session && profileLoading) || (needsPermissions && permissionsLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper">
        <p className="text-sm text-muted">Carregando...</p>
      </div>
    )
  }

  if (!session || deactivated || suspensa) {
    return <Navigate to="/login" state={{ from: location, deactivated, suspensa }} replace />
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
