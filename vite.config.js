import { defineConfig, loadEnv } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// Vite config.
//
// We explicitly call loadEnv() so the dev server's `/api` proxy points at
// whatever port the backend is actually using. Without this, changing PORT
// in .env affects Bun (which reads process.env.PORT natively) but leaves
// Vite stuck on the default, causing every API call to fail with a
// generic "Network error" in the browser.
//
// `loadEnv(mode, cwd, '')` with the empty prefix means: load *all* env
// vars from .env files, not just the VITE_-prefixed ones.
//
// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendPort = env.PORT || '3000'

  return {
    plugins: [svelte()],
    server: {
      proxy: {
        '/api': {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
      },
    },
  }
})
