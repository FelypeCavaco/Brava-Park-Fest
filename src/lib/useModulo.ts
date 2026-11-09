import { useCompany } from './CompanyContext'
import { moduloLigado } from './modules'

// A função faz parte do plano da casa? (Festou: liga/desliga por plano.
// Na Brava nada é desligado, então é sempre true.)
export function useModulo(id: string): boolean {
  const { brand } = useCompany()
  return moduloLigado(id, brand.disabledModules)
}
