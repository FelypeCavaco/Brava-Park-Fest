// Certificado digital A1 (.pfx) da casa e assinatura da DPS.
//
// - lerCertificado: abre o .pfx com a senha, separa chave e certificado,
//   confere validade e lê o CNPJ (ou CPF) gravado no certificado ICP-Brasil
//   (extensão OtherName, OID 2.16.76.1.3.3 para CNPJ e 2.16.76.1.3.1 para CPF).
// - assinarDps: assinatura XMLDSig "enveloped" sobre o grupo infDPS, com
//   canonicalização C14N. O algoritmo fica numa constante: o leiaute não
//   especifica; os exemplos publicados usam RSA-SHA256.

import forge from 'npm:node-forge@1.3.1'
import { SignedXml } from 'npm:xml-crypto@6.0.0'

export const ALGORITMO = {
  assinatura: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
  resumo: 'http://www.w3.org/2001/04/xmlenc#sha256',
}
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature'
const OID_CNPJ = '2.16.76.1.3.3'
const OID_CPF = '2.16.76.1.3.1'

export interface Certificado {
  chavePem: string
  certPem: string
  cnpj: string | null
  cpf: string | null
  titular: string
  validoDe: Date
  validoAte: Date
}

export class ErroCertificado extends Error {}

// Lê o CNPJ ou CPF da extensão "nomes alternativos" (OtherName) do certificado ICP-Brasil.
function documentoDoCertificado(cert: forge.pki.Certificate): { cnpj: string | null; cpf: string | null } {
  const ext = cert.getExtension('subjectAltName') as { value?: string } | undefined
  let cnpj: string | null = null
  let cpf: string | null = null
  if (ext?.value) {
    try {
      const seq = forge.asn1.fromDer(ext.value)
      for (const nome of (seq.value as forge.asn1.Asn1[]) ?? []) {
        // OtherName: [0] { OID, [0] { valor } }
        if (nome.tagClass !== forge.asn1.Class.CONTEXT_SPECIFIC || nome.type !== 0) continue
        const partes = nome.value as forge.asn1.Asn1[]
        const oid = forge.asn1.derToOid(partes[0].value as string)
        let bruto = ''
        const juntar = (n: forge.asn1.Asn1) => {
          if (typeof n.value === 'string') bruto += n.value
          else for (const f of n.value as forge.asn1.Asn1[]) juntar(f)
        }
        juntar(partes[1])
        const digitos = bruto.replace(/\D/g, '')
        if (oid === OID_CNPJ && digitos.length >= 14) cnpj = digitos.slice(-14)
        if (oid === OID_CPF && digitos.length >= 19) cpf = digitos.slice(8, 19) // data de nascimento (8) + CPF (11)
      }
    } catch {
      /* certificado sem a extensão no formato esperado */
    }
  }
  // Reserva: muitos e-CNPJ trazem "RAZÃO SOCIAL:CNPJ" no nome comum.
  if (!cnpj) {
    const cn = String(cert.subject.getField('CN')?.value ?? '')
    const m = cn.match(/:(\d{14})$/)
    if (m) cnpj = m[1]
  }
  return { cnpj, cpf }
}

export function lerCertificado(pfxBase64: string, senha: string, agora = new Date()): Certificado {
  let p12: forge.pkcs12.Pkcs12Pfx
  try {
    const der = forge.util.decode64(pfxBase64)
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), false, senha)
  } catch {
    throw new ErroCertificado('Não foi possível abrir o certificado. Confira se o arquivo é o .pfx (ou .p12) e se a senha está certa.')
  }
  const chaves = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []
  const certs = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []
  const chave = chaves[0]?.key
  if (!chave) throw new ErroCertificado('O arquivo não tem a chave privada. Exporte o certificado de novo marcando "exportar a chave privada".')
  // O certificado da casa é o que não é de autoridade certificadora.
  const titular = certs.map((b) => b.cert!).find((c) => {
    const bc = c.getExtension('basicConstraints') as { cA?: boolean } | undefined
    return !bc?.cA
  }) ?? certs[0]?.cert
  if (!titular) throw new ErroCertificado('Não encontrei o certificado dentro do arquivo.')
  const { cnpj, cpf } = documentoDoCertificado(titular)
  const validoDe = titular.validity.notBefore
  const validoAte = titular.validity.notAfter
  if (agora > validoAte) throw new ErroCertificado(`O certificado venceu em ${validoAte.toLocaleDateString('pt-BR')}. É preciso renovar.`)
  if (agora < validoDe) throw new ErroCertificado('O certificado ainda não começou a valer.')
  return {
    chavePem: forge.pki.privateKeyToPem(chave),
    certPem: forge.pki.certificateToPem(titular),
    cnpj,
    cpf,
    titular: String(titular.subject.getField('CN')?.value ?? ''),
    validoDe,
    validoAte,
  }
}

export function assinarDps(xml: string, cert: Certificado): string {
  const sig = new SignedXml({
    privateKey: cert.chavePem,
    publicCert: cert.certPem,
    signatureAlgorithm: ALGORITMO.assinatura,
    canonicalizationAlgorithm: C14N,
  })
  sig.addReference({
    xpath: "//*[local-name(.)='infDPS']",
    transforms: [ENVELOPED, C14N],
    digestAlgorithm: ALGORITMO.resumo,
  })
  sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='infDPS']", action: 'after' } })
  return sig.getSignedXml()
}
