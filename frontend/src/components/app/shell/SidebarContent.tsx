import { useId } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { ArrowRightStartOnRectangleIcon, Cog6ToothIcon } from '@heroicons/react/24/outline'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { clearSession } from '@/lib/session'
import { cn } from '@/lib/utils'
import { getNavSections, type NavItem, type NavSection } from './navigation'

const itemBase =
  'group flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors duration-150 lg:min-h-9'
const itemIdle = 'text-text-secondary hover:bg-neutral-100 hover:text-text-primary'
const itemActive = 'bg-primary-50 font-semibold text-primary-800'
const iconIdle = 'text-text-tertiary group-hover:text-text-secondary'

const SETTINGS_ITEM: NavItem = { label: 'Configuración', path: '/configuracion', icon: Cog6ToothIcon }

type NavigateHandler = { onNavigate?: () => void }

function NavEntry({ item, onNavigate }: { item: NavItem } & NavigateHandler) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.path}
      onClick={onNavigate}
      className={({ isActive }) => cn(itemBase, isActive ? itemActive : itemIdle)}
    >
      {({ isActive }) => (
        <>
          <Icon
            aria-hidden="true"
            className={cn('h-5 w-5 shrink-0', isActive ? 'text-primary-700' : iconIdle)}
          />
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {isActive && (
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary-600" />
          )}
        </>
      )}
    </NavLink>
  )
}

function NavGroup({ section, onNavigate }: { section: NavSection } & NavigateHandler) {
  const labelId = useId()
  return (
    <div>
      <p id={labelId} className="px-3 pb-1.5 text-xs font-medium text-text-tertiary">
        {section.label}
      </p>
      <ul aria-labelledby={labelId} className="space-y-0.5">
        {section.items.map((item) => (
          <li key={item.path}>
            <NavEntry item={item} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function initialsOf(name: string) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('')
  return initials || '·'
}

/** Navegación principal y bloque de cuenta; se comparte entre la barra lateral y el menú móvil. */
export default function SidebarContent({ onNavigate }: NavigateHandler) {
  const navigate = useNavigate()
  const { user, isSuperAdmin } = useCurrentUser()
  const sections = getNavSections(isSuperAdmin)

  const handleLogout = () => {
    clearSession()
    navigate('/auth/login')
  }

  return (
    <>
      <nav aria-label="Principal" className="custom-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {sections.map((section) => (
          <NavGroup key={section.label} section={section} onNavigate={onNavigate} />
        ))}
      </nav>

      <div className="border-t border-border-subtle px-3 pb-4 pt-3">
        {user && (
          <div className="flex items-center gap-3 px-3 pb-3">
            <span
              aria-hidden="true"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-100 text-xs font-semibold text-primary-800"
            >
              {initialsOf(user.name)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-text-primary">{user.name}</p>
              <p className="truncate text-xs text-text-tertiary">{user.email}</p>
            </div>
          </div>
        )}
        <ul className="space-y-0.5">
          <li>
            <NavEntry item={SETTINGS_ITEM} onNavigate={onNavigate} />
          </li>
          <li>
            <button type="button" onClick={handleLogout} className={cn(itemBase, itemIdle)}>
              <ArrowRightStartOnRectangleIcon aria-hidden="true" className={cn('h-5 w-5 shrink-0', iconIdle)} />
              Cerrar sesión
            </button>
          </li>
        </ul>
      </div>
    </>
  )
}
