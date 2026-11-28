import type { OpticsLessonContract } from '@mmaxr/schema'
import { go } from '../router'
import type { CoachClient } from '../services/aiCoach'
import type { LabSession } from '../services/session'
import { lockIn, runTrial, submitExplanation, uploadAudio } from '../services/opticsApi'
import { sensorTracker } from '../services/sensorTracker'
import { telemetry } from '../services/telemetry'
import { startCoach } from '../lab/coach'
import { buildOpticsSnapshot, say } from '../lab/opticsCoach'
import { OpticsHud, type OpticsHudHandlers } from '../lab/opticsHud'
import { OpticsScene, type Stage } from '../lab/opticsScene'
import { IMAGE_FIELDS, OpticsExperiment, StateError, type Tool, type Trial } from '../state/optics'
import { toast } from '../ui/components'

interface Ctx {
  root: HTMLElement
  canvas: HTMLCanvasElement
  status: HTMLElement
  session: LabSession
  lesson: OpticsLessonContract
  isDestroyed: () => boolean
  /** Speaks a recorded narration line once (mmaxr-assets/narration/<lessonId>.json). */
  narrate?: (cueId: string) => void
}

const STAGE_OF: Record<Tool, Stage> = { plane: 'plane', law: 'laws', rule: 'rules', concave: 'concave', convex: 'convex' }

/** Runs the Light: Reflection & Spherical Mirrors lab. Returns a cleanup function. */
export async function startOpticsLab(ctx: Ctx): Promise<() => void> {
  const { root, canvas, status, session, lesson } = ctx
  const narrate = ctx.narrate ?? (() => undefined)
  const exp = new OpticsExperiment(lesson, (verb, object, at) => telemetry.emit(verb, object, at))
  let busy = false
  let submitting = false
  let coach: CoachClient | null = null
  let idleTimer: number | null = null
  let hud: OpticsHud | null = null
  let scene: OpticsScene | null = null
  let stage: Stage | null = null

  const defaultHint = (): { text: string; action: { label: string; run: () => void } | null } => {
    if (exp.pending) return { text: 'Prediction locked. Fire when you are ready: the result is the only way to find out.', action: { label: exp.pending.kind === 'case' ? 'Trace the rays' : 'Fire', run: () => void run() } }
    switch (exp.phase) {
      case 'plane':
        return { text: 'Pick a surface, predict what the beam will do, then fire the laser.', action: null }
      case 'laws':
        return { text: 'Pick a law, predict where the reflected ray goes, then fire the laser.', action: null }
      case 'rules':
        return { text: 'Pick a ray, predict where it goes after it hits the mirror, then fire it.', action: null }
      case 'concave':
        return { text: 'Slide the candle to a position, predict the image, then trace the rays.', action: null }
      case 'convex':
        return { text: 'Same stand, new mirror. Predict the image for each candle position.', action: null }
      case 'table':
        return exp.canSubmit ? { text: 'Everything is run. Check your table, then lock it in to see the textbook answers.', action: { label: 'Lock in & reveal', run: () => void submit() } } : { text: exp.submitBlocker ?? '', action: null }
      default:
        return { text: 'Experiment complete. Orbit the bench to review it.', action: null }
    }
  }

  const refresh = (hint?: { text: string; action?: { label: string; run: () => void } | null }) => {
    hud!.update()
    if (exp.phase !== 'reveal') narrate(`phase-${exp.phase}`)
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

  /** Which of the four rays this is (ids are rule1..rule4, whatever order the session shows them in). */
  const ruleNo = (id: string) => Number(id.replace('rule', '')) as 1 | 2 | 3 | 4
  const ruleParams = (id: string) => lesson.rayRules.rules.find((r) => r.id === id)!.params
  const law = (id: string) => lesson.lawsOfReflection.laws.find((l) => l.id === id)!

  const ensureStage = (tool: Tool) => {
    const next = STAGE_OF[tool]
    if (stage === next) return
    stage = next
    scene!.setStage(next)
    if (tool === 'concave' || tool === 'convex') scene!.setCases(exp.of(tool).map((t) => ({ id: t.id, uOverF: exp.caseDef(t.id).uOverF })))
  }

  /** Bring one experiment onto the bench and open its card. */
  const select = (id: string) => {
    if (busy) return
    const t = exp.trial(id)
    const gate = exp.canPredict(id)
    if (!gate.ok && !t.result) {
      hud!.hint(gate.reason ?? 'Not yet.', null)
      return
    }
    if (exp.pending && exp.pending.id !== id) {
      hud!.hint('Run the experiment you predicted first.', { label: 'Run it', run: () => void run() })
      return
    }
    ensureStage(t.tool)
    if (t.kind === 'plane') scene!.selectSurface(id)
    else if (t.kind === 'law') scene!.previewLaw(law(id))
    else if (t.kind === 'rule') scene!.previewRule(ruleNo(id), ruleParams(id))
    else scene!.setCandleSpot(exp.caseDef(id).uOverF)
    hud!.show(id)
    refresh()
    if (t.result) void replay(t)
  }

  /** Show a finished experiment again on the bench (no server call, no telemetry). */
  const replay = async (t: Trial) => {
    if (busy) return
    busy = true
    try {
      if (t.kind === 'plane') await scene!.playPlane(t.id)
      else if (t.kind === 'law') await scene!.playLaw(law(t.id))
      else if (t.kind === 'rule') await scene!.playRule(ruleNo(t.id), ruleParams(t.id))
      else await scene!.playCase(exp.caseDef(t.id).uOverF)
    } finally {
      busy = false
    }
  }

  const next = () => {
    const t = exp.items.find((x) => !x.result)
    if (t) return select(t.id)
    hud!.closeCard()
    hud!.openTable()
    refresh()
  }

  const run = async () => {
    if (busy || !exp.pending) return
    busy = true
    const p = exp.pending
    hud!.hint(p.kind === 'case' ? 'Tracing the rays…' : 'Firing…', null)
    const clickedAt = Date.now()
    let result: Awaited<ReturnType<typeof runTrial>>
    try {
      result = await runTrial(session, { kind: p.kind, id: p.id, prediction: p.prediction!, confidence: p.confidence!, thinkMs: p.decisionMs })
    } catch (err) {
      busy = false
      toast((err as Error).message, 'error')
      refresh()
      return
    }
    const trial = guard(() => exp.act(result, clickedAt))
    if (!trial) {
      busy = false
      return
    }
    try {
      if (trial.kind === 'plane') await scene!.playPlane(trial.id)
      else if (trial.kind === 'law') await scene!.playLaw(law(trial.id))
      else if (trial.kind === 'rule') await scene!.playRule(ruleNo(trial.id), ruleParams(trial.id))
      else await scene!.playCase(exp.caseDef(trial.id).uOverF)
    } finally {
      busy = false
    }
    if (ctx.isDestroyed()) return
    if (!result.match) {
      narrate('surprise')
      const parts = trial.kind === 'case' && result.fields ? IMAGE_FIELDS.filter((f) => !result.fields![f]).join(', ') : 'the outcome'
      coach?.event('prediction_mismatch', result.anomaly ? say.anomaly : say.mismatch(trial.title, parts), buildOpticsSnapshot(exp))
    }
    hud!.show(trial.id)
    refresh(afterRun(trial))
  }

  /** What to tell the student after a run, or after the explanation it owed. */
  const afterRun = (trial: Trial): { text: string; action?: { label: string; run: () => void } | null } => {
    if (exp.needsExplanation(trial) && !trial.explained) return { text: 'Look at the diagram on the bench, then explain what you saw to continue.', action: null }
    if (exp.phase === 'table') return { text: 'Every experiment is run and explained. Review your table and lock it in.', action: { label: 'Open my table', run: () => hud!.openTable() } }
    const sameStep = exp.of(trial.tool).some((t) => !exp.isComplete(t))
    if (!sameStep) {
      const msg: Record<string, string> = { law: 'Both surfaces done. Now the laws of reflection.', rule: 'Laws done. Next, the rays you draw on a spherical mirror.', concave: 'Rays done. Now the concave mirror, with the candle.', convex: 'Concave mirror done. Next the convex mirror goes on the same stand.' }
      const nextTool = exp.phase === 'laws' ? 'law' : exp.phase === 'rules' ? 'rule' : exp.phase
      return { text: msg[nextTool] ?? 'That part is done. On to the next.', action: { label: 'Next', run: next } }
    }
    return { text: trial.result?.match ? 'As you predicted. Continue when you are ready.' : 'Not what you predicted: that is useful. Continue when you are ready.', action: { label: 'Next', run: next } }
  }

  const submit = async () => {
    if (submitting) return
    if (!exp.canSubmit) {
      toast(exp.submitBlocker ?? 'Not ready to lock in yet.', 'error')
      return
    }
    submitting = true
    try {
      const payload = guard(() => exp.submissionPayload())
      if (!payload) return
      hud!.hint('Locking in your table…', null)
      const reveal = await lockIn(session, payload)
      const summary = exp.finish(reveal)
      refresh()
      hud!.closeCard()
      hud!.showReveal(summary, reveal, () => go('/experiments'), () => undefined)
      narrate('reveal')
      coach?.reveal(buildOpticsSnapshot(exp))
    } catch (err) {
      toast((err as Error).message, 'error')
      refresh()
    } finally {
      submitting = false
    }
  }

  scene = new OpticsScene(
    canvas,
    {
      onSurfaceClick: (id) => exp.phase === 'plane' && select(id),
      onLaserClick: () => {
        if (exp.pending) void run()
        else hud!.hint('Make a prediction first, then fire.', null)
      },
      onCandleSnap: (index) => {
        const tool = exp.phase === 'convex' ? 'convex' : 'concave'
        const t = exp.of(tool)[index]
        if (!t) return
        if (busy) return
        if (exp.phase !== 'concave' && exp.phase !== 'convex') {
          hud!.hint('The candle is only used in the concave and convex experiments.', null)
          return
        }
        select(t.id)
      },
    },
    lesson.config.focalLengthM,
  )

  const handlers: OpticsHudHandlers = {
    onBack: () => go('/experiments'),
    onSelect: select,
    onLock: (id, prediction, confidence, decisionMs) => {
      if (!guard(() => exp.predict(id, prediction, confidence, decisionMs))) return
      hud!.show(id)
      refresh()
    },
    onRun: () => void run(),
    onNext: next,
    onNoticeAnomaly: (id) => {
      guard(() => exp.noticeAnomaly(id))
      hud!.show(id)
      hud!.hint('Good catch. At the focus the reflected rays are parallel, so they never meet. Does your table agree?', null)
    },
    onExplain: async (id, text, meta, audio) => {
      const body = guard(() => exp.explainPayload(id, text, meta))
      if (!body) return
      try {
        await submitExplanation(session, body)
      } catch (err) {
        toast((err as Error).message, 'error')
        return
      }
      exp.explained(id, text, meta)
      hud!.show(id)
      refresh(afterRun(exp.trial(id)))
      if (audio) void uploadAudio(session, body.kind, id, audio).catch(() => {})
      toast('Saved.')
    },
    onCell: (id, field, value) => {
      const t = exp.trial(id)
      const from = exp.table[id]?.[field] ?? ''
      if (!value) return hud!.update()
      if (!guard(() => (exp.setCell(id, field, value), true))) return
      const lab = (v: string) => lesson.imageFields[field].find((o) => o.id === v)?.label ?? v
      if (from && from !== value) coach?.event('revision', say.revision(t.title, field, lab(from), lab(value)), buildOpticsSnapshot(exp))
      refresh()
      if (exp.canSubmit) coach?.event('ready_to_submit', say.ready, buildOpticsSnapshot(exp))
    },
    onSubmit: () => void submit(),
    onLayout: (insets) => scene?.setInsets(insets),
  }

  hud = new OpticsHud(exp, handlers, lesson.title)
  root.appendChild(hud.root)

  // ---- AI coach ----
  const labCoach = startCoach({
    session,
    hello: { lessonId: lesson.lessonId, title: lesson.title, labType: lesson.type, summary: lesson.summary },
    snapshot: () => buildOpticsSnapshot(exp),
    mount: hud,
    finished: () => exp.phase === 'reveal',
    idleMs: 75_000,
    idleText: say.idle,
    activityRoot: root,
  })
  coach = labCoach.client

  await scene.load(lesson, (done, total) => {
    status.querySelector('p')!.textContent = `Preparing your lab… ${done}/${total}`
  })
  if (ctx.isDestroyed()) {
    cleanup()
    return () => {}
  }
  scene.start()
  sensorTracker.start(session, () => scene!.head, () => scene!.hand)
  status.remove()
  stage = 'plane'
  scene.setStage('plane', false)
  refresh()
  select(exp.items[0].id)
  ;(window as unknown as Record<string, unknown>).__mmaxr = { exp, scene, telemetry, lesson, handlers }

  function cleanup() {
    if (idleTimer !== null) window.clearInterval(idleTimer)
    labCoach.dispose()
    hud?.destroy()
    scene?.dispose()
  }
  return cleanup
}
