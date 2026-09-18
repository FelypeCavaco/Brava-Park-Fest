import { FormEvent, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from './ui/Button'
import { supabase } from '../lib/supabaseClient'
import { CLIENT_SOURCES, CLIENT_SOURCE_LABEL, type Client } from '../types'

interface ClientQuickCreateModalProps {
  onClose: () => void
  onCreated: (client: Client) => void
  initialClient?: Client
}

// Mesmo formulário de cadastro de cliente da aba "Clientes" — usado tanto lá
// quanto embutido em outras telas (ex: Nova reserva) pra cadastrar um
// cliente na hora, sem precisar sair do que já estava fazendo. Quando
// recebe `initialClient`, vira o formulário de edição do cadastro.
export function ClientQuickCreateModal({ onClose, onCreated, initialClient }: ClientQuickCreateModalProps) {
  const isEditing = !!initialClient
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [name, setName] = useState(initialClient?.name ?? '')
  const [phone, setPhone] = useState(initialClient?.phone ?? '')
  const [email, setEmail] = useState(initialClient?.email ?? '')
  const [childName, setChildName] = useState(initialClient?.child_name ?? '')
  const [childBirthday, setChildBirthday] = useState(initialClient?.child_birthday ?? '')
  const [consent, setConsent] = useState(isEditing)
  const [cpf, setCpf] = useState(initialClient?.cpf ?? '')
  const [cep, setCep] = useState(initialClient?.cep ?? '')
  const [street, setStreet] = useState(initialClient?.street ?? '')
  const [addressNumber, setAddressNumber] = useState(initialClient?.address_number ?? '')
  const [neighborhood, setNeighborhood] = useState(initialClient?.neighborhood ?? '')
  const [city, setCity] = useState(initialClient?.city ?? '')
  const [state, setState] = useState(initialClient?.state ?? '')
  const [source, setSource] = useState(
    initialClient?.source && !CLIENT_SOURCES.includes(initialClient.source as any) ? 'outro' : initialClient?.source ?? '',
  )
  const [sourceOutro, setSourceOutro] = useState(
    initialClient?.source && !CLIENT_SOURCES.includes(initialClient.source as any) ? initialClient.source : '',
  )
  const [cepLoading, setCepLoading] = useState(false)

  async function handleCepBlur() {
    const digits = cep.replace(/\D/g, '')
    if (digits.length !== 8) return
    setCepLoading(true)
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`)
      const data = await res.json()
      if (!data.erro) {
        setStreet(data.logradouro || '')
        setNeighborhood(data.bairro || '')
        setCity(data.localidade || '')
        setState(data.uf || '')
      }
    } catch {
      // sem internet ou serviço fora do ar — deixa o usuário preencher à mão
    }
    setCepLoading(false)
  }

  async function handleAddClient(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || !consent) return

    const finalSource = source === 'outro' ? sourceOutro.trim() || 'outro' : source || null

    const payload = {
      name: name.trim(),
      phone: phone.trim() || null,
      email: email.trim() || null,
      child_name: childName.trim() || null,
      child_birthday: childBirthday || null,
      cpf: cpf.trim() || null,
      cep: cep.trim() || null,
      street: street.trim() || null,
      address_number: addressNumber.trim() || null,
      neighborhood: neighborhood.trim() || null,
      city: city.trim() || null,
      state: state.trim() || null,
      source: finalSource,
    }

    setSaving(true)
    const { data, error } = isEditing
      ? await supabase.from('clients').update(payload).eq('id', initialClient!.id).select().single()
      : await supabase.from('clients').insert(payload).select().single()
    setSaving(false)

    if (error) {
      setError(isEditing ? 'Não foi possível salvar as alterações.' : 'Não foi possível salvar o cliente.')
      return
    }

    onCreated(data as Client)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-surface rounded-card p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-display font-semibold">{isEditing ? 'Editar cliente' : 'Novo cliente'}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5 mb-3">{error}</div>}

        <form onSubmit={handleAddClient} className="space-y-3">
          <div>
            <label className="block text-xs text-muted mb-1">Nome</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm"
              placeholder="Nome completo"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Telefone (WhatsApp)</label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm"
              placeholder="(11) 90000-0000"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm"
              placeholder="cliente@email.com"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Como conheceu a gente? (opcional)</label>
            <select value={source} onChange={(e) => setSource(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm">
              <option value="">Não perguntado</option>
              {CLIENT_SOURCES.map((s) => (
                <option key={s} value={s}>{CLIENT_SOURCE_LABEL[s]}</option>
              ))}
            </select>
            {source === 'outro' && (
              <input
                type="text"
                value={sourceOutro}
                onChange={(e) => setSourceOutro(e.target.value)}
                placeholder="Qual?"
                className="w-full border border-line rounded-lg px-3 py-2 text-sm mt-2"
              />
            )}
          </div>
          <div className="pt-2 border-t border-line">
            <p className="text-xs text-muted mb-2">Dados para contrato (opcional, preencha ao fechar a festa)</p>
            <div className="grid grid-cols-2 gap-3">
              <input type="text" value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="CPF" className="border border-line rounded-lg px-3 py-2 text-sm" />
              <input
                type="text"
                value={cep}
                onChange={(e) => setCep(e.target.value)}
                onBlur={handleCepBlur}
                placeholder={cepLoading ? 'Buscando...' : 'CEP'}
                className="border border-line rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-3 gap-3 mt-2">
              <input type="text" value={street} onChange={(e) => setStreet(e.target.value)} placeholder="Rua/Avenida" className="col-span-2 border border-line rounded-lg px-3 py-2 text-sm" />
              <input type="text" value={addressNumber} onChange={(e) => setAddressNumber(e.target.value)} placeholder="Número" className="border border-line rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="grid grid-cols-3 gap-3 mt-2">
              <input type="text" value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} placeholder="Bairro" className="border border-line rounded-lg px-3 py-2 text-sm" />
              <input type="text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Cidade" className="border border-line rounded-lg px-3 py-2 text-sm" />
              <input type="text" value={state} onChange={(e) => setState(e.target.value)} placeholder="UF" className="border border-line rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted mb-1">Aniversariante (opcional)</label>
              <input
                type="text"
                value={childName}
                onChange={(e) => setChildName(e.target.value)}
                className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                placeholder="Nome da criança"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Data de nascimento</label>
              <input
                type="date"
                value={childBirthday}
                onChange={(e) => setChildBirthday(e.target.value)}
                className="w-full border border-line rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>
          <p className="text-xs text-muted">
            Preencher o aniversariante ativa o alerta automático de reativação quando a data se aproximar.
          </p>
          {!isEditing && (
            <label className="flex items-start gap-2 text-xs text-muted pt-2 border-t border-line">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" required />
              O cliente autoriza o uso destes dados para contato comercial (orçamentos, lembretes, pesquisas), conforme a LGPD.
            </label>
          )}
          <Button type="submit" className="w-full justify-center mt-2" disabled={!consent || saving}>
            {saving ? 'Salvando...' : isEditing ? 'Salvar alterações' : 'Salvar cliente'}
          </Button>
        </form>
      </div>
    </div>
  )
}
