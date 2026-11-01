import { FormEvent, useEffect, useState } from 'react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError } from '../../lib/format'
import type { DadosContratada } from '../../lib/saasContract'

// Painel da plataforma: os seus dados como contratada, usados no contrato do
// sistema de cada empresa.
const CAMPOS: { k: keyof DadosContratada; label: string; ph?: string; full?: boolean }[] = [
  { k: 'contratada_nome', label: 'Seu nome ou razão social', full: true },
  { k: 'contratada_documento', label: 'CPF ou CNPJ' },
  { k: 'contratada_email', label: 'E-mail' },
  { k: 'contratada_endereco', label: 'Endereço completo', full: true },
  { k: 'contratada_whatsapp', label: 'WhatsApp de suporte' },
  { k: 'suporte_horario', label: 'Horário de suporte', ph: 'segunda a sexta, das 9h às 18h' },
  { k: 'foro', label: 'Foro (cidade/UF)', ph: 'Itajaí/SC' },
]

export function ContractorSettings() {
  const [f, setF] = useState<DadosContratada | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    supabase.rpc('platform_get_contract_settings').then(({ data, error }) => {
      if (!error) setF((data ?? {}) as DadosContratada)
    })
  }, [])

  if (!f) return null // antes da migração 077

  async function salvar(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.rpc('platform_save_contract_settings', { p_dados: f })
    setMsg(error ? friendlyDbError(error.message) : 'Salvo. Os próximos contratos já saem com esses dados.')
  }

  return (
    <Card title="Seus dados para o contrato">
      <form onSubmit={salvar} className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {CAMPOS.map((c) => (
          <div key={c.k} className={c.full ? 'md:col-span-2' : ''}>
            <label className="block text-xs text-muted mb-1">{c.label}</label>
            <input value={f[c.k] ?? ''} onChange={(e) => setF({ ...f, [c.k]: e.target.value })} placeholder={c.ph} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
          </div>
        ))}
        <div className="md:col-span-2 flex items-center gap-3">
          <Button type="submit">Salvar</Button>
          {msg && <span className="text-xs text-muted">{msg}</span>}
        </div>
      </form>
    </Card>
  )
}
