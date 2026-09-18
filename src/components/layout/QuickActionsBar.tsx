import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import { QUICK_ACTIONS } from '../../lib/quickActions'

interface QuickActionsBarProps {
  size?: 'compact' | 'large'
  className?: string
}

// Barra de atalhos pra não precisar navegar pelo menu toda vez — "compact"
// fica no topo de qualquer página (ao lado da busca), "large" é o bloco de
// destaque no Painel. Cada botão já esconde sozinho se a pessoa não tiver
// permissão pra página/ação de destino.
export function QuickActionsBar({ size = 'compact', className = '' }: QuickActionsBarProps) {
  const navigate = useNavigate()
  const { can } = useAuth()

  const visible = QUICK_ACTIONS.filter((a) => a.requires.every((key) => can(key)))
  if (visible.length === 0) return null

  if (size === 'large') {
    return (
      <div className={`grid grid-cols-2 sm:grid-cols-4 gap-3 ${className}`}>
        {visible.map((a) => (
          <button
            key={a.key}
            onClick={() => navigate(a.to)}
            className="flex flex-col items-center justify-center gap-2 bg-surface border border-line rounded-card p-4 text-center hover:border-purple hover:bg-purple-light/40 transition-colors"
          >
            <div className="w-9 h-9 rounded-lg bg-purple-light flex items-center justify-center">
              <a.icon className="w-4 h-4 text-purple-dark" strokeWidth={1.75} />
            </div>
            <span className="text-xs font-medium text-ink/80">{a.label}</span>
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className={`flex items-center gap-1.5 overflow-x-auto ${className}`}>
      {visible.map((a) => (
        <button
          key={a.key}
          onClick={() => navigate(a.to)}
          title={a.label}
          className="flex items-center gap-1.5 shrink-0 px-2.5 py-1.5 rounded-lg border border-line bg-surface text-xs text-ink/80 hover:border-purple hover:text-purple-dark transition-colors"
        >
          <a.icon className="w-3.5 h-3.5" strokeWidth={1.75} />
          <span className="hidden lg:inline">{a.label}</span>
        </button>
      ))}
    </div>
  )
}
