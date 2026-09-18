-- =========================================================
-- Documentos da festa guardados de verdade (Supabase Storage),
-- em vez de só aparecer como prévia na tela.
-- =========================================================

-- Bucket privado — os arquivos podem ter dados do cliente, então não ficam
-- públicos; o acesso é sempre por link temporário gerado na hora (ver
-- src/pages/FestaDetalhe.tsx).
insert into storage.buckets (id, name, public)
values ('festa-documentos', 'festa-documentos', false)
on conflict (id) do nothing;

-- Só a equipe logada mexe nesses arquivos, igual ao resto do sistema.
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'objects' and policyname = 'festa_documentos_select') then
    create policy "festa_documentos_select" on storage.objects for select to authenticated using (bucket_id = 'festa-documentos');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'objects' and policyname = 'festa_documentos_insert') then
    create policy "festa_documentos_insert" on storage.objects for insert to authenticated with check (bucket_id = 'festa-documentos');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'objects' and policyname = 'festa_documentos_delete') then
    create policy "festa_documentos_delete" on storage.objects for delete to authenticated using (bucket_id = 'festa-documentos');
  end if;
end $$;

-- Metadados de cada arquivo (o arquivo em si fica no Storage; aqui só
-- guardamos o nome e o caminho, pra listar rapidinho na Central da Festa).
create table if not exists reservation_documents (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  uploaded_at timestamptz not null default now()
);

create index if not exists idx_reservation_documents_reservation on reservation_documents (reservation_id);

alter table reservation_documents enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'reservation_documents' and policyname = 'authenticated_full_access') then
    create policy "authenticated_full_access" on reservation_documents
      for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
  end if;
end $$;
