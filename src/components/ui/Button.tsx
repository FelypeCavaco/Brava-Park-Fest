import { ButtonHTMLAttributes } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost'
}

const variants = {
  primary: 'bg-purple text-white hover:bg-purple-dark',
  secondary: 'bg-paper text-ink border border-line hover:bg-line/40',
  ghost: 'text-ink hover:bg-paper',
}

export function Button({ variant = 'primary', className = '', children, ...rest }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed
      ${variants[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
