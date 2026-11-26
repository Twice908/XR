import type { MissionsNarration } from '@mmaxr/schema'
import { sound } from './sound'

/**
 * Speaks MMAXR's recorded narration lines with a caption. One line at a time: a new line cuts the old one off.
 * With sound off (the lab's sound switch) the caption still shows, for about as long as the line would take.
 */
export class Narrator {
  private audio: HTMLAudioElement | null = null
  private hideTimer = 0
  private onSpeaking: (speaking: boolean) => void

  constructor(
    private readonly caption: HTMLElement,
    onSpeaking: (speaking: boolean) => void = () => {},
  ) {
    this.onSpeaking = onSpeaking
    caption.hidden = true
  }

  say(line: MissionsNarration | null | undefined) {
    this.stop()
    if (!line) return
    this.caption.textContent = line.text
    this.caption.hidden = false
    const readMs = Math.max(3500, line.text.split(/\s+/).length * 380)
    const done = () => {
      this.audio = null
      this.onSpeaking(false)
      window.clearTimeout(this.hideTimer)
      this.hideTimer = window.setTimeout(() => (this.caption.hidden = true), 1800)
    }
    if (!line.audioUrl || sound.muted) {
      this.hideTimer = window.setTimeout(() => (this.caption.hidden = true), readMs)
      return
    }
    const audio = new Audio(line.audioUrl)
    this.audio = audio
    audio.addEventListener('ended', done, { once: true })
    audio.addEventListener('error', done, { once: true })
    this.onSpeaking(true)
    audio.play().catch(() => {
      // Autoplay refused or the file is missing: the caption carries the line.
      done()
      this.hideTimer = window.setTimeout(() => (this.caption.hidden = true), readMs)
    })
  }

  stop() {
    window.clearTimeout(this.hideTimer)
    if (this.audio) {
      this.audio.pause()
      this.audio = null
      this.onSpeaking(false)
    }
    this.caption.hidden = true
  }

  dispose() {
    this.stop()
  }
}
