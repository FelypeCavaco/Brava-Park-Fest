-- =========================================================
-- REVERTER a migração 078 (cardápio por pacote) — só use se for para desfazer.
-- Todas as opções voltam a aparecer em todos os pacotes.
-- =========================================================
begin;

create or replace function festa_menu_sections(p_reservation uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'nome', s.name, 'ajuda', s.help, 'modo', s.mode,
      'quantidade', menu_section_quantity(s.id, p_reservation),
      'outro', s.allow_other, 'outro_rotulo', s.other_label, 'campo', s.legacy_field,
      'opcoes', coalesce((select jsonb_agg(o.name order by o.sort, o.name) from portal_menu_options o where o.section_id = s.id and o.active), '[]'::jsonb)
    ) order by s.sort, s.created_at), '[]'::jsonb)
  from menu_sections s
  join reservations r on r.id = p_reservation
  where s.active and s.company_id = r.company_id and (s.unit_id is null or s.unit_id = r.unit_id);
$$;
revoke all on function festa_menu_sections(uuid) from public, anon, authenticated;

alter table portal_menu_options drop column if exists package_ids;

select fix_definer_owners();

commit;

notify pgrst, 'reload schema';
