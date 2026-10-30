// Edge Function: painel do administrador geral — cria uma casa de festas
// nova com o primeiro administrador dela. Só quem está na lista de
// administradores gerais (tabela platform_admins) pode chamar. Usa a
// service role key (acesso total), por isso roda aqui no servidor.
//
// Ação "create_company": { empresa, admin_nome, email, senha }
//   1) cria o login do administrador (Supabase Auth);
//   2) chama platform_create_company, que cria a empresa, os dados iniciais
//      (perfil Administrador, formas de pagamento, comissão) e o perfil dele;
//   3) se o passo 2 falhar, apaga o login criado (não sobra acesso solto).
//
// Como publicar: painel do Supabase > Edge Functions > Deploy a new function
// > nome "platform-admin" (apague o nome de exemplo antes) > cole este
// arquivo inteiro > Deploy.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonResponse({ error: 'Não autenticado.' }, 401)

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: callerData, error: callerError } = await admin.auth.getUser(authHeader.replace('Bearer ', ''))
    if (callerError || !callerData.user) return jsonResponse({ error: 'Sessão inválida.' }, 401)

    const { data: isAdmin } = await admin.from('platform_admins').select('user_id').eq('user_id', callerData.user.id).maybeSingle()
    if (!isAdmin) return jsonResponse({ error: 'Só o administrador geral pode fazer isso.' }, 403)

    const body = await req.json()
    if (body.action !== 'create_company') return jsonResponse({ error: 'Ação desconhecida.' }, 400)

    const empresa = String(body.empresa ?? '').trim()
    const nome = String(body.admin_nome ?? '').trim()
    const email = String(body.email ?? '').trim().toLowerCase()
    const senha = String(body.senha ?? '')
    if (!empresa || !nome || !email || !senha) return jsonResponse({ error: 'Preencha empresa, nome, e-mail e senha.' }, 400)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResponse({ error: 'E-mail inválido.' }, 400)
    if (senha.length < 8) return jsonResponse({ error: 'A senha precisa ter pelo menos 8 caracteres.' }, 400)

    const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true })
    if (createError || !created.user) {
      const msg = createError?.message ?? ''
      return jsonResponse({ error: /already|registered|exists/i.test(msg) ? 'Já existe um login com este e-mail.' : msg || 'Não foi possível criar o login.' }, 400)
    }

    const { data: companyId, error: rpcError } = await admin.rpc('platform_create_company', {
      p_name: empresa, p_admin_user: created.user.id, p_admin_name: nome, p_admin_email: email,
    })
    if (rpcError) {
      await admin.auth.admin.deleteUser(created.user.id)
      return jsonResponse({ error: rpcError.message.replace(/^[A-Z_]+: /, '') }, 400)
    }

    return jsonResponse({ company_id: companyId, user_id: created.user.id }, 200)
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Erro desconhecido.' }, 500)
  }
})
