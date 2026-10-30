import { useState } from 'react'
import { useCompany, brandInitials } from '../lib/CompanyContext'

// Logo da empresa (Configurações → Empresa). Sem logo enviada, ou se a imagem
// não abrir, mostra as iniciais do nome num círculo nas cores do sistema.
export function BrandLogo({ className = '' }: { className?: string }) {
  const { brand } = useCompany()
  const [falhou, setFalhou] = useState<string | null>(null)
  if (brand.logoUrl && falhou !== brand.logoUrl) {
    return <img src={brand.logoUrl} alt={brand.name} className={`object-cover ${className}`} draggable={false} onError={() => setFalhou(brand.logoUrl)} />
  }
  return (
    <span className={`flex items-center justify-center bg-purple text-white font-display font-semibold ${className}`} aria-label={brand.name}>
      {brand.name ? brandInitials(brand.name) : ''}
    </span>
  )
}
