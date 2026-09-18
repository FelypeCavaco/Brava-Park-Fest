import { Routes, Route } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { RequireAuth } from './components/layout/RequireAuth'
import { Login } from './pages/Login'
import { GuestListPublic } from './pages/GuestListPublic'
import { ReviewPublic } from './pages/ReviewPublic'
import { Dashboard } from './pages/Dashboard'
import { DailyReminders } from './pages/DailyReminders'
import { Reservations } from './pages/Reservations'
import { FestaDetalhe } from './pages/FestaDetalhe'
import { Clients } from './pages/Clients'
import { Reactivation } from './pages/Reactivation'
import { Visits } from './pages/Visits'
import { Packages } from './pages/Packages'
import { Contracts } from './pages/Contracts'
import { Payments } from './pages/Payments'
import { Finance } from './pages/Finance'
import { MonthlyResult } from './pages/MonthlyResult'
import { Profitability } from './pages/Profitability'
import { Inventory } from './pages/Inventory'
import { Schedules } from './pages/Schedules'
import { BirthdayReport } from './pages/BirthdayReport'
import { Suppliers } from './pages/Suppliers'
import { Reports } from './pages/Reports'
import { Users } from './pages/Users'
import { Proposals } from './pages/Proposals'
import { Feedback } from './pages/Feedback'
import { Marketing } from './pages/Marketing'
import { Funnel } from './pages/Funnel'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/lista-convidados/:token" element={<GuestListPublic />} />
      <Route path="/avaliacao/:token" element={<ReviewPublic />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/lembretes" element={<DailyReminders />} />
          <Route path="/reservas" element={<Reservations />} />
          <Route path="/reservas/:id" element={<FestaDetalhe />} />
          <Route path="/clientes" element={<Clients />} />
          <Route path="/reativacao" element={<Reactivation />} />
          <Route path="/visitas" element={<Visits />} />
          <Route path="/pacotes" element={<Packages />} />
          <Route path="/contratos" element={<Contracts />} />
          <Route path="/propostas" element={<Proposals />} />
          <Route path="/satisfacao" element={<Feedback />} />
          <Route path="/pagamentos" element={<Payments />} />
          <Route path="/financeiro" element={<Finance />} />
          <Route path="/resultado-do-mes" element={<MonthlyResult />} />
          <Route path="/lucro-por-festa" element={<Profitability />} />
          <Route path="/estoque" element={<Inventory />} />
          <Route path="/escalas" element={<Schedules />} />
          <Route path="/relatorio-aniversariantes" element={<BirthdayReport />} />
          <Route path="/fornecedores" element={<Suppliers />} />
          <Route path="/relatorios" element={<Reports />} />
          <Route path="/usuarios" element={<Users />} />
          <Route path="/marketing" element={<Marketing />} />
          <Route path="/funil" element={<Funnel />} />
        </Route>
      </Route>
    </Routes>
  )
}
