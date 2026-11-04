import { useEffect, useState } from 'react'
import { FileText } from 'lucide-react'
import { Button } from '../ui/Button'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError } from '../../lib/format'
import { baixarContratoSaas, faltandoNoContrato, type DadosContratada, type DadosEmpresaContrato } from '../../lib/saasContract'
import { TERMOS_DATA } from '../../lib/termosUso'

// Gerenciar empresa → Contrato: gera o contrato do Festou em PDF, já
// preenchido com os seus dados e os da casa.
export function CompanyContract({ empresaId }: { empresaId: string }) {
  const [c, setC] = useState<DadosContratada | null>(null)
  const [e, setE] = useState<DadosEmpresaContrato | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [gerando, setGerando] = useState(false)
  const [aceites, setAceites] = useState<{ user_name: string | null; user_email: string | null; version: string; accepted_at: string }[] | null>(null)

  useEffect(() => {
    Promise.all([supabase.rpc('platform_get_contract_settings'), supabase.rpc('platform_contract_data', { p_company: empresaId })]).then(([a, b]) => {
      if (a.error || b.error) return setErro(friendlyDbError((a.error ?? b.error)!.message))
      setC((a.data ?? {}) as DadosContratada)
      const d = b.data as DadosEmpresaContrato
      setE({ ...d, plano: d.plano ? { ...d.plano, mensalidade: Number(d.plano.mensalidade), implantacao: Number(d.plano.implantacao), unidade_adicional: Number(d.plano.unidade_adicional) } : null })
    })
  }, [empresaId])

  useEffect(() => {
    supabase.rpc('platform_terms_list', { p_company: empresaId }).then(({ data, error }) => setAceites(error ? [] : (data ?? [])))
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

      <div className="pt-3 border-t border-line">
        <p className="font-semibold">Termos de Uso aceitos</p>
        <p className="text-xs text-muted mb-2">Cada pessoa da casa aceita os Termos (versão atual: {TERMOS_DATA}) antes de usar o sistema. <a href="/termos" target="_blank" rel="noreferrer" className="text-purple font-medium">Ver os Termos</a></p>
        {aceites === null ? <p className="text-xs text-muted">Carregando...</p>
          : aceites.length === 0 ? <p className="text-xs text-muted">Ninguém desta casa aceitou ainda.</p>
          : (
            <ul className="divide-y divide-line text-xs">
              {aceites.map((a, i) => (
                <li key={i} className="py-1.5 flex flex-wrap justify-between gap-2">
                  <span>{a.user_name ?? '—'}{a.user_email ? ` · ${a.user_email}` : ''}</span>
                  <span className="text-muted">versão {a.version.split('-').reverse().join('/')} · aceito em {new Date(a.accepted_at).toLocaleString('pt-BR')}</span>
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  )
}
