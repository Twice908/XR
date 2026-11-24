import { XapiVerb } from '@mmaxr/schema'
import type { BiologyLessonContract, BiologyOption } from '@mmaxr/schema'
import { go } from '../router'
import { CoachClient, loadMode } from '../services/aiCoach'
import type { LabSession } from '../services/session'
import { commitStop, reviseStop, submitChallenge, uploadAudio } from '../services/biologyApi'
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
  const exp = new JourneyExperiment(lesson, (verb, object) => telemetry.emit(verb, object))
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
    onToggle: (g, id) => {
      guard(() => exp.toggle(g, id))
      hud!.update()
    },
    onConfidence: (c) => {
      guard(() => exp.setConfidence(c))
      hud!.update()
    },
    onLock: () => {
      guard(() => exp.lockPrediction())
      hud!.update()
    },
    onCommit: async (text, mode, speakMs, audio) => {
      if (working) return
      const body = guard(() => exp.commitPayload(text, mode, speakMs))
      if (!body) return
      working = true
      hud!.setBusy('Checking your explanation…')
      try {
        const reveal = await commitStop(session, body)
        if (audio) void uploadAudio(session, body.checkpoint, audio).catch(() => {})
        const wrong = !reveal.selectionScore.allCorrect || reveal.coverage < 0.5
        if (wrong) coach?.event('prediction_mismatch', say.mismatch(exp.stop.cp.organName), buildBiologySnapshot(exp))
        // The names floated over the animation come from the groups the lesson lists (digestive: juices and enzymes).
        const labelOf = (k: string) => ((reveal.answer[k] as BiologyOption[] | undefined) ?? []).filter((j) => j.id !== 'none').map((j) => j.label)
        const labels = (lesson.revealLabels ?? ['juices', 'components']).flatMap(labelOf)
        // Hold a second, clear the lower panel, then let the enzyme action play on its own with a mini timer.
        hud!.setBusy('Answer received. Watch what happens inside…')
        await new Promise((r) => setTimeout(r, 1000))
        hud!.setWatching(true)
        hud!.setBusy(null)
        exp.recordReveal(reveal)
        const total = 5000
        const t0 = performance.now()
        const timerLabel = lesson.revealTimerLabel
        const tick = window.setInterval(() => hud!.setTimer(total - (performance.now() - t0), timerLabel), 100)
        hud!.setTimer(total, timerLabel)
        try {
          await scene.playReveal(body.checkpoint, labels.length ? labels : labelOf(exp.groups[exp.groups.length - 1].key), total)
        } finally {
          window.clearInterval(tick)
          hud!.setWatching(false)
        }
      } catch (err) {
        hud!.setBusy(null)
        toast((err as Error).message, 'error')
      } finally {
        working = false
        hud!.update()
      }
    },
    onRevise: async (text) => {
      if (working) return
      working = true
      try {
        const r = await reviseStop(session, exp.stop.cp.id, text)
        exp.recordRevision(text, r.coverage, r.revisions)
        hud!.setReviseResult({ keywords: r.keywords, coverage: r.coverage, revisions: r.revisions })
        coach?.event('revision', say.revision(exp.stop.cp.organName), buildBiologySnapshot(exp))
      } catch (err) {
        toast((err as Error).message, 'error')
      } finally {
        working = false
        hud!.update()
      }
    },
    onContinue: async () => {
      if (working) return
      if (exp.isLastStop) {
        guard(() => exp.next())
        hud!.update()
        void scene.enterFinal?.()
        coach?.event('ready_to_submit', say.ready, buildBiologySnapshot(exp))
        return
      }
      working = true
      guard(() => exp.next())
      hud!.setTraveling(true)
      await scene.arrive(exp.index)
      hud!.setTraveling(false)
      working = false
    },
    onScenario: (id, option) => {
      exp.scenarioAnswers[id] = option
      hud!.update()
    },
    onSubmitFinal: async (audio) => {
      if (working || !exp.canSubmitFinal) return
      working = true
      hud!.setBusy('Checking your answers…')
      try {
        const result = await submitChallenge(session, exp.finalPayload())
        if (audio) void uploadAudio(session, 'final', audio).catch(() => {})
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
  sensorTracker.start(session.sessionId, () => scene.head, () => scene.hand)
  status.remove()
  hud.update()
  void scene.arrive(0)
  ;(window as unknown as Record<string, unknown>).__mmaxr = { exp, scene, telemetry, lesson, handlers, session }
  return cleanup
}
