-- =========================================================
-- Ajustes pedidos após o Motor de Contratos:
-- checklist com data por tarefa, motivo ao recusar proposta,
-- estoque mínimo variável por convidados do dia.
-- =========================================================

alter table checklist_items add column if not exists due_date date;

alter table proposals add column if not exists decline_reason text;

alter table inventory_items add column if not exists quantity_per_guest numeric(10,4);
