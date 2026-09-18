import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { GlobalSearch } from './GlobalSearch'
import { QuickActionsBar } from './QuickActionsBar'

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)

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
        <Outlet />
      </main>
    </div>
  )
}
