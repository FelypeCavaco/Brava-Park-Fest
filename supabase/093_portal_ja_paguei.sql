-- =========================================================
-- PORTAL: BOTÃO "JÁ PAGUEI" COM COMPROVANTE
--
-- A família paga pelo Pix (QR code ou copia e cola) e, no botão "Já paguei",
-- informa o valor e anexa o comprovante (obrigatório). O comprovante aparece
-- no sininho da equipe e na Central da festa, onde a equipe confere no banco
-- e aprova (o pagamento é lançado) ou recusa (com o motivo).
--
-- Volta a aceitar o envio desligado na migração 084, com os mesmos limites:
-- até 5 comprovantes esperando conferência por festa, e o arquivo só pode ir
-- para a pasta daquele portal.
--
-- Funciona nos dois bancos (Brava e clientes). Roda numa transação.
-- =========================================================

begin;

create or replace function portal_submit_receipt(p_token uuid, p_amount numeric, p_path text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_res uuid := portal_reservation(p_token);
  v_id uuid;
begin
  if v_res is null then raise exception 'Link não encontrado.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Informe o valor pago.'; end if;
  if p_path is null or split_part(p_path, '/', 1) <> p_token::text then raise exception 'Anexe o comprovante do pagamento.'; end if;
  if (select count(*) from portal_receipts where reservation_id = v_res and status = 'em_analise') >= 5 then
    raise exception 'Já existem comprovantes aguardando conferência. Aguarde a equipe.';
  end if;
  insert into portal_receipts (reservation_id, amount, storage_path) values (v_res, round(p_amount, 2), p_path) returning id into v_id;
  perform portal_log(v_res, 'comprovante', 'Informou um pagamento de ' || fmt_brl(p_amount) || ' (Já paguei) e enviou o comprovante', v_id);
  return v_id;
end;
$$;

drop policy if exists "portal_comprovantes_upload" on storage.objects;
create policy "portal_comprovantes_upload" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'portal-comprovantes' and portal_token_valid((storage.foldername(name))[1]));

select fix_definer_owners();

commit;
