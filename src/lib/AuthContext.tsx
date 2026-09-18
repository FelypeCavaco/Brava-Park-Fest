import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'
import type { Role } from '../types'

interface Profile {
  role: Role | null
  name: string
  active: boolean
}

interface AuthContextValue {
  session: Session | null
  loading: boolean
  profile: Profile | null
  profileLoading: boolean
  permissions: Record<string, boolean>
  permissionsLoading: boolean
  can: (key: string) => boolean
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  loading: true,
  profile: null,
  profileLoading: true,
  permissions: {},
  permissionsLoading: true,
  can: () => true,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [permissions, setPermissions] = useState<Record<string, boolean>>({})
  const [permissionsLoading, setPermissionsLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  // O perfil (cargo) fica em user_profiles, separado da sessão do Supabase Auth —
  // é ele que decide o que cada pessoa pode ver no sistema. Perfis são
  // cadastrados/editados livremente pelo dono, por isso vem via join em `roles`.
  useEffect(() => {
    const userId = session?.user?.id
    if (!userId) {
      setProfile(null)
      setProfileLoading(false)
      return
    }
    setProfileLoading(true)
    supabase
      .from('user_profiles')
      .select('name, active, role:roles(id, name, is_admin)')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        const roleRow = data?.role as any
        setProfile(
          data
            ? {
                name: data.name,
                active: data.active,
                role: roleRow ? { id: roleRow.id, name: roleRow.name, isAdmin: roleRow.is_admin } : null,
              }
            : null,
        )
        setProfileLoading(false)
      })
  }, [session?.user?.id])

  // Permissões efetivas = o básico do perfil (role_permission_items), com
  // qualquer ajuste individual da pessoa por cima (o ajuste sempre vence).
  // Perfil com is_admin não passa por aqui (sempre tem acesso total via `can`).
  useEffect(() => {
    const role = profile?.role
    const userId = session?.user?.id
    if (!role || role.isAdmin || !userId) {
      setPermissions({})
      setPermissionsLoading(false)
      return
    }
    setPermissionsLoading(true)
    Promise.all([
      supabase.from('role_permission_items').select('permission_key, allowed').eq('role_id', role.id),
      supabase.from('user_permission_overrides').select('permission_key, allowed').eq('user_id', userId),
    ]).then(([roleResult, overridesResult]) => {
      const map: Record<string, boolean> = {}
      for (const row of roleResult.data ?? []) map[row.permission_key] = row.allowed
      for (const row of overridesResult.data ?? []) map[row.permission_key] = row.allowed
      setPermissions(map)
      setPermissionsLoading(false)
    })
  }, [profile?.role?.id, session?.user?.id])

  function can(key: string) {
    if (profile?.role?.isAdmin) return true
    if (!(key in permissions)) return true // chave sem regra cadastrada ainda — não bloqueia
    return permissions[key]
  }

  return (
    <AuthContext.Provider value={{ session, loading, profile, profileLoading, permissions, permissionsLoading, can }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
