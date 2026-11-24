export interface Page {
  el: HTMLElement
  destroy?: () => void
}

export type Route = (params: string[]) => Page | Promise<Page>

export interface RouteTable {
  [pattern: string]: Route
}

let current: Page | null = null

export const go = (path: string) => {
  if (location.hash === `#${path}`) window.dispatchEvent(new HashChangeEvent('hashchange'))
  else location.hash = path
}

export function startRouter(root: HTMLElement, routes: RouteTable, guard: (path: string) => string | null) {
  let token = 0
  const render = async () => {
    const path = location.hash.replace(/^#/, '') || '/'
    const redirect = guard(path)
    if (redirect && redirect !== path) return go(redirect)

    const mine = ++token
    const match = Object.entries(routes)
      .map(([pattern, route]) => {
        const re = new RegExp(`^${pattern.replace(/:[^/]+/g, '([^/]+)')}$`)
        const m = path.match(re)
        return m ? { route, params: m.slice(1).map(decodeURIComponent) } : null
      })
      .find(Boolean)
    if (!match) return go('/experiments')

    current?.destroy?.()
    current = null
    const page = await match.route(match.params)
    if (mine !== token) return page.destroy?.()
    current = page
    root.replaceChildren(page.el)
  }
  window.addEventListener('hashchange', () => void render())
  void render()
}
