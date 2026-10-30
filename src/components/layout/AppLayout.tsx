import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { GlobalSearch } from './GlobalSearch'
import { QuickActionsBar } from './QuickActionsBar'
import { useUnit } from '../../lib/UnitContext'
import { useAuth } from '../../lib/AuthContext'
import { Settings } from '../../pages/Settings'

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { units } = useUnit()
  const { profile } = useAuth()
  // Empresa recém-criada, ainda sem unidade: as telas dependem de ter pelo
  // menos uma, então só mostra o cadastro de unidades até criar a primeira.
  const semUnidade = units.length === 0

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
          <QuickActionsBar className="flex-1 min-w-0" />
          <GlobalSearch />
        </div>
        {semUnidade ? (
          <div className="space-y-4">
            <div className="bg-amber-light text-ink text-sm rounded-lg px-4 py-3">
              {profile?.role?.isAdmin
                ? 'Para começar, cadastre a primeira unidade da empresa na aba "Unidades" abaixo.'
                : 'A empresa ainda não tem nenhuma unidade cadastrada. Peça a um administrador para cadastrar.'}
            </div>
            {profile?.role?.isAdmin && <Settings />}
          </div>
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  )
}
