import { XapiVerb } from '@mmaxr/schema'
import type { ChemistryLessonContract } from '@mmaxr/schema'
import { go, type Page } from '../router'
import { assertChemistry, fetchLesson } from '../services/lessons'
import { revealTruth, runTest } from '../services/labApi'
import { openSession } from '../services/session'
import { sensorTracker } from '../services/sensorTracker'
import { telemetry } from '../services/telemetry'
import { userAuth } from '../services/userAuth'
import { ChemistryExperiment, PH_TOOL, StateError } from '../state/chemistry'
import { CoachClient, loadMode } from '../services/aiCoach'
import { CoachPanel } from '../lab/coachPanel'
import { buildSnapshot, describe as say } from '../lab/coachContext'
import { Hud, type HudHandlers } from '../lab/hud'
import { startMetalsLab } from './metalsLab'
import { startBiologyLab } from './biologyLab'
import { LabScene } from '../lab/labScene'
import { h } from '../ui/dom'
import { banner, button, toast } from '../ui/components'

export function labPage(lessonId: string): Page {
  const canvas = h('canvas', { 'aria-label': '3D chemistry lab. Use the tools panel and click objects on the bench.' })
  const status = h('div', { class: 'lab-loading' }, h('div', { class: 'spinner' }), h('p', { class: 't-support' }, 'Preparing your lab…'))
  const root = h('div', { class: 'lab' }, canvas, status)

  let scene: LabScene | null = null
  let hud: Hud | null = null
  let destroyed = false
  let coach: CoachClient | null = null
  let idleTimer: number | null = null
  let metalsCleanup: (() => void) | null = null

  const fail = (message: string) => {
    status.className = 'lab-error'
    status.replaceChildren(banner('error', message), button('Back to experiments', { variant: 'primary', onClick: () => go('/experiments') }))
  }

  void (async () => {
    try {
      const account = userAuth.current()
      if (!account) return go('/login')

      // The session comes first: the server draws this student's hidden tubes when the lesson is requested for it.
      const session = await openSession(account.token, lessonId)
      const raw = await fetchLesson(lessonId, session)
      if (raw.type === 'chemistry_metals') {
        telemetry.configure({ sessionId: session.sessionId, studentId: session.studentId, token: session.token })
        telemetry.emit(XapiVerb.INVESTIGATED, { action: 'enter_lab', target: raw.lessonId })
        metalsCleanup = await startMetalsLab({ root, canvas, status, session, lesson: raw, isDestroyed: () => destroyed })
        return
      }
      if (raw.type === 'biology_digestive_system') {
        telemetry.configure({ sessionId: session.sessionId, studentId: session.studentId, token: session.token })
        telemetry.emit(XapiVerb.INVESTIGATED, { action: 'enter_lab', target: raw.lessonId })
        metalsCleanup = await startBiologyLab({ root, canvas, status, session, lesson: raw, isDestroyed: () => destroyed })
        return
      }
      const lesson: ChemistryLessonContract = assertChemistry(raw)
      telemetry.configure({ sessionId: session.sessionId, studentId: session.studentId, token: session.token })
      telemetry.emit(XapiVerb.INVESTIGATED, { action: 'enter_lab', target: lesson.lessonId })

      const exp = new ChemistryExperiment(lesson, (verb, object) => telemetry.emit(verb, object))
      let busy = false

      const toolColor = (tool: string) => exp.indicator(tool)?.colors?.neutral ?? 'Colorless'

      const defaultHint = () => {
        if (exp.phase === 'select_tools') {
          return exp.canStartTesting
            ? { text: 'Good set. Ready to test the five unknown solutions?', action: { label: 'Start testing', run: () => hudHandlers.onStartTesting() } }
            : { text: `Choose ${exp.required} indicators (${exp.chosen.length} so far): click the bottles on the back shelf.`, action: null }
        }
        if (exp.phase === 'testing') return { text: exp.pending ? 'Prediction locked. Click the dropper to add the indicator.' : 'Pick a test tube to test. You will predict the colour first.', action: exp.pending ? { label: 'Add indicator', run: () => void addIndicator() } : null }
        if (exp.canSubmit) return { text: 'Everything is recorded. Ready to see what was really in the tubes?', action: { label: 'Submit & reveal', run: () => hudHandlers.onSubmit() } }
        if (exp.phase === 'ph') return { text: exp.pending ? 'Prediction locked. Dip the paper when you are ready.' : 'pH paper unlocked. Test each tube, then write its pH in your notebook.', action: exp.pending ? { label: 'Dip pH paper', run: () => void addIndicator() } : null }
        return { text: 'Experiment complete. Orbit the bench to review it.', action: null }
      }

      const refresh = (hint?: { text: string; action?: { label: string; run: () => void } | null }) => {
        scene!.setBottleSelected(exp.chosen, exp.phase === 'testing' ? exp.activeTool : null)
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

      let submitting = false
      const submit = async () => {
        if (submitting || !exp.canSubmit) return
        submitting = true
        try {
          const payload = guard(() => exp.submissionPayload())
          if (!payload) return
          hud!.hint('Submitting your analysis…', null)
          // One-shot on the server: it locks what was submitted, then discloses the truth.
          const truth = await revealTruth(session, payload)
          const summary = exp.finish(truth)
          scene!.hideDropper()
          truth.forEach((t) => scene!.revealLabel(t.tube - 1, t.formula))
          refresh()
          hud!.showReveal(summary, () => go('/experiments'), () => scene!.focusTube(null))
          coach?.reveal(buildSnapshot(exp))
        } catch (err) {
          toast((err as Error).message, 'error')
          refresh()
        } finally {
          submitting = false
        }
      }

      const addIndicator = async () => {
        if (busy || !exp.pending) return
        busy = true
        const tool = exp.pending.tool
        hud!.hint('Adding the indicator…', null)
        // The server decides what this test shows; the browser has no way to compute it.
        let observed: string
        try {
          observed = await runTest(session, exp.pending.tube + 1, tool)
        } catch (err) {
          busy = false
          toast((err as Error).message, 'error')
          refresh()
          return
        }
        const r = guard(() => exp.act(observed))
        if (!r) {
          busy = false
          return
        }
        hud!.hint('Watch the liquid…', null)
        if (tool === PH_TOOL) await scene!.playPhDip(r.tube, r.actual)
        else await scene!.playAddIndicator(r.tube, toolColor(tool), r.actual)
        busy = false
        scene!.focusTube(null)
        if (!r.match) coach?.event('prediction_mismatch', say.mismatch(r.tube + 1, tool === PH_TOOL ? 'the pH paper' : exp.indicator(tool)!.name, r.predicted, r.actual), buildSnapshot(exp))
        refresh({
          text: r.match
            ? `Tube ${r.tube + 1} turned ${r.actual}. Write what you see in your notebook.`
            : `Tube ${r.tube + 1} turned ${r.actual}: not what you predicted. Record it, then ask yourself why.`,
        })
        hud!.openNotebook()
      }

      const onTubeClick = async (i: number) => {
        if (busy) return
        const gate = exp.canTest(i)
        if (!gate.ok) {
          hud!.hint(gate.reason ?? 'You cannot test that tube right now.', exp.pending ? { label: exp.activeTool === PH_TOOL ? 'Dip pH paper' : 'Add indicator', run: () => void addIndicator() } : null)
          return
        }
        const tool = exp.activeTool!
        const isPaper = tool === PH_TOOL
        scene!.focusTube(i)
        const answer = await hud!.promptPrediction({ tube: i, toolName: exp.indicator(tool)!.name, isPaper })
        if (!answer || destroyed) {
          scene?.focusTube(null)
          return
        }
        if (!guard(() => exp.predict(i, answer.color, answer.confidence, answer.decisionMs))) return
        if (!isPaper) scene!.showDropperAt(i, toolColor(tool))
        else void 0
        refresh()
      }

      scene = new LabScene(canvas, {
        onTubeClick: (i) => void onTubeClick(i),
        onDropperClick: () => void addIndicator(),
        onBottleClick: (id) => {
          if (busy) return
          if (exp.phase === 'select_tools') guard(() => exp.toggleIndicator(id))
          else if (exp.phase === 'testing') exp.selectTool(id)
          refresh()
        },
      })

      const hudHandlers: HudHandlers = {
          onBack: () => go('/experiments'),
          onToggleIndicator: (id) => {
            guard(() => exp.toggleIndicator(id))
            refresh()
          },
          onStartTesting: () => {
            if (!guard(() => (exp.startTesting(), true))) return
            scene!.focusTube(null)
            refresh()
          },
          onSelectTool: (id) => {
            exp.selectTool(id)
            refresh()
          },
          onAddIndicator: () => void addIndicator(),
          onRecordColor: (tube, tool, color) => {
            const ok = guard(() => (exp.recordColor(tube, tool, color), true))
            hud!.update()
            if (ok && color) {
              hud!.hint(`Saved. Open your notebook when you are ready to decide what tube ${tube + 1} is, or test another tube.`, null)
              hud!.closeNotebookSoon()
            }
          },
          onConclusion: (tube, c) => {
            if (!c) return hud!.update()
            const before = exp.phase
            const history = exp.tubes[tube].conclusionHistory.length
            const prior = exp.tubes[tube].conclusion
            const ok = guard(() => (exp.setConclusion(tube, c), true))
            if (ok) hud!.closeNotebookSoon()
            if (ok && history > 0 && prior) coach?.event('revision', say.revision(tube + 1, prior, c), buildSnapshot(exp))
            else if (ok && before === 'testing' && exp.phase === 'ph') coach?.event('ph_unlocked', say.phUnlocked, buildSnapshot(exp))
            refresh(before === 'testing' && exp.phase === 'ph' ? { text: 'Every tube has a conclusion. pH paper is unlocked: find each exact pH.' } : undefined)
          },
          onRecordPh: (tube, value) => {
            const ok = guard(() => (exp.recordPh(tube, value), true))
            refresh()
            if (ok && value !== null) hud!.closeNotebookSoon()
            if (ok && exp.canSubmit) coach?.event('ready_to_submit', say.ready, buildSnapshot(exp))
          },
          onLayout: (insets) => scene?.setInsets(insets),
          onSubmit: () => void submit(),
      }
      hud = new Hud(exp, hudHandlers, lesson.title)
      root.appendChild(hud.root)

      // ---- AI coach ----
      const client = new CoachClient()
      coach = client
      const panel: CoachPanel = new CoachPanel({
        initialMode: loadMode(),
        setOpen: (open) => hud!.setPanelOpen(panel.el, open),
        onAsk: (text) => {
          client.ask(text, buildSnapshot(exp))
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
        } else if (m.type === 'coach_off') panel.setThinking(false)
        else if (m.type === 'error') panel.setThinking(false)
      })
      client.connect(
        { sessionId: session.sessionId, studentId: session.studentId, token: session.token },
        { lessonId: lesson.lessonId, title: lesson.title, labType: lesson.type, summary: lesson.summary },
      )
      // If the student goes quiet for a while, offer a nudge (the service rate-limits and honours the mode).
      let lastActive = Date.now()
      root.addEventListener('pointerdown', () => (lastActive = Date.now()))
      idleTimer = window.setInterval(() => {
        if (exp.phase !== 'reveal' && Date.now() - lastActive > 75_000) {
          lastActive = Date.now()
          client.event('idle', say.idle, buildSnapshot(exp))
        }
      }, 10_000)

      await scene.load(lesson, (done, total) => {
        status.querySelector('p')!.textContent = `Preparing your lab… ${done}/${total}`
      })
      if (destroyed) return

      scene.start()
      sensorTracker.start(session.sessionId, () => scene!.head, () => scene!.hand)
      status.remove()
      refresh()
      ;(window as unknown as Record<string, unknown>).__mmaxr = { exp, scene, telemetry, lesson, handlers: hudHandlers }
    } catch (err) {
      console.error('[lab] failed to start', err)
      fail((err as Error).message)
    }
  })()

  const onPageHide = () => telemetry.flushBeacon()
  window.addEventListener('pagehide', onPageHide)

  return {
    el: root,
    destroy() {
      destroyed = true
      window.removeEventListener('pagehide', onPageHide)
      sensorTracker.stop()
      telemetry.flushBeacon()
      telemetry.reset()
      metalsCleanup?.()
      if (idleTimer !== null) window.clearInterval(idleTimer)
      coach?.disconnect()
      hud?.destroy()
      scene?.dispose()
    },
  }
}
