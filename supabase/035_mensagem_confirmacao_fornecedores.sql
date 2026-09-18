-- =========================================================
-- Mensagens de WhatsApp editáveis pelo dono (sem precisar mexer em código).
-- Por enquanto só a de "Confirmar com fornecedores" usa isso; dá pra
-- guardar outras aqui no futuro do mesmo jeito. Se a chave não existir
-- ainda (antes de rodar esta migration), o sistema usa um texto padrão
-- fixo como reserva.
-- =========================================================

create table if not exists message_templates (
  key text primary key,
  body text not null,
  updated_at timestamptz not null default now()
);

alter table message_templates enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'message_templates' and policyname = 'authenticated_full_access') then
    create policy "authenticated_full_access" on message_templates
      for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
  end if;
end $$;

insert into message_templates (key, body)
values (
  'confirmar_fornecedores',
  'Olá Pessoal, tudo certo?

Passando para lembrar que a entrega de hoje do BOLO, DOCINHOS, SALGADINHOS E PRATOS QUENTE está programada para as {{horario_entrega}}

TEMA: {{tema}}

{{aniversariante_idade}}

OBS: {{observacao}}'
)
on conflict (key) do nothing;
