import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom'
import AuthLayout from '@/layouts/AuthLayout'
import AppLayout from '@/layouts/AppLayout'
import LoginView from '@/views/auth/LoginView'
import RegisterView from '@/views/auth/RegisterView'
import ConfirmAccountView from '@/views/auth/ConfirmAccountView'
import RequestNewCodeView from '@/views/auth/RequestNewCodeView'
import ForgotPasswordView from '@/views/auth/ForgotPasswordView'
import NewPasswordView from '@/views/auth/NewPasswordView'

const VoiceAgentsView = lazy(() => import('@/views/app/VoiceAgentsView'))
const VoiceAgentDetailView = lazy(() => import('@/views/app/VoiceAgentDetailView'))
const PhoneNumbersView = lazy(() => import('@/views/app/PhoneNumbersView'))
const TextAgentsView = lazy(() => import('@/views/app/TextAgentsView'))
const TextAgentDetailView = lazy(() => import('@/views/app/TextAgentDetailView'))
const SettingsView = lazy(() => import('@/views/app/SettingsView'))
const DashboardView = lazy(() => import('@/views/app/DashboardView'))
const AdminUsersView = lazy(() => import('@/views/app/AdminUsersView'))
const EscalationsView = lazy(() => import('@/views/app/EscalationsView'))
const AppointmentsView = lazy(() => import('@/views/app/AppointmentsView'))
const WhatsAppConfigView = lazy(() => import('@/views/app/WhatsAppConfigView'))
const TextAgentEmbedView = lazy(() => import('@/views/embed/TextAgentEmbedView'))
const SofiaErrorsView = lazy(() => import('@/views/app/sofia-errors/SofiaErrorsView'))
const VoiceAnalyticsView = lazy(() => import('@/views/app/voice-analytics/VoiceAnalyticsView'))
const ContactsView = lazy(() => import('@/views/app/ContactsView'))

export default function Router() {
  return (
    <BrowserRouter>
      {/* Vistas bajo demanda: el widget embebido no descarga todo el panel. */}
      <Suspense fallback={null}>
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
          <Route path="/sofia-errores" element={<SofiaErrorsView />} />
          <Route path="/voice-analytics" element={<VoiceAnalyticsView />} />
          <Route path="/citas" element={<AppointmentsView />} />
          <Route path="/whatsapp_config" element={<WhatsAppConfigView />} />
          <Route path="/numeros_telefono" element={<PhoneNumbersView />} />
          <Route path="/admin/usuarios" element={<AdminUsersView />} />
          <Route path="/directorio" element={<ContactsView />} />
          <Route path="/configuracion" element={<SettingsView />} />
          <Route index element={<Navigate to="/agentes_voz" replace />} />
          <Route path="*" element={<Navigate to="/agentes_voz" replace />} />
        </Route>
      </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
