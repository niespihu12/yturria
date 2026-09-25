import { defineConfig, loadEnv } from 'vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

const BRANDS = JSON.parse(readFileSync(new URL('./src/brands.json', import.meta.url), 'utf8'))

// react-hook-form mutates formState/errors in place, so React Compiler memoization
// freezes validation messages and dirty flags. Components using it are not compiled.
function usesReactHookForm(filename) {
  try {
    return readFileSync(filename.split('?')[0], 'utf8').includes('react-hook-form')
  } catch {
    return false
  }
}

// Escribe la marca (VITE_BRAND) en index.html: el tema, el favicon y las fuentes
// se aplican antes de que cargue el JavaScript (sin parpadeo ni FOUT tardío).
function brandHtml() {
  let brand = BRANDS.aos
  return {
    name: 'brand-html',
    configResolved(config) {
      const { VITE_BRAND } = loadEnv(config.mode, config.envDir ?? process.cwd(), 'VITE_')
      brand = BRANDS[VITE_BRAND] ?? BRANDS.aos
    },
    transformIndexHtml(html) {
      const branded = html
        .replace('<html lang="es">', `<html lang="es" data-brand="${brand.key}">`)
        .replace(/<title>.*<\/title>/, `<title>${brand.documentTitle}</title>`)
        .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" type="image/png" href="${brand.mark.src}" />`)
      return {
        html: branded,
        tags: [
          { tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.googleapis.com' }, injectTo: 'head' },
          { tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }, injectTo: 'head' },
          { tag: 'link', attrs: { rel: 'stylesheet', href: brand.fontStylesheet, 'data-brand-fonts': '' }, injectTo: 'head' },
        ],
      }
    },
  }
}

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    brandHtml(),
    tailwindcss(),
    react(),
    babel({ presets: [reactCompilerPreset({ sources: (filename) => !usesReactHookForm(filename) })] }),
  ],
})
