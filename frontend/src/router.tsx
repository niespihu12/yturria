import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom'
import AuthLayout from '@/layouts/AuthLayout'
import AppLayout from '@/layouts/AppLayout'
import LoginView from '@/views/auth/LoginView'
import RegisterView from '@/views/auth/RegisterView'
import ConfirmAccountView from '@/views/auth/ConfirmAccountView'
import RequestNewCodeView from '@/views/auth/RequestNewCodeView'
import ForgotPasswordView from '@/views/auth/ForgotPasswordView'
import NewPasswordView from '@/views/auth/NewPasswordView'
import VoiceAgentsView from '@/views/app/VoiceAgentsView'
import VoiceAgentDetailView from '@/views/app/VoiceAgentDetailView'
import PhoneNumbersView from '@/views/app/PhoneNumbersView'
import TextAgentsView from '@/views/app/TextAgentsView'
import TextAgentDetailView from '@/views/app/TextAgentDetailView'
import SettingsView from '@/views/app/SettingsView'
import DashboardView from '@/views/app/DashboardView'
import AdminUsersView from '@/views/app/AdminUsersView'
import EscalationsView from '@/views/app/EscalationsView'
import AppointmentsView from '@/views/app/AppointmentsView'
import TextAgentEmbedView from '@/views/embed/TextAgentEmbedView'

export default function Router() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/embed/text-agent/:id" element={<TextAgentEmbedView />} />

        {/* Auth routes */}
        <Route element={<AuthLayout />}>
          <Route path="/auth/login" element={<LoginView />} />
          <Route path="/auth/register" element={<RegisterView />} />
          <Route path="/auth/confirm-account" element={<ConfirmAccountView />} />
          <Route path="/auth/request-code" element={<RequestNewCodeView />} />
          <Route path="/auth/forgot-password" element={<ForgotPasswordView />} />
          <Route path="/auth/new-password" element={<NewPasswordView />} />
        </Route>

        {/* App routes (protected) */}
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<DashboardView />} />
          <Route path="/agentes_voz" element={<VoiceAgentsView />} />
          <Route path="/agentes_voz/:id" element={<VoiceAgentDetailView />} />
          <Route path="/agentes_texto" element={<TextAgentsView />} />
          <Route path="/agentes_texto/:id" element={<TextAgentDetailView />} />
          <Route path="/escalamientos" element={<EscalationsView />} />
          <Route path="/citas" element={<AppointmentsView />} />
          <Route path="/numeros_telefono" element={<PhoneNumbersView />} />
          <Route path="/admin/usuarios" element={<AdminUsersView />} />
          <Route path="/configuracion" element={<SettingsView />} />
          <Route index element={<Navigate to="/agentes_voz" replace />} />
          <Route path="*" element={<Navigate to="/agentes_voz" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
