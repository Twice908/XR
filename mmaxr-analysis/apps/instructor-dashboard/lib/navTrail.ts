/*
 * The pages visited in this tab, in order. The "← back" links use it so that going back to the page you came
 * from steps back in browser history (instead of pushing yet another entry), which keeps the browser's Back
 * button from replaying every page you passed through.
 */
let trail: string[] = []

export function recordVisit(path: string) {
  if (trail[trail.length - 1] === path) return
  // Arriving at the page just before the current one means we went back: drop the page we left.
  if (trail.length >= 2 && trail[trail.length - 2] === path) trail = trail.slice(0, -1)
  else trail = [...trail, path].slice(-50)
}

export const previousPath = () => trail[trail.length - 2] ?? null
