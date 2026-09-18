-- =========================================================
-- Link do grupo de WhatsApp de cada unidade, usado pra confirmar a festa do
-- dia com os fornecedores/prestadores (horário de entrega, tema,
-- aniversariante e convidados). O WhatsApp não deixa abrir um grupo
-- existente já com uma mensagem escrita (isso só funciona com número de
-- telefone avulso), então o botão copia a mensagem pronta e abre o grupo
-- junto — só falta colar.
-- =========================================================

alter table units add column if not exists staff_whatsapp_group_link text;

update units set staff_whatsapp_group_link = 'https://chat.whatsapp.com/Gb2XWzFPbkT2qS8SfxggZz?s=cl&p=i&mlu=4&ilr=4' where name = 'Vila Operária';
update units set staff_whatsapp_group_link = 'https://chat.whatsapp.com/Cubq4wnDUfQIZJd2OW4DSh?s=cl&p=i&mlu=4&ilr=4' where name = 'São Vicente';
