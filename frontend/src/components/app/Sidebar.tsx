import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  DevicePhoneMobileIcon,
  PhoneIcon,
  Squares2X2Icon,
  ChatBubbleLeftRightIcon,
  ArrowRightStartOnRectangleIcon,
  Cog6ToothIcon,
} from '@heroicons/react/24/outline'
import {
  DevicePhoneMobileIcon as DevicePhoneMobileSolid,
  PhoneIcon as PhoneSolid,
  Squares2X2Icon as Squares2X2Solid,
  ChatBubbleLeftRightIcon as ChatBubbleLeftRightSolid,
} from '@heroicons/react/24/solid'
import Logo from '@/components/Logo'

const navItems = [
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
    label: 'Numeros de telefono',
    path: '/numeros_telefono',
    icon: DevicePhoneMobileIcon,
    iconActive: DevicePhoneMobileSolid,
  },
]

export default function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const settingsActive =
    location.pathname === '/configuracion' ||
    location.pathname.startsWith('/configuracion/')

  const handleLogout = () => {
    localStorage.removeItem('AUTH_TOKEN')
    navigate('/auth/login')
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-[#e4e0f5] bg-white">
      <div className="border-b border-[#e4e0f5] px-5 py-5">
        <div className="rounded-2xl border border-[#e4e0f5] bg-[#f5f3ff] px-4 py-4">
          <div className="flex justify-center rounded-xl bg-[#271173] px-3 py-2 shadow-sm">
            <Logo className="h-9 w-auto" />
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-black/50">
            <span className="inline-block h-2 w-2 rounded-full bg-[#271173]" />
            Voice Console
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-4">
        <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-black/40">
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
              className={`nav-item flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-colors duration-150 ${
                active
                  ? 'bg-[#ede9ff] text-[#271173] font-medium'
                  : 'text-black/60 hover:bg-[#f5f3ff] hover:text-[#271173]'
              }`}
              style={{ animationDelay: `${index * 40}ms` }}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>

      <div className="space-y-0.5 border-t border-[#e4e0f5] px-3 py-4">
        <Link
          to="/configuracion"
          className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-colors duration-150 ${
            settingsActive
              ? 'bg-[#ede9ff] text-[#271173] font-medium'
              : 'text-black/60 hover:bg-[#f5f3ff] hover:text-[#271173]'
          }`}
        >
          <Cog6ToothIcon className="w-4 h-4" />
          Configuracion
        </Link>

        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-black/60 transition-colors duration-150 hover:bg-rose-50 hover:text-rose-600"
        >
          <ArrowRightStartOnRectangleIcon className="w-4 h-4" />
          Cerrar sesion
        </button>
      </div>
    </aside>
  )
}
