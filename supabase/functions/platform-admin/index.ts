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
// Ação "delete_company": { company_id, confirm_name } (migração 076)
//   1) platform_delete_company: confere se está suspensa e se o nome bate,
//      guarda a cópia dos dados e apaga tudo da empresa no banco;
//   2) apaga os arquivos dela (logo, documentos, comprovantes);
//   3) apaga os logins dos funcionários dela (nunca o do administrador geral);
//   4) cancela a assinatura dela no Asaas, se tiver.
//
// Ação "asaas_sync": { company_id } (migração 079) — cria ou atualiza no Asaas
//   o cliente (a casa de festas) e a assinatura mensal (Pix, boleto ou cartão,
//   à escolha do cliente), deixa os avisos do Asaas (por e-mail) em 5 dias
//   antes e no dia do vencimento, e guarda o link da fatura em aberto.
// Ação "asaas_cancel": { company_id } — cancela a assinatura no Asaas.
//
// Segredos (Supabase > Edge Functions > Secrets): ASAAS_API_KEY e ASAAS_ENV
// ("sandbox" para testes, "producao" para valer).
//
// Como publicar: painel do Supabase > Edge Functions > Deploy a new function
// > nome "platform-admin" (apague o nome de exemplo antes) > cole este
// arquivo inteiro > Deploy.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ---------- Asaas ----------
function asaasBase() {
  return Deno.env.get('ASAAS_ENV') === 'producao' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3'
}

async function asaas(method: string, path: string, body?: unknown) {
  const key = Deno.env.get('ASAAS_API_KEY')
  if (!key) throw new Error('Falta configurar a chave do Asaas no Supabase (segredo ASAAS_API_KEY).')
  const res = await fetch(asaasBase() + path, {
    method,
    headers: { access_token: key, 'Content-Type': 'application/json', 'User-Agent': 'Festou' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : {}
  if (!res.ok) {
    const msg = (data?.errors ?? []).map((e: { description?: string }) => e.description).filter(Boolean).join(' ')
    throw new Error(`Asaas: ${msg || res.status}`)
  }
  return data
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

    if (body.action === 'asaas_sync') {
      const companyId = String(body.company_id ?? '')
      const { data: d, error: dErr } = await admin.rpc('platform_asaas_dados', { p_company: companyId })
      if (dErr) return jsonResponse({ error: dErr.message.replace(/^[A-Z_]+: /, '') }, 400)
      const dados = d as { empresa: string; razao_social: string | null; cnpj: string | null; email: string | null; whatsapp: string | null;
        mensalidade: number; customer_id: string | null; subscription_id: string | null; proximo_vencimento: string | null }
      const cpfCnpj = (dados.cnpj ?? '').replace(/\D/g, '')
      if (cpfCnpj.length !== 14 && cpfCnpj.length !== 11) return jsonResponse({ error: 'Cadastre o CNPJ (ou CPF) da casa na primeira unidade (Configurações → Unidades).' }, 400)
      if (!(Number(dados.mensalidade) > 0)) return jsonResponse({ error: 'A mensalidade precisa ser maior que zero.' }, 400)
      if (!dados.proximo_vencimento) return jsonResponse({ error: 'Não há próximo vencimento: confira o início e o dia de vencimento.' }, 400)
      const fone = (dados.whatsapp ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')
      const cliente = {
        name: (dados.razao_social || dados.empresa).trim(), cpfCnpj, email: dados.email ?? undefined,
        mobilePhone: fone || undefined, externalReference: companyId, notificationDisabled: false,
      }
      try {
        let customerId = dados.customer_id
        if (customerId) await asaas('PUT', `/customers/${customerId}`, cliente)
        else customerId = (await asaas('POST', '/customers', cliente)).id as string

        // Avisos do Asaas: 5 dias antes e no dia do vencimento, por e-mail.
        let avisos = 'ok'
        try {
          const lista = (await asaas('GET', `/customers/${customerId}/notifications`)).data as { id: string; event: string; scheduleOffset: number }[]
          const venc = lista.filter((n) => n.event === 'PAYMENT_DUEDATE_WARNING')
          // por enquanto só e-mail (SMS pode ter custo no Asaas)
          const canais = { enabled: true, emailEnabledForCustomer: true, smsEnabledForCustomer: false, whatsappEnabledForCustomer: false, phoneCallEnabledForCustomer: false }
          const noDia = venc.find((n) => n.scheduleOffset === 0)
          const antes = venc.find((n) => n.scheduleOffset !== 0)
          if (noDia) await asaas('PUT', `/notifications/${noDia.id}`, canais)
          if (antes) await asaas('PUT', `/notifications/${antes.id}`, { ...canais, scheduleOffset: 5 })
          // os demais avisos do Asaas (fatura criada, vencida...) também sem SMS, WhatsApp ou ligação
          for (const n of lista) {
            if (n.id === noDia?.id || n.id === antes?.id) continue
            await asaas('PUT', `/notifications/${n.id}`, { smsEnabledForCustomer: false, whatsappEnabledForCustomer: false, phoneCallEnabledForCustomer: false })
          }
        } catch (e) {
          avisos = e instanceof Error ? e.message : 'falhou'
        }

        let subscriptionId = dados.subscription_id
        const assinatura = { value: Number(dados.mensalidade), description: 'Mensalidade Festou', externalReference: companyId }
        if (subscriptionId) {
          await asaas('PUT', `/subscriptions/${subscriptionId}`, { ...assinatura, updatePendingPayments: true })
        } else {
          subscriptionId = (await asaas('POST', '/subscriptions', {
            ...assinatura, customer: customerId, billingType: 'UNDEFINED', cycle: 'MONTHLY', nextDueDate: dados.proximo_vencimento,
          })).id as string
        }

        // fatura em aberto mais próxima (o link que o cliente usa para pagar)
        let link: string | null = null
        let vencimento: string | null = null
        try {
          const cobr = (await asaas('GET', `/subscriptions/${subscriptionId}/payments`)).data as { status: string; dueDate: string; invoiceUrl: string }[]
          const aberta = cobr.filter((c) => c.status === 'PENDING' || c.status === 'OVERDUE').sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
          if (aberta) { link = aberta.invoiceUrl; vencimento = aberta.dueDate }
        } catch {
          // sem a lista agora: o link chega pelo aviso do Asaas quando a cobrança for criada
        }

        const { error: lErr } = await admin.rpc('platform_asaas_link', { p_company: companyId, p_customer: customerId, p_subscription: subscriptionId, p_link: link, p_vencimento: vencimento })
        if (lErr) return jsonResponse({ error: lErr.message.replace(/^[A-Z_]+: /, '') }, 400)
        return jsonResponse({ customer_id: customerId, subscription_id: subscriptionId, link, vencimento, avisos, ambiente: Deno.env.get('ASAAS_ENV') === 'producao' ? 'producao' : 'sandbox' }, 200)
      } catch (e) {
        return jsonResponse({ error: e instanceof Error ? e.message : 'Falha ao falar com o Asaas.' }, 400)
      }
    }

    if (body.action === 'asaas_cancel') {
      const companyId = String(body.company_id ?? '')
      const { data: b } = await admin.from('platform_billing').select('asaas_subscription_id, asaas_customer_id').eq('company_id', companyId).maybeSingle()
      if (!b?.asaas_subscription_id) return jsonResponse({ error: 'Esta empresa não tem assinatura no Asaas.' }, 400)
      try {
        await asaas('DELETE', `/subscriptions/${b.asaas_subscription_id}`)
      } catch (e) {
        if (!/404|not.?found|não encontrad/i.test(e instanceof Error ? e.message : '')) return jsonResponse({ error: e instanceof Error ? e.message : 'Falha ao cancelar no Asaas.' }, 400)
      }
      await admin.rpc('platform_asaas_link', { p_company: companyId, p_customer: b.asaas_customer_id, p_subscription: null, p_link: null, p_vencimento: null })
      await admin.from('platform_billing').update({ link_pagamento: null, link_vencimento: null }).eq('company_id', companyId)
      return jsonResponse({ ok: true }, 200)
    }

    if (body.action === 'delete_company') {
      const { data: cob } = await admin.from('platform_billing').select('asaas_subscription_id').eq('company_id', String(body.company_id ?? '')).maybeSingle()
      const { data: res, error: delError } = await admin.rpc('platform_delete_company', {
        p_company: String(body.company_id ?? ''), p_confirm_name: String(body.confirm_name ?? ''),
      })
      if (delError) return jsonResponse({ error: delError.message.replace(/^[A-Z_]+: /, '') }, 400)
      const r = res as { copia_id: string; arquivos: { bucket: string; path: string }[]; logins: string[] }

      let arquivosApagados = 0
      let arquivosFalha = 0
      const porBucket: Record<string, string[]> = {}
      for (const f of r.arquivos ?? []) {
        if (!porBucket[f.bucket]) porBucket[f.bucket] = []
        porBucket[f.bucket].push(f.path)
      }
      for (const [bucket, paths] of Object.entries(porBucket)) {
        for (let i = 0; i < paths.length; i += 100) {
          const lote = paths.slice(i, i + 100)
          const { error } = await admin.storage.from(bucket).remove(lote)
          if (error) arquivosFalha += lote.length
          else arquivosApagados += lote.length
        }
      }

      let loginsApagados = 0
      let loginsFalha = 0
      for (const uid of r.logins ?? []) {
        if (uid === callerData.user.id) continue
        const { error } = await admin.auth.admin.deleteUser(uid)
        if (error && !/not.?found/i.test(error.message)) loginsFalha++
        else loginsApagados++
      }

      let assinaturaCancelada = false
      if (cob?.asaas_subscription_id) {
        try {
          await asaas('DELETE', `/subscriptions/${cob.asaas_subscription_id}`)
          assinaturaCancelada = true
        } catch {
          // a empresa já saiu; a assinatura pode ser cancelada no painel do Asaas
        }
      }

      return jsonResponse({ copia_id: r.copia_id, arquivos_apagados: arquivosApagados, arquivos_falha: arquivosFalha, logins_apagados: loginsApagados, logins_falha: loginsFalha, assinatura_cancelada: assinaturaCancelada, tinha_assinatura: !!cob?.asaas_subscription_id }, 200)
    }

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
