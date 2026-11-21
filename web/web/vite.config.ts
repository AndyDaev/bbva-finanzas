import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Finanzas',
        short_name: 'Finanzas',
        description: 'Compras, ingresos, tickets y consejos locales',
        theme_color: '#020202',
        background_color: '#020202',
        display: 'standalone',
        start_url: '/',
        lang: 'es',
        // PNG icons let Android install it as a real app, which is what enables the shortcuts.
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Long-press the app icon: quick actions, which can also be dragged to the home screen.
        shortcuts: [
          {
            name: 'Escanear ticket',
            short_name: 'Ticket',
            url: '/?accion=ticket',
            icons: [{ src: 'shortcut-ticket.png', sizes: '96x96', type: 'image/png' }],
          },
          {
            name: 'Movimientos',
            short_name: 'Movimientos',
            url: '/?accion=movimientos',
            icons: [{ src: 'shortcut-movements.png', sizes: '96x96', type: 'image/png' }],
          },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        // Never answer API navigations (e.g. the bank OAuth callback) with the app shell.
        navigateFallbackDenylist: [/^\/api\//],
        // Unovis ships a map worker this app never uses: keep it out of the offline precache.
        globIgnores: ['**/maplibre-gl-worker-*.js'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 4,
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      // Run `npm run dev:api` (wrangler pages dev) alongside Vite
      '/api': 'http://127.0.0.1:8788',
    },
  },
})
