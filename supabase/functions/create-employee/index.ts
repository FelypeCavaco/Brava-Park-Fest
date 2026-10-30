// Edge Function: cria o login (Supabase Auth) e o perfil (user_profiles) do
// funcionário num passo só. Só quem já é administrador ativo pode chamar
// esta função — ela usa a service role key (acesso total ao projeto), que
// nunca pode ficar exposta no navegador, por isso precisa rodar aqui no
// servidor e não direto no app.
//
// Como publicar: painel do Supabase > Edge Functions > Deploy a new function
// > nome "create-employee" > cole este arquivo inteiro > Deploy.

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

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(supabaseUrl, serviceRoleKey)

    const jwt = authHeader.replace('Bearer ', '')
    const { data: callerData, error: callerError } = await admin.auth.getUser(jwt)
    if (callerError || !callerData.user) return jsonResponse({ error: 'Sessão inválida.' }, 401)

    const { data: callerProfile } = await admin
      .from('user_profiles')
      .select('active, company_id, role:roles(is_admin), company:companies(active)')
      .eq('id', callerData.user.id)
      .maybeSingle()

    const callerRole = callerProfile?.role as { is_admin: boolean } | { is_admin: boolean }[] | null
    const callerIsAdmin = Array.isArray(callerRole) ? callerRole[0]?.is_admin : callerRole?.is_admin

    // Administrador geral (sem cadastro em empresa): cadastra na empresa que
    // ele abriu pelo painel da plataforma.
    let companyId: string | null = null
    if (!callerProfile) {
      const { data: plat } = await admin.from('platform_admins').select('user_id').eq('user_id', callerData.user.id).maybeSingle()
      const { data: aberta } = await admin.from('company_members').select('company_id').eq('user_id', callerData.user.id).maybeSingle()
      if (!plat) return jsonResponse({ error: 'Só administradores podem criar novos usuários.' }, 403)
      if (!aberta) return jsonResponse({ error: 'Abra uma empresa no painel da plataforma antes de cadastrar funcionários.' }, 400)
      companyId = aberta.company_id
    } else {
      if (!callerIsAdmin || !callerProfile.active) {
        return jsonResponse({ error: 'Só administradores podem criar novos usuários.' }, 403)
      }
      // O funcionário novo entra na mesma empresa de quem está cadastrando.
      const callerCompany = callerProfile.company as { active: boolean } | { active: boolean }[] | null
      const companyActive = Array.isArray(callerCompany) ? callerCompany[0]?.active : callerCompany?.active
      if (companyActive === false) return jsonResponse({ error: 'Empresa suspensa. Fale com o suporte.' }, 403)
      companyId = (callerProfile as { company_id?: string }).company_id ?? null
    }

    const { name, email, password, role_id } = await req.json()
    if (!name?.trim() || !email?.trim() || !password || !role_id) {
      return jsonResponse({ error: 'Preencha nome, email, senha e perfil.' }, 400)
    }
    if (password.length < 6) {
      return jsonResponse({ error: 'A senha precisa ter pelo menos 6 caracteres.' }, 400)
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: email.trim(),
      password,
      email_confirm: true,
    })
    if (createError || !created.user) {
      return jsonResponse({ error: createError?.message ?? 'Não foi possível criar o login.' }, 400)
    }

    const { error: profileError } = await admin
      .from('user_profiles')
      .insert({ id: created.user.id, name: name.trim(), email: email.trim(), role_id, active: true, ...(companyId ? { company_id: companyId } : {}) })

    if (profileError) {
      // desfaz o login criado pra não sobrar um acesso sem perfil associado
      await admin.auth.admin.deleteUser(created.user.id)
      return jsonResponse({ error: 'Login criado, mas não foi possível salvar o perfil. Tente de novo.' }, 400)
    }

    return jsonResponse({ id: created.user.id }, 200)
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Erro desconhecido.' }, 500)
  }
})
