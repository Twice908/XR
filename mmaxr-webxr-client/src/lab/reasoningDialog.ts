import { dialog, button, setDisabled } from '../ui/components'
import { h } from '../ui/dom'
import { VoiceBox } from './voiceBox'

export interface Reasoning {
  text: string
  inputMode: 'voice' | 'typed'
  speakMs: number
  audio: Blob | null
}

/** Asks the student to explain their conclusions, aloud or typed, before they submit. Resolves null if they back out. */
export function askReasoning(opts: { title: string; description: string; minWords?: number; confirm?: string }): Promise<Reasoning | null> {
  const min = opts.minWords ?? 10
  return new Promise((resolve) => {
    let done = false
    const finish = (r: Reasoning | null) => {
      if (done) return
      done = true
      box.destroy()
      dlg.close()
      resolve(r)
    }
    const go = button(opts.confirm ?? 'Continue to submit', { variant: 'primary', onClick: () => box.ready && finish({ text: box.text.trim(), inputMode: box.mode, speakMs: box.speakMs, audio: box.audio }) })
    const box = new VoiceBox({ minWords: min, onChange: () => setDisabled(go, !box.ready) })
    setDisabled(go, true)
    const dlg = dialog({ title: opts.title, description: opts.description, wide: true, dismissable: false, onClose: () => finish(null) })
    dlg.body.append(box.el, h('div', { class: 'dialog-actions' }, button('Not yet', { variant: 'ghost', onClick: () => finish(null) }), go))
    box.focus()
  })
}
