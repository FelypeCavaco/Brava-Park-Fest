// Agenda: compromissos (tabela agenda_items) e o cálculo de em quais dias
// cada um cai quando se repete. Datas sempre como 'yyyy-MM-dd'.

export type AgendaRepeat = 'nao' | 'diario' | 'semanal' | 'mensal' | 'anual'

export interface AgendaItem {
  id: string
  title: string
  notes: string | null
  unit_id: string | null
  starts_on: string
  all_day: boolean
  start_time: string | null
  end_time: string | null
  repeat: AgendaRepeat
  repeat_until: string | null
  skipped_dates: string[]
  notify: boolean
  notify_days_before: number
  created_by_name: string | null
}

export const REPEAT_LABEL: Record<AgendaRepeat, string> = {
  nao: 'Não repete',
  diario: 'Todo dia',
  semanal: 'Toda semana',
  mensal: 'Todo mês',
  anual: 'Todo ano',
}

const toDate = (iso: string) => new Date(`${iso}T12:00:00Z`)
const toIso = (d: Date) => d.toISOString().slice(0, 10)

export function addDaysIso(iso: string, n: number) {
  const d = toDate(iso)
  d.setUTCDate(d.getUTCDate() + n)
  return toIso(d)
}

export function diffDays(a: string, b: string) {
  return Math.round((toDate(a).getTime() - toDate(b).getTime()) / 86400000)
}

// Mesmo dia no mês/ano indicado; se o mês não tem esse dia (ex.: 31), usa o último.
function sameDayIn(year: number, month0: number, day: number) {
  const last = new Date(Date.UTC(year, month0 + 1, 0, 12)).getUTCDate()
  return toIso(new Date(Date.UTC(year, month0, Math.min(day, last), 12)))
}

// Dias em que o compromisso acontece entre `from` e `to` (inclusive).
export function occurrences(item: Pick<AgendaItem, 'starts_on' | 'repeat' | 'repeat_until' | 'skipped_dates'>, from: string, to: string): string[] {
  const fim = item.repeat_until && item.repeat_until < to ? item.repeat_until : to
  const pulados = new Set(item.skipped_dates ?? [])
  const out: string[] = []
  const push = (d: string) => {
    if (d >= from && d <= fim && d >= item.starts_on && !pulados.has(d)) out.push(d)
  }
  if (fim < from || item.starts_on > fim) return out
  if (item.repeat === 'nao') {
    push(item.starts_on)
  } else if (item.repeat === 'diario' || item.repeat === 'semanal') {
    const passo = item.repeat === 'diario' ? 1 : 7
    let d = item.starts_on
    if (d < from) d = addDaysIso(d, Math.ceil(diffDays(from, d) / passo) * passo)
    for (; d <= fim; d = addDaysIso(d, passo)) push(d)
  } else {
    const ini = toDate(item.starts_on)
    const dia = ini.getUTCDate()
    const f = toDate(from)
    const t = toDate(fim)
    if (item.repeat === 'mensal') {
      const mes = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth()
      for (let k = Math.max(mes(ini), mes(f)); k <= mes(t); k++) push(sameDayIn(Math.floor(k / 12), k % 12, dia))
    } else {
      for (let y = Math.max(ini.getUTCFullYear(), f.getUTCFullYear()); y <= t.getUTCFullYear(); y++) push(sameDayIn(y, ini.getUTCMonth(), dia))
    }
  }
  return out
}

// Para o Painel: dias deste compromisso que precisam de aviso hoje.
// - os que caem entre hoje e "X dias antes" (janela do aviso);
// - o último dia que já passou (ou hoje), se ninguém marcou como feito —
//   fica no Painel até alguém marcar "Feito".
export function diasParaAvisar(item: AgendaItem, feitos: string[], hoje: string): string[] {
  const feito = new Set(feitos)
  const passados = occurrences(item, addDaysIso(hoje, -400), hoje)
  const ultimo = passados[passados.length - 1]
  const futuros = occurrences(item, addDaysIso(hoje, 1), addDaysIso(hoje, item.notify_days_before))
  return [...(ultimo ? [ultimo] : []), ...futuros].filter((d) => !feito.has(d))
}

export function horarioLabel(item: Pick<AgendaItem, 'all_day' | 'start_time' | 'end_time'>) {
  if (item.all_day || !item.start_time) return 'Dia inteiro'
  const h = (t: string) => t.slice(0, 5)
  return item.end_time ? `${h(item.start_time)} às ${h(item.end_time)}` : h(item.start_time)
}

export function quandoLabel(dia: string, hoje: string) {
  const n = diffDays(dia, hoje)
  if (n === 0) return 'hoje'
  if (n === 1) return 'amanhã'
  if (n > 1) return `em ${n} dias (${dia.slice(8, 10)}/${dia.slice(5, 7)})`
  return `atrasado desde ${dia.slice(8, 10)}/${dia.slice(5, 7)}`
}
