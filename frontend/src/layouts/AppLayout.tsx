import { useEffect, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Navigate, Outlet } from 'react-router-dom'
import Sidebar from '@/components/app/Sidebar'
import { ToastContainer } from 'react-toastify'
import { bootstrapClientAgents } from '@/api/VoiceRuntimeAPI'
import { useCurrentUser } from '@/hooks/useCurrentUser'

export default function AppLayout() {
  const token = localStorage.getItem('AUTH_TOKEN')
  if (!token) return <Navigate to="/auth/login" replace />

  const { user, isSuperAdmin, isLoading } = useCurrentUser()
  const bootstrapInFlightUserRef = useRef<string | null>(null)

  const { mutate: bootstrapClient } = useMutation({
    mutationFn: bootstrapClientAgents,
  })

  useEffect(() => {
    const html = document.documentElement
    const body = document.body
    const prevHtmlOverflow = html.style.overflow
    const prevBodyOverflow = body.style.overflow

    // Keep global scrolling disabled inside the app shell.
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
      onSettled: () => {
        sessionStorage.setItem(storageKey, 'done')
        if (bootstrapInFlightUserRef.current === userId) {
          bootstrapInFlightUserRef.current = null
        }
      },
    })
  }, [bootstrapClient, isLoading, isSuperAdmin, user])

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
    </div>
  )
}
