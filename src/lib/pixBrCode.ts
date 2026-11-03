// Código Pix "copia e cola" (BR Code estático, padrão do Banco Central)
// com a chave da unidade e o valor já preenchido. Funciona em qualquer
// banco, sem integração e sem custo: o QR code é só esse texto desenhado.

function campo(id: string, valor: string): string {
  return id + String(valor.length).padStart(2, '0') + valor
}

// CRC16-CCITT (polinômio 0x1021, início 0xFFFF), exigido no fim do código.
function crc16(texto: string): string {
  let crc = 0xffff
  for (let i = 0; i < texto.length; i++) {
    crc ^= texto.charCodeAt(i) << 8
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

// Sem acentos e só letras, números e espaço (alguns bancos recusam o resto).
function limpo(texto: string, max: number): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, max)
    .trim()
}

function cpfValido(n: string): boolean {
  if (!/^\d{11}$/.test(n) || /^(\d)\1{10}$/.test(n)) return false
  const dv = (len: number) => {
    let s = 0
    for (let i = 0; i < len; i++) s += Number(n[i]) * (len + 1 - i)
    const r = (s * 10) % 11
    return r === 10 ? 0 : r
  }
  return dv(9) === Number(n[9]) && dv(10) === Number(n[10])
}

// A chave precisa ir no formato do DICT: telefone com +55, CPF/CNPJ só
// números, e-mail em minúsculas, chave aleatória como está.
export function normalizarChavePix(chave: string): string {
  const k = chave.trim()
  if (k.includes('@')) return k.toLowerCase()
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) return k.toLowerCase()
  const digitos = k.replace(/\D/g, '')
  if (k.startsWith('+')) return '+' + digitos
  if (digitos.length === 14) return digitos // CNPJ
  if (digitos.length === 11 && cpfValido(digitos) && !/[()\s]/.test(k)) return digitos // CPF
  if (digitos.length === 10 || digitos.length === 11) return '+55' + digitos // telefone com DDD
  if (digitos.length === 13 && digitos.startsWith('55')) return '+' + digitos
  return k
}

// Cidade a partir do endereço ("..., Itajaí - SC" ou "Itajaí/SC").
export function cidadeDoEndereco(endereco: string | null | undefined): string {
  const m = (endereco ?? '').match(/([A-Za-zÀ-ÿ' ]{3,})\s*[-/]\s*[A-Z]{2}\b(?!.*[-/]\s*[A-Z]{2}\b)/)
  return m ? m[1].trim() : ''
}

export function gerarPixCopiaECola(opts: {
  chave: string
  valor: number
  nome: string
  cidade?: string
  identificador?: string
}): string {
  const conta = campo('00', 'br.gov.bcb.pix') + campo('01', normalizarChavePix(opts.chave))
  const txid = (opts.identificador ?? '').normalize('NFD').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 25) || '***'
  const corpo =
    campo('00', '01') +
    campo('26', conta) +
    campo('52', '0000') +
    campo('53', '986') +
    (opts.valor > 0 ? campo('54', opts.valor.toFixed(2)) : '') +
    campo('58', 'BR') +
    campo('59', limpo(opts.nome, 25) || 'RECEBEDOR') +
    campo('60', limpo(opts.cidade ?? '', 15) || 'BRASIL') +
    campo('62', campo('05', txid)) +
    '6304'
  return corpo + crc16(corpo)
}
