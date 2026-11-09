-- =========================================================
-- PLANOS NOVOS DO FESTOU + MENSALIDADE COM UNIDADES A MAIS + PEDIDOS DA
-- PÁGINA DE VENDAS
--
-- SÓ NO BANCO DOS CLIENTES (precisa da 094).
--
-- 1) Planos (decididos em 9/11/2026):
--    Essencial    R$ 189,90 · 1 unidade · até 5 usuários
--    Profissional R$ 279,90 · 1 unidade · até 10 usuários
--    Master       R$ 369,90 · 2 unidades · usuários ilimitados
--    Unidade a mais: R$ 49,90 por mês em todos.
--    As casas que já estão num plano ficam com os limites e as funções novas.
--    A mensalidade delas NÃO muda sozinha (use "Recalcular" na ficha).
-- 2) Mensalidade = preço do plano + unidades a mais × valor da unidade.
-- 3) Pedido feito na página de vendas entra em Interessados.
--
-- Roda numa transação.
-- =========================================================

begin;

-- ---------- 1) Planos ----------
insert into platform_plans (id, nome, preco, unidades_incluidas, usuarios_incluidos, unidade_adicional, modulos, destaque, ordem, ativo) values
  ('essencial', 'Essencial', 189.90, 1, 5, 49.90, array['agenda'], false, 1, true),
  ('profissional', 'Profissional', 279.90, 1, 10, 49.90,
     array['agenda', 'propostas', 'comissoes', 'escalas', 'estoque', 'acertos', 'lucro'], true, 2, true),
  ('master', 'Master', 369.90, 2, null, 49.90, platform_all_modules(), false, 3, true)
on conflict (id) do update set
  nome = excluded.nome, preco = excluded.preco, unidades_incluidas = excluded.unidades_incluidas,
  usuarios_incluidos = excluded.usuarios_incluidos, unidade_adicional = excluded.unidade_adicional,
  modulos = excluded.modulos, destaque = excluded.destaque, ordem = excluded.ordem, ativo = excluded.ativo;
update platform_plans set destaque = false where id not in ('profissional') and destaque;

-- Limites das casas acompanham o plano; funções recalculadas.
update platform_billing b set unidades_incluidas = p.unidades_incluidas, usuarios_incluidos = p.usuarios_incluidos,
       unidade_adicional = p.unidade_adicional, plano = p.nome
from platform_plans p where p.id = b.plano_id;
do $$ declare c record; begin
  for c in select company_id from platform_billing where plano_id is not null loop
    perform platform_apply_plan(c.company_id);
  end loop;
end $$;

-- ---------- 2) Mensalidade com unidades a mais ----------
-- Quanto a casa deveria pagar: preço do plano + unidades ativas além das
-- incluídas × valor da unidade a mais. Nulo se a casa não está num plano.
create or replace function platform_mensalidade_calculada(p_company uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select p.preco + greatest((select count(*) from units u where u.company_id = p_company and u.active) - p.unidades_incluidas, 0) * p.unidade_adicional
  from platform_billing b join platform_plans p on p.id = b.plano_id
  where b.company_id = p_company;
$$;
revoke all on function platform_mensalidade_calculada(uuid) from public, anon, authenticated;

-- Para o painel: mensalidade atual x calculada, e unidades ativas.
drop function if exists platform_billing_plans();
create or replace function platform_billing_plans()
returns table (company_id uuid, plano_id text, modulos_extras text[], mensalidade_calculada numeric, unidades_ativas int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  return query select b.company_id, b.plano_id, b.modulos_extras, platform_mensalidade_calculada(b.company_id),
                      (select count(*)::int from units u where u.company_id = b.company_id and u.active)
    from platform_billing b;
end;
$$;

-- Troca de plano: a mensalidade já considera as unidades a mais.
create or replace function platform_set_company_plan(p_company uuid, p_plano text) returns void
language plpgsql security definer set search_path = public as $$
declare p platform_plans;
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  if not exists (select 1 from platform_billing where company_id = p_company) then
    raise exception 'Cadastre antes a mensalidade da casa (aba Mensalidade).';
  end if;
  if p_plano is null then
    update platform_billing set plano_id = null where company_id = p_company;
    return;
  end if;
  select * into p from platform_plans where id = p_plano;
  if not found then raise exception 'Plano não encontrado.'; end if;
  update platform_billing set plano_id = p.id, plano = p.nome,
         unidades_incluidas = p.unidades_incluidas, usuarios_incluidos = p.usuarios_incluidos, unidade_adicional = p.unidade_adicional
  where company_id = p_company;
  update platform_billing set mensalidade = platform_mensalidade_calculada(p_company) where company_id = p_company;
  perform platform_apply_plan(p_company);
end;
$$;

-- Botão "Recalcular mensalidade": aplica a conta (plano + unidades a mais).
create or replace function platform_billing_recalc(p_company uuid) returns numeric
language plpgsql security definer set search_path = public as $$
declare v numeric;
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  v := platform_mensalidade_calculada(p_company);
  if v is null then raise exception 'A casa não está num plano da lista.'; end if;
  update platform_billing set mensalidade = v where company_id = p_company;
  return v;
end;
$$;

-- Alterar um plano: limites das casas acompanham (a mensalidade não).
create or replace function platform_plan_save(p_dados jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_id text := nullif(trim(p_dados->>'id'), '');
  v_mod text[];
  p platform_plans;
  c record;
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  if nullif(trim(p_dados->>'nome'), '') is null then raise exception 'Informe o nome do plano.'; end if;
  if v_id is null then
    v_id := left(regexp_replace(lower(translate(trim(p_dados->>'nome'), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc')), '[^a-z0-9]+', '_', 'g'), 30);
    v_id := trim(both '_' from v_id);
    if length(v_id) < 2 then v_id := 'plano_' || substr(md5(random()::text), 1, 6); end if;
    if exists (select 1 from platform_plans where id = v_id) then raise exception 'Já existe um plano com esse nome.'; end if;
  end if;
  select coalesce(array_agg(distinct m), '{}') into v_mod
  from jsonb_array_elements_text(coalesce(p_dados->'modulos', '[]'::jsonb)) m
  where m = any(platform_all_modules());

  insert into platform_plans (id, nome, preco, unidades_incluidas, usuarios_incluidos, unidade_adicional, modulos, destaque, ordem, ativo)
  values (v_id, trim(p_dados->>'nome'), coalesce((p_dados->>'preco')::numeric, 0), coalesce((p_dados->>'unidades_incluidas')::int, 1),
          nullif(p_dados->>'usuarios_incluidos', '')::int, coalesce((p_dados->>'unidade_adicional')::numeric, 0), v_mod,
          coalesce((p_dados->>'destaque')::boolean, false), coalesce((p_dados->>'ordem')::int, 99), coalesce((p_dados->>'ativo')::boolean, true))
  on conflict (id) do update set
    nome = excluded.nome, preco = excluded.preco, unidades_incluidas = excluded.unidades_incluidas,
    usuarios_incluidos = excluded.usuarios_incluidos, unidade_adicional = excluded.unidade_adicional,
    modulos = excluded.modulos, destaque = excluded.destaque, ordem = excluded.ordem, ativo = excluded.ativo
  returning * into p;

  if p.destaque then
    update platform_plans set destaque = false where id <> v_id and destaque;
  end if;
  update platform_billing set plano = p.nome, unidades_incluidas = p.unidades_incluidas,
         usuarios_incluidos = p.usuarios_incluidos, unidade_adicional = p.unidade_adicional
  where plano_id = v_id;
  for c in select company_id from platform_billing where plano_id = v_id loop
    perform platform_apply_plan(c.company_id);
  end loop;
  return v_id;
exception
  when check_violation then raise exception 'Confira os valores: sem números negativos e pelo menos 1 unidade.';
  when invalid_text_representation then raise exception 'Confira os valores digitados.';
end;
$$;

-- ---------- 3) Página de vendas ----------
-- Planos à venda (público: nome, preço, limites e funções).
create or replace function platform_public_plans()
returns table (id text, nome text, preco numeric, unidades_incluidas int, usuarios_incluidos int, unidade_adicional numeric, modulos text[], destaque boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.nome, p.preco, p.unidades_incluidas, p.usuarios_incluidos, p.unidade_adicional, p.modulos, p.destaque
  from platform_plans p where p.ativo order by p.ordem, p.preco;
$$;

-- Pedido de contato / demonstração. Sem login. Limites contra abuso:
-- o mesmo WhatsApp ou e-mail em 24 h não duplica; no máximo 30 pedidos por hora.
create or replace function platform_lead_submit(p_dados jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_nome text := left(nullif(trim(p_dados->>'nome'), ''), 120);
  v_wa text := left(regexp_replace(coalesce(p_dados->>'whatsapp', ''), '\D', '', 'g'), 13);
  v_email text := left(lower(nullif(trim(p_dados->>'email'), '')), 160);
begin
  if v_nome is null then raise exception 'Informe o seu nome.'; end if;
  if length(v_wa) < 10 and v_email is null then raise exception 'Informe o seu WhatsApp com DDD.'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Confira o e-mail.'; end if;
  if exists (select 1 from platform_leads l where l.criado_em > now() - interval '24 hours'
             and ((length(v_wa) >= 10 and regexp_replace(coalesce(l.whatsapp, ''), '\D', '', 'g') = v_wa) or (v_email is not null and lower(l.email) = v_email))) then
    return 'ok'; -- já recebido: não duplica
  end if;
  if (select count(*) from platform_leads where criado_em > now() - interval '1 hour' and origem like 'Página de vendas%') >= 30 then
    raise exception 'Recebemos muitos pedidos agora. Tente de novo em alguns minutos ou chame no WhatsApp.';
  end if;
  insert into platform_leads (nome, casa, cidade, whatsapp, email, plano_interesse, origem, observacao)
  values (v_nome, left(nullif(trim(p_dados->>'casa'), ''), 120), left(nullif(trim(p_dados->>'cidade'), ''), 80),
          nullif(v_wa, ''), v_email, left(nullif(trim(p_dados->>'plano'), ''), 40),
          'Página de vendas' || coalesce(' · ' || left(nullif(trim(p_dados->>'utm'), ''), 60), ''),
          left(nullif(trim(p_dados->>'mensagem'), ''), 1000));
  return 'ok';
end;
$$;

revoke all on function platform_billing_plans(), platform_set_company_plan(uuid, text), platform_billing_recalc(uuid), platform_plan_save(jsonb) from public, anon;
grant execute on function platform_billing_plans(), platform_set_company_plan(uuid, text), platform_billing_recalc(uuid), platform_plan_save(jsonb) to authenticated;
revoke all on function platform_public_plans(), platform_lead_submit(jsonb) from public;
grant execute on function platform_public_plans(), platform_lead_submit(jsonb) to anon, authenticated;

select fix_definer_owners();

commit;

notify pgrst, 'reload schema';
