-- =========================================================
-- PORTAL: PIX GERADO (registro de cada Pix que o cliente gera)
--
-- Quando o cliente toca em "Gerar Pix" no portal, o sistema registra a festa,
-- o valor e o horário. A equipe vê a lista "Pix gerados sem comprovante" e,
-- quando cai um Pix no banco sem comprovante, acha de qual festa é pelo valor
-- e pelo horário. Cada item pode ser lançado como pagamento ou excluído.
--
-- Sai da lista sozinho quando:
--   - o cliente envia o comprovante do mesmo valor ("Já paguei");
--   - a equipe lança um pagamento do mesmo valor nessa festa (em qualquer tela).
--
-- Não muda nada que já existe: o Pix continua sendo o mesmo código da casa.
-- Funciona nos dois bancos (Brava e clientes). Roda numa transação.
-- =========================================================

begin;

create table if not exists portal_pix_generated (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  label text,
  status text not null default 'aguardando' check (status in ('aguardando', 'comprovante', 'lancado')),
  receipt_id uuid references portal_receipts(id) on delete set null,
  payment_id uuid references payments(id) on delete set null,
  decided_by_name text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_portal_pix_reservation on portal_pix_generated (reservation_id, created_at desc);
create index if not exists idx_portal_pix_aguardando on portal_pix_generated (created_at desc) where status = 'aguardando';

alter table portal_pix_generated enable row level security;
drop policy if exists "read_portal_pix_generated" on portal_pix_generated;
create policy "read_portal_pix_generated" on portal_pix_generated for select
  using (has_permission(auth.uid(), 'page:portal_avisos') or has_permission(auth.uid(), 'action:festa.pagamentos'));
-- Escrita só pelas funções abaixo.

-- ---------- Portal: o cliente gerou um Pix ----------
-- Se ele gerar o mesmo valor de novo em até 24 horas, não cria outro registro.
create or replace function portal_register_pix(p_token uuid, p_amount numeric, p_label text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_res uuid := portal_reservation(p_token);
  v_id uuid;
begin
  if v_res is null then raise exception 'Link não encontrado.'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000 then raise exception 'Valor inválido.'; end if;
  select id into v_id from portal_pix_generated
  where reservation_id = v_res and status = 'aguardando' and amount = round(p_amount, 2) and created_at > now() - interval '24 hours'
  order by created_at desc limit 1;
  if v_id is not null then return v_id; end if;
  -- freio contra abuso: no máximo 20 Pix aguardando por festa
  if (select count(*) from portal_pix_generated where reservation_id = v_res and status = 'aguardando') >= 20 then
    raise exception 'Muitos Pix gerados. Fale com a equipe.';
  end if;
  insert into portal_pix_generated (reservation_id, amount, label)
  values (v_res, round(p_amount, 2), nullif(left(trim(coalesce(p_label, '')), 60), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- Portal: Pix que o cliente gerou nos últimos 3 dias e ainda não mandou comprovante.
create or replace function portal_pending_pix(p_token uuid)
returns table (id uuid, amount numeric, label text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_res uuid := portal_reservation(p_token);
begin
  if v_res is null then return; end if;
  return query
    select x.id, x.amount, x.label, x.created_at from portal_pix_generated x
    where x.reservation_id = v_res and x.status = 'aguardando' and x.created_at > now() - interval '3 days'
    order by x.created_at desc limit 5;
end;
$$;

-- ---------- Comprovante enviado: o Pix do mesmo valor sai da lista ----------
-- (mesma função da 093, com a baixa do Pix gerado no fim)
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
  update portal_pix_generated set status = 'comprovante', receipt_id = v_id, decided_at = now(), decided_by_name = 'Comprovante enviado pelo cliente'
  where id = (select x.id from portal_pix_generated x
              where x.reservation_id = v_res and x.status = 'aguardando' and x.amount = round(p_amount, 2)
              order by x.created_at desc limit 1);
  return v_id;
end;
$$;

-- ---------- Equipe: lançar ou excluir ----------
create or replace function launch_portal_pix(p_pix uuid, p_amount numeric, p_date date, p_method text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  px portal_pix_generated%rowtype;
  v_payment uuid;
begin
  if not has_permission(auth.uid(), 'action:festa.pagamentos') then raise exception 'Sem permissão para registrar pagamentos.'; end if;
  select * into px from portal_pix_generated where id = p_pix for update;
  if not found then raise exception 'Este Pix não está mais na lista.'; end if;
  if px.status <> 'aguardando' then raise exception 'Este Pix já foi resolvido.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Informe o valor.'; end if;
  -- marca antes de lançar, para a baixa automática do pagamento não pegar outro Pix igual
  update portal_pix_generated set status = 'lancado', decided_by_name = current_actor_name(), decided_at = now() where id = p_pix;
  insert into payments (reservation_id, amount, payment_date, payment_method, notes)
  values (px.reservation_id, round(p_amount, 2), coalesce(p_date, today_brazil()), coalesce(p_method, 'pix'), 'Pix gerado no portal, sem comprovante')
  returning id into v_payment;
  update portal_pix_generated set payment_id = v_payment where id = p_pix;
  return v_payment;
end;
$$;

create or replace function delete_portal_pix(p_pix uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(), 'action:festa.pagamentos') then raise exception 'Sem permissão.'; end if;
  delete from portal_pix_generated where id = p_pix and status = 'aguardando';
  if not found then raise exception 'Este Pix não está mais na lista.'; end if;
end;
$$;

-- ---------- Pagamento lançado por qualquer tela: baixa o Pix de mesmo valor ----------
create or replace function resolve_portal_pix_on_payment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update portal_pix_generated set status = 'lancado', payment_id = new.id, decided_at = now(), decided_by_name = 'Pagamento lançado na festa'
  where id = (select x.id from portal_pix_generated x
              where x.reservation_id = new.reservation_id and x.status = 'aguardando' and x.amount = new.amount
              order by x.created_at asc limit 1);
  return new;
end;
$$;
drop trigger if exists trg_resolve_portal_pix on payments;
create trigger trg_resolve_portal_pix after insert on payments for each row execute function resolve_portal_pix_on_payment();

-- ---------- Acessos ----------
revoke all on function portal_register_pix(uuid, numeric, text) from public;
grant execute on function portal_register_pix(uuid, numeric, text) to anon, authenticated;
revoke all on function portal_pending_pix(uuid) from public;
grant execute on function portal_pending_pix(uuid) to anon, authenticated;
revoke all on function launch_portal_pix(uuid, numeric, date, text) from public, anon;
grant execute on function launch_portal_pix(uuid, numeric, date, text) to authenticated;
revoke all on function delete_portal_pix(uuid) from public, anon;
grant execute on function delete_portal_pix(uuid) to authenticated;
revoke all on function resolve_portal_pix_on_payment() from public, anon, authenticated;
grant execute on function portal_submit_receipt(uuid, numeric, text) to anon, authenticated;

-- Histórico de quem fez o quê também nesta tabela.
drop trigger if exists trg_audit on portal_pix_generated;
create trigger trg_audit after insert or update or delete on portal_pix_generated for each row execute function audit_row_change();

select fix_definer_owners();

commit;
