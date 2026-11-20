import { h } from '../ui/dom'
import { button } from '../ui/components'
import { VoiceCapture, voiceSupport, type VoiceResult } from './voice'

export const wordsIn = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

export interface VoiceBoxOptions {
  minWords: number
  placeholder?: string
  initial?: string
  /** Called whenever the text, or what has been recorded, changes. */
  onChange?(): void
}

/**
 * The same explain-aloud control the digestive-system lab uses: record, watch the words appear, fix them,
 * or just type. Spoken answers keep the recording (for the instructor); typed ones are flagged as typed.
 */
export class VoiceBox {
  readonly el: HTMLElement
  private voice = new VoiceCapture()
  private area: HTMLTextAreaElement
  private mic: HTMLButtonElement
  private note = h('span', { class: 't-support' })
  private count = h('span', { class: 't-support t-mono' })
  private recorded: VoiceResult | null = null
  private failed = false

  constructor(private readonly opts: VoiceBoxOptions) {
    const support = voiceSupport()
    this.area = h('textarea', {
      class: 'input bio-text',
      rows: '4',
      placeholder: opts.placeholder ?? (support.recognition ? 'Press record and explain aloud. Your words appear here, and you can fix them.' : 'Explain in your own words…'),
      'aria-label': 'Your explanation',
      oninput: () => this.changed(),
    }) as HTMLTextAreaElement
    this.area.value = opts.initial ?? ''
    this.mic = button('● Record my explanation', { variant: 'secondary', onClick: () => void this.toggle() })
    this.note.textContent = !support.recorder ? 'This browser cannot record. Type your explanation instead.' : 'You can speak your answer or type it.'
    this.el = h('div', { class: 'stack', style: 'gap:8px' }, h('div', { class: 'row', style: 'gap:12px;flex-wrap:wrap' }, this.mic, this.note), this.area, this.count)
    this.paint()
  }

  get text(): string {
    return this.area.value
  }
  get mode(): 'voice' | 'typed' {
    return this.recorded ? 'voice' : 'typed'
  }
  get speakMs(): number {
    return this.recorded?.durationMs ?? 0
  }
  get audio(): Blob | null {
    return this.recorded?.blob ?? null
  }
  get ready(): boolean {
    return wordsIn(this.area.value) >= this.opts.minWords && !this.voice.recording
  }
  focus() {
    this.area.focus()
  }

  private changed() {
    this.paint()
    this.opts.onChange?.()
  }
  private paint() {
    this.count.textContent = `${wordsIn(this.area.value)} / ${this.opts.minWords} words`
  }

  private async toggle() {
    if (this.voice.recording) {
      const r = await this.voice.stop()
      this.recorded = r
      if (r.transcript && wordsIn(r.transcript) >= wordsIn(this.area.value)) this.area.value = r.transcript
      this.mic.textContent = '● Record again'
      this.note.textContent = `Recorded ${(r.durationMs / 1000).toFixed(0)}s. You can record again or edit the text.`
      this.changed()
      return
    }
    this.note.textContent = 'Listening… speak now.'
    const ok = await this.voice.start(
      (text) => {
        this.area.value = text
        this.changed()
      },
      (msg) => {
        this.note.textContent = msg
      },
    )
    if (!ok) {
      this.failed = true
      this.note.textContent = 'The microphone is not available. Type your explanation instead.'
      return
    }
    this.mic.textContent = '■ Stop'
    this.opts.onChange?.()
  }

  destroy() {
    this.voice.cancel()
    void this.failed
  }
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}
