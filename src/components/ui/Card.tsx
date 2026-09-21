import { HTMLAttributes, MouseEvent, useRef } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title?: string
  action?: React.ReactNode
}

export function Card({ title, action, className = '', children, ...rest }: CardProps) {
  const ref = useRef<HTMLDivElement>(null)

  function handleMouseMove(e: MouseEvent<HTMLDivElement>) {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    el.style.setProperty('--x', `${e.clientX - rect.left}px`)
    el.style.setProperty('--y', `${e.clientY - rect.top}px`)
  }

  return (
    <div
      ref={ref}
      onMouseMove={handleMouseMove}
      className={`card-spotlight bg-surface border border-line rounded-card p-5 shadow-sm hover:shadow-lg hover:-translate-y-0.5 hover:border-purple/30 transition-all duration-300 animate-card-in ${className}`}
      {...rest}
    >
      {(title || action) && (
        <div className="relative z-10 flex items-center justify-between gap-3 mb-4 flex-wrap">
          {title && <h3 className="text-sm font-semibold text-ink/80">{title}</h3>}
          {action}
        </div>
      )}
      <div className="relative z-10 overflow-x-auto">{children}</div>
    </div>
  )
}
