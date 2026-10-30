import { useState } from 'react'
import { useCompany } from '../../lib/CompanyContext'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { GlobalSearch } from './GlobalSearch'
import { QuickActionsBar } from './QuickActionsBar'
import { useUnit } from '../../lib/UnitContext'
import { useAuth } from '../../lib/AuthContext'
import { Settings } from '../../pages/Settings'

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const { units } = useUnit()
  const { profile } = useAuth()
  const { brand, isPlatformAdmin } = useCompany()
  const foraDaEmpresa = isPlatformAdmin && !brand.companyId
  // Empresa recém-criada, ainda sem unidade: as telas dependem de ter pelo
  // menos uma, então só mostra o cadastro de unidades até criar a primeira.
  // (a tela da plataforma abre mesmo assim: o administrador geral pode ser de uma empresa ainda vazia)
  const semUnidade = units.length === 0 && location.pathname !== '/plataforma'

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
            </>
          )}
        </div>
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
          <Outlet />
        )}
      </main>
    </div>
  )
}
