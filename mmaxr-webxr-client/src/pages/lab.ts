import { XapiVerb } from '@mmaxr/schema'
import type { ChemistryLessonContract } from '@mmaxr/schema'
import { go, type Page } from '../router'
import { assertChemistry, fetchLesson } from '../services/lessons'
import { openSession } from '../services/session'
import { sensorTracker } from '../services/sensorTracker'
import { telemetry } from '../services/telemetry'
import { userAuth } from '../services/userAuth'
import { ChemistryExperiment, PH_TOOL, StateError } from '../state/chemistry'
import { Hud, type HudHandlers } from '../lab/hud'
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

  const fail = (message: string) => {
    status.className = 'lab-error'
    status.replaceChildren(banner('error', message), button('Back to experiments', { variant: 'primary', onClick: () => go('/experiments') }))
  }

  void (async () => {
    try {
      const account = userAuth.current()
      if (!account) return go('/login')

      const lesson: ChemistryLessonContract = assertChemistry(await fetchLesson(lessonId))
      const session = await openSession(account.token, lesson.lessonId)
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

      const addIndicator = async () => {
        if (busy || !exp.pending) return
        busy = true
        const tool = exp.pending.tool
        const r = guard(() => exp.act())
        if (!r) {
          busy = false
          return
        }
        hud!.hint('Watch the liquid…', null)
        if (tool === PH_TOOL) await scene!.playPhDip(r.tube, r.actual)
        else await scene!.playAddIndicator(r.tube, toolColor(tool), r.actual)
        busy = false
        scene!.focusTube(null)
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
            guard(() => exp.recordColor(tube, tool, color))
            hud!.update()
          },
          onConclusion: (tube, c) => {
            if (!c) return hud!.update()
            const before = exp.phase
            guard(() => exp.setConclusion(tube, c))
            refresh(before === 'testing' && exp.phase === 'ph' ? { text: 'Every tube has a conclusion. pH paper is unlocked: find each exact pH.' } : undefined)
          },
          onRecordPh: (tube, value) => {
            guard(() => exp.recordPh(tube, value))
            refresh()
          },
          onLayout: (insets) => scene?.setInsets(insets),
          onSubmit: () => {
            const summary = guard(() => exp.submit())
            if (!summary) return
            scene!.hideDropper()
            exp.tubes.forEach((t) => scene!.revealLabel(t.index, t.solution.formula))
            refresh()
            hud!.showReveal(summary, () => go('/experiments'), () => scene!.focusTube(null))
          },
      }
      hud = new Hud(exp, hudHandlers, lesson.title)
      root.appendChild(hud.root)

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
      hud?.destroy()
      scene?.dispose()
    },
  }
}
