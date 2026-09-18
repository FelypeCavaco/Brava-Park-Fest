import { supabase } from './supabaseClient'

// Um token por festa, reaproveitado se já existir (mesmo padrão da lista de
// convidados) — assim reenviar o pedido de avaliação não gera um link novo
// toda vez.
export async function getOrCreateReviewToken(reservationId: string, clientName: string, unitName: string): Promise<string | null> {
  const { data: existing } = await supabase.from('review_links').select('token').eq('reservation_id', reservationId).maybeSingle()
  if (existing?.token) return existing.token

  const { data, error } = await supabase
    .from('review_links')
    .insert({ reservation_id: reservationId, client_name: clientName, unit_name: unitName })
    .select('token')
    .single()

  if (error || !data) return null
  return data.token
}

export function reviewFormUrl(token: string) {
  return `${window.location.origin}/avaliacao/${token}`
}
