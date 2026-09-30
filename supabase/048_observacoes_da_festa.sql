-- =========================================================
-- Observações da festa, com lembrete opcional por data.
-- Cada observação pode "ativar lembrete" com uma data — a partir dessa
-- data, ela aparece no Painel até alguém marcar como concluída (assim não
-- se perde se ninguém abrir o sistema exatamente naquele dia).
-- =========================================================

create table if not exists reservation_notes (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  body text not null,
  remind_on date,
  reminder_done boolean not null default false,
  created_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists idx_reservation_notes_reservation on reservation_notes (reservation_id);
create index if not exists idx_reservation_notes_remind on reservation_notes (remind_on) where remind_on is not null and not reminder_done;

alter table reservation_notes enable row level security;

-- Leitura ampla: o Painel mostra os lembretes do dia pra qualquer pessoa
-- ativa da equipe. Escrita: quem tem acesso à Central da festa.
create policy "read_active" on reservation_notes for select using (is_active_user(auth.uid()));
create policy "write_reservation_notes" on reservation_notes for all
  using (has_permission(auth.uid(), 'page:festa_detalhe'))
  with check (has_permission(auth.uid(), 'page:festa_detalhe'));
