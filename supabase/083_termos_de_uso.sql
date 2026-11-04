-- =========================================================
-- TERMOS DE USO — aceite obrigatório (SÓ NO BANCO DOS CLIENTES)
--
-- Cada pessoa das casas clientes do Festou precisa aceitar a versão atual
-- dos Termos de Uso e da Política de Privacidade antes de usar o sistema.
-- O aceite fica registrado: quem, de qual casa, quando, qual versão e de
-- qual navegador. O administrador geral vê os aceites de cada empresa.
-- Quando os Termos mudarem de versão (no código), todos aceitam de novo.
--
-- A Brava não usa (não é uma casa cliente): NÃO rode no banco da Brava.
-- Não altera dados existentes. Roda numa transação.
-- =========================================================

begin;

create table if not exists platform_terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  company_id uuid references companies(id) on delete cascade,
  version text not null,
  user_name text,
  user_email text,
  user_agent text,
  accepted_at timestamptz not null default now(),
  unique (user_id, version)
);
create index if not exists idx_platform_terms_company on platform_terms_acceptances (company_id, accepted_at desc);
alter table platform_terms_acceptances enable row level security;
-- sem políticas: só as funções abaixo leem e gravam
revoke all on platform_terms_acceptances from anon, authenticated;

-- situação do usuário: 'aceito' (esta versão), 'antiga' (aceitou outra versão) ou 'nunca'
create or replace function platform_terms_status(p_version text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from platform_terms_acceptances where user_id = auth.uid() and version = p_version) then 'aceito'
    when exists (select 1 from platform_terms_acceptances where user_id = auth.uid()) then 'antiga'
    else 'nunca' end;
$$;

-- aceitar (uma vez por versão; aceitar de novo não duplica)
create or replace function platform_terms_accept(p_version text, p_user_agent text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Entre no sistema para aceitar os Termos.'; end if;
  if coalesce(trim(p_version), '') = '' then raise exception 'Versão dos Termos não informada.'; end if;
  insert into platform_terms_acceptances (user_id, company_id, version, user_name, user_email, user_agent)
  values (auth.uid(), current_company_id(), left(trim(p_version), 40),
          (select name from user_profiles where id = auth.uid()),
          (select email from auth.users where id = auth.uid()),
          left(p_user_agent, 300))
  on conflict (user_id, version) do nothing;
end;
$$;

-- quem do Fornecedor/plataforma vê: aceites de uma empresa
create or replace function platform_terms_list(p_company uuid)
returns table (user_name text, user_email text, version text, accepted_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  return query
    select a.user_name, a.user_email, a.version, a.accepted_at
    from platform_terms_acceptances a where a.company_id = p_company
    order by a.accepted_at desc;
end;
$$;

-- quem oferece o sistema, para aparecer nos Termos (nome, documento e contatos)
create or replace function platform_terms_provider() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object(
    'nome', s.contratada_nome, 'documento', s.contratada_documento, 'endereco', s.contratada_endereco,
    'email', s.contratada_email, 'whatsapp', s.contratada_whatsapp, 'foro', s.foro)
    from platform_settings s limit 1), '{}'::jsonb);
$$;

revoke all on function platform_terms_status(text) from public, anon;
revoke all on function platform_terms_accept(text, text) from public, anon;
revoke all on function platform_terms_list(uuid) from public, anon;
revoke all on function platform_terms_provider() from public;
grant execute on function platform_terms_status(text) to authenticated;
grant execute on function platform_terms_accept(text, text) to authenticated;
grant execute on function platform_terms_list(uuid) to authenticated;
-- os Termos também podem ser lidos antes de entrar (página pública /termos)
grant execute on function platform_terms_provider() to anon, authenticated;

select fix_definer_owners();

commit;
