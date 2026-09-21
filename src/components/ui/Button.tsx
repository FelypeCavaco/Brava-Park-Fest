import { ButtonHTMLAttributes } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost'
}

const variants = {
  primary:
    'bg-gradient-to-br from-purple to-purple-dark text-white shadow-md shadow-purple/25 hover:shadow-lg hover:shadow-purple/35 hover:brightness-110',
  secondary: 'bg-paper text-ink border border-line hover:bg-line/40 hover:border-purple/30',
  ghost: 'text-ink hover:bg-paper',
}

export function Button({ variant = 'primary', className = '', children, ...rest }: ButtonProps) {
  return (
    <button
      className={`btn-shine inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100
      ${variants[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
