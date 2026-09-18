import type { Role } from '../types'
import { PAGE_PERMISSION_BY_PATH } from './permissionRegistry'

// Acesso por rota é decidido pela tabela role_permission_items (editável em
// Usuários e permissões, por perfil), com ajuste individual por cima via
// user_permission_overrides — ambos já resolvidos no `can()` do AuthContext.
// Perfil com acesso total (isAdmin) sempre passa. /usuarios é a única
// exceção fixa: só quem tem esse perfil administrador.
export function canAccessRoute(role: Role | null, can: (key: string) => boolean, pathname: string): boolean {
  if (role?.isAdmin) return true
  if (!role) return true // perfil ainda não criado (fluxo inicial) — não restringe, pra dar pra criar o próprio perfil
  if (pathname === '/usuarios') return false
  const rule = PAGE_PERMISSION_BY_PATH.find((r) => r.test(pathname))
  if (!rule) return true
  return can(rule.key)
}
