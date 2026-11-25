import { XapiVerb } from '@mmaxr/schema'
import type { BiologyLessonContract } from '@mmaxr/schema'
import { go } from '../router'
import { CoachClient, loadMode } from '../services/aiCoach'
import type { LabSession } from '../services/session'
import { answerQuestion, fetchQuiz, submitChallenge, uploadAudio, visitStop, watchedStop } from '../services/biologyApi'
import { sensorTracker } from '../services/sensorTracker'
import { telemetry } from '../services/telemetry'
import { BiologyHud, type BiologyHudHandlers } from '../lab/biologyHud'
import { buildBiologySnapshot, say } from '../lab/biologyCoach'
import { BiologyScene } from '../lab/biologyScene'
import { RespiratoryScene } from '../lab/respiratoryScene'
import type { JourneyScene } from '../lab/journeyScene'
import { CoachPanel } from '../lab/coachPanel'
import { JourneyExperiment, StateError } from '../state/biology'
import { toast } from '../ui/components'

interface Ctx {
  root: HTMLElement
  canvas: HTMLCanvasElement
  status: HTMLElement
  session: LabSession
  lesson: BiologyLessonContract
  isDestroyed: () => boolean
}

/** Runs the Human Digestive System guided journey. Returns a cleanup function. */
export async function startBiologyLab(ctx: Ctx): Promise<() => void> {
  const { root, canvas, status, session, lesson } = ctx
  const exp = new JourneyExperiment(lesson, (verb, object, at) => telemetry.emit(verb, object, at))
  const sceneEvents = { onProgress: (d: number, t: number) => (status.querySelector('p')!.textContent = `Preparing your lab… ${d}/${t}`) }
  const scene: JourneyScene = lesson.type === 'biology_respiratory_system' ? new RespiratoryScene(canvas, lesson, sceneEvents) : new BiologyScene(canvas, lesson, sceneEvents)
  let hud: BiologyHud | null = null
  let coach: CoachClient | null = null
  let idleTimer: number | null = null
  let working = false

  const guard = <T,>(fn: () => T): T | undefined => {
    try {
      return fn()
    } catch (err) {
      toast(err instanceof StateError ? err.message : (err as Error).message, 'error')
      hud?.update()
      return undefined
    }
  }

  const handlers: BiologyHudHandlers = {
    onBack: () => go('/experiments'),
    // Hold a moment, clear the lower panel, then let this stop's animation play with a mini timer.
    onWatch: async () => {
      if (working) return
      working = true
      const cp = exp.stop.cp
      try {
        hud!.setWatching(true)
        const total = 5000
        const t0 = performance.now()
        const timerLabel = lesson.revealTimerLabel
        const tick = window.setInterval(() => hud!.setTimer(total - (performance.now() - t0), timerLabel), 100)
        hud!.setTimer(total, timerLabel)
        try {
          await scene.playReveal(cp.id, cp.animLabels, total)
        } finally {
          window.clearInterval(tick)
          hud!.setWatching(false)
        }
        await watchedStop(session, cp.id)
        exp.markWatched()
      } catch (err) {
        toast((err as Error).message, 'error')
      } finally {
        working = false
        hud!.update()
      }
    },
    onContinue: async () => {
      if (working) return
      working = true
      try {
        const cp = exp.stop.cp
        const last = exp.isLastStop
        const seen = await visitStop(session, cp.id)
        if (!last) {
          guard(() => exp.nextStop())
          hud!.setTraveling(true)
          await scene.arrive(exp.index)
          hud!.setTraveling(false)
          return
        }
        guard(() => exp.nextStop())
        if (seen.quizOpen) {
          const q = await fetchQuiz(session)
          exp.startQuiz(q.questions, q.answered)
          void scene.enterFinal?.()
          if (exp.stage === 'final') coach?.event('ready_to_submit', say.ready, buildBiologySnapshot(exp))
        }
      } catch (err) {
        hud!.setTraveling(false)
        toast((err as Error).message, 'error')
      } finally {
        working = false
        hud!.update()
      }
    },
    onPick: (id) => {
      guard(() => exp.pick(id))
      hud!.update()
    },
    onCheck: async () => {
      if (working) return
      const body = guard(() => exp.checkPayload())
      if (!body) return
      working = true
      hud!.setBusy('Checking…')
      try {
        const f = await answerQuestion(session, body)
        hud!.setBusy(null)
        exp.recordFeedback(f)
        if (!f.correct) coach?.event('prediction_mismatch', say.wrong(exp.question!.organ), buildBiologySnapshot(exp))
      } catch (err) {
        hud!.setBusy(null)
        toast((err as Error).message, 'error')
      } finally {
        working = false
        hud!.update()
      }
    },
    onNextQuestion: () => {
      guard(() => exp.nextQuestion())
      if (exp.stage === 'final') coach?.event('ready_to_submit', say.ready, buildBiologySnapshot(exp))
      hud!.update()
    },
    onSubmitFinal: async (audio) => {
      if (working || !exp.canSubmitFinal) return
      working = true
      hud!.setBusy('Checking your explanation…')
      try {
        const result = await submitChallenge(session, exp.finalPayload())
        if (audio) void uploadAudio(session, audio).catch(() => {})
        exp.finish(result)
        hud!.setBusy(null)
        coach?.reveal(buildBiologySnapshot(exp))
      } catch (err) {
        hud!.setBusy(null)
        toast((err as Error).message, 'error')
      } finally {
        working = false
        hud!.update()
      }
    },
    onView: (overview) => scene.overview(overview),
    onLayout: (insets) => scene.setInsets(insets),
  }

  hud = new BiologyHud(exp, handlers, lesson.title)
  root.appendChild(hud.root)

  // ---- AI coach ----
  const client = new CoachClient()
  coach = client
  const panel: CoachPanel = new CoachPanel({
    initialMode: loadMode(),
    setOpen: (open) => hud!.setPanelOpen(panel.el, open),
    onAsk: (text) => {
      client.ask(text, buildBiologySnapshot(exp))
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
    if (exp.stage !== 'done' && Date.now() - lastActive > 90_000) {
      lastActive = Date.now()
      client.event('idle', say.idle, buildBiologySnapshot(exp))
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
  scene.start()
  sensorTracker.start(session, () => scene.head, () => scene.hand)
  status.remove()
  hud.update()
  void scene.arrive(0)
  ;(window as unknown as Record<string, unknown>).__mmaxr = { exp, scene, telemetry, lesson, handlers, session }
  return cleanup
}
