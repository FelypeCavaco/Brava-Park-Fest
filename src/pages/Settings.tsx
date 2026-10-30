import { FormEvent, useEffect, useState } from 'react'
import { Plus, Upload, X, Building2, Store, ArrowUp, ArrowDown, Trash2 } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { BrandLogo } from '../components/BrandLogo'
import { supabase } from '../lib/supabaseClient'
import { useCompany } from '../lib/CompanyContext'
import { useUnit } from '../lib/UnitContext'
import { parseDecimal, friendlyDbError, brl } from '../lib/format'

// Configurações (só administrador): dados da empresa e das unidades. Tudo o
// que antes era fixo no sistema para a Brava fica editável aqui.

interface UnitRow {
  id: string
  name: string
  color: string | null
  sort: number | null
  address: string | null
  legal_name: string | null
  cnpj: string | null
  full_address: string | null
  responsible_name: string | null
  pix_key: string | null
  extra_hour_price: number | null
  default_deposit_percent: number | null
  google_review_link: string | null
  staff_whatsapp_group_link: string | null
  // Portal do cliente (migração 069)
  guest_min_age?: number
  menu_deadline_days?: number
  guest_deadline_days?: number
  payment_deadline_days?: number
  playlist_enabled?: boolean
  parabens_after_min?: number
  hot_dish_after_parabens_min?: number
  cake_after_parabens_min?: number
  portal_rules?: Regra[]
}

interface Regra {
  titulo: string
  texto: string
}

// Números do portal: [campo, rótulo, ajuda, mínimo, máximo]
const CAMPOS_PORTAL: [PortalNum, string, string, number, number][] = [
  ['guest_min_age', 'Idade que conta como convidado', 'A partir de quantos anos a criança entra na conta da lista.', 0, 18],
  ['menu_deadline_days', 'Prazo do cardápio (dias antes)', 'Depois disso o cliente ainda envia, mas fica marcado "após o prazo".', 0, 60],
  ['guest_deadline_days', 'Prazo da lista de convidados (dias antes)', 'Depois disso a lista fecha no portal.', 0, 60],
  ['payment_deadline_days', 'Prazo do saldo (dias antes)', 'Aparece para o cliente e nos avisos do Painel.', 0, 60],
  ['parabens_after_min', 'Parabéns (minutos após o início)', 'Ex.: 90 = 1h30 depois do início.', 0, 720],
  ['hot_dish_after_parabens_min', 'Pratos quentes (minutos após o parabéns)', 'Só aparece em festa com pratos quentes.', 0, 240],
  ['cake_after_parabens_min', 'Bolo (minutos após o parabéns)', '', 0, 240],
]
type PortalNum = 'guest_min_age' | 'menu_deadline_days' | 'guest_deadline_days' | 'payment_deadline_days' | 'parabens_after_min' | 'hot_dish_after_parabens_min' | 'cake_after_parabens_min'
const PORTAL_PADRAO: Record<PortalNum, number> = {
  guest_min_age: 5, menu_deadline_days: 7, guest_deadline_days: 1, payment_deadline_days: 1,
  parabens_after_min: 90, hot_dish_after_parabens_min: 10, cake_after_parabens_min: 30,
}

type UnitForm = Record<Exclude<keyof UnitRow, 'id' | 'sort' | 'extra_hour_price' | 'default_deposit_percent' | PortalNum | 'playlist_enabled' | 'portal_rules'>, string> & Record<PortalNum, string> & {
  playlist_enabled: boolean
  portal_rules: Regra[] | null
  id: string | null
  sort: string
  extra_hour_price: string
  default_deposit_percent: string
}

const CAMPOS_TEXTO: { key: keyof UnitForm; label: string; ajuda?: string; placeholder?: string; full?: boolean }[] = [
  { key: 'legal_name', label: 'Razão social', ajuda: 'Vai no contrato como contratada.' },
  { key: 'cnpj', label: 'CNPJ', placeholder: '00.000.000/0000-00' },
  { key: 'responsible_name', label: 'Responsável', ajuda: 'Quem assina pela unidade.' },
  { key: 'address', label: 'Endereço curto', ajuda: 'Aparece na proposta. Ex: Rua X, 100 - Bairro', placeholder: 'Rua, número - bairro' },
  { key: 'full_address', label: 'Endereço completo', ajuda: 'Vai no contrato e no portal do cliente.', full: true },
  { key: 'pix_key', label: 'Chave Pix', ajuda: 'O cliente vê no portal para pagar.' },
  { key: 'google_review_link', label: 'Link de avaliação do Google', ajuda: 'Enviado no pedido de avaliação depois da festa.', placeholder: 'https://g.page/r/.../review', full: true },
  { key: 'staff_whatsapp_group_link', label: 'Link do grupo de WhatsApp da equipe/fornecedores', placeholder: 'https://chat.whatsapp.com/...', full: true },
]

function toForm(u: UnitRow | null, nextSort: number): UnitForm {
  return {
    id: u?.id ?? null,
    name: u?.name ?? '',
    color: u?.color ?? '#6D28D9',
    sort: String(u?.sort ?? nextSort),
    address: u?.address ?? '',
    legal_name: u?.legal_name ?? '',
    cnpj: u?.cnpj ?? '',
    full_address: u?.full_address ?? '',
    responsible_name: u?.responsible_name ?? '',
    pix_key: u?.pix_key ?? '',
    extra_hour_price: u?.extra_hour_price != null ? String(u.extra_hour_price).replace('.', ',') : '',
    default_deposit_percent: u?.default_deposit_percent != null ? String(u.default_deposit_percent).replace('.', ',') : '',
    google_review_link: u?.google_review_link ?? '',
    staff_whatsapp_group_link: u?.staff_whatsapp_group_link ?? '',
    ...(Object.fromEntries(CAMPOS_PORTAL.map(([k]) => [k, String(u?.[k] ?? PORTAL_PADRAO[k])])) as Record<PortalNum, string>),
    playlist_enabled: u?.playlist_enabled ?? false,
    // null = unidade nova: o banco preenche com as regras padrão.
    portal_rules: u?.portal_rules ? u.portal_rules.map((r) => ({ ...r })) : null,
  }
}

const linkOk = (s: string) => !s.trim() || /^https:\/\//i.test(s.trim())

export function Settings() {
  const [aba, setAba] = useState<'empresa' | 'unidades'>('empresa')
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Configurações</h1>
        <p className="text-sm text-muted mt-1">Dados da empresa e das unidades. Só administradores veem esta tela.</p>
      </div>
      <div className="flex gap-1 border-b border-line">
        {([['empresa', 'Empresa', Building2], ['unidades', 'Unidades', Store]] as const).map(([k, l, Icon]) => (
          <button
            key={k}
            onClick={() => setAba(k)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-1.5 ${aba === k ? 'border-purple text-purple' : 'border-transparent text-muted hover:text-ink'}`}
          >
            <Icon className="w-4 h-4" /> {l}
          </button>
        ))}
      </div>
      {aba === 'empresa' ? <EmpresaTab /> : <UnidadesTab />}
    </div>
  )
}

function EmpresaTab() {
  const { brand, reloadBrand } = useCompany()
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [tagline, setTagline] = useState('')
  const [whats, setWhats] = useState('')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const [semMigracao, setSemMigracao] = useState(false)

  useEffect(() => {
    ;(async () => {
      const { data, error } = await supabase.from('companies').select('id, name, tagline, team_whatsapp, logo_url').order('created_at').limit(1).maybeSingle()
      if (error) return setSemMigracao(true)
      if (!data) return
      setCompanyId(data.id)
      setName(data.name ?? '')
      setTagline(data.tagline ?? '')
      setWhats(data.team_whatsapp ?? '')
      setLogoUrl(data.logo_url)
    })()
  }, [])

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (!companyId) return
    const digits = whats.replace(/\D/g, '')
    if (!name.trim()) return setMsg({ ok: false, texto: 'Informe o nome da empresa.' })
    if (digits && (digits.length < 10 || digits.length > 13)) return setMsg({ ok: false, texto: 'WhatsApp inválido: use DDD + número, ex: (47) 99999-0000.' })
    setSaving(true)
    const { error } = await supabase.from('companies').update({ name: name.trim(), tagline: tagline.trim() || null, team_whatsapp: digits || null }).eq('id', companyId)
    setSaving(false)
    if (error) return setMsg({ ok: false, texto: friendlyDbError(error.message) })
    setMsg({ ok: true, texto: 'Dados da empresa salvos.' })
    reloadBrand()
  }

  async function enviarLogo(file: File | undefined) {
    if (!file || !companyId) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return setMsg({ ok: false, texto: 'A logo precisa ser uma imagem PNG, JPG ou WEBP.' })
    if (file.size > 2 * 1024 * 1024) return setMsg({ ok: false, texto: 'A logo pode ter no máximo 2 MB.' })
    setSaving(true)
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
    const path = `${companyId}/logo-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('marca').upload(path, file, { contentType: file.type, upsert: false })
    if (upErr) {
      setSaving(false)
      return setMsg({ ok: false, texto: 'Não foi possível enviar a logo.' })
    }
    const url = supabase.storage.from('marca').getPublicUrl(path).data.publicUrl
    const { error } = await supabase.from('companies').update({ logo_url: url }).eq('id', companyId)
    setSaving(false)
    if (error) return setMsg({ ok: false, texto: friendlyDbError(error.message) })
    setLogoUrl(url)
    setMsg({ ok: true, texto: 'Logo atualizada.' })
    reloadBrand()
  }

  async function tirarLogo() {
    if (!companyId || !window.confirm('Tirar a logo? No lugar dela aparecem as iniciais do nome da empresa.')) return
    const { error } = await supabase.from('companies').update({ logo_url: null }).eq('id', companyId)
    if (error) return setMsg({ ok: false, texto: friendlyDbError(error.message) })
    setLogoUrl(null)
    reloadBrand()
  }

  if (semMigracao) {
    return <Card><p className="text-sm text-muted">Esta tela ainda não está ativada no banco de dados (falta rodar a migração 068_empresa_e_unidades.sql).</p></Card>
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card title="Dados da empresa" className="lg:col-span-2">
        {msg && <div className={`text-sm rounded-lg px-4 py-2.5 mb-3 ${msg.ok ? 'bg-teal-light text-teal' : 'bg-danger-light text-danger'}`}>{msg.texto}</div>}
        <form onSubmit={salvar} className="space-y-3">
          <div>
            <label className="block text-xs text-muted mb-1">Nome da empresa *</label>
            <input required value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
            <p className="text-[11px] text-muted mt-1">Aparece no menu, na tela de login e na aba do navegador.</p>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Frase da marca (opcional)</label>
            <input value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={80} placeholder="Ex: Aqui a diversão é garantida" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
            <p className="text-[11px] text-muted mt-1">Aparece embaixo do nome, na tela de login.</p>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">WhatsApp da equipe</label>
            <input value={whats} onChange={(e) => setWhats(e.target.value)} inputMode="tel" placeholder="(47) 99999-0000" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
            <p className="text-[11px] text-muted mt-1">Número que o cliente chama pelo portal da festa.</p>
          </div>
          <Button type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button>
        </form>
      </Card>
      <Card title="Logo">
        <div className="flex flex-col items-center gap-3">
          <BrandLogo className="w-28 h-28 rounded-full text-3xl shadow" />
          <p className="text-xs text-muted text-center">PNG, JPG ou WEBP, até 2 MB. Prefira uma imagem quadrada.</p>
          <label className="inline-flex items-center gap-1.5 text-sm font-medium text-purple cursor-pointer">
            <Upload className="w-4 h-4" /> {logoUrl ? 'Trocar logo' : 'Enviar logo'}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={saving} onChange={(e) => { enviarLogo(e.target.files?.[0]); e.target.value = '' }} />
          </label>
          {logoUrl && <button onClick={tirarLogo} className="text-xs text-muted hover:text-danger">Tirar logo</button>}
          {!logoUrl && brand.name && <p className="text-[11px] text-muted text-center">Sem logo, o sistema mostra as iniciais do nome.</p>}
        </div>
      </Card>
    </div>
  )
}

function UnidadesTab() {
  const { reloadUnits } = useUnit()
  const [rows, setRows] = useState<UnitRow[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<UnitForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const { data, error: err } = await supabase.from('units').select('*')
    setLoading(false)
    if (err) return setError('Não foi possível carregar as unidades.')
    setRows(((data ?? []) as any[]).filter((u) => u.active !== false).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.created_at).localeCompare(String(b.created_at))) as UnitRow[])
  }
  useEffect(() => { load() }, [])

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    if (!form.name.trim()) return setError('Informe o nome da unidade.')
    if (rows.some((r) => r.id !== form.id && r.name.trim().toLowerCase() === form.name.trim().toLowerCase())) return setError('Já existe uma unidade com esse nome.')
    if (!linkOk(form.google_review_link) || !linkOk(form.staff_whatsapp_group_link)) return setError('Os links precisam começar com https://')
    const hora = form.extra_hour_price.trim() ? parseDecimal(form.extra_hour_price) : null
    const sinal = form.default_deposit_percent.trim() ? parseDecimal(form.default_deposit_percent) : null
    if (form.extra_hour_price.trim() && (hora == null || hora < 0)) return setError('Valor da hora extra inválido.')
    if (form.default_deposit_percent.trim() && (sinal == null || sinal < 0 || sinal > 100)) return setError('O sinal precisa ser um percentual entre 0 e 100.')
    const nums: Partial<Record<PortalNum, number>> = {}
    for (const [k, rot, , min, max] of CAMPOS_PORTAL) {
      const n = Number.parseInt(form[k], 10)
      if (!Number.isFinite(n) || n < min || n > max || String(n) !== form[k].trim()) return setError(`"${rot}": use um número inteiro de ${min} a ${max}.`)
      nums[k] = n
    }
    const regras = (form.portal_rules ?? []).map((r) => ({ titulo: r.titulo.trim(), texto: r.texto.trim() })).filter((r) => r.titulo || r.texto)
    if (regras.some((r) => !r.titulo || !r.texto)) return setError('Cada regra do portal precisa de título e texto.')
    const t = (s: string) => s.trim() || null
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      color: /^#[0-9a-f]{6}$/i.test(form.color) ? form.color : null,
      sort: Number.parseInt(form.sort, 10) || 0,
      address: t(form.address),
      legal_name: t(form.legal_name),
      cnpj: t(form.cnpj),
      full_address: t(form.full_address),
      responsible_name: t(form.responsible_name),
      pix_key: t(form.pix_key),
      extra_hour_price: hora,
      default_deposit_percent: sinal,
      google_review_link: t(form.google_review_link),
      staff_whatsapp_group_link: t(form.staff_whatsapp_group_link),
      ...nums,
      playlist_enabled: form.playlist_enabled,
      ...(form.portal_rules ? { portal_rules: regras } : {}),
    }
    setSaving(true)
    const { error: err } = form.id
      ? await supabase.from('units').update(payload).eq('id', form.id)
      : await supabase.from('units').insert(payload)
    setSaving(false)
    if (err) return setError(/color|sort|code/.test(err.message) ? 'Falta rodar a migração 068_empresa_e_unidades.sql no banco.' : friendlyDbError(err.message))
    setError(null)
    setForm(null)
    await load()
    await reloadUnits()
  }

  const vazio = (s: string | null) => !s || !s.trim()
  return (
    <>
      <Card
        title="Unidades"
        action={<Button onClick={() => setForm(toForm(null, rows.length + 1))}><Plus className="w-4 h-4" /> Nova unidade</Button>}
      >
        {error && !form && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5 mb-3">{error}</div>}
        {loading ? (
          <p className="text-sm text-muted py-6 text-center">Carregando...</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((u) => {
              const faltando = [vazio(u.legal_name) && 'razão social', vazio(u.cnpj) && 'CNPJ', vazio(u.full_address) && 'endereço', vazio(u.pix_key) && 'Pix'].filter(Boolean)
              return (
                <li key={u.id} className="py-3 flex flex-wrap items-center gap-3">
                  <span className="w-4 h-4 rounded-full shrink-0" style={{ background: u.color ?? '#6D28D9' }} />
                  <div className="flex-1 min-w-[200px]">
                    <p className="font-medium text-sm">{u.name}</p>
                    <p className="text-xs text-muted">
                      {u.cnpj ? `CNPJ ${u.cnpj}` : 'Sem CNPJ'}{u.extra_hour_price != null ? ` · hora extra ${brl(Number(u.extra_hour_price))}` : ''}{u.default_deposit_percent != null ? ` · sinal ${String(u.default_deposit_percent).replace('.', ',')}%` : ''}
                    </p>
                    {faltando.length > 0 && <p className="text-xs text-amber mt-0.5">Falta preencher: {faltando.join(', ')}</p>}
                  </div>
                  <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={() => setForm(toForm(u, rows.length + 1))}>Editar</Button>
                </li>
              )
            })}
            {rows.length === 0 && <li className="py-6 text-center text-sm text-muted">Nenhuma unidade cadastrada.</li>}
          </ul>
        )}
      </Card>

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setForm(null)} />
          <div className="relative w-full max-w-2xl bg-surface rounded-card p-6 shadow-xl max-h-[90vh] overflow-y-auto overscroll-contain">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-display font-semibold">{form.id ? `Editar ${form.name || 'unidade'}` : 'Nova unidade'}</h2>
              <button onClick={() => setForm(null)} className="text-muted hover:text-ink" aria-label="Fechar"><X className="w-5 h-5" /></button>
            </div>
            {error && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5 mb-3">{error}</div>}
            <form onSubmit={salvar} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2 grid grid-cols-[1fr_auto_auto] gap-3 items-end">
                <div>
                  <label className="block text-xs text-muted mb-1">Nome da unidade *</label>
                  <input required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Cor</label>
                  <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="h-[38px] w-14 border border-line rounded-lg p-1 bg-surface" title="Cor da unidade nos gráficos" />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Ordem</label>
                  <input value={form.sort} onChange={(e) => setForm({ ...form, sort: e.target.value })} inputMode="numeric" className="w-16 border border-line rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              {CAMPOS_TEXTO.map((c) => (
                <div key={c.key} className={c.full ? 'sm:col-span-2' : ''}>
                  <label className="block text-xs text-muted mb-1">{c.label}</label>
                  <input value={form[c.key] as string} onChange={(e) => setForm({ ...form, [c.key]: e.target.value })} placeholder={c.placeholder} className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
                  {c.ajuda && <p className="text-[11px] text-muted mt-1">{c.ajuda}</p>}
                </div>
              ))}
              <div>
                <label className="block text-xs text-muted mb-1">Valor da hora extra (R$)</label>
                <input value={form.extra_hour_price} onChange={(e) => setForm({ ...form, extra_hour_price: e.target.value })} inputMode="decimal" placeholder="0,00" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Sinal padrão (%)</label>
                <input value={form.default_deposit_percent} onChange={(e) => setForm({ ...form, default_deposit_percent: e.target.value })} inputMode="decimal" placeholder="Ex: 30" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="sm:col-span-2 border-t border-line pt-4 mt-1">
                <p className="font-semibold text-sm">Portal do cliente</p>
                <p className="text-xs text-muted">Regras que o cliente vê no portal da festa desta unidade.</p>
              </div>
              {CAMPOS_PORTAL.map(([k, rot, ajuda]) => (
                <div key={k}>
                  <label className="block text-xs text-muted mb-1">{rot}</label>
                  <input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} inputMode="numeric" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
                  {ajuda && <p className="text-[11px] text-muted mt-1">{ajuda}</p>}
                </div>
              ))}
              <label className="sm:col-span-2 flex items-start gap-2 text-sm bg-paper rounded-lg px-3 py-2.5 cursor-pointer">
                <input type="checkbox" checked={form.playlist_enabled} onChange={(e) => setForm({ ...form, playlist_enabled: e.target.checked })} className="mt-0.5" />
                <span>
                  Cliente pode enviar playlist do Spotify
                  <span className="block text-xs text-muted">Mostra a opção "Música da festa" no portal: equipe escolhe ou o cliente envia a playlist.</span>
                </span>
              </label>
              <div className="sm:col-span-2 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted">Regras da casa — use {'{{convidados}}'} e {'{{idade}}'} para o limite da festa e a idade acima.</p>
                </div>
                {form.portal_rules === null ? (
                  <p className="text-xs text-muted bg-paper rounded-lg px-3 py-2">A unidade nova recebe as regras padrão ao salvar. Depois é só editar aqui.</p>
                ) : (
                  <>
                    {form.portal_rules.map((r, i) => {
                      const regras = form.portal_rules as Regra[]
                      const mudar = (nova: Regra[]) => setForm({ ...form, portal_rules: nova })
                      return (
                        <div key={i} className="border border-line rounded-lg p-2.5 space-y-1.5">
                          <div className="flex gap-2">
                            <input value={r.titulo} onChange={(e) => mudar(regras.map((x, j) => (j === i ? { ...x, titulo: e.target.value } : x)))} placeholder="Título" className="flex-1 min-w-0 border border-line rounded-lg px-2.5 py-1.5 text-sm font-medium" />
                            <button type="button" disabled={i === 0} onClick={() => mudar(regras.map((x, j) => (j === i - 1 ? regras[i] : j === i ? regras[i - 1] : x)))} className="text-muted hover:text-ink disabled:opacity-30" aria-label="Subir"><ArrowUp className="w-4 h-4" /></button>
                            <button type="button" disabled={i === regras.length - 1} onClick={() => mudar(regras.map((x, j) => (j === i + 1 ? regras[i] : j === i ? regras[i + 1] : x)))} className="text-muted hover:text-ink disabled:opacity-30" aria-label="Descer"><ArrowDown className="w-4 h-4" /></button>
                            <button type="button" onClick={() => mudar(regras.filter((_, j) => j !== i))} className="text-muted hover:text-danger" aria-label="Apagar regra"><Trash2 className="w-4 h-4" /></button>
                          </div>
                          <textarea value={r.texto} onChange={(e) => mudar(regras.map((x, j) => (j === i ? { ...x, texto: e.target.value } : x)))} rows={2} placeholder="Texto da regra" className="w-full border border-line rounded-lg px-2.5 py-1.5 text-sm" />
                        </div>
                      )
                    })}
                    <button type="button" onClick={() => setForm({ ...form, portal_rules: [...(form.portal_rules ?? []), { titulo: '', texto: '' }] })} className="text-sm text-purple font-medium flex items-center gap-1">
                      <Plus className="w-4 h-4" /> Adicionar regra
                    </button>
                  </>
                )}
              </div>
              <div className="sm:col-span-2">
                {!form.id && <p className="text-xs text-muted mb-2">A unidade nova já aparece no seletor de unidade, nos filtros e nos gráficos. Depois cadastre os pacotes e o contrato-base dela.</p>}
                <Button type="submit" className="w-full justify-center" disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
