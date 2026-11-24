-- =========================================================
-- 110 — Recreação, etapa 5e: autocadastro por QR
-- =========================================================
-- O responsável lê o QR da casa, preenche os próprios dados no celular e
-- envia. O envio NÃO cria a família: vira um "pré-cadastro" que a recepção
-- confere (com aviso de possível duplicado) e aprova ou recusa. Só na
-- aprovação nasce a família de verdade.
--
-- Proteções da página pública (aberta a qualquer pessoa):
--  * só funciona se o administrador geral ligou "Autocadastro por QR" e com
--    o código secreto do QR da casa (a recepção pode trocar o QR);
--  * campo-isca (honeypot) e tempo mínimo de preenchimento;
--  * limite por origem (5 por hora) e por casa (40 por hora, 200 pendentes);
--  * mesmo CPF ou WhatsApp já aguardando: não entra duas vezes;
--  * tamanho e formato validados (CPF, telefone, datas, quantidade de crianças);
--  * a página pública só ENVIA: nunca lê nada de volta (nenhuma família,
--    nenhum pré-cadastro);
--  * pré-cadastro parado há mais de 30 dias é apagado.
-- O termo é gravado com o texto vigente no envio e a data do envio.
-- Desfazer: 110_REVERTER_recreacao_autocadastro.sql
-- =========================================================

begin;

-- chave nova nas funções da recreação (desligada por padrão)
create or replace function rec_funcoes_padrao() returns jsonb language sql immutable as $$
  select '{"codigo": true, "qr": true, "foto": "cadastro", "fotoObrig": false, "fotoDias": 30,
           "paginaPais": true, "pedirTempo": true, "chegando": true, "ocorrPais": true,
           "ocorr": true, "ocorrCiente": true,
           "caixaObrig": true, "cego": true, "lembrete": true, "horaFecha": "22:00", "lembreteMin": 30,
           "troca": true, "trocaConta": true, "offline": false, "autocadastro": false}'::jsonb;
$$;

alter table rec_config add column if not exists autocad_token text;
create unique index if not exists uq_rec_config_autocad on rec_config (autocad_token) where autocad_token is not null;

create table if not exists rec_pre_cadastros (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default current_company_id() references companies(id) on delete cascade,
  criado_em timestamptz not null default now(),
  status text not null default 'pendente' check (status in ('pendente', 'aprovado', 'recusado')),
  responsavel text not null,
  cpf text,
  telefone text not null,
  dados jsonb not null,
  termo_texto text,
  origem_hash text,
  decidido_em timestamptz,
  decidido_por text,
  motivo text,
  familia_id uuid references rec_familias(id) on delete set null
);
create index if not exists idx_rec_pre_status on rec_pre_cadastros (company_id, status, criado_em desc);
create index if not exists idx_rec_pre_origem on rec_pre_cadastros (company_id, origem_hash, criado_em desc);

do $$
begin
  drop trigger if exists trg_set_company_id on rec_pre_cadastros;
  create trigger trg_set_company_id before insert or update on rec_pre_cadastros for each row execute function set_company_id();
  alter table rec_pre_cadastros enable row level security;
  drop policy if exists company_isolation on rec_pre_cadastros;
  create policy company_isolation on rec_pre_cadastros as restrictive for all
    using (company_id = current_company_id() or (auth.uid() is null and current_user = 'app_definer'))
    with check (company_id = current_company_id() or (auth.uid() is null and current_user = 'app_definer'));
  drop policy if exists app_definer_all on rec_pre_cadastros;
  create policy app_definer_all on rec_pre_cadastros for all to app_definer using (true) with check (true);
  revoke all on rec_pre_cadastros from anon, authenticated;
  grant all on rec_pre_cadastros to app_definer;
  drop trigger if exists trg_audit on rec_pre_cadastros;
  create trigger trg_audit after insert or update or delete on rec_pre_cadastros for each row execute function audit_row_change();
end $$;
-- Dados pessoais: ninguém lê a tabela direto; só as funções abaixo.

-- ---------- Página pública: dados da casa ----------
create or replace function rec_autocad_casa(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cfg record; c record;
begin
  if p_token is null or length(p_token) < 20 then return jsonb_build_object('ok', false); end if;
  select * into cfg from rec_config where autocad_token = p_token;
  if not found then return jsonb_build_object('ok', false); end if;
  if not coalesce(((rec_funcoes_padrao() || coalesce(cfg.funcoes, '{}'))->>'autocadastro')::boolean, false)
     or not (select coalesce(not ('recreacao' = any(disabled_modules)), true) from companies where id = cfg.company_id) then
    return jsonb_build_object('ok', false);
  end if;
  select name, logo_url into c from companies where id = cfg.company_id;
  return jsonb_build_object('ok', true, 'casa', jsonb_build_object('nome', c.name, 'logo', c.logo_url),
    'termo', coalesce(cfg.termo, 'Declaro que sou responsável pela criança cadastrada, que informei alergias e cuidados necessários e que a criança só será entregue a mim ou às pessoas autorizadas mediante o código de retirada.'));
end;
$$;
revoke all on function rec_autocad_casa(text) from public;
grant execute on function rec_autocad_casa(text) to anon, authenticated;

-- ---------- Página pública: enviar ----------
create or replace function rec_autocad_enviar(p_token text, p_dados jsonb, p_hp text default '', p_ms int default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cfg record; v_emp uuid; v_ip text; v_hash text; x jsonb; n int;
  v_nome text; v_cpf text; v_tel text; v_email text; v_nasc date; v_krs jsonb := '[]'; v_aut jsonb := '[]'; v_termo text;
begin
  if p_token is null or length(p_token) < 20 then raise exception 'Link inválido. Peça o QR na recepção.'; end if;
  select * into cfg from rec_config where autocad_token = p_token;
  if not found then raise exception 'Link inválido. Peça o QR na recepção.'; end if;
  v_emp := cfg.company_id;
  if not coalesce(((rec_funcoes_padrao() || coalesce(cfg.funcoes, '{}'))->>'autocadastro')::boolean, false) then raise exception 'O cadastro pelo celular não está disponível. Procure a recepção.'; end if;
  if exists (select 1 from companies where id = v_emp and 'recreacao' = any(disabled_modules)) then raise exception 'O cadastro pelo celular não está disponível. Procure a recepção.'; end if;
  -- robô: campo-isca preenchido ou formulário "preenchido" em menos de 4 segundos: finge que deu certo
  if length(coalesce(p_hp, '')) > 0 or coalesce(p_ms, 0) < 4000 then return jsonb_build_object('ok', true); end if;
  if pg_column_size(p_dados) > 12000 then raise exception 'Dados demais. Revise o formulário.'; end if;

  -- limites por origem e por casa
  begin
    v_ip := split_part(coalesce((current_setting('request.headers', true))::json->>'x-forwarded-for', ''), ',', 1);
  exception when others then v_ip := ''; end;
  v_hash := md5(coalesce(nullif(trim(v_ip), ''), 'sem-ip') || v_emp::text);
  if (select count(*) from rec_pre_cadastros where company_id = v_emp and origem_hash = v_hash and criado_em > now() - interval '1 hour') >= 5 then
    raise exception 'Muitas tentativas. Procure a recepção.'; end if;
  if (select count(*) from rec_pre_cadastros where company_id = v_emp and criado_em > now() - interval '1 hour') >= 40 then
    raise exception 'Muitos cadastros agora. Procure a recepção.'; end if;
  if (select count(*) from rec_pre_cadastros where company_id = v_emp and status = 'pendente') >= 200 then
    raise exception 'Cadastro indisponível no momento. Procure a recepção.'; end if;

  -- validação
  v_nome := left(regexp_replace(trim(coalesce(p_dados->>'responsavel', '')), '\s+', ' ', 'g'), 120);
  v_cpf := rec_digitos(p_dados->>'cpf'); v_tel := rec_digitos(p_dados->>'telefone');
  v_email := nullif(lower(trim(coalesce(p_dados->>'email', ''))), '');
  if length(v_nome) < 3 or v_nome !~ '\s' then raise exception 'Escreva seu nome completo.'; end if;
  if v_cpf is null or not rec_cpf_valido(v_cpf) then raise exception 'CPF inválido: confira os números.'; end if;
  if v_tel is null or length(v_tel) < 10 or length(v_tel) > 13 then raise exception 'Informe o WhatsApp com DDD.'; end if;
  if v_email is not null and (length(v_email) > 120 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'E-mail inválido.'; end if;
  if not coalesce((p_dados->>'termo_aceito')::boolean, false) then raise exception 'É preciso aceitar o termo de responsabilidade.'; end if;
  if jsonb_typeof(p_dados->'criancas') <> 'array' or jsonb_array_length(p_dados->'criancas') not between 1 and 6 then raise exception 'Cadastre de 1 a 6 crianças.'; end if;
  for x in select y from jsonb_array_elements(p_dados->'criancas') y loop
    if length(trim(coalesce(x->>'nome', ''))) < 2 then raise exception 'Escreva o nome de cada criança.'; end if;
    begin v_nasc := nullif(x->>'nascimento', '')::date; exception when others then v_nasc := null; end;
    if v_nasc is null or v_nasc > today_brazil() or v_nasc < today_brazil() - interval '18 years' then raise exception 'Confira a data de nascimento de %.', left(trim(coalesce(x->>'nome', '')), 40); end if;
    v_krs := v_krs || jsonb_build_array(jsonb_build_object('nome', left(regexp_replace(trim(x->>'nome'), '\s+', ' ', 'g'), 120), 'nascimento', v_nasc,
      'cuidados', nullif(left(trim(coalesce(x->>'cuidados', '')), 300), '')));
  end loop;
  if jsonb_typeof(coalesce(p_dados->'autorizados', '[]')) = 'array' then
    for x in select y from jsonb_array_elements(coalesce(p_dados->'autorizados', '[]')) y loop
      if length(trim(coalesce(x->>'nome', ''))) >= 2 and jsonb_array_length(v_aut) < 4 then
        v_aut := v_aut || jsonb_build_array(jsonb_build_object('nome', left(trim(x->>'nome'), 120), 'parentesco', nullif(left(trim(coalesce(x->>'parentesco', '')), 40), '')));
      end if;
    end loop;
  end if;

  -- já aguardando conferência com o mesmo CPF ou WhatsApp: não duplica (e não conta como erro)
  if exists (select 1 from rec_pre_cadastros where company_id = v_emp and status = 'pendente' and (cpf = v_cpf or telefone = v_tel)) then
    return jsonb_build_object('ok', true, 'repetido', true);
  end if;

  v_termo := coalesce(cfg.termo, 'Declaro que sou responsável pela criança cadastrada, que informei alergias e cuidados necessários e que a criança só será entregue a mim ou às pessoas autorizadas mediante o código de retirada.');
  insert into rec_pre_cadastros (company_id, responsavel, cpf, telefone, dados, termo_texto, origem_hash)
  values (v_emp, v_nome, v_cpf, v_tel,
          jsonb_build_object('responsavel', v_nome, 'cpf', v_cpf, 'telefone', v_tel, 'email', v_email,
            'imagem_autorizada', coalesce((p_dados->>'imagem_autorizada')::boolean, false), 'criancas', v_krs, 'autorizados', v_aut),
          v_termo, v_hash);
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function rec_autocad_enviar(text, jsonb, text, int) from public;
grant execute on function rec_autocad_enviar(text, jsonb, text, int) to anon, authenticated;

-- ---------- Recepção: QR da casa ----------
create or replace function rec_autocad_token(p_trocar boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare v_tok text;
begin
  if not rec_pode('action:recreacao.familias_editar') then raise exception 'Sem permissão.'; end if;
  if not coalesce((rec_cfg()->>'autocadastro')::boolean, false) then raise exception 'O autocadastro não está ligado para esta casa.'; end if;
  select autocad_token into v_tok from rec_config where company_id = current_company_id();
  if v_tok is null or p_trocar then
    v_tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into rec_config (company_id, autocad_token) values (current_company_id(), v_tok)
    on conflict (company_id) do update set autocad_token = excluded.autocad_token;
  end if;
  return v_tok;
end;
$$;
revoke all on function rec_autocad_token(boolean) from public, anon;
grant execute on function rec_autocad_token(boolean) to authenticated;

-- ---------- Recepção: conferir ----------
create or replace function rec_pre_listar() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not rec_pode('action:recreacao.familias_editar') then raise exception 'Sem permissão.'; end if;
  delete from rec_pre_cadastros where company_id = current_company_id() and criado_em < now() - interval '30 days';
  return (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'criado_em', p.criado_em, 'dados', p.dados,
      'parecidas', rec_familia_parecidas(null, p.cpf, p.telefone, p.responsavel, p.dados->'criancas')) order by p.criado_em), '[]')
    from rec_pre_cadastros p where p.company_id = current_company_id() and p.status = 'pendente');
end;
$$;
revoke all on function rec_pre_listar() from public, anon;
grant execute on function rec_pre_listar() to authenticated;

create or replace function rec_pre_aprovar(p_id uuid, p_dados jsonb default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare p rec_pre_cadastros%rowtype; v_fam uuid; v_d jsonb;
begin
  if not rec_pode('action:recreacao.familias_editar') then raise exception 'Sem permissão.'; end if;
  select * into p from rec_pre_cadastros where id = p_id and company_id = current_company_id() and status = 'pendente' for update;
  if not found then raise exception 'Este cadastro já foi tratado ou não existe.'; end if;
  v_d := coalesce(p_dados, p.dados) || jsonb_build_object('termo_aceito', true);
  v_fam := rec_familia_salvar(null, v_d);
  -- o aceite vale pela data e pelo texto do envio feito pelo responsável
  update rec_familias set origem = 'autocadastro', termo_aceito_em = p.criado_em, termo_texto = p.termo_texto,
         termo_registrado_por = 'Autocadastro pelo celular' where id = v_fam;
  update rec_pre_cadastros set status = 'aprovado', decidido_em = now(), decidido_por = current_actor_name(), familia_id = v_fam where id = p.id;
  return v_fam;
end;
$$;
revoke all on function rec_pre_aprovar(uuid, jsonb) from public, anon;
grant execute on function rec_pre_aprovar(uuid, jsonb) to authenticated;

create or replace function rec_pre_recusar(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not rec_pode('action:recreacao.familias_editar') then raise exception 'Sem permissão.'; end if;
  update rec_pre_cadastros set status = 'recusado', decidido_em = now(), decidido_por = current_actor_name(),
         motivo = nullif(left(trim(coalesce(p_motivo, '')), 300), ''),
         -- recusado: some os dados pessoais, fica só o registro de que houve
         dados = jsonb_build_object('recusado', true), cpf = null, telefone = '', responsavel = 'recusado'
   where id = p_id and company_id = current_company_id() and status = 'pendente';
  if not found then raise exception 'Este cadastro já foi tratado ou não existe.'; end if;
end;
$$;
revoke all on function rec_pre_recusar(uuid, text) from public, anon;
grant execute on function rec_pre_recusar(uuid, text) to authenticated;

commit;
