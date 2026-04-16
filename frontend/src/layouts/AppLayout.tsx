import { useEffect } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import Sidebar from '@/components/app/Sidebar'
import { ToastContainer } from 'react-toastify'

export default function AppLayout() {
  const token = localStorage.getItem('AUTH_TOKEN')
  if (!token) return <Navigate to="/auth/login" replace />

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
