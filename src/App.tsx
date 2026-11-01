import { Suspense } from 'react'
import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import { lazyPage, PageLoading } from './lib/lazyPage'
import { AppLayout } from './components/layout/AppLayout'
import { RequireAuth } from './components/layout/RequireAuth'
import { Login } from './pages/Login'
const ClientPortal = lazyPage(() => import('./pages/ClientPortal').then((m) => ({ default: m.ClientPortal })))
const ReviewPublic = lazyPage(() => import('./pages/ReviewPublic').then((m) => ({ default: m.ReviewPublic })))
const Dashboard = lazyPage(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })))
const DailyReminders = lazyPage(() => import('./pages/DailyReminders').then((m) => ({ default: m.DailyReminders })))
const Reservations = lazyPage(() => import('./pages/Reservations').then((m) => ({ default: m.Reservations })))
const FestaDetalhe = lazyPage(() => import('./pages/FestaDetalhe').then((m) => ({ default: m.FestaDetalhe })))
const Clients = lazyPage(() => import('./pages/Clients').then((m) => ({ default: m.Clients })))
const Reactivation = lazyPage(() => import('./pages/Reactivation').then((m) => ({ default: m.Reactivation })))
const Agenda = lazyPage(() => import('./pages/Agenda').then((m) => ({ default: m.Agenda })))
const Settings = lazyPage(() => import('./pages/Settings').then((m) => ({ default: m.Settings })))
const Platform = lazyPage(() => import('./pages/Platform').then((m) => ({ default: m.Platform })))
const Packages = lazyPage(() => import('./pages/Packages').then((m) => ({ default: m.Packages })))
const Contracts = lazyPage(() => import('./pages/Contracts').then((m) => ({ default: m.Contracts })))
const Payments = lazyPage(() => import('./pages/Payments').then((m) => ({ default: m.Payments })))
const Finance = lazyPage(() => import('./pages/Finance').then((m) => ({ default: m.Finance })))
const FestaFixedCosts = lazyPage(() => import('./pages/FestaFixedCosts').then((m) => ({ default: m.FestaFixedCosts })))
const MonthlyResult = lazyPage(() => import('./pages/MonthlyResult').then((m) => ({ default: m.MonthlyResult })))
const Profitability = lazyPage(() => import('./pages/Profitability').then((m) => ({ default: m.Profitability })))
const Inventory = lazyPage(() => import('./pages/Inventory').then((m) => ({ default: m.Inventory })))
const Schedules = lazyPage(() => import('./pages/Schedules').then((m) => ({ default: m.Schedules })))
const BirthdayReport = lazyPage(() => import('./pages/BirthdayReport').then((m) => ({ default: m.BirthdayReport })))
const Suppliers = lazyPage(() => import('./pages/Suppliers').then((m) => ({ default: m.Suppliers })))
const Reports = lazyPage(() => import('./pages/Reports').then((m) => ({ default: m.Reports })))
const ExportData = lazyPage(() => import('./pages/ExportData').then((m) => ({ default: m.ExportData })))
const Users = lazyPage(() => import('./pages/Users').then((m) => ({ default: m.Users })))
const Proposals = lazyPage(() => import('./pages/Proposals').then((m) => ({ default: m.Proposals })))
const Feedback = lazyPage(() => import('./pages/Feedback').then((m) => ({ default: m.Feedback })))
const Marketing = lazyPage(() => import('./pages/Marketing').then((m) => ({ default: m.Marketing })))
const Funnel = lazyPage(() => import('./pages/Funnel').then((m) => ({ default: m.Funnel })))
const Settlements = lazyPage(() => import('./pages/Settlements').then((m) => ({ default: m.Settlements })))
const Commissions = lazyPage(() => import('./pages/Commissions').then((m) => ({ default: m.Commissions })))
const MarketingHub = lazyPage(() => import('./pages/MarketingHub').then((m) => ({ default: m.MarketingHub })))
const ConsumptionAverages = lazyPage(() => import('./pages/ConsumptionAverages').then((m) => ({ default: m.ConsumptionAverages })))

function RedirectToPortal() {
  const { token } = useParams()
  return <Navigate to={`/portal/${token}`} replace />
}

export default function App() {
  return (
    <Suspense fallback={<PageLoading />}>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/portal/:token" element={<ClientPortal />} />
      {/* Links antigos da lista de convidados agora abrem o portal do cliente. */}
      <Route path="/lista-convidados/:token" element={<RedirectToPortal />} />
      <Route path="/avaliacao/:token" element={<ReviewPublic />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/lembretes" element={<DailyReminders />} />
          <Route path="/reservas" element={<Reservations />} />
          <Route path="/reservas/:id" element={<FestaDetalhe />} />
          <Route path="/clientes" element={<Clients />} />
          <Route path="/reativacao" element={<Reactivation />} />
          <Route path="/visitas" element={<Agenda />} />
          <Route path="/agenda" element={<Agenda />} />
          <Route path="/pacotes" element={<Packages />} />
          <Route path="/contratos" element={<Contracts />} />
          <Route path="/propostas" element={<Proposals />} />
          <Route path="/satisfacao" element={<Feedback />} />
          <Route path="/pagamentos" element={<Payments />} />
          <Route path="/financeiro" element={<Finance />} />
          <Route path="/despesas-fixas-festas" element={<FestaFixedCosts />} />
          <Route path="/resultado-do-mes" element={<MonthlyResult />} />
          <Route path="/lucro-por-festa" element={<Profitability />} />
          <Route path="/estoque" element={<Inventory />} />
          <Route path="/consumo-por-convidado" element={<ConsumptionAverages />} />
          <Route path="/acertos-entre-unidades" element={<Settlements />} />
          <Route path="/comissoes" element={<Commissions />} />
          <Route path="/escalas" element={<Schedules />} />
          <Route path="/relatorio-aniversariantes" element={<BirthdayReport />} />
          <Route path="/fornecedores" element={<Suppliers />} />
          <Route path="/relatorios" element={<Reports />} />
          <Route path="/usuarios" element={<Users />} />
          <Route path="/exportar-dados" element={<ExportData />} />
          <Route path="/configuracoes" element={<Settings />} />
          <Route path="/plataforma" element={<Platform />} />
          <Route path="/marketing" element={<MarketingHub />} />
          <Route path="/funil" element={<Funnel />} />
        </Route>
      </Route>
    </Routes>
    </Suspense>
  )
}
