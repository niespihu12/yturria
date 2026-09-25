import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

// react-hook-form mutates formState/errors in place, so React Compiler memoization
// freezes validation messages and dirty flags. Components using it are not compiled.
function usesReactHookForm(filename) {
  try {
    return readFileSync(filename.split('?')[0], 'utf8').includes('react-hook-form')
  } catch {
    return false
  }
}

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    tailwindcss(),
    react(),
    babel({ presets: [reactCompilerPreset({ sources: (filename) => !usesReactHookForm(filename) })] }),
  ],
})
