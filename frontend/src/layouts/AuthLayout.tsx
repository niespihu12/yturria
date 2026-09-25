import { Suspense } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { ToastContainer } from 'react-toastify'
import { brand } from '@/brand'
import BrandLogo from '@/components/app/shell/BrandLogo'

const SERVICE_LINE =
  brand.key === 'bolivar'
    ? 'Atención por voz, chat y WhatsApp para los clientes de Seguros Bolívar.'
    : 'Atención por voz, chat y WhatsApp desde una sola consola.'

export default function AuthLayout() {
  const { pathname } = useLocation()
  const token = localStorage.getItem('AUTH_TOKEN')
  if (token) return <Navigate to="/dashboard" replace />

  return (
    <>
      <div className="min-h-dvh bg-surface lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <aside className="hidden flex-col justify-between border-r border-border-subtle bg-bg-primary px-12 py-12 lg:flex xl:px-16">
          <div>
            <BrandLogo className="h-14" />
          </div>
          <div className="max-w-md">
            <p className="font-display text-3xl leading-snug text-primary-900 xl:text-4xl">
              {SERVICE_LINE}
            </p>
            <p className="mt-8 border-t border-border-default pt-4 text-sm text-text-tertiary">
              {brand.productName}
            </p>
          </div>
        </aside>

        <main className="flex min-h-dvh flex-col px-4 py-8 sm:px-8 lg:justify-center lg:py-12">
          <div className="mx-auto mb-10 w-full max-w-sm lg:hidden">
            <BrandLogo className="h-10" />
          </div>
          <div key={pathname} className="section-enter mx-auto w-full max-w-sm">
            <Suspense fallback={null}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
      <ToastContainer autoClose={7000} pauseOnHover pauseOnFocusLoss theme="light" />
    </>
  )
}
