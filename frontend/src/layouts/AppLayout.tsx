import { useEffect, useRef, useState } from 'react'
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

        // Only mark done when there are no errors so the next session retries.
        if (!textError && !voiceError) {
          sessionStorage.setItem(storageKey, 'done')
        }

        // Show onboarding wizard the first time a text agent is created.
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
        // Network/server error — don't mark done, will retry next session.
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
    <div className="flex h-screen overflow-hidden bg-[#f5f3ff] text-black">
      <Sidebar />
      <main className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <Outlet />
        </div>
      </main>
      <ToastContainer
        pauseOnHover={false}
        pauseOnFocusLoss={false}
        theme="light"
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
