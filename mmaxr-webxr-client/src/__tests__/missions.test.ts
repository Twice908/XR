import { describe, expect, it } from 'vitest'
import type { MissionsLessonContract, MissionsProgress } from '@mmaxr/schema'
import { addElectron, charge, electronNote, freshIonic, ionBadge, join, placementProblem, removalProblem, transfer } from '../state/atomKit'
import { MissionsRun } from '../state/missions'

describe('atom kit (MMAXR rules)', () => {
  it('fills shells inner first, with MMAXR\'s reasons', () => {
    expect(placementProblem([1], 2)).toBe('Fill shell 1 before adding an electron to shell 2.')
    expect(placementProblem([2], 1)).toBe('Shell 1 holds at most 2 electrons.')
    expect(placementProblem([2, 8, 8], 3)).toBe('For elements 1-20, shell 3 holds 8 before shell 4 is used.')
    expect(placementProblem([2, 3], 2)).toBeNull()
    expect(removalProblem([2, 8, 1], 2)).toBe('Remove electrons from the outer shell first.')
    expect(addElectron([2], 2)).toEqual([2, 1])
  })

  it('labels ions as students write them', () => {
    expect(ionBadge({ protons: 11, neutrons: 12, shells: [2, 8] })).toEqual({ label: 'Na⁺', detail: 'Positive ion: 1 electron lost' })
    expect(ionBadge({ protons: 17, neutrons: 18, shells: [2, 8, 8] })?.label).toBe('Cl⁻')
    expect(ionBadge({ protons: 6, neutrons: 6, shells: [2, 4] })).toBeNull()
  })

  it('moves sodium\'s electron to chlorine and refuses the wrong way round', () => {
    const start = freshIonic()
    expect(transfer(start, 'cl', 'na')).toEqual({ problem: 'Chlorine is a non-metal. It takes electrons to complete its outer shell, so it does not give them away.' })
    expect(join(start)).toEqual({ problem: 'Sodium still has 1 electron in its outer shell to give away, so it is not an ion yet.' })
    const moved = transfer(start, 'na', 'cl')
    if (!('state' in moved)) throw new Error('transfer refused')
    expect(moved.state.atoms.map((a) => a.atom.shells)).toEqual([[2, 8], [2, 8, 8]])
    expect(moved.state.atoms.map((a) => charge(a.atom))).toEqual([1, -1])
    expect(transfer(moved.state, 'na', 'cl')).toMatchObject({ problem: expect.stringContaining('already has a complete outer shell') })
    expect(join(moved.state)).toMatchObject({ state: { bonded: true } })
  })

  it('plays each shell on its own notes', () => {
    expect(electronNote(1, 0)).toBe(67)
    expect(electronNote(2, 3)).toBe(80)
  })
})

const LESSON: MissionsLessonContract = {
  lessonId: 'atom-builder',
  type: 'chemistry_atom_builder',
  title: 'Atom Builder',
  intro: null,
  invalid: null,
  missions: [
    { id: 'm1', title: 'One', goalText: 'g1', hintCount: 3, start: null, complete: null },
    { id: 'm2', title: 'Two', goalText: 'g2', hintCount: 3, start: null, complete: null },
  ],
}
const progress = (current: string | null, met: string[] = []): MissionsProgress => ({
  current,
  missions: { m1: { attempts: met.includes('m1') ? 1 : 0, hintsUsed: 0, met: met.includes('m1') }, m2: { attempts: 0, hintsUsed: 0, met: met.includes('m2') } },
  answered: [],
  finished: false,
})

describe('a mission run', () => {
  it('goes build, check, questions, next mission, then done', () => {
    const events: string[] = []
    const run = new MissionsRun(LESSON, progress('m1'), (_v, o) => events.push(String(o.action)), () => 1000)
    run.resume([])
    expect(run.phase).toBe('intro')
    run.startMission()
    expect(run.phase).toBe('build')

    run.recordCheck({ met: false, attempts: 1, feedback: 'Not yet.', questions: [], progress: progress('m1') }, {})
    expect(run.feedback).toBe('Not yet.')

    const q = { id: 'q1', prompt: '?', options: [{ id: 'p0', label: 'a' }, { id: 'p1', label: 'b' }] }
    run.recordCheck({ met: true, attempts: 2, feedback: null, questions: [q], progress: progress('m1', ['m1']) }, {})
    run.openQuestions([q])
    expect(run.phase).toBe('questions')
    expect(run.canCheckAnswer).toBe(false)
    run.pick('p1')
    expect(run.answerPayload()).toEqual({ question: 'q1', choice: 'p1', thinkMs: 0 })
    run.recordAnswer({ correct: false, answer: 'p0', explanation: 'because', progress: progress('m2', ['m1']) })
    expect(run.answers.q1).toMatchObject({ correct: false, answer: 'p0', yourAnswer: 'p1' })
    expect(run.next()).toBe('mission')
    expect(run.mission?.id).toBe('m2')
    expect(run.phase).toBe('build')
    expect(events).toEqual(['start_mission', 'check_mission', 'check_mission', 'mission_complete', 'quiz_answer', 'start_mission'])
  })

  it('resumes after a reload: on unlocked questions, or straight into the build', () => {
    const q = { id: 'q1', prompt: '?', options: [] }
    const a = new MissionsRun(LESSON, progress('m1', ['m1']), () => {})
    a.resume([q])
    expect(a.phase).toBe('questions')
    const b = new MissionsRun(LESSON, progress('m2', ['m1']), () => {})
    b.resume([])
    expect(b.phase).toBe('build')
    const c = new MissionsRun(LESSON, progress(null, ['m1', 'm2']), () => {})
    c.resume([])
    expect(c.phase).toBe('done')
  })
})
