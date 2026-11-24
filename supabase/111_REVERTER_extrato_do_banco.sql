-- Desfaz a 111: remove o extrato do banco (tabelas e funções).
-- O que o extrato já lançou CONTINUA no financeiro, como se tivesse sido lançado à mão.
begin;
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
select fix_definer_owners();
commit;
