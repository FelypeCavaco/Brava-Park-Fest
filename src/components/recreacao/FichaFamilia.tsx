import { useEffect, useState } from 'react'
import { X, MessageCircle, Baby, ShieldCheck, History, Phone, Mail, CreditCard } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { brl, friendlyDbError } from '../../lib/format'
import { fmtMin, horaMin, idadeTexto, linkWhatsApp, mascaraCpf, mascaraTelefone, type FamiliaRec } from '../../lib/recreacao'

// Ficha completa de uma família, aberta ao clicar num nome nos relatórios:
// cadastro, crianças, quem pode buscar e o histórico de visitas.

interface Ficha {
  familia: FamiliaRec & { criado_em?: string; criado_por?: string | null; origem?: string }
  resumo: { visitas: number; dias: number; gasto: number; tempo_medio_min: number; primeira: string | null; ultima: string | null; dentro_agora: number; cancelamentos: number }
  ocorrencias: number
  visitas: { id: string; crianca: string; entrada_em: string; saida_em: string | null; status: 'dentro' | 'saiu' | 'cancelada'; plano: string | null; seg_cobrado: number | null; total: number | null; itens: number | null; desconto: number | null; acrescimo: number | null; unidade: string | null }[]
}

const dataBr = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—')

export function FichaFamilia({ id, casa, onFechar }: { id: string; casa: string; onFechar: () => void }) {
  const [f, setF] = useState<Ficha | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => {
    setF(null)
    supabase.rpc('rec_familia_ficha', { p_familia: id }).then(({ data, error }) => {
      if (error) return setErro(friendlyDbError(error.message))
      setF(data as Ficha)
    })
  }, [id])
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc)
  }, [onFechar])

  const fam = f?.familia
  return (
    <div className="fixed inset-0 z-[60] flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="fixed inset-0 bg-ink/60" onClick={onFechar} />
      <div className="relative w-full max-w-3xl bg-surface rounded-2xl shadow-xl p-5 sm:p-6 animate-card-in my-auto" role="dialog" aria-label="Ficha da família">
        <button type="button" onClick={onFechar} className="absolute right-4 top-4 text-muted hover:text-ink" aria-label="Fechar ficha"><X className="w-5 h-5" /></button>
        {erro ? <p className="text-sm text-danger pr-8">{erro}</p> : !f || !fam ? <p className="text-sm text-muted py-8 text-center">Carregando...</p> : (
          <div className="space-y-5">
            <div className="pr-8">
              <h2 className="text-xl font-semibold">{fam.responsavel}</h2>
              <div className="flex flex-wrap gap-x-5 gap-y-1 mt-1.5 text-sm text-muted">
                {fam.cpf && <span className="inline-flex items-center gap-1.5"><CreditCard className="w-3.5 h-3.5" />{mascaraCpf(fam.cpf)}</span>}
                {fam.telefone && <span className="inline-flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" />{mascaraTelefone(fam.telefone)}</span>}
                {fam.email && <span className="inline-flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" />{fam.email}</span>}
              </div>
              <p className="text-xs text-muted mt-1.5">
                Cadastrada em {dataBr(fam.criado_em)}{fam.criado_por ? ` por ${fam.criado_por}` : ''}
                {fam.termo_aceito_em ? ` · termo aceito em ${dataBr(fam.termo_aceito_em)}` : ' · termo ainda não aceito'}
                {fam.imagem_autorizada ? ' · autorizou o uso de imagem' : ''}
              </p>
              {fam.observacoes && <p className="text-sm mt-2 rounded-lg bg-amber-light text-amber px-3 py-2">{fam.observacoes}</p>}
              {fam.telefone && (
                <a className="inline-flex items-center gap-1.5 mt-3 text-sm font-bold text-teal hover:underline" target="_blank" rel="noreferrer"
                  href={linkWhatsApp(fam.telefone, `Oi, ${fam.responsavel.split(' ')[0]}! Aqui é da ${casa}.`)}><MessageCircle className="w-4 h-4" />Chamar no WhatsApp</a>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Numero rotulo="Visitas" valor={String(f.resumo.visitas)} dica={`${f.resumo.dias} dia${f.resumo.dias === 1 ? '' : 's'} diferentes`} />
              <Numero rotulo="Gasto total" valor={brl(Number(f.resumo.gasto))} dica={f.resumo.visitas ? `média ${brl(Number(f.resumo.gasto) / Math.max(1, f.resumo.visitas))} por visita` : undefined} />
              <Numero rotulo="Tempo médio" valor={f.resumo.tempo_medio_min ? fmtMin(f.resumo.tempo_medio_min) : '—'} />
              <Numero rotulo="Última visita" valor={dataBr(f.resumo.ultima)} dica={f.resumo.primeira ? `primeira em ${dataBr(f.resumo.primeira)}` : undefined} />
            </div>
            {(f.ocorrencias > 0 || f.resumo.cancelamentos > 0 || f.resumo.dentro_agora > 0) && (
              <p className="text-xs text-muted">
                {f.resumo.dentro_agora > 0 ? `${f.resumo.dentro_agora} criança${f.resumo.dentro_agora > 1 ? 's' : ''} na recreação agora · ` : ''}
                {f.ocorrencias} ocorrência{f.ocorrencias === 1 ? '' : 's'} · {f.resumo.cancelamentos} cancelamento{f.resumo.cancelamentos === 1 ? '' : 's'}
              </p>
            )}

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <h3 className="font-semibold text-sm mb-2 flex items-center gap-2"><Baby className="w-4 h-4 text-purple" />Crianças</h3>
                <ul className="space-y-1.5 text-sm">{fam.criancas.map((c) => (
                  <li key={c.id} className={c.ativo ? '' : 'opacity-50'}>
                    <b>{c.nome}</b> <span className="text-muted">· {idadeTexto(c.nascimento)}{c.ativo ? '' : ' · inativa'}</span>
                    {c.cuidados && <span className="block text-xs font-bold text-danger">{c.cuidados}</span>}
                  </li>
                ))}</ul>
              </div>
              <div>
                <h3 className="font-semibold text-sm mb-2 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-purple" />Quem pode buscar</h3>
                {fam.autorizados.length === 0 ? <p className="text-sm text-muted">Só o responsável.</p> : (
                  <ul className="space-y-1.5 text-sm">{fam.autorizados.map((a) => (
                    <li key={a.id} className={a.ativo ? '' : 'opacity-50'}><b>{a.nome}</b> <span className="text-muted">{[a.parentesco, a.documento].filter(Boolean).join(' · ')}{a.ativo ? '' : ' · removido'}</span></li>
                  ))}</ul>
                )}
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-sm mb-2 flex items-center gap-2"><History className="w-4 h-4 text-purple" />Histórico de visitas {f.visitas.length >= 40 ? <span className="text-xs font-normal text-muted">(as 40 mais recentes)</span> : null}</h3>
              {f.visitas.length === 0 ? <p className="text-sm text-muted">Nenhuma visita ainda.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-muted"><th className="py-1 font-semibold">Dia</th><th className="font-semibold">Criança</th><th className="font-semibold">Horário</th><th className="font-semibold">Plano</th><th className="font-semibold text-right">Valor</th></tr></thead>
                    <tbody>{f.visitas.map((v) => (
                      <tr key={v.id} className="border-t border-line">
                        <td className="py-1.5 whitespace-nowrap">{dataBr(v.entrada_em)}</td>
                        <td>{v.crianca.split(' ')[0]}</td>
                        <td className="whitespace-nowrap">{horaMin(v.entrada_em)}{v.saida_em ? ` às ${horaMin(v.saida_em)}` : v.status === 'dentro' ? ' · dentro' : ''}</td>
                        <td className="text-muted">{v.plano ?? '—'}{v.unidade ? ` · ${v.unidade}` : ''}</td>
                        <td className="text-right font-semibold">{v.status === 'cancelada' ? <span className="text-danger text-xs">cancelada</span> : v.total != null ? brl(Number(v.total)) : '—'}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Numero({ rotulo, valor, dica }: { rotulo: string; valor: string; dica?: string }) {
  return (
    <div className="bg-paper/70 border border-line rounded-xl p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted">{rotulo}</p>
      <p className="font-display font-bold text-lg mt-0.5 truncate">{valor}</p>
      {dica && <p className="text-[11px] text-muted">{dica}</p>}
    </div>
  )
}
