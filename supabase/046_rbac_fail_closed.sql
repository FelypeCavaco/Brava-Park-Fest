-- =========================================================
-- SEGURANÇA — Etapa 2 de 2: RBAC de verdade no banco (fail-closed).
--
-- Até aqui, TODA tabela do sistema (menos user_profiles/roles/
-- role_permission_items/user_permission_overrides) liberava qualquer
-- usuário autenticado pra ler/escrever tudo, não importa o perfil dele.
-- As permissões (role_permission_items) só eram checadas no front-end
-- (<Can>, RequireAuth) — quem soubesse chamar a API do Supabase direto
-- (console do navegador, por exemplo) ignorava qualquer restrição de tela.
--
-- Esta migration faz o próprio banco checar a permissão de verdade, com
-- um detalhe importante pra não travar ninguém: hoje "não ter uma linha em
-- role_permission_items" significa "liberado" (assim os perfis existentes
-- funcionam sem precisar configurar cada chave manualmente). Se eu
-- simplesmente virasse a regra pra "sem linha = negado" (fail-closed) sem
-- mais nada, TODO perfil que não é administrador perderia acesso a quase
-- tudo na hora, porque quase nada tem linha explícita hoje.
--
-- Por isso o primeiro passo aqui é preencher explicitamente (allowed=true)
-- toda combinação perfil x permissão que ainda não tem linha — isso
-- reproduz EXATAMENTE o comportamento de hoje, sem mudar nada pra ninguém.
-- só DEPOIS disso a regra vira fail-closed de verdade: qualquer combinação
-- sem linha (ex: perfil novo criado sem mexer nas permissões, ou uma
-- permissão nova que ainda não foi configurada pra um perfil antigo) passa
-- a ser NEGADA, não liberada.
-- =========================================================

-- 1) Preenche toda combinação perfil x permissão que falta, com o valor
-- que já é o efetivo hoje (true, já que "sem linha" sempre significou
-- liberado até agora).
insert into role_permission_items (role_id, permission_key, allowed)
select r.id, k.key, true
from roles r
cross join (values
  ('page:painel'), ('page:lembretes'), ('page:reservas'),
  ('action:reservas.nova_reserva'), ('action:reservas.lista_espera'),
  ('page:visitas'), ('page:festa_detalhe'),
  ('action:festa.editar_dados'), ('action:festa.trocar_pacote'),
  ('action:festa.pagamentos'), ('action:festa.itens_extras'),
  ('action:festa.consumo_pos_festa'), ('action:festa.checklist'),
  ('action:festa.equipe'), ('action:festa.documentos'),
  ('action:festa.lista_convidados'), ('action:festa.excluir_festa'),
  ('page:clientes'), ('action:clientes.criar_editar'), ('action:clientes.excluir'),
  ('page:reativacao'), ('page:satisfacao'),
  ('page:pacotes'), ('action:pacotes.criar_editar'), ('action:pacotes.excluir'),
  ('page:contratos'), ('page:propostas'), ('page:marketing'), ('page:funil'),
  ('page:pagamentos'), ('page:financeiro'),
  ('action:financeiro.registrar_despesa'), ('action:financeiro.despesas_fixas'),
  ('action:financeiro.marcar_pago'), ('action:financeiro.remover'),
  ('page:resultado_do_mes'), ('page:lucro_por_festa'), ('page:relatorios'),
  ('page:estoque'), ('page:fornecedores'), ('page:escalas'),
  ('page:relatorio_aniversariantes')
) as k(key)
where not exists (
  select 1 from role_permission_items rpi
  where rpi.role_id = r.id and rpi.permission_key = k.key
);

-- 2) Função central de checagem — mesma ordem de resolução que o front-end
-- já usa (admin sempre passa; ajuste individual da pessoa vence; senão o
-- perfil dela; sem nenhuma linha, NEGA — fail-closed de verdade a partir
-- de agora). Também exige a pessoa estar ativa, senão nem admin passa.
create or replace function has_permission(p_user_id uuid, p_key text) returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select is_active_user(p_user_id) and (
    is_admin_user(p_user_id)
    or coalesce(
      (select allowed from user_permission_overrides where user_id = p_user_id and permission_key = p_key),
      (
        select rpi.allowed
        from role_permission_items rpi
        join user_profiles up on up.role_id = rpi.role_id
        where up.id = p_user_id and rpi.permission_key = p_key
      ),
      false
    )
  );
$$;

revoke all on function has_permission(uuid, text) from public, anon;
grant execute on function has_permission(uuid, text) to authenticated;

-- 3) Remove a política solta de todas as tabelas de negócio (o loop que
-- criava "authenticated_full_access" pra cada uma). A partir daqui cada
-- tabela ganha sua própria regra abaixo.
do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'units','audit_log','waitlist',
      'spaces','clients','leads','packages','extra_items','reservations',
      'reservation_extra_items','contracts','payments','checklist_items',
      'staff_assignments','marketing_spend','expenses','reservation_costs','inventory_items',
      'recurring_expenses','unit_goals','proposals','nps_responses','reservation_consumption',
      'package_costs','visits','contact_history','suppliers','supplier_bookings','contract_templates',
      'guest_list_pages','guest_list_entries','reservation_documents','reservation_stock_consumption','expense_items',
      'inventory_purchase_variants','message_templates','reservation_birthday_kids','payment_method_fees',
      'review_links','party_reviews'
    ])
  loop
    execute format('drop policy if exists "authenticated_full_access" on %I;', t);
  end loop;
end $$;

-- ---------- Leitura ampla, escrita restrita por permissão ----------
-- (tabelas de referência/consulta cruzada — várias telas de módulos
-- diferentes leem, então restringir leitura quebraria painel/relatórios
-- pra quem não tem aquela página específica; a escrita é o que importa
-- travar de verdade.)

create policy "read_active" on units for select using (is_active_user(auth.uid()));
create policy "insert_admin" on units for insert with check (is_admin_user(auth.uid()));
create policy "update_admin" on units for update using (is_admin_user(auth.uid())) with check (is_admin_user(auth.uid()));

create policy "read_active" on spaces for select using (is_active_user(auth.uid()));
create policy "insert_admin" on spaces for insert with check (is_admin_user(auth.uid()));
create policy "update_admin" on spaces for update using (is_admin_user(auth.uid())) with check (is_admin_user(auth.uid()));

create policy "read_active" on leads for select using (is_active_user(auth.uid()));
create policy "write_admin" on leads for all using (is_admin_user(auth.uid())) with check (is_admin_user(auth.uid()));

create policy "read_active" on audit_log for select using (is_active_user(auth.uid()));
create policy "insert_active" on audit_log for insert with check (is_active_user(auth.uid()));

create policy "read_active" on contact_history for select using (is_active_user(auth.uid()));
create policy "insert_active" on contact_history for insert with check (is_active_user(auth.uid()));

create policy "read_active" on clients for select using (is_active_user(auth.uid()));
create policy "write_clients" on clients for insert with check (has_permission(auth.uid(), 'action:clientes.criar_editar'));
create policy "update_clients" on clients for update using (has_permission(auth.uid(), 'action:clientes.criar_editar')) with check (has_permission(auth.uid(), 'action:clientes.criar_editar'));
create policy "delete_clients" on clients for delete using (has_permission(auth.uid(), 'action:clientes.excluir'));

create policy "read_active" on packages for select using (is_active_user(auth.uid()));
create policy "write_packages" on packages for insert with check (has_permission(auth.uid(), 'action:pacotes.criar_editar'));
create policy "update_packages" on packages for update using (has_permission(auth.uid(), 'action:pacotes.criar_editar')) with check (has_permission(auth.uid(), 'action:pacotes.criar_editar'));
create policy "delete_packages" on packages for delete using (has_permission(auth.uid(), 'action:pacotes.excluir'));

create policy "read_active" on extra_items for select using (is_active_user(auth.uid()));
create policy "write_extra_items" on extra_items for insert with check (has_permission(auth.uid(), 'action:pacotes.criar_editar'));
create policy "update_extra_items" on extra_items for update using (has_permission(auth.uid(), 'action:pacotes.criar_editar')) with check (has_permission(auth.uid(), 'action:pacotes.criar_editar'));
create policy "delete_extra_items" on extra_items for delete using (has_permission(auth.uid(), 'action:pacotes.excluir'));

-- ficha técnica de custo do pacote — mesma chave de gerenciar pacote
create policy "read_active" on package_costs for select using (is_active_user(auth.uid()));
create policy "write_package_costs" on package_costs for all
  using (has_permission(auth.uid(), 'action:pacotes.criar_editar'))
  with check (has_permission(auth.uid(), 'action:pacotes.criar_editar'));

create policy "read_active" on payments for select using (is_active_user(auth.uid()));
create policy "write_payments" on payments for insert with check (has_permission(auth.uid(), 'action:festa.pagamentos'));
create policy "update_payments" on payments for update using (has_permission(auth.uid(), 'action:festa.pagamentos')) with check (has_permission(auth.uid(), 'action:festa.pagamentos'));
create policy "delete_payments" on payments for delete using (has_permission(auth.uid(), 'action:festa.pagamentos'));

create policy "read_active" on expenses for select using (is_active_user(auth.uid()));
create policy "write_expenses" on expenses for insert with check (has_permission(auth.uid(), 'action:financeiro.registrar_despesa'));
create policy "update_expenses" on expenses for update
  using (has_permission(auth.uid(), 'page:financeiro'))
  with check (has_permission(auth.uid(), 'page:financeiro'));
create policy "delete_expenses" on expenses for delete using (has_permission(auth.uid(), 'action:financeiro.remover'));

create policy "read_active" on reservation_costs for select using (is_active_user(auth.uid()));
create policy "write_reservation_costs" on reservation_costs for insert
  with check (has_permission(auth.uid(), 'page:festa_detalhe') or has_permission(auth.uid(), 'page:lucro_por_festa'));
create policy "delete_reservation_costs" on reservation_costs for delete
  using (has_permission(auth.uid(), 'page:festa_detalhe') or has_permission(auth.uid(), 'page:lucro_por_festa'));

create policy "read_active" on inventory_items for select using (is_active_user(auth.uid()));
create policy "write_inventory_items" on inventory_items for insert
  with check (has_permission(auth.uid(), 'page:estoque'));
create policy "update_inventory_items" on inventory_items for update
  using (has_permission(auth.uid(), 'page:estoque') or has_permission(auth.uid(), 'page:festa_detalhe') or has_permission(auth.uid(), 'page:financeiro'))
  with check (has_permission(auth.uid(), 'page:estoque') or has_permission(auth.uid(), 'page:festa_detalhe') or has_permission(auth.uid(), 'page:financeiro'));
create policy "delete_inventory_items" on inventory_items for delete
  using (has_permission(auth.uid(), 'page:estoque'));

create policy "read_active" on marketing_spend for select using (is_active_user(auth.uid()));
create policy "write_marketing_spend" on marketing_spend for insert with check (has_permission(auth.uid(), 'page:marketing'));
create policy "update_marketing_spend" on marketing_spend for update using (has_permission(auth.uid(), 'page:marketing')) with check (has_permission(auth.uid(), 'page:marketing'));

create policy "read_active" on unit_goals for select using (is_active_user(auth.uid()));
create policy "write_unit_goals" on unit_goals for insert with check (has_permission(auth.uid(), 'page:relatorios'));
create policy "update_unit_goals" on unit_goals for update using (has_permission(auth.uid(), 'page:relatorios')) with check (has_permission(auth.uid(), 'page:relatorios'));

create policy "read_active" on payment_method_fees for select using (is_active_user(auth.uid()));
create policy "write_payment_method_fees" on payment_method_fees for all
  using (has_permission(auth.uid(), 'page:pagamentos'))
  with check (has_permission(auth.uid(), 'page:pagamentos'));

-- ---------- Tabelas de uma tela só — leitura e escrita pela mesma chave ----------

create policy "read_visits" on visits for select using (has_permission(auth.uid(), 'page:visitas'));
create policy "write_visits" on visits for all
  using (has_permission(auth.uid(), 'page:visitas'))
  with check (has_permission(auth.uid(), 'page:visitas'));

create policy "read_suppliers" on suppliers for select using (has_permission(auth.uid(), 'page:fornecedores'));
create policy "write_suppliers" on suppliers for all
  using (has_permission(auth.uid(), 'page:fornecedores'))
  with check (has_permission(auth.uid(), 'page:fornecedores'));

create policy "read_supplier_bookings" on supplier_bookings for select using (has_permission(auth.uid(), 'page:fornecedores'));
create policy "write_supplier_bookings" on supplier_bookings for all
  using (has_permission(auth.uid(), 'page:fornecedores'))
  with check (has_permission(auth.uid(), 'page:fornecedores'));

create policy "read_proposals" on proposals for select using (has_permission(auth.uid(), 'page:propostas'));
create policy "write_proposals" on proposals for all
  using (has_permission(auth.uid(), 'page:propostas'))
  with check (has_permission(auth.uid(), 'page:propostas'));

create policy "read_nps_responses" on nps_responses for select using (has_permission(auth.uid(), 'page:satisfacao'));
create policy "write_nps_responses" on nps_responses for all
  using (has_permission(auth.uid(), 'page:satisfacao'))
  with check (has_permission(auth.uid(), 'page:satisfacao'));

create policy "read_party_reviews" on party_reviews for select using (has_permission(auth.uid(), 'page:satisfacao'));

create policy "read_contract_templates" on contract_templates for select
  using (has_permission(auth.uid(), 'page:contratos') or has_permission(auth.uid(), 'page:festa_detalhe'));
create policy "write_contract_templates" on contract_templates for all
  using (has_permission(auth.uid(), 'page:contratos'))
  with check (has_permission(auth.uid(), 'page:contratos'));

create policy "read_contracts" on contracts for select
  using (has_permission(auth.uid(), 'page:contratos') or has_permission(auth.uid(), 'page:festa_detalhe'));
create policy "write_contracts" on contracts for all
  using (has_permission(auth.uid(), 'page:contratos') or has_permission(auth.uid(), 'page:festa_detalhe'))
  with check (has_permission(auth.uid(), 'page:contratos') or has_permission(auth.uid(), 'page:festa_detalhe'));

create policy "read_recurring_expenses" on recurring_expenses for select using (has_permission(auth.uid(), 'page:financeiro'));
create policy "write_recurring_expenses" on recurring_expenses for all
  using (has_permission(auth.uid(), 'action:financeiro.despesas_fixas'))
  with check (has_permission(auth.uid(), 'action:financeiro.despesas_fixas'));

create policy "read_expense_items" on expense_items for select using (has_permission(auth.uid(), 'page:financeiro'));
-- sem política de escrita direta: expense_items só é gravado/apagado pelas
-- funções record_stock_purchase/undo_stock_purchase, que são security
-- definer e não passam por RLS — não precisa (nem deveria) ter insert/
-- update/delete liberado direto pela API aqui.

create policy "read_inventory_purchase_variants" on inventory_purchase_variants for select
  using (has_permission(auth.uid(), 'page:financeiro') or has_permission(auth.uid(), 'page:estoque'));

-- ---------- Tabelas da Central da festa ----------

create policy "read_active" on reservations for select using (is_active_user(auth.uid()));
create policy "write_reservations" on reservations for insert with check (has_permission(auth.uid(), 'action:reservas.nova_reserva'));
create policy "update_reservations" on reservations for update
  using (has_permission(auth.uid(), 'action:festa.editar_dados') or has_permission(auth.uid(), 'action:festa.trocar_pacote'))
  with check (has_permission(auth.uid(), 'action:festa.editar_dados') or has_permission(auth.uid(), 'action:festa.trocar_pacote'));
create policy "delete_reservations" on reservations for delete using (has_permission(auth.uid(), 'action:festa.excluir_festa'));

create policy "read_festa_detalhe" on reservation_extra_items for select using (has_permission(auth.uid(), 'page:festa_detalhe'));
create policy "write_reservation_extra_items" on reservation_extra_items for all
  using (has_permission(auth.uid(), 'action:festa.itens_extras'))
  with check (has_permission(auth.uid(), 'action:festa.itens_extras'));

create policy "read_festa_detalhe" on checklist_items for select using (has_permission(auth.uid(), 'page:festa_detalhe'));
create policy "write_checklist_items" on checklist_items for all
  using (has_permission(auth.uid(), 'action:festa.checklist'))
  with check (has_permission(auth.uid(), 'action:festa.checklist'));

create policy "read_staff_assignments" on staff_assignments for select
  using (has_permission(auth.uid(), 'page:festa_detalhe') or has_permission(auth.uid(), 'page:escalas'));
create policy "write_staff_assignments" on staff_assignments for all
  using (has_permission(auth.uid(), 'action:festa.equipe'))
  with check (has_permission(auth.uid(), 'action:festa.equipe'));

create policy "read_festa_detalhe" on reservation_consumption for select using (has_permission(auth.uid(), 'page:festa_detalhe'));
create policy "write_reservation_consumption" on reservation_consumption for all
  using (has_permission(auth.uid(), 'action:festa.consumo_pos_festa'))
  with check (has_permission(auth.uid(), 'action:festa.consumo_pos_festa'));

create policy "read_festa_detalhe" on reservation_stock_consumption for select using (has_permission(auth.uid(), 'page:festa_detalhe'));
create policy "write_reservation_stock_consumption" on reservation_stock_consumption for all
  using (has_permission(auth.uid(), 'action:festa.consumo_pos_festa'))
  with check (has_permission(auth.uid(), 'action:festa.consumo_pos_festa'));

create policy "read_festa_detalhe" on reservation_documents for select using (has_permission(auth.uid(), 'page:festa_detalhe'));
create policy "write_reservation_documents" on reservation_documents for all
  using (has_permission(auth.uid(), 'action:festa.documentos'))
  with check (has_permission(auth.uid(), 'action:festa.documentos'));

create policy "read_festa_detalhe" on message_templates for select using (has_permission(auth.uid(), 'page:festa_detalhe'));
create policy "write_message_templates" on message_templates for all
  using (has_permission(auth.uid(), 'page:festa_detalhe'))
  with check (has_permission(auth.uid(), 'page:festa_detalhe'));

create policy "read_festa_detalhe" on reservation_birthday_kids for select using (has_permission(auth.uid(), 'page:festa_detalhe'));
create policy "write_reservation_birthday_kids" on reservation_birthday_kids for all
  using (has_permission(auth.uid(), 'action:reservas.nova_reserva') or has_permission(auth.uid(), 'action:festa.editar_dados'))
  with check (has_permission(auth.uid(), 'action:reservas.nova_reserva') or has_permission(auth.uid(), 'action:festa.editar_dados'));

-- lista de espera
create policy "read_active" on waitlist for select using (is_active_user(auth.uid()));
create policy "write_waitlist" on waitlist for all
  using (has_permission(auth.uid(), 'action:reservas.lista_espera'))
  with check (has_permission(auth.uid(), 'action:reservas.lista_espera'));

-- lista de convidados (lado da equipe — os anons públicos já têm política
-- própria, criada nas migrations 019/041, e continuam intactos)
create policy "read_festa_detalhe" on guest_list_pages for select using (has_permission(auth.uid(), 'page:festa_detalhe'));
create policy "write_guest_list_pages" on guest_list_pages for insert with check (has_permission(auth.uid(), 'action:festa.lista_convidados'));

create policy "staff_read_guest_list_entries" on guest_list_entries for select using (has_permission(auth.uid(), 'page:festa_detalhe'));
create policy "staff_write_guest_list_entries" on guest_list_entries for insert with check (has_permission(auth.uid(), 'action:festa.lista_convidados'));
-- check-in de chegada na portaria (toggle "arrived") é um update feito pela
-- equipe, além de inserir/apagar nome manualmente.
create policy "staff_update_guest_list_entries" on guest_list_entries for update
  using (has_permission(auth.uid(), 'action:festa.lista_convidados'))
  with check (has_permission(auth.uid(), 'action:festa.lista_convidados'));
create policy "staff_delete_guest_list_entries" on guest_list_entries for delete using (has_permission(auth.uid(), 'action:festa.lista_convidados'));

-- link do formulário de avaliação — baixa sensibilidade (só cria um token
-- compartilhável), usado a partir de 3 telas diferentes (Central da festa,
-- Satisfação, Lembretes diários); mantém liberado pra qualquer ativo.
create policy "read_active" on review_links for select using (is_active_user(auth.uid()));
create policy "insert_active" on review_links for insert with check (is_active_user(auth.uid()));
