import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext'

// Unidades da empresa, lidas do banco (tabela `units`) — cadastradas e
// editadas em Configurações. `UNITS` é a lista das unidades ativas, na ordem
// escolhida; o "id" de cada uma (ex: 'vila-operaria') é um apelido estável
// usado dentro das telas. Para o id de verdade (uuid) no banco, use
// `unitDbIds` (abaixo).
//
// A lista é preenchida pelo UnitProvider ANTES de as telas abrirem (ele
// segura a tela até carregar), então dá para usar `UNITS` direto, inclusive
// `UNITS[0]` como valor inicial de formulário.
export interface UnitInfo {
  id: string
  name: string
  color: string
}
export const UNITS: UnitInfo[] = []

export type UnitFilter = string | 'todas'

// Cores usadas antes de a cor de cada unidade existir no banco (migração 068)
// e para unidades sem cor escolhida.
const KNOWN: Record<string, { slug: string; color: string }> = {
  'Vila Operária': { slug: 'vila-operaria', color: '#6D28D9' },
  'São Vicente': { slug: 'sao-vicente', color: '#7CB92E' },
}
const PALETA = ['#6D28D9', '#7CB92E', '#E07A1F', '#0E7490', '#BE185D', '#4D7C0F', '#B45309', '#1D4ED8']

export function unitColor(slug: string) {
  return UNITS.find((u) => u.id === slug)?.color ?? PALETA[0]
}

export function unitName(slug: string) {
  return UNITS.find((u) => u.id === slug)?.name ?? slug
}

// "Ambas as unidades" com duas; "Todas as unidades" com três ou mais.
export function allUnitsLabel() {
  return UNITS.length === 2 ? 'Ambas as unidades' : UNITS.length === 1 ? UNITS[0].name : 'Todas as unidades'
}

export interface UnitDbIds {
  unitId: string
  spaceId: string
}

interface UnitContextValue {
  selectedUnit: UnitFilter
  setSelectedUnit: (unit: UnitFilter) => void
  // ids de verdade (uuid) de cada unidade/espaço no Supabase, indexados pelo
  // apelido estável (ex: 'vila-operaria').
  unitDbIds: Record<string, UnitDbIds>
  unitDbIdsLoading: boolean
  units: UnitInfo[]
  // Recarrega depois de cadastrar/editar unidade em Configurações.
  reloadUnits: () => Promise<void>
}

const UnitContext = createContext<UnitContextValue | undefined>(undefined)

export function UnitProvider({ children }: { children: ReactNode }) {
  const { session, loading: authLoading } = useAuth()
  const userId = session?.user?.id ?? null
  const [selectedUnit, setSelectedUnit] = useState<UnitFilter>('todas')
  const [unitDbIds, setUnitDbIds] = useState<Record<string, UnitDbIds>>({})
  const [units, setUnits] = useState<UnitInfo[]>([])
  const [loadedFor, setLoadedFor] = useState<string | null | undefined>(undefined)

  const load = useCallback(async (forUser: string | null) => {
    if (!forUser) {
      UNITS.splice(0, UNITS.length)
      setUnits([])
      setUnitDbIds({})
      setLoadedFor(null)
      return
    }
    // select('*'): funciona antes e depois da migração 068 (code/color/sort).
    const [{ data: us }, { data: spaces }] = await Promise.all([
      supabase.from('units').select('*'),
      supabase.from('spaces').select('id, unit_id, created_at').order('created_at'),
    ])
    const lista = ((us ?? []) as any[])
      .filter((u) => u.active !== false)
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.created_at).localeCompare(String(b.created_at)))
    const map: Record<string, UnitDbIds> = {}
    const infos: UnitInfo[] = []
    lista.forEach((u, i) => {
      const slug = u.code || KNOWN[u.name]?.slug || `u-${u.id}`
      const space = (spaces ?? []).find((s) => s.unit_id === u.id)
      if (!space) return
      map[slug] = { unitId: u.id, spaceId: space.id }
      infos.push({ id: slug, name: u.name, color: u.color || KNOWN[u.name]?.color || PALETA[i % PALETA.length] })
    })
    UNITS.splice(0, UNITS.length, ...infos)
    setUnits(infos)
    setUnitDbIds(map)
    setSelectedUnit((prev) => (prev === 'todas' || infos.some((u) => u.id === prev) ? prev : 'todas'))
    setLoadedFor(forUser)
  }, [])

  useEffect(() => {
    if (authLoading) return
    load(userId)
  }, [authLoading, userId, load])

  const reloadUnits = useCallback(() => load(userId), [load, userId])
  const loading = authLoading || loadedFor !== userId

  return (
    <UnitContext.Provider value={{ selectedUnit, setSelectedUnit, unitDbIds, unitDbIdsLoading: loading, units, reloadUnits }}>
      {/* Segura as telas internas até as unidades carregarem (elas usam UNITS[0]
          como valor inicial). Telas públicas (portal, avaliação) não usam unidades. */}
      {loading && userId ? null : children}
    </UnitContext.Provider>
  )
}

export function useUnit() {
  const ctx = useContext(UnitContext)
  if (!ctx) throw new Error('useUnit precisa estar dentro de um UnitProvider')
  return ctx
}
