-- =========================================================
-- BANCO DOS CLIENTES — PASSO 2 DE 2: PRIMEIRO ACESSO
--
-- Rode UMA vez no projeto NOVO, depois das partes da estrutura e depois de
-- criar o seu login em Authentication > Users > Add user (marque "Auto
-- Confirm User"). O seu deve ser o ÚNICO login do projeto neste momento.
--
-- Faz três coisas:
--   1) te cadastra como administrador geral (você entra direto no painel
--      da plataforma, sem ser funcionário de nenhuma empresa);
--   2) cria a empresa de demonstração "Festa Feliz (demonstração)", que
--      você abre pelo painel (serve para testar e para mostrar o sistema);
--   3) define o nome provisório do sistema na tela de login (troque depois
--      em Plataforma > Produto).
-- Roda dentro de uma transação: ou tudo, ou nada.
-- =========================================================

begin;

do $$
declare
  v_user uuid;
begin
  if (select count(*) from auth.users) = 0 then
    raise exception 'Nenhum login criado ainda. Crie o seu em Authentication > Users > Add user.';
  end if;
  if (select count(*) from auth.users) > 1 then
    raise exception 'Há mais de um login no projeto: este arquivo é para o primeiro acesso, com só o seu login criado.';
  end if;
  if exists (select 1 from platform_admins) then
    raise exception 'O administrador geral já foi cadastrado neste banco.';
  end if;
  select id into v_user from auth.users;

  insert into platform_admins (user_id) values (v_user);
  perform platform_create_company('Festa Feliz (demonstração)', null, null, null);
  insert into platform_settings (name, tagline) values ('Gestão de Festas', 'Sistema para casas de festa')
  on conflict (unica) do nothing;
end $$;

commit;

notify pgrst, 'reload schema';
