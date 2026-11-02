// Edge Function: recebe os avisos do Asaas (cobrança criada, paga, vencida,
// estornada) e repassa para o banco (platform_asaas_event), que registra o
// pagamento do mês e libera ou bloqueia a empresa.
//
// Segurança: o Asaas manda no cabeçalho "asaas-access-token" o token que você
// cadastrou no webhook do Asaas. Ele precisa ser igual ao segredo
// ASAAS_WEBHOOK_TOKEN do Supabase; sem isso, nada é aceito.
//
// Como publicar: painel do Supabase > Edge Functions > Deploy a new function
// > nome "asaas-webhook" > cole este arquivo inteiro > Deploy. Depois, em
// Details, deixe "Verify JWT with legacy secret" DESLIGADO (o Asaas não manda
// login do Supabase; quem protege é o token acima).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function resposta(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return resposta({ error: 'Use POST.' }, 405)

  const esperado = Deno.env.get('ASAAS_WEBHOOK_TOKEN') ?? ''
  const recebido = req.headers.get('asaas-access-token') ?? ''
  if (esperado.length < 32 || recebido !== esperado) return resposta({ error: 'Token inválido.' }, 401)

  let evento: unknown
  try {
    evento = await req.json()
  } catch {
    return resposta({ received: true, ignorado: 'corpo inválido' }, 200)
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data, error } = await admin.rpc('platform_asaas_event', { p_event: evento })
  // Erro no banco: responde 500 para o Asaas tentar de novo mais tarde.
  if (error) return resposta({ error: error.message }, 500)
  return resposta({ received: true, resultado: data }, 200)
})
