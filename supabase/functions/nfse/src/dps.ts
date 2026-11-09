// Monta a DPS (Declaração de Prestação de Serviço) no padrão nacional da
// NFS-e, versão 1.01 do leiaute (esquemas XSD de 09/02/2026 do gov.br/nfse).
// A ordem dos campos segue exatamente os esquemas: o governo rejeita campos
// fora de ordem. A assinatura digital é feita depois (ver assinar.ts).
//
// Regras do Anexo I já tratadas aqui:
//  - quando o emitente é o próprio prestador (tpEmit = 1), o nome do
//    prestador NÃO é informado (E0121) e o endereço é opcional;
//  - ME/EPP do Simples (opSimpNac = 3) precisa do regime de apuração
//    (regApTribSN, E0166) e o total de tributos vai como pTotTribSN (E0712);
//  - MEI (opSimpNac = 2) não informa pTotTribSN (E0710) nem regime especial;
//  - não optante (opSimpNac = 1) não informa pTotTribSN nem indTotTrib (E0713).

export type Ambiente = 1 | 2 // 1 = produção, 2 = homologação (produção restrita)

export interface EnderecoNacional {
  logradouro: string
  numero: string
  complemento?: string | null
  bairro: string
  municipioIbge: string // 7 dígitos
  cep: string // 8 dígitos
}

export interface DadosDps {
  ambiente: Ambiente
  serie: string // até 5 dígitos
  numero: number // número sequencial da DPS na série (1 em diante)
  emitidaEm: Date
  competencia: string // AAAA-MM-DD (data em que o serviço começou; não pode ser depois da emissão)
  municipioEmissor: string // código IBGE (7) do município do prestador
  versaoAplicativo: string // até 20 caracteres
  prestador: {
    cnpj?: string | null
    cpf?: string | null
    inscricaoMunicipal?: string | null
    telefone?: string | null
    email?: string | null
    opcaoSimples: 1 | 2 | 3 // 1 não optante, 2 MEI, 3 ME/EPP
    regimeApuracaoSimples?: 1 | 2 | 3 | null // obrigatório para ME/EPP
    regimeEspecial?: number | null // 0 nenhum (padrão)
  }
  tomador?: {
    cpf?: string | null
    cnpj?: string | null
    nome: string
    telefone?: string | null
    email?: string | null
    endereco?: EnderecoNacional | null
  } | null
  servico: {
    municipioPrestacao: string // código IBGE (7)
    codigoTributacaoNacional: string // 6 dígitos (subitem da lista nacional)
    codigoTributacaoMunicipal?: string | null // 3 dígitos, se o município usar
    descricao: string // até 2000
    codigoNbs?: string | null // 9 dígitos
    informacoesComplementares?: string | null // até 2000
  }
  valores: {
    valorServico: number
    descontoIncondicionado?: number | null
    tributacaoIss: 1 | 2 | 3 | 4 // 1 operação tributável
    retencaoIss: 1 | 2 | 3 // 1 não retido
    aliquotaIss?: number | null // em %, ex.: 2 = 2%; só quando o município exigir
    percentualTributosSimples?: number | null // ME/EPP: % aproximado do Simples
    totalTributos?: { federal: number; estadual: number; municipal: number } | null // não optante: % aproximados
  }
}

const NS = 'http://www.sped.fazenda.gov.br/nfse'

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function soDigitos(s: string | null | undefined) {
  return (s ?? '').replace(/\D/g, '')
}
function texto(s: string, max: number) {
  // sem quebras de linha nem espaços duplicados; corta no limite do campo
  return esc(s.replace(/\s+/g, ' ').trim().slice(0, max))
}
function tag(nome: string, valor: string | null | undefined) {
  return valor === null || valor === undefined || valor === '' ? '' : `<${nome}>${valor}</${nome}>`
}
// Valores monetários: "0" ou com duas casas ("1500.00"), como pede o esquema.
export function dinheiro(v: number) {
  const n = Math.round(v * 100) / 100
  return n === 0 ? '0' : n.toFixed(2)
}
function percentual(v: number) {
  const n = Math.round(v * 100) / 100
  return n === 0 ? '0' : n.toFixed(2)
}
// Data e hora no fuso de Brasília (-03:00), sem milissegundos.
export function dataHoraBrasilia(d: Date) {
  const t = new Date(d.getTime() - 3 * 3600 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}T${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}-03:00`
}

export function identificadorDps(d: DadosDps) {
  const cnpj = soDigitos(d.prestador.cnpj)
  const cpf = soDigitos(d.prestador.cpf)
  const tipo = cnpj ? '2' : '1'
  const inscricao = (cnpj || cpf).padStart(14, '0')
  return `DPS${d.municipioEmissor}${tipo}${inscricao}${soDigitos(d.serie).padStart(5, '0')}${String(d.numero).padStart(15, '0')}`
}

function documento(cpf?: string | null, cnpj?: string | null) {
  const c = soDigitos(cnpj)
  if (c) return `<CNPJ>${c}</CNPJ>`
  const p = soDigitos(cpf)
  if (p) return `<CPF>${p}</CPF>`
  return ''
}

function endereco(e: EnderecoNacional) {
  return (
    `<end><endNac><cMun>${soDigitos(e.municipioIbge)}</cMun><CEP>${soDigitos(e.cep)}</CEP></endNac>` +
    `<xLgr>${texto(e.logradouro, 255)}</xLgr><nro>${texto(e.numero || 'S/N', 60)}</nro>` +
    (e.complemento ? `<xCpl>${texto(e.complemento, 156)}</xCpl>` : '') +
    `<xBairro>${texto(e.bairro, 60)}</xBairro></end>`
  )
}

// Confere o que dá para conferir antes de mandar (o resto o governo confere).
export function conferirDps(d: DadosDps): string[] {
  const erros: string[] = []
  const cnpj = soDigitos(d.prestador.cnpj)
  const cpf = soDigitos(d.prestador.cpf)
  if (!cnpj && !cpf) erros.push('Informe o CNPJ da casa (prestador).')
  if (cnpj && cnpj.length !== 14) erros.push('O CNPJ da casa precisa ter 14 números.')
  if (!/^\d{7}$/.test(d.municipioEmissor)) erros.push('Código IBGE do município da casa inválido (7 números).')
  if (!/^\d{6}$/.test(d.servico.codigoTributacaoNacional)) erros.push('Código de tributação nacional do serviço inválido (6 números).')
  if (d.servico.codigoTributacaoMunicipal && !/^\d{3}$/.test(d.servico.codigoTributacaoMunicipal)) erros.push('Código de tributação municipal inválido (3 números).')
  if (d.servico.codigoNbs && !/^\d{9}$/.test(d.servico.codigoNbs)) erros.push('Código NBS inválido (9 números).')
  if (!/^\d{7}$/.test(d.servico.municipioPrestacao)) erros.push('Código IBGE do local da prestação inválido (7 números).')
  if (!d.servico.descricao.trim()) erros.push('Escreva a descrição do serviço.')
  if (!(d.valores.valorServico > 0)) erros.push('O valor do serviço precisa ser maior que zero.')
  if (!/^\d{1,5}$/.test(soDigitos(d.serie)) || Number(d.serie) < 0) erros.push('Série da DPS inválida (até 5 números).')
  if (!(d.numero >= 1)) erros.push('Número da DPS inválido.')
  if (d.competencia > dataHoraBrasilia(d.emitidaEm).slice(0, 10)) erros.push('A data do serviço não pode ser depois da data de emissão.')
  if (d.prestador.opcaoSimples === 3 && !d.prestador.regimeApuracaoSimples) erros.push('Informe o regime de apuração do Simples Nacional da casa.')
  if (d.prestador.opcaoSimples === 3 && (d.valores.percentualTributosSimples === null || d.valores.percentualTributosSimples === undefined)) erros.push('Informe o percentual aproximado de tributos do Simples Nacional da casa.')
  if (d.valores.aliquotaIss !== null && d.valores.aliquotaIss !== undefined && (d.valores.aliquotaIss < 0 || d.valores.aliquotaIss > 5)) erros.push('A alíquota do ISS precisa estar entre 0% e 5%.')
  if (d.tomador) {
    const tc = soDigitos(d.tomador.cnpj)
    const tp = soDigitos(d.tomador.cpf)
    if (!tc && !tp) erros.push('Informe o CPF ou CNPJ do cliente.')
    if (tp && !cpfValido(tp)) erros.push('O CPF do cliente é inválido.')
    if (tc && !cnpjValido(tc)) erros.push('O CNPJ do cliente é inválido.')
    if (!d.tomador.nome.trim()) erros.push('Informe o nome do cliente.')
    if (d.tomador.endereco && !/^\d{8}$/.test(soDigitos(d.tomador.endereco.cep))) erros.push('O CEP do cliente precisa ter 8 números.')
  }
  return erros
}

export function montarDps(d: DadosDps): string {
  const id = identificadorDps(d)
  const p = d.prestador
  const t = d.tomador
  const v = d.valores
  const sn = p.opcaoSimples

  const regTrib =
    `<regTrib><opSimpNac>${sn}</opSimpNac>` +
    (sn === 3 ? `<regApTribSN>${p.regimeApuracaoSimples ?? 1}</regApTribSN>` : '') +
    `<regEspTrib>${sn === 2 ? 0 : p.regimeEspecial ?? 0}</regEspTrib></regTrib>`

  const prest =
    `<prest>${documento(p.cpf, p.cnpj)}` +
    tag('IM', p.inscricaoMunicipal ? texto(p.inscricaoMunicipal, 15) : null) +
    tag('fone', soDigitos(p.telefone).length >= 6 ? soDigitos(p.telefone).slice(0, 20) : null) +
    tag('email', p.email ? texto(p.email, 80) : null) +
    regTrib +
    `</prest>`

  const toma = t
    ? `<toma>${documento(t.cpf, t.cnpj)}<xNome>${texto(t.nome, 300)}</xNome>` +
      (t.endereco ? endereco(t.endereco) : '') +
      tag('fone', soDigitos(t.telefone).length >= 6 ? soDigitos(t.telefone).slice(0, 20) : null) +
      tag('email', t.email && /.+@.+\..+/.test(t.email) ? texto(t.email, 80) : null) +
      `</toma>`
    : ''

  const s = d.servico
  const serv =
    `<serv><locPrest><cLocPrestacao>${s.municipioPrestacao}</cLocPrestacao></locPrest>` +
    `<cServ><cTribNac>${s.codigoTributacaoNacional}</cTribNac>` +
    tag('cTribMun', s.codigoTributacaoMunicipal || null) +
    `<xDescServ>${texto(s.descricao, 2000)}</xDescServ>` +
    tag('cNBS', s.codigoNbs || null) +
    `</cServ>` +
    (s.informacoesComplementares ? `<infoCompl><xInfComp>${texto(s.informacoesComplementares, 2000)}</xInfComp></infoCompl>` : '') +
    `</serv>`

  let totTrib: string
  if (sn === 3) totTrib = `<pTotTribSN>${percentual(v.percentualTributosSimples ?? 0)}</pTotTribSN>`
  else if (sn === 1 && v.totalTributos)
    totTrib = `<pTotTrib><pTotTribFed>${percentual(v.totalTributos.federal)}</pTotTribFed><pTotTribEst>${percentual(v.totalTributos.estadual)}</pTotTribEst><pTotTribMun>${percentual(v.totalTributos.municipal)}</pTotTribMun></pTotTrib>`
  else totTrib = `<indTotTrib>0</indTotTrib>`

  const valores =
    `<valores><vServPrest><vServ>${dinheiro(v.valorServico)}</vServ></vServPrest>` +
    (v.descontoIncondicionado && v.descontoIncondicionado > 0 ? `<vDescCondIncond><vDescIncond>${dinheiro(v.descontoIncondicionado)}</vDescIncond></vDescCondIncond>` : '') +
    `<trib><tribMun><tribISSQN>${v.tributacaoIss}</tribISSQN><tpRetISSQN>${v.retencaoIss}</tpRetISSQN>` +
    (v.aliquotaIss !== null && v.aliquotaIss !== undefined && v.tributacaoIss === 1 ? `<pAliq>${percentual(v.aliquotaIss)}</pAliq>` : '') +
    `</tribMun><totTrib>${totTrib}</totTrib></trib></valores>`

  return (
    `<DPS xmlns="${NS}" versao="1.01"><infDPS Id="${id}">` +
    `<tpAmb>${d.ambiente}</tpAmb>` +
    `<dhEmi>${dataHoraBrasilia(d.emitidaEm)}</dhEmi>` +
    `<verAplic>${texto(d.versaoAplicativo, 20)}</verAplic>` +
    `<serie>${soDigitos(d.serie)}</serie>` +
    `<nDPS>${d.numero}</nDPS>` +
    `<dCompet>${d.competencia}</dCompet>` +
    `<tpEmit>1</tpEmit>` +
    `<cLocEmi>${d.municipioEmissor}</cLocEmi>` +
    prest +
    toma +
    serv +
    valores +
    `</infDPS></DPS>`
  )
}

// ---------- dígitos verificadores ----------
export function cpfValido(cpf: string) {
  const c = soDigitos(cpf)
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false
  const dv = (base: string, peso: number) => {
    let s = 0
    for (let i = 0; i < base.length; i++) s += Number(base[i]) * (peso - i)
    const r = (s * 10) % 11
    return r === 10 ? 0 : r
  }
  return dv(c.slice(0, 9), 10) === Number(c[9]) && dv(c.slice(0, 10), 11) === Number(c[10])
}
export function cnpjValido(cnpj: string) {
  const c = soDigitos(cnpj)
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false
  const dv = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const s = base.split('').reduce((t, d, i) => t + Number(d) * pesos[i], 0)
    const r = s % 11
    return r < 2 ? 0 : 11 - r
  }
  return dv(c.slice(0, 12)) === Number(c[12]) && dv(c.slice(0, 13)) === Number(c[13])
}
