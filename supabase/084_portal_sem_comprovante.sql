-- =========================================================
-- PORTAL SEM ENVIO DE COMPROVANTE (para evitar fraude)
--
-- A família paga só pelo Pix (QR code ou copia e cola) e a equipe confirma
-- pelo extrato do banco. O portal deixa de aceitar comprovante: a tela já
-- não mostra o envio, e aqui o banco também passa a recusar (ninguém consegue
-- mandar comprovante por fora da tela).
--
-- Os comprovantes que já foram enviados continuam como estão: os que estão
-- esperando ainda podem ser aprovados ou recusados pela equipe.
-- Funciona nos dois bancos (Brava e clientes). Roda numa transação.
-- =========================================================

begin;

create or replace function portal_submit_receipt(p_token uuid, p_amount numeric, p_path text) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'O envio de comprovante pelo portal foi desativado. Pague pelo Pix (QR code ou copia e cola): a equipe confirma pelo extrato do banco.';
end;
$$;

-- arquivos novos de comprovante não podem mais ser enviados pelo portal
drop policy if exists "portal_comprovantes_upload" on storage.objects;

select fix_definer_owners();

commit;
