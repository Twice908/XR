import { XapiVerb } from '@mmaxr/schema'
import type { SoundAct, SoundLessonContract, SoundTool } from '@mmaxr/schema'
import { go } from '../router'
import { CoachClient, loadMode } from '../services/aiCoach'
import type { LabSession } from '../services/session'
import { finishSound, runTask, submitCalc, submitExplanation, uploadAudio } from '../services/soundApi'
import { sensorTracker } from '../services/sensorTracker'
import { telemetry } from '../services/telemetry'
import { CoachPanel } from '../lab/coachPanel'
import { buildSoundSnapshot, say } from '../lab/soundCoach'
import { SoundHud, type SoundHudHandlers } from '../lab/soundHud'
import { playScan, scanImage } from '../lab/soundScan'
import { SoundScene } from '../lab/soundScene'
import { SoundExperiment, StateError, type Trial } from '../state/sound'
import { toast } from '../ui/components'

interface Ctx {
  root: HTMLElement
  canvas: HTMLCanvasElement
  status: HTMLElement
  session: LabSession
  lesson: SoundLessonContract
  isDestroyed: () => boolean
}

const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d)

/** Runs the Sound & Waves sandbox. Returns a cleanup function. */
export async function startSoundLab(ctx: Ctx): Promise<() => void> {
  const { root, canvas, status, session, lesson } = ctx
  const exp = new SoundExperiment(lesson, (verb, object) => telemetry.emit(verb, object))
  let busy = false
  let submitting = false
  let coach: CoachClient | null = null
  let idleTimer: number | null = null
  let hud: SoundHud | null = null
  let scene: SoundScene | null = null
  let place: 'field' | 'room' = 'field'
  let act: SoundAct = { freq: 3, amp: 3 }
  let shoutT = 1.4

  const taskFor = (id: string) => exp.items.find((t) => t.id === id)

  const defaultHint = (): { text: string; action: { label: string; run: () => void } | null } => {
    if (exp.pending) return { text: 'Prediction locked. Do what the checklist asks on the bench, then run it.', action: null }
    if (exp.phase === 'finish') return { text: 'Every task is run, calculated and explained. Finish to see your summary.', action: { label: 'Finish', run: () => void submit() } }
    return { text: 'Play with the instruments any time. Pick a task to predict, run and explain.', action: null }
  }
  const refresh = (hint?: { text: string; action?: { label: string; run: () => void } | null }) => {
    hud!.update()
    const d = hint ?? defaultHint()
    hud!.hint(d.text, d.action ?? null)
  }
  const guard = <T,>(fn: () => T): T | undefined => {
    try {
      return fn()
    } catch (err) {
      toast(err instanceof StateError ? err.message : (err as Error).message, 'error')
      hud?.update()
      return undefined
    }
  }
  const pushAct = () => hud?.setAct({ ...act })
  const log = (action: string, value?: string | number) => telemetry.emit(XapiVerb.INVESTIGATED, { action, value })

  /** Set the benches up for a task: the generator at its starting frequency, the right place, a clean checklist. */
  const stageFor = (t: Trial) => {
    exp.tab = t.tab
    scene!.setStage(t.tab)
    const p = t.task.params
    act = { freq: act.freq, amp: act.amp }
    if (t.id === 'wave_1') {
      act.freq = num(p.f1, 3)
      scene!.setWave({ freq: act.freq, speed: num(p.speed, 0.24) })
    }
    if (t.id === 'wave_2') {
      act.amp = num(p.a1, 3)
      scene!.setWave({ amp: act.amp })
    }
    if (t.id === 'echo_2') {
      place = 'field'
      shoutT = num(p.t, 1.4)
      scene!.setPlace('field')
      hud!.setPlaceState('field')
    }
    if (t.id === 'echo_1') {
      place = 'field'
      scene!.setPlace('field')
      hud!.setPlaceState('field')
    }
    if (t.id === 'sonar_1') {
      hud!.showSonarMode('ship')
      scene!.resetSonar(String(p.target).includes('wreck') ? 'wreck' : 'floor')
      hud!.setTimerReading(null)
    }
    if (t.id === 'ultrasound_1') {
      hud!.showSonarMode('scanner')
      hud!.setScanNote('')
    }
    hud!.setAct({ ...act })
  }

  const select = (id: string) => {
    if (busy) return
    const t = exp.trial(id)
    const gate = exp.canPredict(id)
    if (!gate.ok && !t.result) return hud!.hint(gate.reason ?? 'Not yet.', null)
    if (exp.pending && exp.pending.id !== id) return hud!.hint('Run the task you predicted first.', null)
    if (!t.result) stageFor(t)
    else {
      exp.tab = t.tab
      scene!.setStage(t.tab)
    }
    hud!.show(id)
    refresh()
  }

  const nextTask = () => {
    const t = exp.items.find((x) => !exp.isComplete(x))
    if (t) return select(t.id)
    hud!.closeCard()
    refresh()
  }

  const afterRun = (t: Trial): { text: string; action?: { label: string; run: () => void } | null } => {
    if (t.result && !exp.isComplete(t)) return { text: t.result.hasCalc && !t.calc.ok ? 'Read the instrument, then calculate the depth yourself.' : 'Look at what the instruments showed, then explain it to continue.', action: null }
    if (exp.phase === 'finish') return { text: 'Every task is run, calculated and explained. Finish to see your summary.', action: { label: 'Finish', run: () => void submit() } }
    return { text: t.result?.match ? 'As you predicted. Continue when you are ready.' : 'Not what you predicted: that is useful. Continue when you are ready.', action: { label: 'Next', run: nextTask } }
  }

  const run = async () => {
    if (busy || !exp.pending) return
    const p = exp.pending
    const body = guard(() => exp.actPayload(p.id, { ...act }))
    if (!body) return
    busy = true
    hud!.hint('Recording your run…', null)
    let result: Awaited<ReturnType<typeof runTask>>
    try {
      result = await runTask(session, body)
    } catch (err) {
      busy = false
      toast((err as Error).message, 'error')
      refresh()
      return
    }
    busy = false
    const trial = guard(() => exp.act(result))
    if (!trial) return
    if (!result.match) coach?.event('prediction_mismatch', result.anomaly ? say.anomaly : say.mismatch(trial.task.prompt), buildSoundSnapshot(exp))
    hud!.show(trial.id)
    refresh(afterRun(trial))
  }

  const calc = async (id: string, value: number) => {
    let r: Awaited<ReturnType<typeof submitCalc>>
    try {
      r = await submitCalc(session, id, value)
    } catch (err) {
      toast((err as Error).message, 'error')
      return
    }
    exp.calcResult(id, r, value)
    const t = exp.trial(id)
    if (!r.ok) {
      hud!.setCalcNote(id, 'Not quite. Think about how far the pulse really travels before the echo gets back to the ship.')
      if (r.attempts >= 3) coach?.event('prediction_mismatch', say.calc(r.attempts), buildSoundSnapshot(exp))
    }
    hud!.show(id)
    refresh(afterRun(t))
  }

  const submit = async () => {
    if (submitting) return
    if (!exp.canSubmit) return void toast(exp.submitBlocker ?? 'Not ready to finish yet.', 'error')
    submitting = true
    try {
      hud!.hint('Finishing…', null)
      const reveal = await finishSound(session)
      const summary = exp.finish(reveal)
      refresh()
      hud!.closeCard()
      hud!.showReveal(summary, reveal, () => go('/experiments'), () => undefined)
      coach?.reveal(buildSoundSnapshot(exp))
    } catch (err) {
      toast((err as Error).message, 'error')
      refresh()
    } finally {
      submitting = false
    }
  }

  let flogTimer: number | null = null
  const debounceLog = (action: string, value: number) => {
    if (flogTimer !== null) window.clearTimeout(flogTimer)
    flogTimer = window.setTimeout(() => log(action, value), 600)
  }

  scene = new SoundScene(canvas)

  const handlers: SoundHudHandlers = {
    onBack: () => go('/experiments'),
    onTab: (tab: SoundTool) => {
      if (busy) return
      exp.tab = tab
      scene!.setStage(tab)
      if (tab === 'echo') hud!.setPlaceState(place)
      refresh()
    },
    onSelect: select,
    onLock: (id, option, confidence, decisionMs) => {
      if (!guard(() => exp.predict(id, option, confidence, decisionMs))) return
      hud!.show(id)
      refresh()
    },
    onRun: () => void run(),
    onCalc: calc,
    onNoticeAnomaly: (id) => {
      guard(() => exp.noticeAnomaly(id))
      hud!.show(id)
    },
    onExplain: async (id, text, meta, audio) => {
      const body = guard(() => exp.explainPayload(id, text, meta))
      if (!body) return
      let r: Awaited<ReturnType<typeof submitExplanation>>
      try {
        r = await submitExplanation(session, body)
      } catch (err) {
        toast((err as Error).message, 'error')
        return
      }
      exp.explained(id, text, meta, r)
      hud!.show(id)
      refresh(afterRun(exp.trial(id)))
      if (audio) void uploadAudio(session, id, audio).catch(() => {})
      toast('Saved.')
      if (exp.canSubmit) coach?.event('ready_to_submit', say.ready, buildSoundSnapshot(exp))
    },
    onNext: nextTask,
    onSubmit: () => void submit(),
    onLayout: (insets) => scene?.setInsets(insets),
    /* ---- instruments ---- */
    onFreq: (v) => {
      act.freq = v
      scene!.setWave({ freq: v })
      debounceLog('set_frequency', v)
    },
    onAmp: (v) => {
      act.amp = v
      scene!.setWave({ amp: v })
      debounceLog('set_amplitude', v)
    },
    onToggleRun: (running) => scene!.setRunning(running),
    onPlace: (p) => {
      place = p
      scene!.setPlace(p)
      hud!.setPlaceState(p)
    },
    onClap: () => {
      if (scene!.isBusy) return
      const rt = num(taskFor('echo_1')?.task.params.rt, 0.9)
      void scene!.clap(place, rt)
      if (place === 'field') act.clappedField = true
      else act.clappedRoom = true
      log('clap', place)
      pushAct()
    },
    onShout: () => {
      if (scene!.isBusy) return
      act.measuredT = undefined
      log('shout')
      void scene!.shout(shoutT, () => hud!.startStopwatch(), () => undefined)
      pushAct()
    },
    onStopwatchStop: (seconds) => {
      if (seconds < 0.15) return toast('Shout first: that starts the stopwatch.', 'error')
      act.measuredT = Math.round(seconds * 100) / 100
      log('stopwatch_stop', act.measuredT)
      pushAct()
    },
    onPulse: () => {
      if (scene!.isBusy) return
      const t = taskFor('sonar_1')
      const p = t?.task.params ?? {}
      const echoT = num(p.t, 0.8)
      hud!.setTimerReading(null)
      log('send_pulse')
      void scene!.ping(echoT, num(p.speed, 1500), String(p.target ?? '').includes('wreck') ? 'wreck' : 'floor', () => undefined, () => {
        hud!.setTimerReading(echoT)
        act.pulse = true
        pushAct()
      })
    },
    onSonarMode: () => undefined,
    onScan: (kind) => {
      const p = taskFor('ultrasound_1')?.task.params ?? {}
      const fa = num(p.fa, 1)
      const cyst = num(p.s, 4)
      const lambdaMm = kind === 'audible' ? (343 / (fa * 1000)) * 1000 : (1540 / 5_000_000) * 1000
      const label = kind === 'audible' ? `Audible sound, ${fa} kHz: wavelength about ${Math.round(lambdaMm / 10)} cm` : `Ultrasound, 5 MHz: wavelength about ${(lambdaMm).toFixed(2)} mm`
      hud!.setScanNote(label)
      log('scan', kind)
      void playScan(hud!.scanCanvas, scanImage({ lambdaMm, label }, cyst, 17), 1.6).then(() => {
        if (kind === 'audible') act.scannedAudible = true
        else act.scannedUltra = true
        pushAct()
      })
    },
  }

  hud = new SoundHud(exp, handlers, lesson.title)
  root.appendChild(hud.root)

  // ---- AI coach ----
  const client = new CoachClient()
  coach = client
  const panel: CoachPanel = new CoachPanel({
    initialMode: loadMode(),
    setOpen: (open) => hud!.setPanelOpen(panel.el, open),
    onAsk: (text) => {
      client.ask(text, buildSoundSnapshot(exp))
      telemetry.emit(XapiVerb.INVESTIGATED, { action: 'ask_coach', data: { length: text.length } })
    },
    onMode: (mode) => {
      client.setMode(mode)
      telemetry.emit(XapiVerb.INVESTIGATED, { action: 'coach_mode', value: mode })
    },
  })
  hud.attachPanel(panel.el, panel.toggle, (open) => panel.setOpenState(open), panel.bubble)
  let info: { provider?: string; configured?: boolean } = {}
  client.onStatus((s) => panel.setStatus(s, info))
  client.onMessage((m) => {
    if (m.type === 'ready') {
      info = { provider: m.provider, configured: m.configured }
      panel.setStatus('online', info)
    } else if (m.type === 'thinking') panel.setThinking(true)
    else if (m.type === 'coach') {
      panel.addCoach(m.text, m.reason, m.degraded)
      if (m.reason === 'wrapup') hud!.setPanelOpen(panel.el, true)
    } else if (m.type === 'coach_off' || m.type === 'error') panel.setThinking(false)
  })
  client.connect({ sessionId: session.sessionId, studentId: session.studentId, token: session.token }, { lessonId: lesson.lessonId, title: lesson.title, labType: lesson.type, summary: lesson.summary })
  let lastActive = Date.now()
  root.addEventListener('pointerdown', () => (lastActive = Date.now()))
  idleTimer = window.setInterval(() => {
    if (exp.phase !== 'reveal' && Date.now() - lastActive > 75_000) {
      lastActive = Date.now()
      client.event('idle', say.idle, buildSoundSnapshot(exp))
    }
  }, 10_000)

  await scene.load(lesson, (done, total) => {
    status.querySelector('p')!.textContent = `Preparing your lab… ${done}/${total}`
  })
  if (ctx.isDestroyed()) {
    cleanup()
    return () => {}
  }
  scene.start()
  sensorTracker.start(session.sessionId, () => scene!.head, () => scene!.hand)
  status.remove()
  scene.setWave({ freq: 3, amp: 3, speed: 0.24 })
  refresh()
  ;(window as unknown as Record<string, unknown>).__mmaxr = { exp, scene, telemetry, lesson, handlers }

  function cleanup() {
    if (idleTimer !== null) window.clearInterval(idleTimer)
    if (flogTimer !== null) window.clearTimeout(flogTimer)
    coach?.disconnect()
    hud?.destroy()
    scene?.dispose()
  }
  return cleanup
}
