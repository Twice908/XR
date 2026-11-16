import type { ChatMessage } from '../services/aiCoach'

export function mountChatOverlay(root: HTMLElement): {
  append: (msg: ChatMessage) => void
  onSubmit: (cb: (text: string) => void) => void
} {
  root.innerHTML = `
    <div class="mmaxr-chat">
      <div class="mmaxr-chat-log" role="log" aria-live="polite"></div>
      <form class="mmaxr-chat-form">
        <input type="text" placeholder="Ask your coach…" autocomplete="off" />
        <button type="submit">Send</button>
      </form>
    </div>
  `
  const log = root.querySelector<HTMLDivElement>('.mmaxr-chat-log')!
  const form = root.querySelector<HTMLFormElement>('.mmaxr-chat-form')!
  const input = form.querySelector<HTMLInputElement>('input')!

  // Dedupe state — prevents double-rendering when backend echoes
  let lastAppend: { role: string; text: string; at: number } | null = null

  return {
    append(msg) {
      const now = Date.now()
      if (
        lastAppend &&
        lastAppend.role === msg.role &&
        lastAppend.text === msg.text &&
        now - lastAppend.at < 2000
      ) {
        return // same message within 2s — skip
      }
      lastAppend = { role: msg.role, text: msg.text, at: now }

      const el = document.createElement('div')

      if (msg.role === 'system' || msg.flagged) {
        el.className = 'mmaxr-chat-msg mmaxr-chat-system'
        el.textContent = `⚠️ ${msg.text}`
      } else if (msg.role === 'student') {
        el.className = 'mmaxr-chat-msg mmaxr-chat-student'
        el.textContent = msg.text
      } else {
        el.className = 'mmaxr-chat-msg mmaxr-chat-coach'
        el.textContent = msg.text
      }

      log.appendChild(el)
      log.scrollTop = log.scrollHeight
    },
    onSubmit(cb) {
      form.addEventListener('submit', (e) => {
        e.preventDefault()
        const text = input.value.trim()
        if (!text) return
        input.value = ''
        cb(text)
      })
    },
  }
}