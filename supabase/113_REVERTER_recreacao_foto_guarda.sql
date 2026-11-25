-- Desfaz a 113: volta a apagar sempre por dias.
begin;

create or replace function rec_funcoes_padrao() returns jsonb language sql immutable as $$
  select '{"codigo": true, "qr": true, "foto": "cadastro", "fotoObrig": false, "fotoDias": 30,
           "paginaPais": true, "pedirTempo": true, "chegando": true, "ocorrPais": true,
           "ocorr": true, "ocorrCiente": true,
           "caixaObrig": true, "cego": true, "lembrete": true, "horaFecha": "22:00", "lembreteMin": 30,
           "troca": true, "trocaConta": true, "offline": false, "autocadastro": false}'::jsonb;
$$;

create or replace function platform_rec_funcoes_salvar(p_company uuid, p_funcoes jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare f jsonb := '{}'; k text; pad jsonb := rec_funcoes_padrao();
begin
  if not is_platform_admin(auth.uid()) then raise exception 'Só o administrador geral.'; end if;
  if not exists (select 1 from companies where id = p_company) then raise exception 'Empresa não encontrada.'; end if;
  for k in select jsonb_object_keys(pad) loop
    if p_funcoes ? k then
      if jsonb_typeof(pad->k) = 'boolean' then f := f || jsonb_build_object(k, coalesce((p_funcoes->>k)::boolean, (pad->>k)::boolean));
      elsif jsonb_typeof(pad->k) = 'number' then f := f || jsonb_build_object(k, greatest(1, least(999, coalesce(nullif(p_funcoes->>k, '')::int, (pad->>k)::int))));
      else f := f || jsonb_build_object(k, coalesce(p_funcoes->>k, pad->>k));
      end if;
    end if;
  end loop;
  if f ? 'foto' and f->>'foto' not in ('nao', 'cadastro', 'entrada') then raise exception 'Opção de foto inválida.'; end if;
  if f ? 'horaFecha' and f->>'horaFecha' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Horário de fim do expediente inválido.'; end if;
  insert into rec_config (company_id, funcoes, atualizado_em, atualizado_por)
  values (p_company, f, now(), 'Administrador geral')
  on conflict (company_id) do update set funcoes = rec_config.funcoes || excluded.funcoes, atualizado_em = now(), atualizado_por = 'Administrador geral';
end;
$$;
revoke all on function platform_rec_funcoes_salvar(uuid, jsonb) from public, anon;
grant execute on function platform_rec_funcoes_salvar(uuid, jsonb) to authenticated;

create or replace function rec_fotos_vencidas() returns text[]
language plpgsql stable security definer set search_path = public as $$
declare v_dias int := coalesce((rec_cfg()->>'fotoDias')::int, 30);
begin
  if not rec_pode('action:recreacao.operar') then return '{}'; end if;
  return coalesce((select array_agg(foto_path) from (
    select foto_path from rec_visitas
     where company_id = current_company_id() and foto_path is not null and status <> 'dentro'
       and foto_em < now() - make_interval(days => v_dias)
     order by foto_em limit 100) x), '{}');
end;
$$;
revoke all on function rec_fotos_vencidas() from public, anon;
grant execute on function rec_fotos_vencidas() to authenticated;

commit;
