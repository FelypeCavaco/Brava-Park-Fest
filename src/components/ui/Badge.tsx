type BadgeTone = 'purple' | 'orange' | 'teal' | 'amber' | 'danger' | 'neutral'

const tones: Record<BadgeTone, string> = {
  purple: 'bg-purple-light text-purple-dark',
  orange: 'bg-orange-light text-ink',
  teal: 'bg-teal-light text-teal',
  amber: 'bg-amber-light text-amber',
  danger: 'bg-danger-light text-danger',
  neutral: 'bg-line/50 text-muted',
}

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  )
}
