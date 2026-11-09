import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, LogIn, AlertTriangle, Building2 } from 'lucide-react'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { brl } from '../../lib/format'
import type { PainelDados } from './platformApi'
import { situacaoMensalidade } from './CompanyBilling'
import { dataBr, diasSemUso, emTeste, progressoImplantacao, SEM_USO_ALERTA, type Empresa } from './platformTypes'

// Casas (clientes): todas as casas de festa que usam o Festou. Clicar na
// linha abre a ficha da casa.

type Filtro = 'todas' | 'em_dia' | 'atrasadas' | 'teste' | 'sem_uso' | 'suspensas'

export function PlatCasas({ d }: { d: PainelDados }) {
  const navigate = useNavigate()
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const M = d.mensalidades

  const semUso = (c: Empresa) => { const x = diasSemUso(c.ultima_atividade); return c.active && (x === null || x >= SEM_USO_ALERTA) }
  const passa = (c: Empresa) => {
    if (busca.trim() && !c.name.toLowerCase().includes(busca.trim().toLowerCase())) return false
    const m = M[c.id]
    switch (filtro) {
      case 'em_dia': return c.active && m?.cadastrada && m.situacao !== 'atrasada' && emTeste(m) === null
      case 'atrasadas': return m?.situacao === 'atrasada'
      case 'teste': return c.active && emTeste(m) !== null
      case 'sem_uso': return semUso(c)
      case 'suspensas': return !c.active
      default: return true
    }
  }
  const lista = d.empresas.filter(passa)
  const filtros: [Filtro, string][] = [['todas', 'Todas'], ['em_dia', 'Em dia'], ['atrasadas', 'Atrasadas'], ['teste', 'Em teste'], ['sem_uso', 'Sem uso'], ['suspensas', 'Suspensas']]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Casas (clientes)</h1>
          <p className="text-sm text-muted mt-1">Todas as casas de festa que usam o Festou. Clique numa linha para abrir a ficha completa.</p>
        </div>
        <Button onClick={() => d.novaCasa()}><Plus className="w-4 h-4" /> Nova casa</Button>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pelo nome" aria-label="Buscar casa"
            className="border border-line rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px] max-w-xs" />
          <div className="inline-flex flex-wrap rounded-lg border border-line bg-surface p-0.5 gap-0.5" role="group" aria-label="Filtrar casas">
            {filtros.map(([k, l]) => (
              <button key={k} type="button" aria-pressed={filtro === k} onClick={() => setFiltro(k)}
                className={`px-3 h-8 rounded-md text-xs font-medium ${filtro === k ? 'bg-purple text-white' : 'text-ink/70 hover:bg-paper'}`}>{l}</button>
            ))}
          </div>
        </div>

        {d.carregando ? (
          <p className="text-sm text-muted py-6 text-center">Carregando...</p>
        ) : lista.length === 0 ? (
          <p className="text-sm text-muted py-6 text-center">{d.empresas.length === 0 ? 'Nenhuma casa ainda.' : 'Nenhuma casa com esse filtro.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="pb-3 font-medium">Casa</th>
                  <th className="pb-3 font-medium">Plano</th>
                  <th className="pb-3 font-medium">Situação</th>
                  <th className="pb-3 font-medium">Usuários</th>
                  <th className="pb-3 font-medium">Unidades</th>
                  <th className="pb-3 pr-4 font-medium text-right">Festas 30 dias</th>
                  <th className="pb-3 font-medium">Implantação</th>
                  <th className="pb-3 font-medium">Último uso</th>
                  <th className="pb-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {lista.map((c) => {
                  const m = M[c.id]
                  const plano = d.planos.find((p) => p.id === d.planosDaCasa[c.id]?.plano_id)
                  const s = situacaoMensalidade(m)
                  const pr = progressoImplantacao(d.implantacao[c.id])
                  const dias = diasSemUso(c.ultima_atividade)
                  return (
                    <tr key={c.id} className="cursor-pointer hover:bg-paper/70" onClick={() => navigate(`/plataforma/casas/${c.id}`)}>
                      <td className="py-3 pr-2">
                        <span className="flex items-center gap-1.5 font-medium"><Building2 className="w-3.5 h-3.5 text-muted shrink-0" /> {c.name}</span>
                        <span className="block text-[11px] text-muted">desde {dataBr(c.created_at)}</span>
                      </td>
                      <td className="py-3 pr-2">
                        {plano ? plano.nome : m?.plano || <span className="text-muted">—</span>}
                        {m?.cadastrada && Number(m.mensalidade) > 0 && <span className="block text-[11px] text-muted">{brl(Number(m.mensalidade))}</span>}
                      </td>
                      <td className="py-3 pr-2">{!c.active ? <Badge tone="danger">Suspensa</Badge> : <Badge tone={s.tom}>{s.texto}</Badge>}</td>
                      <td className="py-3 pr-2">{m?.cadastrada ? <Medidor n={c.usuarios} limite={m.usuarios_incluidos ?? null} alertaNoLimite /> : <span className="tabular-nums">{c.usuarios}</span>}</td>
                      <td className="py-3 pr-2">{m?.cadastrada ? <Medidor n={c.unidades} limite={m.unidades_incluidas ?? null} /> : <span className="tabular-nums">{c.unidades}</span>}</td>
                      <td className="py-3 pr-4 text-right tabular-nums">{c.festas_30d}</td>
                      <td className="py-3 pr-2">{pr ? <Medidor n={pr.feitos} limite={pr.total} completo /> : <span className="text-muted">—</span>}</td>
                      <td className="py-3 pr-2">
                        <span className={`flex items-center gap-1 whitespace-nowrap ${semUso(c) ? 'text-amber font-medium' : 'text-muted'}`}>
                          {semUso(c) && <AlertTriangle className="w-3.5 h-3.5" />}
                          {dias === null ? 'nunca usou' : dias === 0 ? 'hoje' : dias === 1 ? 'ontem' : `há ${dias} dias`}
                        </span>
                      </td>
                      <td className="py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <Button className="text-xs px-3 py-1.5" disabled={d.abrindo !== null} onClick={() => d.abrirEmpresa(c.id)}>
                          <LogIn className="w-3.5 h-3.5" /> {d.abrindo === c.id ? 'Abrindo...' : 'Abrir'}
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

// Barrinha "usado / limite". No limite: laranja (usuários) ou verde (implantação completa).
export function Medidor({ n, limite, alertaNoLimite = false, completo = false }: { n: number; limite: number | null; alertaNoLimite?: boolean; completo?: boolean }) {
  const cheio = limite !== null && n >= limite
  const pct = limite === null ? 30 : Math.min(100, Math.round((n / Math.max(limite, 1)) * 100))
  const cor = cheio && alertaNoLimite ? 'bg-amber' : cheio && completo ? 'bg-teal' : 'bg-purple'
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap tabular-nums">
      <span className="w-14 h-2 rounded-full bg-purple-light overflow-hidden"><span className={`block h-full rounded-full ${cor}`} style={{ width: `${pct}%` }} /></span>
      <span className={cheio && alertaNoLimite ? 'text-amber font-medium' : ''}>{n}/{limite === null ? '∞' : limite}</span>
    </span>
  )
}
