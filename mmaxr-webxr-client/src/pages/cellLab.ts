import type { MissionsLessonContract } from '@mmaxr/schema'
import { XapiVerb } from '@mmaxr/schema'
import { go } from '../router'
import type { LabSession } from '../services/session'
import { answerQuestion, checkMission, fetchProgress, finishRun, takeHint } from '../services/missionsApi'
import { telemetry } from '../services/telemetry'
import { getStage } from '../stage/index.js'
import { h } from '../ui/dom'
import { floatingCoachMount, startCoach } from '../lab/coach'
import type { Snapshot } from '../services/aiCoach'

interface Ctx {
  root: HTMLElement
  canvas: HTMLCanvasElement
  status: HTMLElement
  session: LabSession
  lesson: MissionsLessonContract
  isDestroyed: () => boolean
}

/** What the cell bundle tells this page (see mmaxr-cell-explorer/app/src/main.ts). */
type CellMessage =
  | { source: 'mmaxr-cell'; type: 'ready' | 'exit' }
  | { source: 'mmaxr-cell'; type: 'mission'; missionId: string; chapter: string | null }
  | { source: 'mmaxr-cell'; type: 'hint'; missionId: string }
  | { source: 'mmaxr-cell'; type: 'answer'; assessmentId: string; optionIndex: number }

/**
 * Plant vs Animal Cell, exactly as in MMAXR: its own bundle (with its own three.js and IWSDK) in a frame over the
 * lab. The journey checks its questions itself; this page records each chapter, hint and answer with XR's server
 * in order, so the run is scored and reported like every other XR lab.
 */
export async function startCellLab(ctx: Ctx): Promise<() => void> {
  const { root, canvas, status, session, lesson } = ctx
  if (!lesson.bundleUrl) throw new Error('This lab has no bundle to open.')
  // The cell lab plays its own sounds; the shell's audio stays paused underneath.
  getStage().setQuiet(true)
  canvas.hidden = true
  const { progress: startProgress } = await fetchProgress(session)
  let progress = startProgress
  let finished = progress.finished
  let lastAnswer: { correct: boolean } | null = null
  let answeredAt = Date.now()

  const frame = h('iframe', { class: 'ml-frame', src: lesson.bundleUrl, title: lesson.title, allow: 'xr-spatial-tracking; autoplay; fullscreen' }) as HTMLIFrameElement
  root.appendChild(frame)

  // One message at a time: a chapter must be recorded before the answers it unlocked.
  let queue: Promise<void> = Promise.resolve()
  const record = (fn: () => Promise<void>) => {
    queue = queue.then(fn).catch((err) => console.warn('[cell] could not record', err))
  }

  const onMessage = (ev: MessageEvent) => {
    if (ev.origin !== window.location.origin || ev.source !== frame.contentWindow) return
    const m = ev.data as CellMessage
    if (m?.source !== 'mmaxr-cell') return
    coach.markActive() // clicks inside the frame never reach this page
    switch (m.type) {
      case 'ready':
        status.remove()
        return
      case 'exit':
        go('/experiments')
        return
      case 'mission':
        record(async () => {
          if (!m.chapter) return
          const r = await checkMission(session, m.missionId, { chapter: m.chapter })
          progress = r.progress
          telemetry.emit(XapiVerb.OBSERVED, { action: 'mission_complete', target: `mission:${m.missionId}`, value: r.attempts })
          answeredAt = Date.now()
          if (r.progress.current === null && !finished) await finish()
        })
        return
      case 'hint':
        record(async () => {
          const r = await takeHint(session, m.missionId)
          telemetry.emit(XapiVerb.INVESTIGATED, { action: 'hint', target: `mission:${m.missionId}`, value: r.level })
        })
        return
      case 'answer':
        record(async () => {
          const thinkMs = Date.now() - answeredAt
          const r = await answerQuestion(session, { question: m.assessmentId, choice: `p${m.optionIndex}`, thinkMs })
          answeredAt = Date.now()
          progress = r.progress
          lastAnswer = { correct: r.correct }
          if (!r.correct) coach.client.event('prediction_mismatch', 'The student answered a question about the cells and got it wrong.', snapshot())
          telemetry.emit(XapiVerb.ACTED, { action: 'quiz_answer', target: `question:${m.assessmentId}`, value: r.correct ? 'correct' : 'wrong', data: { tool: 'quiz', match: r.correct, decisionMs: thinkMs } })
          if (r.progress.current === null && !finished) await finish()
        })
        return
    }
  }
  const finish = async () => {
    finished = true
    const sum = await finishRun(session)
    coach.client.reveal(snapshot())
    telemetry.emit(XapiVerb.EXPLAINED, { action: 'submit_analysis', data: { missions: sum.missions, hintsUsed: sum.hintsUsed, quizCorrect: sum.correct, quizTotal: sum.total } })
  }
  window.addEventListener('message', onMessage)

  // The coach floats over the frame. It knows the student's place in the journey, never the answers.
  const snapshot = (): Snapshot => {
    const done = lesson.missions.filter((x) => progress.missions[x.id]?.met === true)
    const current = lesson.missions.find((x) => x.id === progress.current)
    const lines = [`The student is exploring a plant cell and an animal cell. Missions done: ${done.length} of ${lesson.missions.length}.`]
    if (current) lines.push(`Current mission: ${current.title}. Goal on screen: ${current.goalText}`)
    if (lastAnswer) lines.push(`Their last answer to a question was ${lastAnswer.correct ? 'right' : 'not right'}.`)
    if (finished) lines.push('The student has finished the journey.')
    return { phase: finished ? 'done' : 'exploring', tools: [], activeTool: null, tubes: [], lines }
  }
  const mount = floatingCoachMount(root)
  const coach = startCoach({
    session,
    hello: { lessonId: lesson.lessonId, title: lesson.title, labType: lesson.type, summary: lesson.summary },
    snapshot,
    mount,
    finished: () => finished,
    activityRoot: root,
  })

  // The bundle answers within a few seconds; if it never does, do not leave the student behind a spinner.
  const fallback = window.setTimeout(() => status.remove(), 15000)

  return () => {
    window.clearTimeout(fallback)
    window.removeEventListener('message', onMessage)
    coach.dispose()
    mount.dispose()
    frame.remove()
    canvas.hidden = false
  }
}
