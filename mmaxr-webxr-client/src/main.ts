import './styles/tokens.css'
import './styles/ui.css'
import './styles/lab.css'
import { userAuth } from './services/userAuth'
import { startRouter, type RouteTable } from './router'
import { forgotPage, loginPage, registerPage } from './pages/auth'
import { experimentsPage } from './pages/experiments'

const PUBLIC = new Set(['/login', '/register', '/forgot'])

const routes: RouteTable = {
  '/login': () => loginPage(),
  '/register': () => registerPage(),
  '/forgot': () => forgotPage(),
  '/experiments': () => experimentsPage(),
  '/lab/:lessonId': async ([lessonId]) => (await import('./pages/lab')).labPage(lessonId),
}

async function boot() {
  const root = document.getElementById('app')
  if (!root) throw new Error('#app not found')

  // Validate any remembered session before the first route renders.
  await userAuth.refresh()

  startRouter(root, routes, (path) => {
    const signedIn = !!userAuth.current()
    if (!signedIn && !PUBLIC.has(path)) return '/login'
    if (signedIn && PUBLIC.has(path)) return '/experiments'
    return null
  })
}

boot().catch((err) => {
  console.error('[boot] fatal', err)
  document.body.textContent = `Failed to start: ${(err as Error).message}`
})
