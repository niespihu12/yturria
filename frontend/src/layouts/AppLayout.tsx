import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Navigate, Outlet } from 'react-router-dom'
import { toast } from 'react-toastify'
import { ToastContainer } from 'react-toastify'
import Sidebar from '@/components/app/Sidebar'
import MobileNav from '@/components/app/shell/MobileNav'
import { bootstrapClientAgents } from '@/api/VoiceRuntimeAPI'
import { useCurrentUser } from '@/hooks/useCurrentUser'

// Se muestra una sola vez por agente: no forma parte del bundle inicial.
const OnboardingWizard = lazy(() => import('@/components/app/onboarding/OnboardingWizard'))

export default function AppLayout() {
  const { user, isSuperAdmin, isLoading } = useCurrentUser()
  const bootstrapInFlightUserRef = useRef<string | null>(null)
  const [wizardAgentId, setWizardAgentId] = useState<string | null>(null)

  const { mutate: bootstrapClient } = useMutation({
    mutationFn: bootstrapClientAgents,
  })

  useEffect(() => {
    const html = document.documentElement
    const body = document.body
    const prevHtmlOverflow = html.style.overflow
    const prevBodyOverflow = body.style.overflow

    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'

    return () => {
      html.style.overflow = prevHtmlOverflow
      body.style.overflow = prevBodyOverflow
    }
  }, [])

  useEffect(() => {
    if (isLoading || isSuperAdmin || !user) {
      return
    }

    const userId = String(user._id || '').trim()
    if (!userId) return

    const storageKey = `client-bootstrap:${userId}`
    if (sessionStorage.getItem(storageKey) === 'done') {
      return
    }

    if (bootstrapInFlightUserRef.current === userId) {
      return
    }

    bootstrapInFlightUserRef.current = userId
    bootstrapClient(undefined, {
      onSuccess: (result) => {
        const textError = result?.text?.error
        const voiceError = result?.voice?.error

        if (!textError && !voiceError) {
          sessionStorage.setItem(storageKey, 'done')
        }

        const agentId = result?.text?.agent_id
        if (result?.text?.created && agentId) {
          const wizardKey = `onboarding-wizard:done:${agentId}`
          if (!localStorage.getItem(wizardKey)) {
            setWizardAgentId(agentId)
          }
        }

        if (textError === 'provider_key_missing') {
          toast.error(
            'Su cuenta aún no tiene activada la inteligencia artificial. Contacte al administrador para activarla.',
            { autoClose: 8000 },
          )
        }
      },
      onError: () => {
        toast.error('No pudimos preparar su cuenta. Recargue la página; si la situación continúa, contacte al administrador.')
      },
      onSettled: () => {
        if (bootstrapInFlightUserRef.current === userId) {
          bootstrapInFlightUserRef.current = null
        }
      },
    })
  }, [bootstrapClient, isLoading, isSuperAdmin, user])

  if (!localStorage.getItem('AUTH_TOKEN')) return <Navigate to="/auth/login" replace />

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg-secondary text-text-primary lg:flex-row">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-600 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-800 focus:shadow-md"
      >
        Saltar al contenido
      </a>
      <MobileNav />
      <Sidebar />
      <main id="contenido" tabIndex={-1} className="flex min-h-0 min-w-0 flex-1 overflow-hidden focus:outline-none">
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <div
                  role="status"
                  aria-label="Cargando"
                  className="h-5 w-5 animate-spin rounded-full border-2 border-primary-600 border-t-transparent"
                />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </div>
      </main>
      {/* Se pausan al pasar el puntero o perder el foco (WCAG 2.2.1) y duran lo suficiente para leerse. */}
      <ToastContainer
        autoClose={7000}
        pauseOnHover
        pauseOnFocusLoss
        theme="light"
        toastClassName="!bg-surface !border !border-border-default !shadow-lg !rounded-xl !text-text-primary"
        progressClassName="!bg-primary-500"
      />
      {wizardAgentId && (
        <Suspense fallback={null}>
          <OnboardingWizard
            agentId={wizardAgentId}
            onComplete={() => setWizardAgentId(null)}
          />
        </Suspense>
      )}
    </div>
  )
}
