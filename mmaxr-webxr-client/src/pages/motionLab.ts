import { XapiVerb } from '@mmaxr/schema'
import type { MotionLessonContract } from '@mmaxr/schema'
import { go } from '../router'
import { CoachClient, loadMode } from '../services/aiCoach'
import type { LabSession } from '../services/session'
import { explainResult, lockPrediction, observeResult, uploadExplainAudio } from '../services/motionApi'
import { sensorTracker } from '../services/sensorTracker'
import { telemetry } from '../services/telemetry'
import { MotionHud, type MotionHudHandlers } from '../lab/motionHud'
import { buildMotionSnapshot, say } from '../lab/motionCoach'
import { MotionScene, type MotionSceneEvents, type SandboxScene } from '../lab/motionScene'
import { MagnetismScene } from '../lab/magnetismScene'
import { CircuitsScene } from '../lab/circuitsScene'
import { CoachPanel } from '../lab/coachPanel'
import { MotionExperiment, StateError } from '../state/motion'
import { toast } from '../ui/components'

interface Ctx {
  root: HTMLElement
  canvas: HTMLCanvasElement
  status: HTMLElement
  session: LabSession
  lesson: MotionLessonContract
  isDestroyed: () => boolean
}

/** Runs the Motion, Forces & Gravitation sandbox. Returns a cleanup function. */
export async function startMotionLab(ctx: Ctx): Promise<() => void> {
  const { root, canvas, status, session, lesson } = ctx
  const exp = new MotionExperiment(lesson, (verb, object) => telemetry.emit(verb, object))
  let hud: MotionHud | null = null
  let coach: CoachClient | null = null
  let idleTimer: number | null = null
  let working = false
  const events: MotionSceneEvents = {
    onProgress: (d, t) => (status.querySelector('p')!.textContent = `Preparing your lab… ${d}/${t}`),
    onGauges: (g) => hud?.setGauges(g),
    onNote: (n) => hud?.setNote(n),
  }
  // the motion sandbox and the magnetism lab share this page: same questions, locked predictions and explanations
  const scene: SandboxScene = lesson.type === 'physics_circuits' ? new CircuitsScene(canvas, lesson, events) : lesson.type === 'physics_electromagnetism' ? new MagnetismScene(canvas, lesson, events) : new MotionScene(canvas, lesson, events)


  /** Puts the equipment for the current question on the table, so the picture matches what is being asked. */
  const stageTrial = () => {
    const t = exp.current
    if (t.stage === 'open' && t.trial.action) scene.stage?.(t.trial.action, t.trial.params)
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
  const free = (what: string) => telemetry.emit(XapiVerb.INVESTIGATED, { action: 'free_play', value: what })

  /** Plays the experiment, then asks the server what really happened. */
  const runAndObserve = async () => {
    const t = guard(() => exp.startRun())
    if (!t) return
    working = true
    hud!.update()
    try {
      if (t.trial.action) await scene.run(t.trial.action, t.trial.params)
      if (ctx.isDestroyed()) return
      hud!.setBusy(t.trial.action ? 'Checking what happened…' : 'Checking your answer…')
      const obs = await observeResult(session, t.trial.id)
      exp.recordObservation(obs)
      if (!obs.match) coach?.event('prediction_mismatch', say.mismatch(t.n), buildMotionSnapshot(exp))
      if (exp.allDone) {
        coach?.event('ready_to_submit', say.done, buildMotionSnapshot(exp))
        coach?.reveal(buildMotionSnapshot(exp))
      }
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      working = false
      hud?.setBusy(null)
      hud?.update()
    }
  }

  const handlers: MotionHudHandlers = {
    onBack: () => go('/experiments'),
    onModule: (id) => {
      if (working) return
      hud!.setSummary(false)
      hud!.setFreeDriving(false)
      exp.switchModule(id)
      hud!.update()
      void scene.goto(id).then(stageTrial)
    },
    onNumber: (f, text) => {
      guard(() => exp.setNumber(f, text))
      hud!.refreshLock()
    },
    onChoice: (id) => {
      guard(() => exp.setChoice(id))
      hud!.update()
    },
    onConfidence: (c) => {
      guard(() => exp.setConfidence(c))
      hud!.update()
    },
    onLock: async () => {
      if (working) return
      const body = guard(() => exp.lockPayload())
      if (!body) return
      working = true
      hud!.setBusy('Locking in…')
      try {
        await lockPrediction(session, body)
        exp.recordLocked(body.thinkMs)
        hud!.setBusy(null)
        working = false
        hud!.update()
        if (!exp.current.trial.action) await runAndObserve()
      } catch (err) {
        hud!.setBusy(null)
        toast((err as Error).message, 'error')
      } finally {
        working = false
        hud!.update()
      }
    },
    onRun: () => {
      if (working) return
      void runAndObserve()
    },
    onExplain: async (text, mode, speakMs, audio) => {
      if (working) return
      exp.setExplanation(text, mode, speakMs)
      const body = guard(() => exp.explainPayload())
      if (!body) return
      working = true
      hud!.setBusy('Checking your explanation…')
      try {
        const r = await explainResult(session, body.trial, body.explanation, body.inputMode, body.speakMs)
        if (audio) void uploadExplainAudio(session, body.trial, audio).catch(() => {})
        exp.recordExplained(r)
        coach?.event('revision', say.explained(exp.current.n), buildMotionSnapshot(exp))
        if (exp.allDone) coach?.reveal(buildMotionSnapshot(exp))
      } catch (err) {
        toast((err as Error).message, 'error')
      } finally {
        working = false
        hud!.setBusy(null)
        hud!.update()
      }
    },
    onNext: () => {
      if (exp.allDone && !exp.canAdvance) {
        hud!.setSummary(true)
        return
      }
      exp.advance()
      hud!.setGauges(null)
      scene.reset()
      stageTrial()
      hud!.update()
    },
    onReplay: () => {
      const a = exp.current.trial.action
      if (!a || working || scene.busy) return
      free(`replay_${exp.current.trial.id}`)
      hud!.update()
      void scene.run(a, exp.current.trial.params)
    },
    onFreeDrive: (on) => {
      if (on) {
        scene.startFreeDrive()
        free('free_drive')
      } else scene.stopFreeDrive()
      hud!.setFreeDriving(scene.isFreeDriving)
    },
    onDrive: (thr, steer) => scene.driveInput(thr, steer),
    onPush: (force) => {
      if (working || scene.busy) return
      free(`push_heavy_${force}`)
      void scene.runPushHeavy(force)
    },
    onLayout: (insets) => scene.setInsets(insets),
  }

  hud = new MotionHud(exp, handlers, lesson.title)
  root.appendChild(hud.root)

  // ---- AI coach ----
  const client = new CoachClient()
  coach = client
  const panel: CoachPanel = new CoachPanel({
    initialMode: loadMode(),
    setOpen: (open) => hud!.setPanelOpen(panel.el, open),
    onAsk: (text) => {
      client.ask(text, buildMotionSnapshot(exp))
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
    if (!exp.allDone && Date.now() - lastActive > 90_000) {
      lastActive = Date.now()
      client.event('idle', say.idle, buildMotionSnapshot(exp))
    }
  }, 10_000)

  const cleanup = () => {
    if (idleTimer !== null) window.clearInterval(idleTimer)
    coach?.disconnect()
    hud?.destroy()
    scene.dispose()
  }

  await scene.load()
  if (ctx.isDestroyed()) {
    cleanup()
    return () => {}
  }
  await scene.goto(lesson.scenarios[0].id, true)
  stageTrial()
  scene.start()
  sensorTracker.start(session.sessionId, () => scene.head, () => scene.hand)
  status.remove()
  hud.update()
  ;(window as unknown as Record<string, unknown>).__mmaxr = { exp, scene, telemetry, lesson, handlers }
  return cleanup
}
