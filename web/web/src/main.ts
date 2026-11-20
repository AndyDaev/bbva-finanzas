import { createApp } from 'vue'
import { registerSW } from 'virtual:pwa-register'
import App from './App.vue'
import './assets/index.css'

/**
 * An older service worker may answer an API navigation (such as the bank callback) with the
 * app shell. If that happens, drop the service worker and reload so the request reaches the server.
 */
async function escapeApiNavigation() {
  if (!window.location.pathname.startsWith('/api/')) return false
  const registrations = (await navigator.serviceWorker?.getRegistrations?.()) || []
  await Promise.all(registrations.map((registration) => registration.unregister()))
  window.location.reload()
  return true
}

escapeApiNavigation().then((redirected) => {
  if (redirected) return
  registerSW({ immediate: true })
  createApp(App).mount('#app')
})
