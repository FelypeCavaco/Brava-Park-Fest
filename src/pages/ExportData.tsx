import { useState } from 'react'
import { Download, FileSpreadsheet } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { supabase } from '../lib/supabaseClient'
import { useCompany } from '../lib/CompanyContext'
import { friendlyDbError } from '../lib/format'

// Exportar dados: o administrador baixa todos os dados da empresa numa
// planilha (uma aba por assunto). Direito do cliente pela LGPD e cópia de
// segurança própria.

const ABAS: Record<string, string> = {
  reservations: 'Festas',
  clients: 'Clientes',
  payments: 'Pagamentos',
  reservation_installments: 'Parcelas',
  reservation_costs: 'Custos das festas',
  reservation_extra_items: 'Extras das festas',
  reservation_consumption: 'Consumo cobrado',
  reservation_stock_consumption: 'Consumo do estoque',
  reservation_birthday_kids: 'Aniversariantes',
  reservation_notes: 'Observações',
  reservation_documents: 'Documentos',
  guest_list_entries: 'Convidados',
  guest_list_pages: 'Links do portal',
  portal_receipts: 'Comprovantes do portal',
  contracts: 'Contratos',
  contract_templates: 'Contrato-base',
  proposals: 'Propostas',
  packages: 'Pacotes',
  extra_items: 'Itens extras',
  menu_sections: 'Cardápio (seções)',
  portal_menu_options: 'Cardápio (opções)',
  units: 'Unidades',
  spaces: 'Espaços',
  expenses: 'Despesas',
  recurring_expenses: 'Despesas fixas',
  festa_fixed_costs: 'Custos fixos das festas',
  other_incomes: 'Outras entradas',
  inventory_items: 'Estoque',
  suppliers: 'Fornecedores',
  staff_members: 'Equipe',
  staff_assignments: 'Escalas',
  commission_payouts: 'Comissões pagas',
  visits: 'Visitas',
  agenda_items: 'Agenda',
  party_reviews: 'Avaliações',
  marketing_spend: 'Gastos com tráfego',
  user_profiles: 'Usuários',
  roles: 'Perfis de acesso',
  audit_log: 'Histórico de alterações',
}

function celula(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number' || typeof v === 'string') return v
  if (typeof v === 'boolean') return v ? 'sim' : 'não'
  return JSON.stringify(v)
}

export function ExportData() {
  const { brand } = useCompany()
  const [gerando, setGerando] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)

  async function exportar() {
    setGerando(true)
    setMsg(null)
    try {
      const [{ data, error }, XLSX] = await Promise.all([supabase.rpc('company_export'), import('xlsx')])
      if (error || !data) throw new Error(error ? friendlyDbError(error.message) : 'Sem dados.')
      const dados = data as { gerada_em: string; empresa: Record<string, unknown>; tabelas: Record<string, Record<string, unknown>[]> }
      const livro = XLSX.utils.book_new()
      const usados = new Set<string>()
      const nomeAba = (base: string) => {
        let n = base.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)
        for (let i = 2; usados.has(n); i++) n = `${base.slice(0, 28)} ${i}`
        usados.add(n)
        return n
      }
      const tabelas = Object.entries(dados.tabelas).sort(([a], [b]) => {
        const ia = Object.keys(ABAS).indexOf(a)
        const ib = Object.keys(ABAS).indexOf(b)
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b)
      })
      const resumo = [
        ['Empresa', String(dados.empresa?.name ?? brand.name)],
        ['Gerada em', new Date(dados.gerada_em).toLocaleString('pt-BR')],
        [],
        ['Aba', 'Linhas'],
        ...tabelas.map(([t, linhas]) => [ABAS[t] ?? t, linhas.length]),
      ]
      XLSX.utils.book_append_sheet(livro, XLSX.utils.aoa_to_sheet(resumo), nomeAba('Resumo'))
      for (const [t, linhas] of tabelas) {
        const colunas = [...new Set(linhas.flatMap((l) => Object.keys(l)))].filter((c) => c !== 'company_id')
        const folha = XLSX.utils.aoa_to_sheet([colunas, ...linhas.map((l) => colunas.map((c) => celula(l[c])))])
        XLSX.utils.book_append_sheet(livro, folha, nomeAba(ABAS[t] ?? t))
      }
      const slug = (brand.name || 'empresa').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
      XLSX.writeFile(livro, `dados-${slug}-${new Date().toISOString().slice(0, 10)}.xlsx`)
      setMsg({ ok: true, texto: `Planilha baixada com ${tabelas.length} abas.` })
    } catch (e) {
      setMsg({ ok: false, texto: e instanceof Error ? e.message : 'Não foi possível exportar.' })
    } finally {
      setGerando(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold">Exportar dados</h1>
        <p className="text-sm text-muted mt-1">Baixe todos os dados da {brand.name || 'empresa'} numa planilha.</p>
      </div>
      <Card>
        <div className="flex gap-4 items-start">
          <span className="w-11 h-11 rounded-full bg-green-light text-green-dark flex items-center justify-center shrink-0"><FileSpreadsheet className="w-5 h-5" /></span>
          <div className="space-y-3 text-sm">
            <p>A planilha tem uma aba para cada assunto: festas, clientes, pagamentos, parcelas, despesas, estoque, equipe, convidados, histórico e o resto. Os arquivos (contratos em PDF, comprovantes, fotos) não vão na planilha.</p>
            <p className="text-muted">Use para guardar uma cópia própria, abrir no Excel ou no Google Planilhas, ou atender um cliente que peça os dados dele.</p>
            {msg && <p className={`rounded-lg px-3 py-2 ${msg.ok ? 'bg-teal-light text-teal' : 'bg-danger-light text-danger'}`}>{msg.texto}</p>}
            <Button onClick={exportar} disabled={gerando}><Download className="w-4 h-4" /> {gerando ? 'Preparando a planilha...' : 'Baixar planilha (.xlsx)'}</Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
