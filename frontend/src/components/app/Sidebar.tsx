import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  DevicePhoneMobileIcon,
  PhoneIcon,
  Squares2X2Icon,
  ChatBubbleLeftRightIcon,
  UserGroupIcon,
  ArrowRightStartOnRectangleIcon,
  Cog6ToothIcon,
  InboxIcon,
  CalendarDaysIcon,
  ChatBubbleOvalLeftEllipsisIcon,
  UsersIcon,
} from '@heroicons/react/24/outline'
import {
  DevicePhoneMobileIcon as DevicePhoneMobileSolid,
  PhoneIcon as PhoneSolid,
  Squares2X2Icon as Squares2X2Solid,
  ChatBubbleLeftRightIcon as ChatBubbleLeftRightSolid,
  UserGroupIcon as UserGroupSolid,
  InboxIcon as InboxSolid,
  CalendarDaysIcon as CalendarDaysSolid,
  ChatBubbleOvalLeftEllipsisIcon as ChatBubbleOvalLeftEllipsisSolid,
  UsersIcon as UsersSolid,
} from '@heroicons/react/24/solid'
import Logo from '@/components/Logo'
import { getAuthenticatedUser } from '@/api/AuthAPI'
import { clearSession } from '@/lib/session'

const baseNavItems = [
  {
    label: 'Dashboard',
    path: '/dashboard',
    icon: Squares2X2Icon,
    iconActive: Squares2X2Solid,
  },
  {
    label: 'Agentes de Voz',
    path: '/agentes_voz',
    icon: PhoneIcon,
    iconActive: PhoneSolid,
  },
  {
    label: 'Agentes de Texto',
    path: '/agentes_texto',
    icon: ChatBubbleLeftRightIcon,
    iconActive: ChatBubbleLeftRightSolid,
  },
  {
    label: 'Bandeja (Escalamientos)',
    path: '/escalamientos',
    icon: InboxIcon,
    iconActive: InboxSolid,
  },
  {
    label: 'Citas',
    path: '/citas',
    icon: CalendarDaysIcon,
    iconActive: CalendarDaysSolid,
  },
  {
    label: 'WhatsApp Saliente',
    path: '/whatsapp_config',
    icon: ChatBubbleOvalLeftEllipsisIcon,
    iconActive: ChatBubbleOvalLeftEllipsisSolid,
  },
  {
    label: 'Números de teléfono',
    path: '/numeros_telefono',
    icon: DevicePhoneMobileIcon,
    iconActive: DevicePhoneMobileSolid,
  },
  {
    label: 'Directorio',
    path: '/directorio',
    icon: UsersIcon,
    iconActive: UsersSolid,
  },
]

export default function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()

  const { data: currentUser } = useQuery({
    queryKey: ['auth-user'],
    queryFn: getAuthenticatedUser,
    staleTime: 60_000,
  })

  const navItems =
    currentUser?.role === 'super_admin'
      ? [
          ...baseNavItems,
          {
            label: 'Administración',
            path: '/admin/usuarios',
            icon: UserGroupIcon,
            iconActive: UserGroupSolid,
          },
        ]
      : baseNavItems

  const settingsActive =
    location.pathname === '/configuracion' ||
    location.pathname.startsWith('/configuracion/')

  const handleLogout = () => {
    clearSession()
    navigate('/auth/login')
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col bg-surface border-r border-border-default">
      {/* Brand header */}
      <div className="px-5 py-5">
        <div className="rounded-2xl border border-border-default bg-bg-secondary px-4 py-4">
          <div className="flex justify-center rounded-xl bg-primary-600 px-3 py-2.5 shadow-sm">
            <Logo className="h-9 w-auto" />
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-text-tertiary">
            <span className="inline-block h-2 w-2 rounded-full bg-accent-500 animate-pulse" />
            Voice Console
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 px-3 py-2 custom-scrollbar overflow-y-auto">
        <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          Llamadas
        </p>

        {navItems.map((item, index) => {
          const active =
            location.pathname === item.path ||
            location.pathname.startsWith(item.path + '/')
          const Icon = active ? item.iconActive : item.icon

          return (
            <Link
              key={item.path}
              to={item.path}
              className={`nav-item flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                active
                  ? 'bg-primary-50 text-primary-700 shadow-sm ring-1 ring-primary-200'
                  : 'text-text-secondary hover:bg-neutral-50 hover:text-text-primary'
              }`}
              style={{ animationDelay: `${index * 40}ms` }}
            >
              <Icon className="w-[18px] h-[18px] shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          )
        })}
      </nav>

      {/* Footer actions */}
      <div className="space-y-0.5 border-t border-border-default px-3 py-4">
        <Link
          to="/configuracion"
          className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
            settingsActive
              ? 'bg-primary-50 text-primary-700 shadow-sm ring-1 ring-primary-200'
              : 'text-text-secondary hover:bg-neutral-50 hover:text-text-primary'
          }`}
        >
          <Cog6ToothIcon className="w-[18px] h-[18px]" />
          Configuración
        </Link>

        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-text-secondary transition-all duration-200 hover:bg-danger-50 hover:text-danger-600"
        >
          <ArrowRightStartOnRectangleIcon className="w-[18px] h-[18px]" />
          Cerrar sesión
        </button>
      </div>
    </aside>
  )
}
