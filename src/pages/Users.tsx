import { FormEvent, useEffect, useState } from 'react'
import { Plus, X, Trash2, ShieldAlert, UserPlus, KeyRound, Copy, SlidersHorizontal, RotateCcw } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import { useOpenOnQueryParam } from '../lib/useOpenOnQueryParam'
import { useUndo } from '../lib/UndoContext'
import { PERMISSION_GROUPS, ALL_PERMISSIONS } from '../lib/permissionRegistry'
import type { Role } from '../types'

interface UserRow {
  id: string
  name: string
  email: string | null
  roleId: string | null
  active: boolean
}

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let result = ''
  for (let i = 0; i < 10; i++) result += chars[Math.floor(Math.random() * chars.length)]
  return result
}

export function Users() {
  const { session } = useAuth()
  const { scheduleDelete } = useUndo()
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  useOpenOnQueryParam('novo', () => setShowForm(true))

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [formRoleId, setFormRoleId] = useState('')
  const [creating, setCreating] = useState(false)
  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; password: string } | null>(null)
  const [customizeOnCreate, setCustomizeOnCreate] = useState(false)
  const [createOverrides, setCreateOverrides] = useState<Record<string, boolean>>({})

  const [myName, setMyName] = useState('')

  const [roles, setRoles] = useState<Role[]>([])
  const [rolesLoading, setRolesLoading] = useState(true)
  const [rolePermItems, setRolePermItems] = useState<Record<string, Record<string, boolean>>>({})
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null)
  const [showCreateRoleModal, setShowCreateRoleModal] = useState(false)
  const [createRoleName, setCreateRoleName] = useState('')
  const [createRolePermValues, setCreateRolePermValues] = useState<Record<string, boolean>>({})
  const [creatingRole, setCreatingRole] = useState(false)

  const [overrideUser, setOverrideUser] = useState<UserRow | null>(null)
  const [overrideValues, setOverrideValues] = useState<Record<string, boolean>>({})
  const [overrideKeys, setOverrideKeys] = useState<Set<string>>(new Set())
  const [overrideLoading, setOverrideLoading] = useState(false)

  useEffect(() => {
    loadUsers()
    loadRoles()
  }, [])

  async function loadRoles() {
    setRolesLoading(true)
    const [{ data: rolesData, error: rolesError }, { data: itemsData }] = await Promise.all([
      supabase.from('roles').select('id, name, is_admin').order('name'),
      supabase.from('role_permission_items').select('role_id, permission_key, allowed'),
    ])
    if (rolesError) {
      setError('Não foi possível carregar os perfis.')
      setRolesLoading(false)
      return
    }
    const items: Record<string, Record<string, boolean>> = {}
    for (const row of itemsData ?? []) {
      if (!items[row.role_id]) items[row.role_id] = {}
      items[row.role_id][row.permission_key] = row.allowed
    }
    const mapped = (rolesData ?? []).map((r) => ({ id: r.id, name: r.name, isAdmin: r.is_admin }))
    setRoles(mapped)
    setRolePermItems(items)
    setRolesLoading(false)
  }

  function openCreateRoleModal() {
    setCreateRoleName('')
    setCreateRolePermValues({})
    setShowCreateRoleModal(true)
  }

  async function handleCreateRoleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!createRoleName.trim()) return
    setCreatingRole(true)
    const { data, error } = await supabase.from('roles').insert({ name: createRoleName.trim(), is_admin: false }).select().single()
    if (error) {
      setCreatingRole(false)
      setError('Não foi possível criar o perfil — talvez já exista um com esse nome.')
      return
    }
    const created = { id: data.id, name: data.name, isAdmin: data.is_admin }
    // Grava TODAS as permissões de forma explícita (liberado e negado), não só
    // as negadas — o banco agora nega por padrão quem não tem linha nenhuma
    // (fail-closed), então um perfil novo sem nada gravado ficaria travado.
    const allItems = ALL_PERMISSIONS.map((item) => ({
      role_id: created.id,
      permission_key: item.key,
      allowed: createRolePermValues[item.key] ?? true,
    }))
    await supabase.from('role_permission_items').insert(allItems)
    const restricted = allItems.filter((item) => !item.allowed)
    setCreatingRole(false)
    setRoles((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
    setRolePermItems((prev) => ({ ...prev, [created.id]: Object.fromEntries(restricted.map((item) => [item.permission_key, false])) }))
    setShowCreateRoleModal(false)
    setCreateRoleName('')
    setCreateRolePermValues({})
  }

  function handleDeleteRole(id: string) {
    const role = roles.find((r) => r.id === id)
    if (!role) return
    const affectedUserIds = users.filter((u) => u.roleId === id).map((u) => u.id)
    setRoles((prev) => prev.filter((r) => r.id !== id))
    setUsers((prev) => prev.map((u) => (u.roleId === id ? { ...u, roleId: null } : u)))
    setEditingRoleId(null)
    scheduleDelete({
      label: `Perfil "${role.name}" removido`,
      commit: async () => {
        await supabase.from('roles').delete().eq('id', id)
      },
      undo: async () => {
        await supabase.from('roles').insert({ id, name: role.name, is_admin: role.isAdmin })
        if (affectedUserIds.length > 0) {
          await supabase.from('user_profiles').update({ role_id: id }).in('id', affectedUserIds)
        }
        setRoles((prev) => [...prev, role].sort((a, b) => a.name.localeCompare(b.name)))
        setUsers((prev) => prev.map((u) => (affectedUserIds.includes(u.id) ? { ...u, roleId: id } : u)))
      },
    })
  }

  function roleSummary(role: Role) {
    if (role.isAdmin) return 'Acesso total ao sistema'
    const map = rolePermItems[role.id] ?? {}
    const allowedCount = ALL_PERMISSIONS.filter((item) => map[item.key] ?? true).length
    return `${allowedCount} de ${ALL_PERMISSIONS.length} acessos liberados`
  }

  async function toggleRolePermission(roleId: string, key: string, current: boolean) {
    const next = !current
    setRolePermItems((prev) => ({ ...prev, [roleId]: { ...prev[roleId], [key]: next } }))
    const { error } = await supabase
      .from('role_permission_items')
      .upsert({ role_id: roleId, permission_key: key, allowed: next }, { onConflict: 'role_id,permission_key' })
    if (error) {
      setRolePermItems((prev) => ({ ...prev, [roleId]: { ...prev[roleId], [key]: current } }))
      setError('Não foi possível salvar essa permissão.')
    }
  }

  async function loadUsers() {
    setLoading(true)
    const { data, error } = await supabase.from('user_profiles').select('*').order('name')
    if (error) setError('Não foi possível carregar os usuários.')
    setUsers((data ?? []).map((u) => ({ id: u.id, name: u.name, email: u.email, roleId: u.role_id, active: u.active })))
    setLoading(false)
  }

  const myProfile = users.find((u) => u.id === session?.user.id)
  const adminRole = roles.find((r) => r.isAdmin)

  async function handleCreateMyProfile(e: FormEvent) {
    e.preventDefault()
    if (!session || !myName.trim() || !adminRole) return
    const { data, error } = await supabase
      .from('user_profiles')
      .insert({ id: session.user.id, name: myName.trim(), email: session.user.email, role_id: adminRole.id, active: true })
      .select()
      .single()
    if (error) {
      setError('Não foi possível criar seu perfil.')
      return
    }
    setUsers((prev) => [...prev, { id: data.id, name: data.name, email: data.email, roleId: data.role_id, active: data.active }])
    setMyName('')
  }

  function initCreateOverrides(roleId: string) {
    const roleMap = rolePermItems[roleId] ?? {}
    const initial: Record<string, boolean> = {}
    for (const item of ALL_PERMISSIONS) initial[item.key] = roleMap[item.key] ?? true
    setCreateOverrides(initial)
  }

  function handleFormRoleChange(roleId: string) {
    setFormRoleId(roleId)
    if (customizeOnCreate) initCreateOverrides(roleId)
  }

  function handleToggleCustomizeOnCreate(checked: boolean) {
    setCustomizeOnCreate(checked)
    if (checked && formRoleId) initCreateOverrides(formRoleId)
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || !email.trim() || !password || !formRoleId) return
    setCreating(true)
    setError(null)
    const { data, error } = await supabase.functions.invoke('create-employee', {
      body: { name: name.trim(), email: email.trim(), password, role_id: formRoleId },
    })
    setCreating(false)

    if (error) {
      let message = `Não foi possível criar o funcionário. ${error.message ?? ''}`.trim()
      const context = (error as any)?.context
      if (context && typeof context.text === 'function') {
        try {
          const raw = await context.text()
          try {
            const body = JSON.parse(raw)
            message = body?.error ?? body?.message ?? raw ?? message
          } catch {
            if (raw) message = raw
          }
          if (context.status) message = `Erro ${context.status}: ${message}`
        } catch {
          // não deu pra ler o corpo do erro — mantém a mensagem do error.message
        }
      } else {
        message =
          'Não foi possível conectar na função "create-employee" (falha de rede, não um erro dela). Confira se ela foi publicada com o nome exato e se a opção "Enforce JWT verification" está desativada nela.'
      }
      setError(message)
      return
    }

    if (data?.error) {
      setError(data.error)
      return
    }

    if (customizeOnCreate) {
      const roleMap = rolePermItems[formRoleId] ?? {}
      const diffs = ALL_PERMISSIONS.filter((item) => (createOverrides[item.key] ?? true) !== (roleMap[item.key] ?? true))
      if (diffs.length > 0) {
        const results = await Promise.all(
          diffs.map((item) =>
            supabase
              .from('user_permission_overrides')
              .upsert({ user_id: data.id, permission_key: item.key, allowed: createOverrides[item.key] }, { onConflict: 'user_id,permission_key' }),
          ),
        )
        if (results.some((r) => r.error)) {
          setError('O funcionário foi criado, mas alguns ajustes de acesso personalizados não foram salvos — confira em "Ajustes individuais" dele.')
        }
      }
    }

    setUsers((prev) => [...prev, { id: data.id, name: name.trim(), email: email.trim(), roleId: formRoleId, active: true }])
    setCreatedCredentials({ email: email.trim(), password })
    setName('')
    setEmail('')
    setPassword('')
    setFormRoleId('')
    setCustomizeOnCreate(false)
    setCreateOverrides({})
    setShowForm(false)
  }

  async function updateUserRole(id: string, newRoleId: string) {
    setUsers((prev) => prev.map((x) => (x.id === id ? { ...x, roleId: newRoleId } : x)))
    await supabase.from('user_profiles').update({ role_id: newRoleId }).eq('id', id)
  }

  async function toggleActive(id: string, current: boolean) {
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, active: !current } : u)))
    await supabase.from('user_profiles').update({ active: !current }).eq('id', id)
  }

  function handleRemove(id: string) {
    const user = users.find((u) => u.id === id)
    if (!user) return
    setUsers((prev) => prev.filter((u) => u.id !== id))
    scheduleDelete({
      label: `"${user.name}" removido`,
      commit: async () => {
        await supabase.from('user_profiles').delete().eq('id', id)
      },
      undo: async () => {
        await supabase.from('user_profiles').insert({ id, name: user.name, email: user.email, role_id: user.roleId, active: user.active })
        setUsers((prev) => [...prev, user])
      },
    })
  }

  function isAdminUser(u: UserRow) {
    return !!u.roleId && roles.find((r) => r.id === u.roleId)?.isAdmin
  }

  async function openOverrides(u: UserRow) {
    setOverrideUser(u)
    setOverrideLoading(true)
    const { data } = await supabase.from('user_permission_overrides').select('permission_key, allowed').eq('user_id', u.id)
    const overrides: Record<string, boolean> = {}
    for (const row of data ?? []) overrides[row.permission_key] = row.allowed
    const roleMap = u.roleId ? rolePermItems[u.roleId] ?? {} : {}
    const effective: Record<string, boolean> = {}
    for (const item of ALL_PERMISSIONS) effective[item.key] = overrides[item.key] ?? roleMap[item.key] ?? true
    setOverrideValues(effective)
    setOverrideKeys(new Set(Object.keys(overrides)))
    setOverrideLoading(false)
  }

  async function toggleOverride(key: string, current: boolean) {
    if (!overrideUser) return
    const next = !current
    setOverrideValues((prev) => ({ ...prev, [key]: next }))
    setOverrideKeys((prev) => new Set(prev).add(key))
    const { error } = await supabase
      .from('user_permission_overrides')
      .upsert({ user_id: overrideUser.id, permission_key: key, allowed: next }, { onConflict: 'user_id,permission_key' })
    if (error) {
      setOverrideValues((prev) => ({ ...prev, [key]: current }))
      setError('Não foi possível salvar esse ajuste.')
    }
  }

  async function resetOverride(key: string) {
    if (!overrideUser) return
    const roleMap = overrideUser.roleId ? rolePermItems[overrideUser.roleId] ?? {} : {}
    const fallback = roleMap[key] ?? true
    setOverrideValues((prev) => ({ ...prev, [key]: fallback }))
    setOverrideKeys((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
    await supabase.from('user_permission_overrides').delete().eq('user_id', overrideUser.id).eq('permission_key', key)
  }

  const editingRole = roles.find((r) => r.id === editingRoleId) ?? null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Usuários e permissões</h1>
          <p className="text-sm text-muted mt-1">Quem tem acesso ao sistema e o que cada perfil pode fazer</p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4" /> Adicionar funcionário
        </Button>
      </div>

      {error && <div className="bg-danger-light text-danger text-sm rounded-lg px-4 py-2.5">{error}</div>}

      {!loading && session && !myProfile && (
        <Card className="border-purple/30 bg-purple-light">
          <div className="flex gap-3">
            <UserPlus className="w-5 h-5 text-purple-dark shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-purple-dark font-medium mb-2">Você ainda não tem um perfil nesta lista.</p>
              <form onSubmit={handleCreateMyProfile} className="flex flex-wrap gap-2">
                <input
                  type="text"
                  required
                  value={myName}
                  onChange={(e) => setMyName(e.target.value)}
                  placeholder="Seu nome"
                  className="border border-line rounded-lg px-3 py-2 text-sm flex-1 min-w-[160px]"
                />
                <Button type="submit" className="text-xs px-3 py-2" disabled={!adminRole}>Criar meu perfil (Administrador)</Button>
              </form>
            </div>
          </div>
        </Card>
      )}

      {createdCredentials && (
        <Card className="border-teal/30 bg-teal-light">
          <div className="flex gap-3">
            <KeyRound className="w-5 h-5 text-teal shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-ink/80 font-medium mb-2">
                Funcionário criado! Passe esse login para a pessoa (essa senha só aparece aqui uma vez):
              </p>
              <div className="flex flex-wrap items-center gap-2 text-sm bg-surface rounded-lg px-3 py-2 border border-line">
                <span><strong>Email:</strong> {createdCredentials.email}</span>
                <span className="text-line">•</span>
                <span><strong>Senha:</strong> {createdCredentials.password}</span>
                <button
                  onClick={() => navigator.clipboard.writeText(`Email: ${createdCredentials.email}\nSenha: ${createdCredentials.password}`)}
                  className="text-muted hover:text-purple ml-auto"
                  aria-label="Copiar credenciais"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
              <button onClick={() => setCreatedCredentials(null)} className="text-xs text-muted mt-2">Ok, já anotei</button>
            </div>
          </div>
        </Card>
      )}

      <Card className="bg-amber-light border-amber/30">
        <div className="flex gap-3">
          <ShieldAlert className="w-5 h-5 text-amber shrink-0 mt-0.5" />
          <p className="text-sm text-ink/80">
            "Adicionar funcionário" já cria o login e o perfil junto, num passo só — só funciona depois que a função
            "create-employee" for publicada no Supabase (peça pro Claude te guiar nisso se ainda não fez). Exceção: a
            pessoinha do <strong>primeiríssimo administrador</strong> do sistema precisa ser criada manualmente no
            Supabase, em <strong>Authentication &gt; Users</strong> — depois disso, use o quadro acima para "Criar meu
            perfil" e todo o resto pode ser cadastrado por aqui.
          </p>
        </div>
      </Card>

      <Card title="Perfis de acesso">
        {loading ? (
          <p className="text-sm text-muted py-4 text-center">Carregando...</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="pb-3 font-medium">Nome</th>
                <th className="pb-3 font-medium">Email</th>
                <th className="pb-3 font-medium">Perfil</th>
                <th className="pb-3 font-medium">Status</th>
                <th className="pb-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="py-3 font-medium">{u.name}</td>
                  <td className="py-3 text-muted">{u.email ?? '—'}</td>
                  <td className="py-3">
                    <select
                      value={u.roleId ?? ''}
                      onChange={(e) => updateUserRole(u.id, e.target.value)}
                      className="border border-line rounded-lg px-2 py-1 text-xs"
                    >
                      <option value="" disabled>Sem perfil</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-3">
                    <button onClick={() => toggleActive(u.id, u.active)}>
                      <Badge tone={u.active ? 'teal' : 'neutral'}>{u.active ? 'Ativo' : 'Inativo'}</Badge>
                    </button>
                  </td>
                  <td className="py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {!isAdminUser(u) && (
                        <button onClick={() => openOverrides(u)} className="text-muted hover:text-purple" aria-label="Ajustes individuais">
                          <SlidersHorizontal className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button onClick={() => handleRemove(u.id)} className="text-muted hover:text-danger" aria-label="Remover">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={5} className="py-6 text-center text-muted">Nenhum perfil cadastrado ainda.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </Card>

      <Card
        title="Perfis e o que cada um pode fazer"
        action={
          <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={openCreateRoleModal}>
            <Plus className="w-3.5 h-3.5" /> Criar perfil
          </Button>
        }
      >
        <p className="text-sm text-muted mb-4">
          Cada perfil abaixo tem um resumo de quanto ele libera — clique em "Editar" pra ver e mudar as permissões
          dele. Se uma pessoa específica precisar de menos acesso que o resto do perfil dela, use o botão{' '}
          <SlidersHorizontal className="w-3 h-3 inline" /> dela na tabela acima, em vez de mudar o perfil inteiro.
        </p>

        {rolesLoading ? (
          <p className="text-sm text-muted py-4 text-center">Carregando...</p>
        ) : roles.length === 0 ? (
          <p className="text-sm text-muted">Nenhum perfil cadastrado ainda — clique em "Criar perfil" acima.</p>
        ) : (
          <div className="space-y-2">
            {roles.map((r) => (
              <div key={r.id} className="flex items-center justify-between border border-line rounded-lg px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{r.name}</p>
                  <p className="text-xs text-muted mt-0.5">{roleSummary(r)}</p>
                </div>
                {!r.isAdmin && (
                  <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={() => setEditingRoleId(r.id)}>
                    Editar
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-muted mt-3">
          Se tentar abrir uma página que o perfil não pode pelo link direto, o sistema manda de volta pro Painel.
          Desativar alguém na tabela acima (botão "Inativo") também tira o acesso da pessoa — vale a partir da
          próxima vez que ela abrir ou recarregar o sistema.
        </p>
      </Card>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setShowForm(false)} />
          <div className="relative w-full max-w-md bg-surface rounded-card p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-display font-semibold">Adicionar funcionário</h2>
              <button onClick={() => setShowForm(false)} className="text-muted hover:text-ink">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAdd} className="space-y-3">
              <div>
                <label className="block text-xs text-muted mb-1">Nome</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                  placeholder="Nome do funcionário"
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                  placeholder="email@bravaparkfest.com"
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Senha provisória</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="flex-1 border border-line rounded-lg px-3 py-2 text-sm"
                    placeholder="Mínimo 6 caracteres"
                  />
                  <Button type="button" variant="secondary" className="text-xs px-3" onClick={() => setPassword(generatePassword())}>
                    Gerar
                  </Button>
                </div>
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Perfil</label>
                <select required value={formRoleId} onChange={(e) => handleFormRoleChange(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm">
                  <option value="" disabled>Escolha um perfil...</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
                <p className="text-xs text-muted mt-1">
                  Define o básico que a pessoa vai ter — dá pra ajustar individualmente depois, na tabela acima.
                </p>
              </div>

              {formRoleId && roles.find((r) => r.id === formRoleId)?.isAdmin !== true && (
                <div className="border-t border-line pt-3">
                  <label className="flex items-center gap-2.5 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={customizeOnCreate}
                      onChange={(e) => handleToggleCustomizeOnCreate(e.target.checked)}
                    />
                    Personalizar os acessos desta pessoa (além do perfil)
                  </label>
                  {customizeOnCreate && (
                    <div className="space-y-3 max-h-[280px] overflow-y-auto pr-1 mt-3">
                      {PERMISSION_GROUPS.map((group) => (
                        <div key={group.group} className="border border-line rounded-lg p-3">
                          <p className="text-xs font-semibold text-ink/70 mb-2">{group.group}</p>
                          <div className="space-y-1.5">
                            {group.items.map((item) => {
                              const checked = createOverrides[item.key] ?? true
                              return (
                                <label key={item.key} className="flex items-center gap-2.5 text-sm cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => setCreateOverrides((prev) => ({ ...prev, [item.key]: !checked }))}
                                  />
                                  {item.label}
                                </label>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <Button type="submit" className="w-full justify-center mt-2" disabled={creating}>
                {creating ? 'Criando...' : 'Criar funcionário'}
              </Button>
            </form>
          </div>
        </div>
      )}

      {overrideUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOverrideUser(null)} />
          <div className="relative w-full max-w-lg bg-surface rounded-card p-6 shadow-xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-display font-semibold">Ajustes individuais — {overrideUser.name}</h2>
              <button onClick={() => setOverrideUser(null)} className="text-muted hover:text-ink">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-muted mb-4">
              Já vem marcado com o básico do perfil <strong>{roles.find((r) => r.id === overrideUser.roleId)?.name ?? '—'}</strong>.
              Mude só o que for diferente pra essa pessoa especificamente — o resto continua seguindo o perfil, mesmo
              se você editar o perfil depois. O perfil dela continua sendo o mesmo, só os acessos individuais mudam.
            </p>
            {overrideLoading ? (
              <p className="text-sm text-muted py-4 text-center">Carregando...</p>
            ) : (
              <div className="space-y-4">
                {PERMISSION_GROUPS.map((group) => (
                  <div key={group.group} className="border border-line rounded-lg p-3">
                    <p className="text-xs font-semibold text-ink/70 mb-2">{group.group}</p>
                    <div className="space-y-1.5">
                      {group.items.map((item) => {
                        const checked = overrideValues[item.key] ?? true
                        const isCustom = overrideKeys.has(item.key)
                        return (
                          <label key={item.key} className="flex items-center gap-2.5 text-sm cursor-pointer">
                            <input type="checkbox" checked={checked} onChange={() => toggleOverride(item.key, checked)} />
                            <span className="flex-1">{item.label}</span>
                            {isCustom && (
                              <button
                                type="button"
                                onClick={() => resetOverride(item.key)}
                                className="text-xs text-purple flex items-center gap-1"
                                title="Voltar a seguir o perfil"
                              >
                                <RotateCcw className="w-3 h-3" /> personalizado
                              </button>
                            )}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showCreateRoleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setShowCreateRoleModal(false)} />
          <div className="relative w-full max-w-lg bg-surface rounded-card p-6 shadow-xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-display font-semibold">Criar perfil</h2>
              <button onClick={() => setShowCreateRoleModal(false)} className="text-muted hover:text-ink">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateRoleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs text-muted mb-1">Nome do perfil</label>
                <input
                  type="text"
                  required
                  value={createRoleName}
                  onChange={(e) => setCreateRoleName(e.target.value)}
                  placeholder="Ex: Recepção"
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <p className="text-xs text-muted mb-2">
                  Escolha o que esse perfil pode ver e fazer (começa tudo marcado — desmarque o que quiser tirar):
                </p>
                <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                  {PERMISSION_GROUPS.map((group) => (
                    <div key={group.group} className="border border-line rounded-lg p-3">
                      <p className="text-xs font-semibold text-ink/70 mb-2">{group.group}</p>
                      <div className="space-y-1.5">
                        {group.items.map((item) => {
                          const checked = createRolePermValues[item.key] ?? true
                          return (
                            <label key={item.key} className="flex items-center gap-2.5 text-sm cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => setCreateRolePermValues((prev) => ({ ...prev, [item.key]: !checked }))}
                              />
                              {item.label}
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <Button type="submit" className="w-full justify-center" disabled={creatingRole}>
                {creatingRole ? 'Criando...' : 'Criar perfil'}
              </Button>
            </form>
          </div>
        </div>
      )}

      {editingRole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setEditingRoleId(null)} />
          <div className="relative w-full max-w-lg bg-surface rounded-card p-6 shadow-xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-display font-semibold">Editar perfil — {editingRole.name}</h2>
              <button onClick={() => setEditingRoleId(null)} className="text-muted hover:text-ink">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-muted">Marque o que esse perfil pode ver e fazer.</p>
              <button onClick={() => handleDeleteRole(editingRole.id)} className="text-xs text-danger flex items-center gap-1 shrink-0">
                <Trash2 className="w-3.5 h-3.5" /> Excluir este perfil
              </button>
            </div>
            <div className="space-y-4">
              {PERMISSION_GROUPS.map((group) => (
                <div key={group.group} className="border border-line rounded-lg p-3">
                  <p className="text-xs font-semibold text-ink/70 mb-2">{group.group}</p>
                  <div className="space-y-1.5">
                    {group.items.map((item) => {
                      const checked = rolePermItems[editingRole.id]?.[item.key] ?? true
                      return (
                        <label key={item.key} className="flex items-center gap-2.5 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleRolePermission(editingRole.id, item.key, checked)}
                          />
                          {item.label}
                        </label>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
