import { useEffect, useState } from 'react'
import { Copy, Check, MessageCircle, Printer } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { Button } from '../ui/Button'
import { QrImg, qrParaImpressao } from './QrRec'
import { friendlyDbError } from '../../lib/format'
import { imprimirEntrada, papelDe } from '../../lib/recImpressao'
import { horaMin, linkPais, linkWhatsApp, mascaraTelefone, type FuncoesRec, type VisitaRec } from '../../lib/recreacao'

// Reenvia o link do responsável e o código de retirada de quem ainda está dentro
// (a mensagem fechou sem querer, o celular do responsável foi trocado, etc.).

interface Dados { codigo: string; token: string; entrada_em: string; responsavel: string; telefone: string | null; criancas: string[] }

export function ReenviarLink({ v, funcoes, regras, nomeCasa, fechar }: {
  v: VisitaRec; funcoes: FuncoesRec; regras: Record<string, string | number>; nomeCasa: string; fechar: () => void
}) {
  const [d, setD] = useState<Dados | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)

  useEffect(() => {
    let vivo = true
    supabase.rpc('rec_reenviar_dados', { p_visita: v.id }).then(({ data, error }) => {
      if (!vivo) return
      if (error) return setErro(friendlyDbError(error.message))
      setD(data as Dados)
    })
    return () => { vivo = false }
  }, [v.id])

  if (erro) return <div className="rounded-card border-2 border-danger/30 bg-danger-light p-4 text-sm text-danger flex justify-between gap-3"><span>{erro}</span><Button variant="ghost" onClick={fechar}>Fechar</Button></div>
  if (!d) return <div className="rounded-card border-2 border-purple/30 bg-purple-light/30 p-4 text-sm text-muted">Buscando os dados...</div>

  const nomes = d.criancas.map((n) => n.split(' ')[0])
  const link = linkPais(d.token)
  const usaCodigo = funcoes.codigo !== false
  const usaLink = funcoes.paginaPais !== false
  const msg = `Oi, ${d.responsavel.split(' ')[0]}! Segue de novo o acesso de ${nomes.join(' e ')} na recreação (entrada às ${horaMin(d.entrada_em)}).`
    + `${usaCodigo ? `\n\nCódigo de retirada: ${d.codigo}\nSó entregamos a criança com esse código.` : ''}`
    + `${usaLink ? `\n\nAcompanhe o tempo, o valor e o QR da retirada por aqui:\n${link}` : ''}`

  async function copiar() {
    try { await navigator.clipboard.writeText(msg); setCopiado(true); setTimeout(() => setCopiado(false), 2000) } catch { /* sem permissão da área de transferência */ }
  }
  async function imprimir() {
    const papel = papelDe(regras.impressora)
    if (!papel) return
    const qr = funcoes.qr !== false && usaLink ? await qrParaImpressao(link).catch(() => '') : ''
    imprimirEntrada({
      casa: nomeCasa, papel, imprimeTermo: false, termo: '', responsavel: d!.responsavel, telefone: d!.telefone ? mascaraTelefone(d!.telefone) : null,
      entradaEm: d!.entrada_em, codigo: usaCodigo ? d!.codigo : null, link, qr,
      criancas: [{ nome: d!.criancas.join(' e '), nascimento: '', cuidados: null, pulseira: v.pulseira, plano: v.plano.nome, ate: null }],
    })
  }

  return (
    <div className="rounded-card border-2 border-purple/30 bg-purple-light/30 p-4 space-y-3 animate-card-in">
      <p className="font-semibold">Reenviar o acesso para {d.responsavel}</p>
      <div className="flex flex-wrap gap-4 items-start">
        <div className="rounded-xl bg-[#e7f6ec] text-[#1b3a28] p-3 text-sm max-w-lg whitespace-pre-wrap flex-1 min-w-[14rem]">{msg}</div>
        {usaLink && funcoes.qr !== false && <QrImg texto={link} tamanho={120} className="rounded-lg bg-white p-1.5" />}
      </div>
      <div className="flex flex-wrap gap-2">
        {d.telefone
          ? <a href={linkWhatsApp(d.telefone, msg)} target="_blank" rel="noreferrer"><Button><MessageCircle className="w-4 h-4" />Abrir no WhatsApp</Button></a>
          : <span className="text-xs text-amber self-center">Sem telefone no cadastro: copie e mande por outro meio.</span>}
        <Button variant="secondary" onClick={copiar}>{copiado ? <><Check className="w-4 h-4" />Copiado</> : <><Copy className="w-4 h-4" />Copiar mensagem</>}</Button>
        {papelDe(regras.impressora) && <Button variant="secondary" onClick={imprimir}><Printer className="w-4 h-4" />Imprimir via</Button>}
        <Button variant="ghost" onClick={fechar}>Fechar</Button>
      </div>
      <p className="text-xs text-muted">Fica registrado quem consultou o código e quando. Só entregue o código ao responsável.</p>
    </div>
  )
}
