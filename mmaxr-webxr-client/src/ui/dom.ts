type Child = Node | string | number | false | null | undefined

export interface Props {
  class?: string
  [key: string]: unknown
}

/** Tiny hyperscript helper: h('div', {class: 'x', onclick: fn}, child, ...) */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue
    if (key === 'class') el.className = String(value)
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener)
    } else if (key === 'value' || key === 'checked' || key === 'disabled') {
      ;(el as unknown as Record<string, unknown>)[key] = value
    } else el.setAttribute(key, value === true ? '' : String(value))
  }
  append(el, children)
  return el
}

function append(el: Node, children: (Child | Child[])[]) {
  for (const c of children) {
    if (Array.isArray(c)) append(el, c)
    else if (c === null || c === undefined || c === false) continue
    else el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)))
  }
}

export function clear(el: Element) {
  while (el.firstChild) el.removeChild(el.firstChild)
}

export function mount(root: Element, ...children: Node[]) {
  clear(root)
  for (const c of children) root.appendChild(c)
}
