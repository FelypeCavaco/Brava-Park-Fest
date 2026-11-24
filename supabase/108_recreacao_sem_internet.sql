-- =========================================================
-- 108 — Recreação, etapa 5c: entrada sem internet (versão segura)
-- =========================================================
-- Só vale para as casas em que o administrador geral ligou
-- "Continuar funcionando sem internet".
--  * A entrada feita sem sinal fica numa fila no aparelho, com a hora real
--    e o código de retirada gerado ali. Quando a internet volta, o aparelho
--    manda a fila e esta função cria a entrada de verdade, com a hora em
--    que a criança entrou. Repetir o envio não duplica (cada entrada tem um
--    identificador próprio).
--  * A SAÍDA continua exigindo internet: a conta é sempre a do servidor.
--  * A hora informada não pode ser futura nem ter mais de 12 horas.
--  * O plano e o pagamento valem como no momento do envio (o pagamento
--    entra no caixa que estiver aberto nesse momento).
-- Desfazer: 108_REVERTER_recreacao_sem_internet.sql
-- =========================================================

begin;

alter table rec_visitas add column if not exists offline boolean not null default false;

create table if not exists rec_offline_envios (
  company_id uuid not null default current_company_id() references companies(id) on delete cascade,
  local_id uuid not null,
  grupo_id uuid not null,
  em timestamptz not null default now(),
  por text,
  primary key (company_id, local_id)
);
drop trigger if exists trg_set_company_id on rec_offline_envios;
create trigger trg_set_company_id before insert or update on rec_offline_envios for each row execute function set_company_id();
alter table rec_offline_envios enable row level security;
drop policy if exists company_isolation on rec_offline_envios;
create policy company_isolation on rec_offline_envios as restrictive for all
  using (company_id = current_company_id() or (auth.uid() is null and current_user = 'app_definer'))
  with check (company_id = current_company_id() or (auth.uid() is null and current_user = 'app_definer'));
drop policy if exists app_definer_all on rec_offline_envios;
create policy app_definer_all on rec_offline_envios for all to app_definer using (true) with check (true);
revoke all on rec_offline_envios from anon, authenticated;
grant all on rec_offline_envios to app_definer;

-- p_criancas: igual ao da entrada normal ([{ crianca, plano, pulseira, forma, excecao }])
create or replace function rec_entrada_offline(p_local uuid, p_unit uuid, p_familia uuid, p_criancas jsonb,
                                               p_entrada_em timestamptz, p_codigo text, p_token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_grupo uuid; v_ant uuid; v_cod text; v_mudou boolean := false; v_tok uuid; v_primeira uuid;
begin
  if not rec_pode('action:recreacao.operar') then raise exception 'Sem permissão para dar entrada na recreação.'; end if;
  if not coalesce((rec_cfg()->>'offline')::boolean, false) then raise exception 'O modo sem internet não está ligado para esta casa.'; end if;
  if p_local is null then raise exception 'Entrada sem identificador.'; end if;
  select grupo_id into v_ant from rec_offline_envios where company_id = current_company_id() and local_id = p_local;
  if found then return jsonb_build_object('repetida', true, 'grupo', v_ant); end if;
  if p_entrada_em is null or p_entrada_em > now() + interval '2 minutes' then raise exception 'A hora da entrada informada pelo aparelho é inválida. Confira o relógio do aparelho.'; end if;
  if p_entrada_em < now() - interval '12 hours' then raise exception 'Esta entrada tem mais de 12 horas. Registre pelo painel e avise o gerente.'; end if;

  r := rec_entrada(p_unit, p_familia, p_criancas);
  v_grupo := (r->>'grupo')::uuid;
  update rec_visitas set entrada_em = p_entrada_em, offline = true where grupo_id = v_grupo;

  -- o código que o responsável recebeu no balcão vale, se não houver outro igual dentro
  v_cod := r->>'codigo';
  if p_codigo ~ '^[0-9]{4}$' and p_codigo <> v_cod then
    if exists (select 1 from rec_visitas where company_id = current_company_id() and status = 'dentro' and codigo = p_codigo and grupo_id <> v_grupo) then
      v_mudou := true;
    else
      update rec_visitas set codigo = p_codigo where grupo_id = v_grupo;
      v_cod := p_codigo;
    end if;
  end if;
  -- o link do QR que ele recebeu também vale
  v_tok := (r->>'token')::uuid;
  if p_token is not null and p_token <> v_tok and not exists (select 1 from rec_visitas where token = p_token) then
    select id into v_primeira from rec_visitas where grupo_id = v_grupo order by id limit 1;
    update rec_visitas set token = p_token where id = v_primeira;
    v_tok := p_token;
  end if;
  insert into rec_offline_envios (local_id, grupo_id, por) values (p_local, v_grupo, current_actor_name());
  return r || jsonb_build_object('codigo', v_cod, 'token', v_tok, 'codigo_mudou', v_mudou, 'entrada_em', p_entrada_em, 'offline', true);
end;
$$;
revoke all on function rec_entrada_offline(uuid, uuid, uuid, jsonb, timestamptz, text, uuid) from public, anon;
grant execute on function rec_entrada_offline(uuid, uuid, uuid, jsonb, timestamptz, text, uuid) to authenticated;

commit;
