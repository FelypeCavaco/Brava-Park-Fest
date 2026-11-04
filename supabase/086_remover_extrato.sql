-- =========================================================
-- REMOVE O EXTRATO DO BANCO (081 e 082)
--
-- O envio do extrato do banco saiu do sistema. Esta migração apaga as
-- tabelas do extrato (movimentos enviados, envios e regras aprendidas) e as
-- funções dele.
--
-- O que o extrato já lançou CONTINUA no financeiro: pagamentos das festas,
-- despesas, contas baixadas e receitas ficam como se tivessem sido lançados
-- à mão. Comprovantes aprovados pelo extrato continuam aprovados.
--
-- Funciona nos dois bancos (Brava e clientes). Roda numa transação.
-- =========================================================

begin;

-- funções do extrato (todas começam com bank_)
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'bank\_%'
  loop
    execute format('drop function if exists %s cascade', f.sig);
  end loop;
end $$;

drop table if exists bank_statement_lines;
drop table if exists bank_statement_imports;
drop table if exists bank_rules;

-- mensagem para quem tentar mandar comprovante pelo portal (não cita mais o extrato)
create or replace function portal_submit_receipt(p_token uuid, p_amount numeric, p_path text) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'O envio de comprovante pelo portal foi desativado. Pague pelo Pix (QR code ou copia e cola): a equipe confirma o pagamento.';
end;
$$;

select fix_definer_owners();

commit;
