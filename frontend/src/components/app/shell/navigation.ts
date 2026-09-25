import type { ComponentType, SVGProps } from 'react'
import {
  CalendarDaysIcon,
  ChatBubbleLeftRightIcon,
  ChatBubbleOvalLeftEllipsisIcon,
  DevicePhoneMobileIcon,
  InboxIcon,
  PhoneIcon,
  Squares2X2Icon,
  UserGroupIcon,
  UsersIcon,
} from '@heroicons/react/24/outline'

export type NavItem = {
  label: string
  path: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
}

export type NavSection = {
  label: string
  items: NavItem[]
}

const BASE_SECTIONS: NavSection[] = [
  {
    label: 'Atención',
    items: [
      { label: 'Resumen', path: '/dashboard', icon: Squares2X2Icon },
      { label: 'Bandeja', path: '/escalamientos', icon: InboxIcon },
      { label: 'Citas', path: '/citas', icon: CalendarDaysIcon },
      { label: 'Directorio', path: '/directorio', icon: UsersIcon },
    ],
  },
  {
    label: 'Agentes',
    items: [
      { label: 'Agentes de voz', path: '/agentes_voz', icon: PhoneIcon },
      { label: 'Agentes de texto', path: '/agentes_texto', icon: ChatBubbleLeftRightIcon },
    ],
  },
  {
    label: 'Canales',
    items: [
      { label: 'WhatsApp saliente', path: '/whatsapp_config', icon: ChatBubbleOvalLeftEllipsisIcon },
      { label: 'Números de teléfono', path: '/numeros_telefono', icon: DevicePhoneMobileIcon },
    ],
  },
]

const ADMIN_SECTION: NavSection = {
  label: 'Administración',
  items: [{ label: 'Usuarios', path: '/admin/usuarios', icon: UserGroupIcon }],
}

export function getNavSections(isSuperAdmin: boolean): NavSection[] {
  return isSuperAdmin ? [...BASE_SECTIONS, ADMIN_SECTION] : BASE_SECTIONS
}
