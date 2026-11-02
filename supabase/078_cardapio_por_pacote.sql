-- =========================================================
-- CARDÁPIO POR PACOTE
--
-- Cada opção do cardápio do portal (ex.: "Camarão", "Bolo de nozes") pode
-- valer para todos os pacotes (como hoje) ou só para os pacotes escolhidos.
-- O portal da festa mostra só as opções do pacote daquela festa, e o envio
-- do cardápio só aceita essas opções.
-- Se uma seção ficar sem nenhuma opção para o pacote da festa (e não aceitar
-- "outro"), ela não aparece para essa festa.
--
-- Rodar nos DOIS bancos (Brava e clientes). Nada muda até alguém escolher
-- pacotes numa opção: todas as opções existentes continuam em todos os pacotes.
-- Roda numa transação.
-- =========================================================

begin;

alter table portal_menu_options add column if not exists package_ids uuid[];
comment on column portal_menu_options.package_ids is 'Pacotes em que a opção aparece; vazio = todos os pacotes';

create or replace function festa_menu_sections(p_reservation uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'nome', x.name, 'ajuda', x.help, 'modo', x.mode,
      'quantidade', menu_section_quantity(x.id, p_reservation),
      'outro', x.allow_other, 'outro_rotulo', x.other_label, 'campo', x.legacy_field,
      'opcoes', x.opcoes
    ) order by x.sort, x.created_at), '[]'::jsonb)
  from (
    select s.*,
           coalesce((select jsonb_agg(o.name order by o.sort, o.name) from portal_menu_options o
                     where o.section_id = s.id and o.active
                       and (o.package_ids is null or cardinality(o.package_ids) = 0 or r.package_id = any(o.package_ids))), '[]'::jsonb) opcoes,
           exists (select 1 from portal_menu_options o where o.section_id = s.id and o.active) tem_opcoes
    from menu_sections s
    join reservations r on r.id = p_reservation
    where s.active and s.company_id = r.company_id and (s.unit_id is null or s.unit_id = r.unit_id)
  ) x
  -- seção cujas opções são todas de outros pacotes some para esta festa
  where jsonb_array_length(x.opcoes) > 0 or x.allow_other or not x.tem_opcoes;
$$;
revoke all on function festa_menu_sections(uuid) from public, anon, authenticated;

select fix_definer_owners();

commit;

notify pgrst, 'reload schema';
