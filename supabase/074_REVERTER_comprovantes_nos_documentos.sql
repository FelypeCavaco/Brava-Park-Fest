-- =========================================================
-- REVERTER a migração 074 (comprovantes nos documentos) — só use se for para desfazer.
-- Tira os comprovantes da lista de documentos das festas (os comprovantes e
-- os pagamentos continuam guardados) e volta a regra de antes.
-- =========================================================
begin;

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
  return v_payment;
end;
$$;

do $$
begin
  drop policy if exists "portal_comprovantes_read" on storage.objects;
  create policy "portal_comprovantes_read" on storage.objects for select to authenticated
    using (bucket_id = 'portal-comprovantes'
      and (has_permission(auth.uid(), 'page:portal_avisos') or has_permission(auth.uid(), 'action:festa.pagamentos'))
      and exists (select 1 from portal_receipts pr where pr.storage_path = name));
end $$;


alter table reservation_documents disable trigger user;
delete from reservation_documents where bucket = 'portal-comprovantes';
alter table reservation_documents enable trigger user;
drop index if exists reservation_documents_receipt_key;
alter table reservation_documents drop column if exists receipt_id;
alter table reservation_documents drop constraint if exists reservation_documents_bucket_check;
alter table reservation_documents drop column if exists bucket;
drop function if exists receipt_document_name(numeric, date, text);

commit;
notify pgrst, 'reload schema';
