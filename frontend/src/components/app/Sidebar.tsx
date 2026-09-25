import { Link } from 'react-router-dom'
import { brand } from '@/brand'
import BrandLogo from '@/components/app/shell/BrandLogo'
import SidebarContent from '@/components/app/shell/SidebarContent'

/** Barra lateral de escritorio (≥ lg). En pantallas menores la reemplaza MobileNav. */
export default function Sidebar() {
  return (
    <aside className="hidden h-full w-64 shrink-0 flex-col border-r border-border-default bg-surface lg:flex">
      <div className="px-6 pb-4 pt-6">
        <Link
          to="/dashboard"
          aria-label={`${brand.logo.alt}, ir al Dashboard`}
          className="inline-flex rounded-lg"
        >
          <BrandLogo className="h-10" />
        </Link>
        <p className="mt-3 text-sm text-text-tertiary">{brand.productName}</p>
      </div>
      <SidebarContent />
    </aside>
  )
}
