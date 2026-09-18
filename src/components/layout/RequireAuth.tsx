import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import { canAccessRoute } from '../../lib/permissions'
import { supabase } from '../../lib/supabaseClient'

export function RequireAuth() {
  const { session, loading, profile, profileLoading, can, permissionsLoading } = useAuth()
  const location = useLocation()

  const deactivated = !!profile && !profile.active
  const needsPermissions = !!profile && !profile.role?.isAdmin

  useEffect(() => {
    if (deactivated) supabase.auth.signOut()
  }, [deactivated])

  if (loading || (session && profileLoading) || (needsPermissions && permissionsLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper">
        <p className="text-sm text-muted">Carregando...</p>
      </div>
    )
  }

  if (!session || deactivated) {
    return <Navigate to="/login" state={{ from: location, deactivated }} replace />
  }

  if (location.pathname !== '/' && !canAccessRoute(profile?.role ?? null, can, location.pathname)) {
    return <Navigate to="/?acesso_negado=1" replace />
  }

  return <Outlet />
}
