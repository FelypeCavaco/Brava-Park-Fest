import type { ReactNode } from 'react'
import { useAuth } from '../lib/AuthContext'

// Esconde o conteúdo (botão, seção, formulário) se o perfil logado não tiver
// a permissão indicada. Ver src/lib/permissionRegistry.ts para as chaves
// disponíveis e Usuários e permissões pra editar quem pode o quê.
export function Can({ permission, children }: { permission: string; children: ReactNode }) {
  const { can } = useAuth()
  if (!can(permission)) return null
  return <>{children}</>
}
