import { Suspense, useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Navigate, Outlet } from 'react-router-dom'
import { toast } from 'react-toastify'
import Sidebar from '@/components/app/Sidebar'
import { ToastContainer } from 'react-toastify'
import { bootstrapClientAgents } from '@/api/VoiceRuntimeAPI'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import OnboardingWizard from '@/components/app/onboarding/OnboardingWizard'

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
            'Sin API Key de IA configurada. Contacta al administrador para activar tu cuenta.',
            { autoClose: 8000 },
          )
        }
      },
      onError: () => {
        toast.error('Error al inicializar tu cuenta. Recarga la página si el problema persiste.')
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
    <div className="flex h-screen overflow-hidden bg-bg-secondary text-text-primary">
      <Sidebar />
      <main className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </div>
      </main>
      <ToastContainer
        pauseOnHover={false}
        pauseOnFocusLoss={false}
        theme="light"
        toastClassName="!bg-surface !border !border-border-default !shadow-lg !rounded-xl !text-text-primary"
        progressClassName="!bg-primary-500"
      />
      {wizardAgentId && (
        <OnboardingWizard
          agentId={wizardAgentId}
          onComplete={() => setWizardAgentId(null)}
        />
      )}
    </div>
  )
}
