-- =========================================================
-- BANCO DOS CLIENTES — PASSO 2 DE 2: PRIMEIRO ACESSO
--
-- Rode UMA vez no projeto NOVO, depois do passo 1 e depois de criar o seu
-- login em Authentication > Users > Add user (marque "Auto Confirm User").
-- O seu deve ser o ÚNICO login do projeto neste momento: o arquivo usa ele.
--
-- Faz três coisas:
--   1) cria a empresa de demonstração "Festa Feliz (demonstração)", com você
--      como administrador dela (serve para testar e para mostrar o sistema);
--   2) te cadastra como administrador geral (painel Plataforma);
--   3) define o nome provisório do sistema na tela de login (troque depois
--      em Plataforma > Produto).
-- Roda dentro de uma transação: ou tudo, ou nada.
-- =========================================================

begin;

do $$
declare
  v_user uuid;
  v_email text;
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
  select id, email into v_user, v_email from auth.users;

  perform platform_create_company('Festa Feliz (demonstração)', v_user, 'Administrador geral', v_email);
  insert into platform_admins (user_id) values (v_user);
  insert into platform_settings (name, tagline) values ('Gestão de Festas', 'Sistema para casas de festa')
  on conflict (unica) do nothing;
end $$;

commit;

notify pgrst, 'reload schema';
