-- Desfaz a 097: apaga o registro de Pix gerados e volta o envio de comprovante
-- ao que era na 093. Os pagamentos já lançados continuam como estão.
begin;

drop trigger if exists trg_resolve_portal_pix on payments;
drop function if exists resolve_portal_pix_on_payment();
drop function if exists launch_portal_pix(uuid, numeric, date, text);
drop function if exists delete_portal_pix(uuid);
drop function if exists portal_pending_pix(uuid);
drop function if exists portal_register_pix(uuid, numeric, text);

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
grant execute on function portal_submit_receipt(uuid, numeric, text) to anon, authenticated;

drop table if exists portal_pix_generated;

select fix_definer_owners();
commit;
