import { useEffect, useState } from 'react'
import { FileText } from 'lucide-react'
import { Button } from '../ui/Button'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError } from '../../lib/format'
import { baixarContratoSaas, faltandoNoContrato, type DadosContratada, type DadosEmpresaContrato } from '../../lib/saasContract'

// Gerenciar empresa → Contrato: gera o contrato do Festou em PDF, já
// preenchido com os seus dados e os da casa.
export function CompanyContract({ empresaId }: { empresaId: string }) {
  const [c, setC] = useState<DadosContratada | null>(null)
  const [e, setE] = useState<DadosEmpresaContrato | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [gerando, setGerando] = useState(false)

  useEffect(() => {
    Promise.all([supabase.rpc('platform_get_contract_settings'), supabase.rpc('platform_contract_data', { p_company: empresaId })]).then(([a, b]) => {
      if (a.error || b.error) return setErro(friendlyDbError((a.error ?? b.error)!.message))
      setC((a.data ?? {}) as DadosContratada)
      const d = b.data as DadosEmpresaContrato
      setE({ ...d, plano: d.plano ? { ...d.plano, mensalidade: Number(d.plano.mensalidade), implantacao: Number(d.plano.implantacao), unidade_adicional: Number(d.plano.unidade_adicional) } : null })
    })
  }, [empresaId])

  if (erro) return <p className="text-sm text-danger">{erro}</p>
  if (!c || !e) return <p className="text-sm text-muted">Carregando...</p>
  const falta = faltandoNoContrato(c, e)

  async function gerar() {
    setGerando(true)
    try {
      await baixarContratoSaas(c!, e!)
    } finally {
      setGerando(false)
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <p>O contrato sai com os seus dados (quadro <b>“Seus dados para o contrato”</b> no painel), os da casa (primeira unidade) e a mensalidade cadastrada.</p>
      {falta.length > 0 ? (
        <div className="bg-amber-light rounded-lg px-4 py-3">
          <p className="font-semibold">Falta preencher</p>
          <p className="text-xs mt-1">{falta.join(' · ')}</p>
          <p className="text-xs text-muted mt-1">Dá para gerar assim mesmo: o que faltar sai em branco, para completar à mão.</p>
        </div>
      ) : (
        <p className="bg-teal-light text-teal rounded-lg px-4 py-2.5">Tudo preenchido.</p>
      )}
      <Button onClick={gerar} disabled={gerando}><FileText className="w-4 h-4" /> {gerando ? 'Gerando...' : 'Baixar contrato (PDF)'}</Button>
      <p className="text-xs text-muted">Rascunho para revisão de um advogado antes do primeiro uso.</p>
    </div>
  )
}
