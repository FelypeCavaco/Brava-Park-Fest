import { useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import {
  LayoutDashboard,
  CalendarDays,
  CalendarClock,
  Users,
  Sparkles,
  Smile,
  Package,
  FileText,
  FileSignature,
  TrendingUp,
  Filter,
  Wallet,
  Banknote,
  FileSpreadsheet,
  PiggyBank,
  ClipboardList,
  Boxes,
  Truck,
  ClipboardCheck,
  Cake,
  BellRing,
  UserCog,
  PartyPopper,
  ChevronDown,
  LogOut,
  X,
} from 'lucide-react'
import { useUnit, UNITS } from '../../lib/UnitContext'
import { useAuth } from '../../lib/AuthContext'
import { canAccessRoute } from '../../lib/permissions'

interface LinkItem {
  to: string
  label: string
  icon: typeof LayoutDashboard
  end?: boolean
}

interface Group {
  id: string
  label: string
  icon: typeof LayoutDashboard
  items: LinkItem[]
}

const topLinks: LinkItem[] = [
  { to: '/', label: 'Painel', icon: LayoutDashboard, end: true },
  { to: '/lembretes', label: 'Lembretes diários', icon: BellRing },
]

const groups: Group[] = [
  {
    id: 'reservas',
    label: 'Reservas',
    icon: CalendarDays,
    items: [
      { to: '/reservas', label: 'Mapa de reservas', icon: CalendarDays },
      { to: '/visitas', label: 'Agenda de visitas', icon: CalendarClock },
    ],
  },
  {
    id: 'clientes',
    label: 'Clientes',
    icon: Users,
    items: [
      { to: '/clientes', label: 'Clientes', icon: Users },
      { to: '/reativacao', label: 'Reativação de clientes', icon: Sparkles },
      { to: '/satisfacao', label: 'Satisfação (NPS)', icon: Smile },
    ],
  },
  {
    id: 'comercial',
    label: 'Comercial',
    icon: FileSignature,
    items: [
      { to: '/pacotes', label: 'Pacotes e itens', icon: Package },
      { to: '/contratos', label: 'Contratos', icon: FileText },
      { to: '/propostas', label: 'Propostas comerciais', icon: FileSignature },
      { to: '/marketing', label: 'Tráfego e CAC', icon: TrendingUp },
      { to: '/funil', label: 'Funil de conversão', icon: Filter },
    ],
  },
  {
    id: 'financeiro',
    label: 'Financeiro',
    icon: Banknote,
    items: [
      { to: '/pagamentos', label: 'Pagamentos', icon: Wallet },
      { to: '/financeiro', label: 'Financeiro', icon: Banknote },
      { to: '/resultado-do-mes', label: 'Resultado do mês', icon: FileSpreadsheet },
      { to: '/lucro-por-festa', label: 'Lucro por festa', icon: PiggyBank },
      { to: '/relatorios', label: 'Relatórios e metas', icon: ClipboardList },
    ],
  },
  {
    id: 'operacao',
    label: 'Operação',
    icon: Boxes,
    items: [
      { to: '/estoque', label: 'Estoque', icon: Boxes },
      { to: '/fornecedores', label: 'Fornecedores', icon: Truck },
      { to: '/escalas', label: 'Escalas', icon: ClipboardCheck },
      { to: '/relatorio-aniversariantes', label: 'Relatório de aniversariantes', icon: Cake },
    ],
  },
  {
    id: 'config',
    label: 'Configurações',
    icon: UserCog,
    items: [{ to: '/usuarios', label: 'Usuários e permissões', icon: UserCog }],
  },
]

interface SidebarProps {
  mobileOpen: boolean
  onClose: () => void
}

export function Sidebar({ mobileOpen, onClose }: SidebarProps) {
  const { selectedUnit, setSelectedUnit } = useUnit()
  const { profile, can } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  const role = profile?.role ?? null
  const visibleTopLinks = topLinks.filter((i) => canAccessRoute(role, can, i.to))
  const visibleGroups = groups
    .map((g) => ({ ...g, items: g.items.filter((i) => canAccessRoute(role, can, i.to)) }))
    .filter((g) => g.items.length > 0)

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    for (const g of groups) {
      initial[g.id] = g.items.some((i) => location.pathname.startsWith(i.to))
    }
    return initial
  })

  function toggleGroup(id: string) {
    setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 bg-ink/50 z-40 md:hidden" onClick={onClose} />
      )}
      <aside
        className={`w-64 shrink-0 bg-ink text-white/90 flex flex-col h-screen fixed inset-y-0 left-0 z-50 transition-transform duration-200 md:sticky md:top-0 md:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
      <div className="flex items-center gap-2 px-5 py-6 shrink-0">
        <PartyPopper className="w-6 h-6 text-orange" strokeWidth={1.75} />
        <div className="flex-1">
          <p className="font-display font-semibold leading-tight">Brava Park Fest</p>
          <p className="text-xs text-white/50">Gestão de festas</p>
        </div>
        <button onClick={onClose} className="md:hidden text-white/60 hover:text-white" aria-label="Fechar menu">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="px-4 mb-4 shrink-0">
        <label className="block text-[11px] uppercase tracking-wide text-white/40 mb-1.5 px-1">
          Unidade
        </label>
        <select
          value={selectedUnit}
          onChange={(e) => setSelectedUnit(e.target.value)}
          className="w-full bg-white/10 border border-white/10 rounded-lg px-2.5 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple"
        >
          <option value="todas" className="text-ink">
            Ambas as unidades
          </option>
          {UNITS.map((u) => (
            <option key={u.id} value={u.id} className="text-ink">
              {u.name}
            </option>
          ))}
        </select>
      </div>

      <nav className="flex-1 px-3 space-y-1 overflow-y-auto min-h-0">
        {visibleTopLinks.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            onClick={onClose}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                isActive ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white'
              }`
            }
          >
            <link.icon className="w-4 h-4" strokeWidth={1.75} />
            {link.label}
          </NavLink>
        ))}

        {visibleGroups.map((group) => {
          const isOpen = openGroups[group.id]
          const hasActive = group.items.some((i) => location.pathname.startsWith(i.to))
          return (
            <div key={group.id}>
              <button
                onClick={() => toggleGroup(group.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  hasActive ? 'text-white' : 'text-white/60 hover:bg-white/5 hover:text-white'
                }`}
              >
                <group.icon className="w-4 h-4" strokeWidth={1.75} />
                <span className="flex-1 text-left">{group.label}</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              {isOpen && (
                <div className="ml-3 pl-3 border-l border-white/10 space-y-1 mt-1 mb-1">
                  {group.items.map(({ to, label, icon: Icon, end }) => (
                    <NavLink
                      key={to}
                      to={to}
                      end={end}
                      onClick={onClose}
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                          isActive ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white'
                        }`
                      }
                    >
                      <Icon className="w-3.5 h-3.5" strokeWidth={1.75} />
                      {label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      <div className="px-3 py-3 border-t border-white/10 shrink-0">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-white/60 hover:bg-white/5 hover:text-white transition-colors"
        >
          <LogOut className="w-4 h-4" strokeWidth={1.75} />
          Sair
        </button>
        <p className="px-3 pt-2 text-xs text-white/40">v0.1 — em construção</p>
      </div>
      </aside>
    </>
  )
}
