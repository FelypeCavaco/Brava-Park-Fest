import { format, parseISO } from 'date-fns'
import { currencyToWords, integerToWords } from './numberToWords'
import type { Client, Package, Reservation, Unit } from '../types'

function formatHour(t: string | null | undefined) {
  if (!t) return ''
  const [h, m] = t.split(':')
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`
}

// Ex: 40 -> "40 (quarenta)" — mesmo estilo usado nos contratos reais
function guestPhrase(n: number) {
  return `${n} (${integerToWords(n)})`
}

function buildClientAddress(c: Client): string {
  const parts = [
    [c.street, c.address_number].filter(Boolean).join(', '),
    c.neighborhood,
    [c.city, c.state].filter(Boolean).join(' - '),
    c.cep,
  ].filter((p) => p && p.trim() !== '')
  return parts.join(', ')
}

interface ContractVars {
  reservation: Reservation
  client: Client
  unit: Unit
  pkg: Package | null
  firstPaymentAmount: number | null // primeiro pagamento registrado, ou null se nenhum ainda
}

// Monta o dicionário de variáveis {{...}} -> valor, a partir dos dados
// reais da reserva/cliente/unidade/pacote (ver seção 3.2 da especificação).
export function buildContractVariables(vars: ContractVars): Record<string, string> {
  const { reservation: r, client, unit, pkg, firstPaymentAmount } = vars

  return {
    contratante_nome: client.name ?? '',
    contratante_cpf: client.cpf ?? '',
    contratante_telefone: client.phone ?? '',
    contratante_endereco: buildClientAddress(client),

    contratada_razao_social: unit.legal_name ?? '',
    contratada_endereco: unit.full_address ?? '',
    contratada_cnpj: unit.cnpj ?? '',
    contratada_responsavel: unit.responsible_name ?? '',
    pix_chave: unit.pix_key ?? '',

    evento_data: format(parseISO(r.event_date), 'dd/MM/yyyy'),
    evento_hora_inicio: formatHour(r.start_time),
    evento_hora_fim: formatHour(r.end_time),
    evento_duracao_horas: pkg?.duration_hours != null ? String(pkg.duration_hours) : '',
    evento_local: unit.full_address ?? '',

    plano_nome: pkg?.name ?? r.event_type ?? '',
    plano_itens: pkg?.included_items ?? '',
    convidados_limite: pkg?.guest_limit != null ? String(pkg.guest_limit) : String(r.guest_count ?? ''),
    convidados_limite_clausula8: (() => {
      const limite = pkg?.guest_limit ?? r.guest_count ?? 0
      const cortesia = r.courtesy_guests ?? 0
      return cortesia > 0 ? `${guestPhrase(limite)} + ${guestPhrase(cortesia)}` : guestPhrase(limite)
    })(),
    convidados_cortesia_paragrafo:
      r.courtesy_guests && r.courtesy_guests > 0
        ? `Convidados de cortesia: O Brava Park Fest concederá, como cortesia, ${guestPhrase(r.courtesy_guests)} convidados adicionais gratuitos, sem qualquer custo extra ao CONTRATANTE, conforme as condições estabelecidas nesse contrato.`
        : '',

    aniversariante_nome: r.child_name ?? '',
    aniversariante_idade: r.child_age != null ? String(r.child_age) : '',
    tema: r.theme ?? '',

    valor_hora_extra: unit.extra_hour_price != null ? currency(unit.extra_hour_price) : '',
    valor_total: currencyToWords(r.final_value),
    valor_sinal: firstPaymentAmount != null ? currencyToWords(firstPaymentAmount) : 'a combinar',

    data_geracao: format(new Date(), 'dd/MM/yyyy'),
  }
}

function currency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// Substitui todas as {{variavel}} do template pelo valor correspondente.
// Uma variável sem valor mapeado vira uma string vazia, nunca quebra o texto.
export function renderContractTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (_match, key: string) => variables[key] ?? '')
}
