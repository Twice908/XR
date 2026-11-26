import type { MissionsLessonContract } from '@mmaxr/schema'
import { go } from '../router'
import type { LabSession } from '../services/session'
import { answerQuestion, checkMission, fetchProgress, finishRun, takeHint } from '../services/missionsApi'
import { sensorTracker } from '../services/sensorTracker'
import { telemetry } from '../services/telemetry'
import { MissionsRun, StateError } from '../state/missions'
import {
  addElectron,
  charge,
  COMPLETE_CHORD,
  electronCount,
  electronNote,
  element,
  freshIonic,
  hasCompleteOuterShell,
  ionBadge,
  join,
  LESSON_CHORD,
  massNumber,
  MAX_Z,
  MISSION_CHORD,
  NEUTRON_NOTE,
  outerShellState,
  placementProblem,
  PROTON_NOTE,
  removalProblem,
  removeElectron,
  transfer,
  type Atom,
  type IonicState,
} from '../state/atomKit'
import { AtomScene, CHEM_PROPS } from '../lab/atomScene'
import type { BenchScene } from '../lab/benchScene'
import { IonicScene } from '../lab/ionicScene'
import { MissionsHud } from '../lab/missionsHud'
import { Narrator } from '../lab/narrator'
import { sound as labSound } from '../lab/sound'
import { getStage } from '../stage/index.js'
import { h } from '../ui/dom'
import { button, toast } from '../ui/components'

interface Ctx {
  root: HTMLElement
  canvas: HTMLCanvasElement
  status: HTMLElement
  session: LabSession
  lesson: MissionsLessonContract
  isDestroyed: () => boolean
}

/** What a mission lab adds to the shared flow: its bench, its controls and the build it sends to Check. */
interface Bench {
  scene: BenchScene
  controls: HTMLElement
  readout: HTMLElement
  /** The build as the server checks it. */
  state(): unknown
  /** Set the bench for a mission: missions after the first carry on from where the last one left the model. */
  prepare(missionIndex: number): void
  dispose(): void
}

/** The shared soundscape, for MMAXR's cues and chords. Its music bed stays silent inside a lab. */
function labVoice() {
  const s = getStage()
  s.setQuiet(false)
  s.sound.setBedLevel(0, 0.2)
  s.sound.setEnabled(!labSound.muted)
  return s.sound
}

/** Runs one mission lab (Atom Builder or Ionic Bonding). Returns a cleanup function. */
async function runMissions(ctx: Ctx, makeBench: (refuse: (reason: string) => void, changed: () => void) => Bench): Promise<() => void> {
  const { root, status, session, lesson } = ctx
  const voice = labVoice()
  const { progress, questions } = await fetchProgress(session)
  const run = new MissionsRun(lesson, progress, (verb, object, at) => telemetry.emit(verb, object, at))
  let hud: MissionsHud | null = null
  let working = false
  let lastRefusal = 0

  const caption = h('p', { class: 'mx-caption', 'aria-live': 'polite' })
  const narrator = new Narrator(caption, (speaking) => voice.setDuck(speaking ? 1 : 0))
  const refuse = (reason: string) => {
    run.refuse(reason)
    voice.cue('deny')
    // The spoken "that spot does not work" plays at most every few seconds, as in MMAXR.
    if (Date.now() - lastRefusal > 6000) narrator.say(lesson.invalid)
    lastRefusal = Date.now()
    hud?.update()
  }
  const bench = makeBench(refuse, () => {
    if (run.feedback) run.feedback = null
    hud?.update()
  })

  const guard = <T,>(fn: () => T): T | undefined => {
    try {
      return fn()
    } catch (err) {
      toast(err instanceof StateError ? err.message : (err as Error).message, 'error')
      return undefined
    }
  }
  const busy = async (label: string, fn: () => Promise<void>) => {
    if (working) return
    working = true
    hud!.setBusy(label)
    try {
      await fn()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      working = false
      hud!.setBusy(null)
    }
  }
  const beginMission = () => {
    bench.prepare(run.missionIndex)
    narrator.say(run.mission?.start)
  }

  hud = new MissionsHud(
    run,
    {
      onBack: () => go('/experiments'),
      onStart: () => {
        guard(() => run.startMission())
        beginMission()
        hud!.update()
      },
      onHint: () =>
        void busy('Finding a hint…', async () => {
          const r = await takeHint(session, run.mission!.id)
          run.recordHint(r)
          voice.cue('open')
        }),
      onCheck: () =>
        void busy('Checking your model…', async () => {
          const state = bench.state()
          const r = await checkMission(session, run.mission!.id, state)
          const complete = run.mission!.complete
          run.recordCheck(r, state)
          if (!r.met) {
            voice.cue('deny')
            return
          }
          voice.arrive()
          voice.chord(MISSION_CHORD, { spreadSeconds: 0.08, gain: 0.045 })
          ;(bench.scene as AtomScene).celebrate?.()
          narrator.say(complete)
          run.openQuestions(r.questions)
          if (!r.questions.length && r.progress.current !== null) beginMissionAfter()
        }),
      onPick: (id) => {
        run.pick(id)
        hud!.update()
      },
      onAnswer: () =>
        void busy('Checking…', async () => {
          const body = guard(() => run.answerPayload())
          if (!body) return
          const r = await answerQuestion(session, body)
          run.recordAnswer(r)
          voice.cue(r.correct ? 'confirm' : 'deny')
        }),
      onNext: () => {
        const next = run.next()
        if (next === 'mission') beginMission()
        if (next === 'finish')
          void busy('Adding up…', async () => {
            const sum = await finishRun(session)
            run.finish(sum)
            voice.arrive()
            voice.chord(LESSON_CHORD, { spreadSeconds: 0.11, gain: 0.05 })
          })
        hud!.update()
      },
      onSoundChange: (muted) => {
        voice.setEnabled(!muted)
        if (muted) narrator.stop()
      },
      onLayout: (insets) => bench.scene.setInsets(insets),
    },
    bench.controls,
    bench.readout,
    caption,
  )
  const beginMissionAfter = () => {
    guard(() => run.startMission())
    beginMission()
  }
  root.appendChild(hud.root)

  const cleanup = () => {
    narrator.dispose()
    hud?.destroy()
    bench.dispose()
    voice.setDuck(0)
  }

  await bench.scene.loadBench(lesson.modelUrl, CHEM_PROPS, (d, t) => {
    const p = status.querySelector('p')
    if (p) p.textContent = `Preparing your lab… ${d}/${t}`
  })
  if (ctx.isDestroyed()) {
    cleanup()
    return () => {}
  }
  run.resume(questions)
  bench.prepare(run.missionIndex)
  bench.scene.start()
  sensorTracker.start(session, () => bench.scene.head, () => bench.scene.hand)
  status.remove()
  hud.update()
  if (run.phase === 'intro') narrator.say(lesson.intro)
  ;(window as unknown as Record<string, unknown>).__mmaxr = { run, bench, lesson, session }
  return cleanup
}

const stepper = (label: string, value: () => number, dec: () => void, inc: () => void) => {
  const n = h('span', { class: 'mx-count t-title' })
  const row = h('div', { class: 'mx-stepper' }, h('span', { class: 't-label' }, label), button('−', { size: 'sm', variant: 'ghost', onClick: dec }), n, button('+', { size: 'sm', variant: 'ghost', onClick: inc }))
  return { row, paint: () => (n.textContent = String(value())) }
}
const fact = (label: string) => {
  const v = h('dd')
  return { node: [h('dt', null, label), v], set: (t: string) => (v.textContent = t) }
}

/** Atom Builder: build each atom or ion from protons, neutrons and electrons, then Check. */
export function startAtomBuilderLab(ctx: Ctx) {
  return runMissions(ctx, (refuse, changed) => {
    let atom: Atom = { protons: 1, neutrons: 0, shells: [1] }
    const scene = new AtomScene(ctx.canvas, { onShell: (shell) => placeElectron(shell) })
    const voice = getStage().sound

    const set = (next: Atom) => {
      const before = atom
      atom = next
      const wasComplete = outerShellState(before.shells) === 'complete'
      if (outerShellState(next.shells) === 'complete' && !wasComplete) voice.chord(COMPLETE_CHORD, { spreadSeconds: 0.09, gain: 0.045 })
      if (charge(next) !== 0 && Math.sign(charge(next)) !== Math.sign(charge(before))) voice.chord(charge(next) > 0 ? [74, 81] : [69, 76], { spreadSeconds: 0.12, gain: 0.04 })
      paint()
      changed()
    }
    const placeElectron = (shell: number) => {
      const problem = placementProblem(atom.shells, shell)
      if (problem) return refuse(problem)
      voice.cue('snap', { midi: electronNote(shell, atom.shells[shell - 1] ?? 0), pan: (shell - 2.5) * 0.25 })
      set({ ...atom, shells: addElectron(atom.shells, shell) })
    }
    const removeOuter = () => {
      const shell = atom.shells.length
      const problem = shell ? removalProblem(atom.shells, shell) : 'There is no electron to remove.'
      if (problem) return refuse(problem)
      voice.cue('close')
      set({ ...atom, shells: removeElectron(atom.shells, shell) })
    }

    const protons = stepper(
      'Protons',
      () => atom.protons,
      () => (atom.protons <= 1 ? refuse('An atom needs at least one proton.') : (voice.cue('close'), set({ ...atom, protons: atom.protons - 1 }))),
      () => (atom.protons >= MAX_Z ? refuse('This kit supports elements 1 to 20.') : (voice.cue('place', { midi: PROTON_NOTE, pan: -0.2 }), set({ ...atom, protons: atom.protons + 1 }))),
    )
    const neutrons = stepper(
      'Neutrons',
      () => atom.neutrons,
      () => (atom.neutrons <= 0 ? refuse('There is no neutron to remove.') : (voice.cue('close'), set({ ...atom, neutrons: atom.neutrons - 1 }))),
      () => (atom.neutrons >= 30 ? refuse('That is more neutrons than this kit holds.') : (voice.cue('place', { midi: NEUTRON_NOTE, pan: 0.2 }), set({ ...atom, neutrons: atom.neutrons + 1 }))),
    )
    const shellButtons = [1, 2, 3, 4].map((n) => button(`Shell ${n}`, { size: 'sm', variant: 'ghost', onClick: () => placeElectron(n) }))
    const electrons = h(
      'div',
      { class: 'mx-stepper mx-electrons' },
      h('span', { class: 't-label' }, 'Electrons'),
      button('−', { size: 'sm', variant: 'ghost', onClick: removeOuter }),
      h('span', { class: 't-support' }, 'add to'),
      ...shellButtons,
    )
    const controls = h(
      'div',
      { class: 'mx-controls' },
      protons.row,
      neutrons.row,
      electrons,
      h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, h('span', { class: 't-support' }, 'Tip: click a shell ring on the bench to drop an electron there.'), button('Reset atom', { size: 'sm', variant: 'ghost', onClick: () => (voice.sweep('rise', 0.6), set({ protons: 1, neutrons: 0, shells: [1] })) })),
    )

    const name = h('h3', { class: 't-title' })
    const ion = h('p', { class: 'mx-ion' })
    const facts = { protons: fact('Protons'), neutrons: fact('Neutrons'), electrons: fact('Electrons'), mass: fact('Mass number'), charge: fact('Charge'), config: fact('Shells'), outer: fact('Outer shell') }
    const brief = h('p', { class: 'mx-brief' })
    const readout = h('aside', { class: 'mx-readout', 'aria-live': 'polite' }, h('span', { class: 't-label mx-eyebrow' }, 'YOUR ATOM'), name, brief, ion, h('dl', null, ...Object.values(facts).flatMap((f) => f.node)))

    const paint = () => {
      protons.paint()
      neutrons.paint()
      const el = element(atom.protons)
      name.textContent = el ? `${el.name} (${el.symbol})` : '?'
      const badge = ionBadge(atom)
      ion.textContent = badge ? `${badge.label} · ${badge.detail}` : 'Neutral atom'
      ion.className = `mx-ion ${charge(atom) > 0 ? 'pos' : charge(atom) < 0 ? 'neg' : ''}`
      const c = charge(atom)
      facts.protons.set(String(atom.protons))
      facts.neutrons.set(String(atom.neutrons))
      facts.electrons.set(String(electronCount(atom.shells)))
      facts.mass.set(String(massNumber(atom)))
      facts.charge.set(c === 0 ? '0' : c > 0 ? `+${c}` : String(c))
      facts.config.set(atom.shells.length ? atom.shells.join(', ') : '—')
      facts.outer.set(outerShellState(atom.shells) === 'complete' ? 'Complete' : outerShellState(atom.shells) === 'empty' ? 'Empty' : 'Not complete (reactive)')
      brief.textContent = `${el?.name ?? '?'} · ${atom.protons} p · ${atom.neutrons} n · ${electronCount(atom.shells)} e · mass ${massNumber(atom)} · charge ${c === 0 ? '0' : c > 0 ? `+${c}` : c} · shells ${atom.shells.join(',') || '—'}`
      shellButtons.forEach((b, i) => b.classList.toggle('mx-dim', !!placementProblem(atom.shells, i + 1)))
      scene.show(atom)
    }
    paint()
    return {
      scene,
      controls,
      readout,
      state: () => ({ protons: atom.protons, neutrons: atom.neutrons, shells: atom.shells }),
      // Each Atom Builder mission is a fresh build: the atom carries over, as in MMAXR, and the student reshapes it.
      prepare: () => paint(),
      dispose: () => scene.dispose(),
    }
  })
}

/** Ionic Bonding: give sodium's outer electron to chlorine, then join the ions. */
export function startIonicBondingLab(ctx: Ctx) {
  return runMissions(ctx, (refuse, changed) => {
    let state: IonicState = freshIonic()
    let giver: 'na' | 'cl' | null = null
    let moving = false
    const voice = getStage().sound
    const scene = new IonicScene(ctx.canvas, { onAtom: (id) => void tap(id) })

    const tap = async (id: 'na' | 'cl') => {
      if (moving || state.bonded) return
      if (!giver) {
        giver = id
        voice.cue('select')
        paint()
        return
      }
      if (giver === id) {
        giver = null
        voice.cue('close')
        paint()
        return
      }
      const from = giver
      giver = null
      const r = transfer(state, from, id)
      if ('problem' in r) {
        paint()
        return refuse(r.problem)
      }
      moving = true
      const fromShell = state.atoms.find((a) => a.id === from)!.atom.shells.length
      const toShell = state.atoms.find((a) => a.id === id)!.atom.shells.length
      await scene.flyElectron(from, id, fromShell, toShell)
      moving = false
      state = r.state
      voice.cue('snap', { midi: electronNote(toShell, (state.atoms.find((a) => a.id === id)!.atom.shells[toShell - 1] ?? 1) - 1), pan: 0.3 })
      if (state.atoms.every((a) => hasCompleteOuterShell(a.atom.shells))) voice.chord(COMPLETE_CHORD, { spreadSeconds: 0.09, gain: 0.045 })
      voice.chord([74, 81], { spreadSeconds: 0.12, gain: 0.04 })
      paint()
      changed()
    }
    const joinIons = () => {
      const r = join(state)
      if ('problem' in r) return refuse(r.problem)
      state = r.state
      voice.sweep('rise', 0.9)
      voice.chord(COMPLETE_CHORD, { spreadSeconds: 0.09, gain: 0.05 })
      paint()
      changed()
    }

    const pickNa = button('Sodium (Na)', { size: 'sm', variant: 'ghost', onClick: () => void tap('na') })
    const pickCl = button('Chlorine (Cl)', { size: 'sm', variant: 'ghost', onClick: () => void tap('cl') })
    const joinBtn = button('Join the ions', { size: 'sm', variant: 'secondary', onClick: joinIons })
    const how = h('p', { class: 't-support' })
    const controls = h(
      'div',
      { class: 'mx-controls' },
      how,
      h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, pickNa, pickCl, joinBtn, button('Reset', { size: 'sm', variant: 'ghost', onClick: () => ((state = freshIonic()), (giver = null), voice.sweep('rise', 0.6), paint(), changed()) })),
    )

    const rows = state.atoms.map((a) => {
      const title = h('h3', { class: 't-title' })
      const ion = h('p', { class: 'mx-ion' })
      const f = { shells: fact('Shells'), electrons: fact('Electrons'), charge: fact('Charge'), outer: fact('Outer shell') }
      const brief = h('p', { class: 'mx-brief' })
      return { id: a.id, node: h('div', { class: 'mx-atom' }, title, brief, ion, h('dl', null, ...Object.values(f).flatMap((x) => x.node))), title, ion, f, brief }
    })
    const readout = h('aside', { class: 'mx-readout', 'aria-live': 'polite' }, h('span', { class: 't-label mx-eyebrow' }, 'ON THE BENCH'), ...rows.map((r) => r.node))

    const paint = () => {
      for (const row of rows) {
        const a = state.atoms.find((x) => x.id === row.id)!
        const c = charge(a.atom)
        const badge = ionBadge(a.atom)
        row.title.textContent = `${a.name} (${a.symbol})`
        row.ion.textContent = badge ? `${badge.label} · ${badge.detail}` : `Neutral ${a.role === 'metal' ? 'metal' : 'non-metal'} atom`
        row.ion.className = `mx-ion ${c > 0 ? 'pos' : c < 0 ? 'neg' : ''}`
        row.f.shells.set(a.atom.shells.join(', '))
        row.f.electrons.set(String(electronCount(a.atom.shells)))
        row.f.charge.set(c === 0 ? '0' : c > 0 ? `+${c}` : String(c))
        row.f.outer.set(hasCompleteOuterShell(a.atom.shells) ? 'Complete (octet)' : 'Not complete')
        row.brief.textContent = `${a.symbol}: shells ${a.atom.shells.join(',')} · charge ${c === 0 ? '0' : c > 0 ? `+${c}` : c} · outer shell ${hasCompleteOuterShell(a.atom.shells) ? 'complete' : 'not complete'}`
      }
      pickNa.classList.toggle('mx-on', giver === 'na')
      pickCl.classList.toggle('mx-on', giver === 'cl')
      how.textContent = state.bonded ? 'Joined: the opposite charges hold Na⁺ and Cl⁻ together in sodium chloride.' : giver ? `${giver === 'na' ? 'Sodium' : 'Chlorine'} is giving. Now tap the atom that takes the electron.` : 'Tap the atom that gives an electron, then the atom that takes it.'
      scene.select(giver)
      scene.show(state, { highlightGiver: !giver })
    }
    paint()
    return {
      scene,
      controls,
      readout,
      state: () => ({ sodium: state.atoms[0].atom.shells, chlorine: state.atoms[1].atom.shells, bonded: state.bonded }),
      // Joining starts from the ions the first mission made.
      prepare: (missionIndex) => {
        if (missionIndex >= 1 && state.atoms[0].atom.shells.length === 3) state = transferDone()
        paint()
      },
      dispose: () => scene.dispose(),
    }
  })
}

const transferDone = (): IonicState => {
  const r = transfer(freshIonic(), 'na', 'cl')
  return 'state' in r ? r.state : freshIonic()
}
