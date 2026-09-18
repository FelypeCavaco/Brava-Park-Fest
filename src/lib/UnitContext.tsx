import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { supabase } from './supabaseClient'

// Lista fixa usada por várias telas que ainda não foram ligadas ao banco de
// dados real. Os "id" aqui (ex: 'vila-operaria') são um apelido estável usado
// só dentro do front-end — para saber o id de verdade (uuid) de cada unidade
// no banco, use `unitDbIds` (abaixo), já ligado à tabela `units`.
export const UNITS = [
  { id: 'vila-operaria', name: 'Vila Operária' },
  { id: 'sao-vicente', name: 'São Vicente' },
]

export type UnitFilter = string | 'todas'

// Cada unidade é o próprio espaço (não existem salões separados dentro dela).
export const SPACES_BY_UNIT: Record<string, string[]> = {
  'vila-operaria': ['Vila Operária'],
  'sao-vicente': ['São Vicente'],
}

// Mapa direto em vez de remover acentos por regex (evita problemas de
// codificação de caracteres) — cobre as unidades conhecidas do negócio.
const KNOWN_SLUGS: Record<string, string> = {
  'Vila Operária': 'vila-operaria',
  'São Vicente': 'sao-vicente',
}

function slugify(name: string) {
  if (KNOWN_SLUGS[name]) return KNOWN_SLUGS[name]
  return name.toLowerCase().trim().replace(/\s+/g, '-')
}

export interface UnitDbIds {
  unitId: string
  spaceId: string
}

interface UnitContextValue {
  selectedUnit: UnitFilter
  setSelectedUnit: (unit: UnitFilter) => void
  // ids de verdade (uuid) de cada unidade/espaço no Supabase, indexados pelo
  // apelido estável (ex: 'vila-operaria'). Fica vazio até a consulta terminar
  // — use `unitDbIdsLoading` para saber quando já pode confiar nesses valores.
  unitDbIds: Record<string, UnitDbIds>
  unitDbIdsLoading: boolean
}

const UnitContext = createContext<UnitContextValue | undefined>(undefined)

export function UnitProvider({ children }: { children: ReactNode }) {
  const [selectedUnit, setSelectedUnit] = useState<UnitFilter>('todas')
  const [unitDbIds, setUnitDbIds] = useState<Record<string, UnitDbIds>>({})
  const [unitDbIdsLoading, setUnitDbIdsLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: units } = await supabase.from('units').select('id, name')
      const { data: spaces } = await supabase.from('spaces').select('id, unit_id')

      const map: Record<string, UnitDbIds> = {}
      for (const u of units ?? []) {
        const slug = slugify(u.name)
        const space = (spaces ?? []).find((s) => s.unit_id === u.id)
        if (space) {
          map[slug] = { unitId: u.id, spaceId: space.id }
        }
      }
      setUnitDbIds(map)
      setUnitDbIdsLoading(false)
    }
    load()
  }, [])

  return (
    <UnitContext.Provider value={{ selectedUnit, setSelectedUnit, unitDbIds, unitDbIdsLoading }}>
      {children}
    </UnitContext.Provider>
  )
}

export function useUnit() {
  const ctx = useContext(UnitContext)
  if (!ctx) throw new Error('useUnit precisa estar dentro de um UnitProvider')
  return ctx
}
