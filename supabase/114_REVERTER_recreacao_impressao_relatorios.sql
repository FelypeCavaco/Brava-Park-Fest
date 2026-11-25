-- Desfaz a 114: volta às regras antigas (sem A4 e sem as opções de impressão) e remove os relatórios novos.
begin;

drop function if exists rec_relatorio_mais(date, date, uuid);

create or replace function rec_regras_padrao() returns jsonb language sql immutable as $$
  select '{"lotacao": 40, "aviso": 10, "idMin": 2, "idMax": 12, "comprovante": "perguntar", "impressora": "nao"}'::jsonb;
$$;

create or replace function rec_regras_salvar(p_regras jsonb, p_termo text) returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not rec_pode_configurar() then raise exception 'Sem permissão para configurar a recreação.'; end if;
  r := jsonb_build_object(
    'lotacao', coalesce(nullif(p_regras->>'lotacao', '')::int, 40),
    'aviso', coalesce(nullif(p_regras->>'aviso', '')::int, 10),
    'idMin', coalesce(nullif(p_regras->>'idMin', '')::int, 0),
    'idMax', coalesce(nullif(p_regras->>'idMax', '')::int, 17),
    'comprovante', case when p_regras->>'comprovante' in ('perguntar', 'zap', 'imp', 'ambos') then p_regras->>'comprovante' else 'perguntar' end,
    'impressora', case when p_regras->>'impressora' in ('nao', '58', '80') then p_regras->>'impressora' else 'nao' end);
  if (r->>'lotacao')::int < 1 or (r->>'lotacao')::int > 2000 then raise exception 'A lotação precisa ser de 1 a 2000 crianças.'; end if;
  if (r->>'aviso')::int < 1 or (r->>'aviso')::int > 120 then raise exception 'O aviso precisa ser de 1 a 120 minutos antes.'; end if;
  if (r->>'idMin')::int < 0 or (r->>'idMax')::int > 17 or (r->>'idMin')::int > (r->>'idMax')::int then
    raise exception 'Confira as idades: a mínima não pode passar da máxima (até 17 anos).';
  end if;
  if length(trim(coalesce(p_termo, ''))) < 20 then raise exception 'Escreva o termo de responsabilidade (pelo menos uma frase).'; end if;
  insert into rec_config (company_id, regras, termo, atualizado_em, atualizado_por)
  values (current_company_id(), r, trim(p_termo), now(), current_actor_name())
  on conflict (company_id) do update set regras = excluded.regras, termo = excluded.termo, atualizado_em = now(), atualizado_por = excluded.atualizado_por;
end;
$$;
revoke all on function rec_regras_salvar(jsonb, text) from public, anon;
grant execute on function rec_regras_salvar(jsonb, text) to authenticated;

commit;
