/**
 * Marca activa de la interfaz. Por defecto la plataforma usa su propia marca;
 * `VITE_BRAND=bolivar` activa el tema de demostración de Seguros Bolívar
 * (tokens en src/styles/brand-bolivar.css). El logo de Seguros Bolívar solo se
 * muestra en ese tema: su manual de marca exige autorización para usarlo.
 *
 * Los datos viven en brands.json porque vite.config.mjs también los usa para
 * escribir título, favicon y fuentes en index.html durante el build.
 */
import brands from './brands.json'

export type BrandKey = 'aos' | 'bolivar'

type BrandAsset = { src: string; alt: string; width: number; height: number }

type BrandConfig = {
  key: BrandKey
  /** Nombre que acompaña al logo en la consola. */
  productName: string
  documentTitle: string
  /** `surface: 'dark'`: el logo es claro y necesita placa de color. */
  logo: BrandAsset & { surface: 'light' | 'dark' }
  /** Isotipo cuadrado para espacios reducidos (favicon, chat embebido). */
  mark: BrandAsset
  /** Hoja de fuentes de la marca. */
  fontStylesheet?: string
}

const BRANDS = brands as Record<BrandKey, BrandConfig>

export const brand: BrandConfig =
  BRANDS[(import.meta.env.VITE_BRAND as BrandKey | undefined) ?? 'aos'] ?? BRANDS.aos

/**
 * Aplica la marca al documento antes del primer render (evita parpadeo de tema).
 * Título, favicon y fuentes ya vienen en index.html (plugin en vite.config.mjs);
 * aquí solo se completan si faltaran.
 */
export function applyBrand() {
  const root = document.documentElement
  root.dataset.brand = brand.key
  document.title = brand.documentTitle

  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (icon && !icon.href.endsWith(brand.mark.src)) {
    icon.type = 'image/png'
    icon.href = brand.mark.src
  }

  if (brand.fontStylesheet && !document.querySelector('link[data-brand-fonts]')) {
    const fonts = document.createElement('link')
    fonts.rel = 'stylesheet'
    fonts.href = brand.fontStylesheet
    fonts.dataset.brandFonts = ''
    document.head.appendChild(fonts)
  }
}
