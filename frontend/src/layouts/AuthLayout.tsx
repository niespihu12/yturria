import Logo from '@/components/Logo'
import { Navigate, Outlet } from 'react-router-dom'
import { ToastContainer } from 'react-toastify'

export default function AuthLayout() {
    const token = localStorage.getItem('AUTH_TOKEN')
    if (token) return <Navigate to="/agentes_voz" replace />

    return (
        <>
            <div className="min-h-screen bg-[#f5f3ff]">
                <div className="mx-auto w-full max-w-[460px] px-6 py-10 lg:py-20">
                    <div className="flex justify-center">
                        <div className="rounded-2xl border border-[#e4e0f5] bg-[#271173] px-5 py-4 shadow-sm">
                            <Logo className="h-11 w-auto" />
                        </div>
                    </div>
                    <div className="mt-2 section-enter">
                        <Outlet />
                    </div>
                </div>
            </div>
            <ToastContainer
                pauseOnHover={false}
                pauseOnFocusLoss={false}
                theme="light"
            />
        </>
    )
}
