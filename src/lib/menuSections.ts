import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

// Quais campos antigos de cardápio a empresa usa (seções ativas do cardápio
// ligadas a "prato quente", "massa do bolo" e "recheio do bolo"). A Brava usa
// os três; uma empresa com cardápio próprio pode não usar nenhum, e aí os
// campos e avisos de prato quente/bolo não aparecem.
export type LegacyMenuField = 'hot_dish_flavors' | 'cake_dough' | 'cake_flavor'

export async function loadLegacyMenuFields(): Promise<Set<LegacyMenuField>> {
  const { data } = await supabase.from('menu_sections').select('legacy_field').eq('active', true).not('legacy_field', 'is', null)
  return new Set((data ?? []).map((r) => r.legacy_field as LegacyMenuField))
}

export function useLegacyMenuFields() {
  const [fields, setFields] = useState<Set<LegacyMenuField>>(new Set())
  useEffect(() => {
    loadLegacyMenuFields().then(setFields)
  }, [])
  return fields
}
