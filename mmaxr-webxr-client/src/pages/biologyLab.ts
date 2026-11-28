import type { BiologyLessonContract } from '@mmaxr/schema'
import { go } from '../router'
import type { CoachClient } from '../services/aiCoach'
import type { LabSession } from '../services/session'
import { answerQuestion, fetchQuiz, submitChallenge, uploadAudio, visitStop, watchedStop } from '../services/biologyApi'
import { sensorTracker } from '../services/sensorTracker'
import { telemetry } from '../services/telemetry'
import { BiologyHud, type BiologyHudHandlers } from '../lab/biologyHud'
import { buildBiologySnapshot, say } from '../lab/biologyCoach'
import { BiologyScene } from '../lab/biologyScene'
import { RespiratoryScene } from '../lab/respiratoryScene'
import type { JourneyScene } from '../lab/journeyScene'
import { startCoach } from '../lab/coach'
import { JourneyExperiment, StateError } from '../state/biology'
import { toast } from '../ui/components'

interface Ctx {
  root: HTMLElement
  canvas: HTMLCanvasElement
  status: HTMLElement
  session: LabSession
  lesson: BiologyLessonContract
  isDestroyed: () => boolean
  /** Speaks a recorded narration line once (mmaxr-assets/narration/<lessonId>.json). */
  narrate?: (cueId: string) => void
}

/** Runs the Human Digestive System guided journey. Returns a cleanup function. */
export async function startBiologyLab(ctx: Ctx): Promise<() => void> {
  const { root, canvas, status, session, lesson } = ctx
  const narrate = ctx.narrate ?? (() => undefined)
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
          narrate(`stop-${exp.stop.cp.id.replace(/_/g, '-')}`)
          return
        }
        guard(() => exp.nextStop())
        if (seen.quizOpen) {
          const q = await fetchQuiz(session)
          exp.startQuiz(q.questions, q.answered)
          narrate(exp.stage === 'final' ? 'final' : 'quiz-start')
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
        if (!f.correct) narrate('wrong-answer')
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
      if (exp.stage === 'final') narrate('final')
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
        narrate('reveal')
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
  const labCoach = startCoach({
    session,
    hello: { lessonId: lesson.lessonId, title: lesson.title, labType: lesson.type, summary: lesson.summary },
    snapshot: () => buildBiologySnapshot(exp),
    mount: hud,
    finished: () => exp.stage === 'done',
    idleMs: 90_000,
    idleText: say.idle,
    activityRoot: root,
  })
  coach = labCoach.client

  const cleanup = () => {
    if (idleTimer !== null) window.clearInterval(idleTimer)
    labCoach.dispose()
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
  if (exp.stage === 'tour') narrate(`stop-${exp.stop.cp.id.replace(/_/g, '-')}`)
  ;(window as unknown as Record<string, unknown>).__mmaxr = { exp, scene, telemetry, lesson, handlers, session }
  return cleanup
}
