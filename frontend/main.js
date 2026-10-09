import { createApp } from 'vue'
import App from './App.vue'
import * as bootstrap from 'bootstrap'

const migrationDeadline = Date.UTC(2026, 10, 1) - 8 * 60 * 60 * 1000
const newSiteUrl = 'https://dict.vmct.top'

if (Date.now() >= migrationDeadline) {
  window.location.replace(newSiteUrl)
} else {
  window.__MIGRATION_DEADLINE__ = migrationDeadline
  window.__NEW_SITE_URL__ = newSiteUrl
}

window.bootstrap = bootstrap

const app = createApp(App)
app.mount('#app')
