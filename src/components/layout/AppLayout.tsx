import { Suspense, useState } from 'react'
import { useCompany } from '../../lib/CompanyContext'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { PageLoading } from '../../lib/lazyPage'
import { GlobalSearch } from './GlobalSearch'
import { NotificationBell } from './NotificationBell'
import { QuickActionsBar } from './QuickActionsBar'
import { useUnit } from '../../lib/UnitContext'
import { useAuth } from '../../lib/AuthContext'
import { Settings } from '../../pages/Settings'
import { BillingBanner } from './BillingNotice'
import { GuiaAjuda } from '../guia/GuiaAjuda'

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const { units } = useUnit()
  const { profile, session } = useAuth()
  const { brand, isPlatformAdmin, billing } = useCompany()
  const foraDaEmpresa = isPlatformAdmin && !brand.companyId
  // Empresa recém-criada, ainda sem unidade: as telas dependem de ter pelo
  // menos uma, então só mostra o cadastro de unidades até criar a primeira.
  // (a tela da plataforma abre mesmo assim: o administrador geral pode ser de uma empresa ainda vazia)
  const semUnidade = units.length === 0 && !location.pathname.startsWith('/plataforma')

  return (
    <div className="flex min-h-screen bg-paper">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <main className="flex-1 min-w-0 p-4 md:p-8 max-w-[1400px]">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => setMobileOpen(true)}
            className="md:hidden shrink-0 p-2 -ml-2 rounded-lg text-ink hover:bg-line/60"
            aria-label="Abrir menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          {foraDaEmpresa ? <div className="flex-1" /> : (
            <>
              <QuickActionsBar className="flex-1 min-w-0" />
              <GlobalSearch />
              {brand.platformManaged && <GuiaAjuda />}
              <NotificationBell />
            </>
          )}
          <UsuarioLogado nome={profile?.name} email={session?.user?.email} perfil={profile?.role?.name} />
        </div>
        {billing && profile?.role?.isAdmin && !isPlatformAdmin && <BillingBanner billing={billing} />}
        {semUnidade ? (
          <div className="space-y-4">
            <div className="bg-amber-light text-ink text-sm rounded-lg px-4 py-3">
              {profile?.role?.isAdmin && (!brand.platformManaged || isPlatformAdmin)
                ? 'Para começar, cadastre a primeira unidade da empresa na aba "Unidades" abaixo.'
                : brand.platformManaged
                  ? 'Sua empresa está sendo preparada. Assim que o suporte cadastrar as unidades, o sistema fica liberado.'
                  : 'A empresa ainda não tem nenhuma unidade cadastrada. Peça a um administrador para cadastrar.'}
            </div>
            {profile?.role?.isAdmin && (!brand.platformManaged || isPlatformAdmin) && <Settings />}
          </div>
        ) : (
          <Suspense fallback={<PageLoading />}>
            <Outlet />
          </Suspense>
        )}
      </main>
    </div>
  )
}

// Quem está logado neste aparelho (canto superior direito).
function UsuarioLogado({ nome, email, perfil }: { nome?: string; email?: string | null; perfil?: string }) {
  const rotulo = nome || email
  if (!rotulo) return null
  const iniciais = rotulo.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase()
  return (
    <div className="shrink-0 flex items-center gap-2 pl-2 border-l border-line" title={`Logado neste aparelho: ${rotulo}${email && nome ? ` (${email})` : ''}`}>
      <span className="w-8 h-8 rounded-full bg-purple-light text-purple text-xs font-bold flex items-center justify-center" aria-hidden>{iniciais}</span>
      <span className="hidden lg:block leading-tight max-w-[11rem]">
        <span className="block text-[10px] font-bold uppercase tracking-wide text-muted">Logado neste aparelho</span>
        <span className="block text-sm font-semibold truncate">{rotulo}{perfil ? <span className="font-normal text-muted"> · {perfil}</span> : null}</span>
      </span>
    </div>
  )
}
