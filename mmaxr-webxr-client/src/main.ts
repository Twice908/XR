import './styles/tokens.css'
import './styles/ui.css'
import './styles/lab.css'
import './styles/missions.css'
import './styles/cosmic.css'
import { userAuth } from './services/userAuth'
import { startRouter, type Page, type RouteTable } from './router'
import { forgotPage, loginPage, registerPage } from './pages/auth'
import { experimentsPage } from './pages/experiments'
import { getStage } from './stage/index.js'
import { lessonPalette } from './stage/theme.js'

const PUBLIC = new Set(['/login', '/register', '/forgot'])

/**
 * A lab keeps its own look: the cosmos steps aside while the lab runs, and the veil covers the
 * hand-over in the lab planet's colours in both directions.
 */
async function labRoute(lessonId: string): Promise<Page> {
  const stage = getStage()
  const palette = lessonPalette(lessonId)
  // No space music inside a lab: labs bring their own sound.
  stage.setQuiet(true)
  if (!stage.veil.showing) await stage.veil.show(palette, stage.time(300))
  const page = (await import('./pages/lab')).labPage(lessonId)
  return {
    ...page,
    mounted() {
      stage.setCosmic(false)
      page.mounted?.()
      stage.veil.setLabel('')
      void stage.veil.hide(stage.time(650))
    },
    async leave() {
      stage.setQuiet(false)
      stage.veil.setLabel('')
      await stage.veil.show(palette, stage.time(380))
    },
  }
}

const routes: RouteTable = {
  '/login': (_, context) => loginPage(context),
  '/register': (_, context) => registerPage(context),
  '/forgot': (_, context) => forgotPage(context),
  '/experiments': (_, context) => experimentsPage(context),
  '/lab/:lessonId': ([lessonId]) => labRoute(lessonId),
}

async function boot() {
  const root = document.getElementById('app')
  if (!root) throw new Error('#app not found')
  root.classList.add('app-shell')

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
