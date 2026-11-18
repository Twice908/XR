/*
 * Explain-aloud capture: records the microphone (kept for the instructor) and, where the browser can,
 * transcribes it live so the words can be scored. Typing always works as a fallback.
 */

type RecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

export interface VoiceSupport {
  recorder: boolean
  recognition: boolean
}

export function voiceSupport(): VoiceSupport {
  const w = window as unknown as Record<string, unknown>
  return {
    recorder: typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof MediaRecorder !== 'undefined',
    recognition: !!(w.SpeechRecognition || w.webkitSpeechRecognition),
  }
}

export interface VoiceResult {
  blob: Blob | null
  durationMs: number
  transcript: string
}

export class VoiceCapture {
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private recognition: RecognitionLike | null = null
  private chunks: Blob[] = []
  private startedAt = 0
  private finalText = ''
  private active = false

  get recording(): boolean {
    return this.active
  }

  /** Resolves true when the microphone is live. */
  async start(onText: (text: string) => void, onError: (message: string) => void): Promise<boolean> {
    const support = voiceSupport()
    if (!support.recorder) {
      onError('Recording is not available in this browser. Type your explanation instead.')
      return false
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      onError('The microphone is blocked. Allow it in your browser, or type your explanation instead.')
      return false
    }
    this.chunks = []
    this.finalText = ''
    this.recorder = new MediaRecorder(this.stream)
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data)
    this.recorder.start()
    this.startedAt = performance.now()
    this.active = true

    if (support.recognition) {
      const w = window as unknown as Record<string, new () => RecognitionLike>
      const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
      const rec = new Ctor()
      rec.continuous = true
      rec.interimResults = true
      rec.lang = 'en-US'
      rec.onresult = (e) => {
        let interim = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]
          if (r.isFinal) this.finalText += `${r[0].transcript.trim()} `
          else interim += r[0].transcript
        }
        onText(`${this.finalText}${interim}`.trim())
      }
      rec.onerror = (e) => {
        if (e.error !== 'no-speech' && e.error !== 'aborted') onError('Live transcription stopped. You can finish by typing.')
      }
      rec.onend = () => {
        // Chrome ends continuous recognition on silence; restart while still recording.
        if (this.active) {
          try {
            rec.start()
          } catch {
            /* already running */
          }
        }
      }
      try {
        rec.start()
        this.recognition = rec
      } catch {
        this.recognition = null
      }
    } else {
      onError('Your browser records but cannot transcribe. Type what you said below.')
    }
    return true
  }

  async stop(): Promise<VoiceResult> {
    this.active = false
    const durationMs = Math.round(performance.now() - this.startedAt)
    try {
      this.recognition?.stop()
    } catch {
      /* ignore */
    }
    const blob = await new Promise<Blob | null>((resolve) => {
      if (!this.recorder || this.recorder.state === 'inactive') return resolve(this.chunks.length ? new Blob(this.chunks, { type: this.recorder?.mimeType || 'audio/webm' }) : null)
      this.recorder.onstop = () => resolve(this.chunks.length ? new Blob(this.chunks, { type: this.recorder?.mimeType || 'audio/webm' }) : null)
      this.recorder.stop()
    })
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.recorder = null
    this.recognition = null
    return { blob, durationMs, transcript: this.finalText.trim() }
  }

  cancel() {
    this.active = false
    try {
      this.recognition?.stop()
    } catch {
      /* ignore */
    }
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
  }
}
