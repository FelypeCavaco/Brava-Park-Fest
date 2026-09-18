-- =========================================================
-- Brava Park Fest — Correção: evita checklist duplicado por festa
-- Remove duplicatas que já possam ter sido criadas (mantendo a que estiver
-- marcada como concluída, se houver) e trava o banco pra nunca mais duplicar.
-- Rode este arquivo no SQL Editor do Supabase.
-- =========================================================

with ranked as (
  select id, reservation_id, description, done,
    row_number() over (
      partition by reservation_id, description
      order by done desc, id
    ) as rn
  from checklist_items
)
delete from checklist_items
where id in (select id from ranked where rn > 1);

alter table checklist_items
  add constraint checklist_items_reservation_description_key unique (reservation_id, description);
