export interface Page {
  el: HTMLElement
  /** Remove listeners and anything the page added outside `el`. */
  destroy?: () => void
  /** Play an exit animation towards `to` (a hash path). The next page mounts once it resolves. */
  leave?: (to: string) => Promise<void>
  /** Called once `el` is in the document, for work that needs layout. */
  mounted?: () => void
}

export interface RouteContext {
  /** The path shown before this one, or null on the first page after loading. */
  from: string | null
}

export type Route = (params: string[], context: RouteContext) => Page | Promise<Page>

export interface RouteTable {
  [pattern: string]: Route
}

let forceNext = false

export const go = (path: string) => {
  if (location.hash === `#${path}`) {
    forceNext = true
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else location.hash = path
}

/**
 * Show the page for the current hash. Page changes run one at a time, so a page's exit animation
 * always finishes before the next page mounts.
 */
export function startRouter(root: HTMLElement, routes: RouteTable, guard: (path: string) => string | null) {
  let current: Page | null = null
  let currentPath: string | null = null
  let queue: Promise<void> = Promise.resolve()

  const render = async () => {
    const path = location.hash.replace(/^#/, '') || '/'
    const force = forceNext
    forceNext = false
    const redirect = guard(path)
    if (redirect && redirect !== path) return go(redirect)
    if (current && path === currentPath && !force) return

    const match = Object.entries(routes)
      .map(([pattern, route]) => {
        const re = new RegExp(`^${pattern.replace(/:[^/]+/g, '([^/]+)')}$`)
        const m = path.match(re)
        return m ? { route, params: m.slice(1).map(decodeURIComponent) } : null
      })
      .find(Boolean)
    if (!match) return go('/experiments')

    const from = currentPath
    if (current) {
      root.inert = true
      try {
        await current.leave?.(path)
      } catch (err) {
        console.warn('[router] exit animation failed', err)
      }
      current.destroy?.()
      current = null
      root.inert = false
    }
    const page = await match.route(match.params, { from })
    current = page
    currentPath = path
    root.replaceChildren(page.el)
    page.mounted?.()
  }

  const schedule = () => {
    queue = queue.then(render).catch((err) => console.error('[router] navigation failed', err))
  }
  window.addEventListener('hashchange', schedule)
  schedule()
}
