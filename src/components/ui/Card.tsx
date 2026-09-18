import { HTMLAttributes } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title?: string
  action?: React.ReactNode
}

export function Card({ title, action, className = '', children, ...rest }: CardProps) {
  return (
    <div
      className={`bg-surface border border-line rounded-card p-5 ${className}`}
      {...rest}
    >
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          {title && <h3 className="text-sm font-semibold text-ink/80">{title}</h3>}
          {action}
        </div>
      )}
      <div className="overflow-x-auto">{children}</div>
    </div>
  )
}
