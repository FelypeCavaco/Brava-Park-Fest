-- =========================================================
-- COMPROVANTES ACEITOS VÃO PARA OS DOCUMENTOS DA FESTA
--
-- Quando a equipe aceita ("Lançar pagamento") um comprovante enviado pelo
-- cliente no portal, o arquivo passa a aparecer também em Central da festa →
-- Documentos, junto do contrato, com o nome "Comprovante - R$ valor - data".
-- O arquivo não é copiado: o documento aponta para o próprio comprovante
-- (reservation_documents.bucket = 'portal-comprovantes'). Tirar da lista de
-- documentos não apaga o comprovante nem o pagamento.
-- Os comprovantes já aceitos antes desta migração também entram na lista
-- (sem gerar avisos no histórico).
--
-- Vale para o banco da Brava (072) e o dos clientes (073).
-- Não altera pagamentos, festas ou valores. Roda dentro de uma transação.
-- =========================================================

begin;

alter table reservation_documents add column if not exists bucket text not null default 'festa-documentos';
alter table reservation_documents drop constraint if exists reservation_documents_bucket_check;
alter table reservation_documents add constraint reservation_documents_bucket_check check (bucket in ('festa-documentos', 'portal-comprovantes'));
alter table reservation_documents add column if not exists receipt_id uuid references portal_receipts(id) on delete cascade;
create unique index if not exists reservation_documents_receipt_key on reservation_documents (receipt_id) where receipt_id is not null;

-- Nome do documento: "Comprovante - R$ 1.500,00 - 30/10/2026.pdf"
create or replace function receipt_document_name(p_amount numeric, p_date date, p_path text) returns text
language sql immutable set search_path = public as $$
  select 'Comprovante - ' || fmt_brl(p_amount) || ' - ' || to_char(p_date, 'DD/MM/YYYY')
         || coalesce('.' || lower(substring(p_path from '\.([A-Za-z0-9]{2,5})$')), '');
$$;

create or replace function launch_portal_receipt(p_receipt uuid, p_amount numeric, p_date date, p_method text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  rc portal_receipts%rowtype;
  v_payment uuid;
begin
  if not has_permission(auth.uid(), 'action:festa.pagamentos') then raise exception 'Sem permissão para registrar pagamentos.'; end if;
  select * into rc from portal_receipts where id = p_receipt for update;
  if not found then raise exception 'Comprovante não encontrado.'; end if;
  if rc.status <> 'em_analise' then raise exception 'Este comprovante já foi analisado.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Informe o valor.'; end if;
  insert into payments (reservation_id, amount, payment_date, payment_method, notes)
  values (rc.reservation_id, round(p_amount, 2), coalesce(p_date, today_brazil()), p_method, 'Comprovante enviado pelo portal do cliente')
  returning id into v_payment;
  update portal_receipts set status = 'lancado', payment_id = v_payment, decided_by_name = current_actor_name(), decided_at = now() where id = p_receipt;
  update portal_events set seen_at = now(), seen_by_name = current_actor_name() where ref_id = p_receipt and seen_at is null;
  -- comprovante aceito entra nos documentos da festa (junto do contrato)
  insert into reservation_documents (reservation_id, file_name, storage_path, bucket, receipt_id)
  values (rc.reservation_id, receipt_document_name(round(p_amount, 2), coalesce(p_date, today_brazil()), rc.storage_path), rc.storage_path, 'portal-comprovantes', rc.id)
  on conflict do nothing;
  return v_payment;
end;
$$;

-- Comprovantes aceitos antes desta migração (sem disparar o histórico).
alter table reservation_documents disable trigger user;
insert into reservation_documents (reservation_id, file_name, storage_path, bucket, receipt_id, uploaded_at, company_id)
select r.reservation_id,
       receipt_document_name(coalesce(p.amount, r.amount), coalesce(p.payment_date, (r.decided_at at time zone 'America/Sao_Paulo')::date, (r.created_at at time zone 'America/Sao_Paulo')::date), r.storage_path),
       r.storage_path, 'portal-comprovantes', r.id, coalesce(r.decided_at, r.created_at), r.company_id
from portal_receipts r
left join payments p on p.id = r.payment_id
where r.status = 'lancado'
  and not exists (select 1 from reservation_documents d where d.receipt_id = r.id);
alter table reservation_documents enable trigger user;

-- Quem vê a festa consegue abrir o comprovante pela lista de documentos.
do $$
begin
  drop policy if exists "portal_comprovantes_read" on storage.objects;
  create policy "portal_comprovantes_read" on storage.objects for select to authenticated
    using (bucket_id = 'portal-comprovantes'
      and (
        -- quem confere comprovantes (avisos do portal / pagamentos)
        ((has_permission(auth.uid(), 'page:portal_avisos') or has_permission(auth.uid(), 'action:festa.pagamentos'))
          and exists (select 1 from portal_receipts pr where pr.storage_path = name))
        -- ou quem vê o comprovante aceito nos documentos da festa
        or exists (select 1 from reservation_documents d where d.bucket = 'portal-comprovantes' and d.storage_path = name)
      ));
end $$;

select fix_definer_owners();

commit;

notify pgrst, 'reload schema';
