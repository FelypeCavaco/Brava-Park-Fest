const UNIDADES = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove']
const DEZ_A_DEZENOVE = [
  'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove',
]
const DEZENAS = [
  '', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa',
]
const CENTENAS = [
  '', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos',
  'seiscentos', 'setecentos', 'oitocentos', 'novecentos',
]

function grupoAte999(n: number): string {
  if (n === 0) return ''
  if (n === 100) return 'cem'

  const c = Math.floor(n / 100)
  const resto = n % 100
  const partes: string[] = []

  if (c > 0) partes.push(CENTENAS[c])

  if (resto > 0) {
    if (resto < 10) {
      partes.push(UNIDADES[resto])
    } else if (resto < 20) {
      partes.push(DEZ_A_DEZENOVE[resto - 10])
    } else {
      const d = Math.floor(resto / 10)
      const u = resto % 10
      partes.push(u > 0 ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d])
    }
  }

  return partes.join(' e ')
}

// Converte um inteiro não negativo em texto por extenso (português).
export function integerToWords(value: number): string {
  const n = Math.floor(Math.abs(value))
  if (n === 0) return 'zero'

  const bilhoes = Math.floor(n / 1_000_000_000)
  const milhoes = Math.floor((n % 1_000_000_000) / 1_000_000)
  const milhares = Math.floor((n % 1_000_000) / 1_000)
  const unidades = n % 1_000

  const partes: string[] = []

  if (bilhoes > 0) partes.push(`${grupoAte999(bilhoes)} ${bilhoes === 1 ? 'bilhão' : 'bilhões'}`)
  if (milhoes > 0) partes.push(`${grupoAte999(milhoes)} ${milhoes === 1 ? 'milhão' : 'milhões'}`)
  if (milhares > 0) partes.push(milhares === 1 ? 'mil' : `${grupoAte999(milhares)} mil`)
  if (unidades > 0 || partes.length === 0) {
    const juntaE = partes.length > 0 && (unidades < 100 || unidades % 100 === 0)
    partes.push(juntaE ? `e ${grupoAte999(unidades)}` : grupoAte999(unidades))
  }

  return partes.join(' ').replace(/\s+/g, ' ').trim()
}

// Converte um valor em reais para "R$ 1.234,56 (mil duzentos e trinta e
// quatro reais e cinquenta e seis centavos)", no mesmo padrão usado no
// contrato original.
export function currencyToWords(value: number): string {
  const cents = Math.round(Math.abs(value) * 100)
  const reais = Math.floor(cents / 100)
  const centavos = cents % 100

  const reaisTexto = `${integerToWords(reais)} ${reais === 1 ? 'real' : 'reais'}`
  const centavosTexto = centavos > 0 ? ` e ${integerToWords(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}` : ''

  const formatted = value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  return `${formatted} (${reaisTexto}${centavosTexto})`
}
