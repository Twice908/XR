import { CONFIG } from './config'
import { fetchActiveLesson } from './services/lessons'
import { fetchSession } from './services/auth'
import { telemetry } from './services/telemetry'
import { aiCoach } from './services/aiCoach'
import { sensorTracker } from './services/sensorTracker'
import { createStateMachine } from './state/machine'
import { createRenderer } from './three/renderer'
import { createScene, loadModel } from './three/scene'
import { attachInteraction } from './three/interaction'
import { mountChatOverlay } from './ui/chatOverlay'
import { XapiVerb } from '@mmaxr/schema'

async function boot() {
  const canvas = document.getElementById('scene') as HTMLCanvasElement | null
  const overlayRoot = document.getElementById('chat-overlay') as HTMLElement | null
  const fatalEl = document.getElementById('fatal') as HTMLElement | null

  if (!canvas) throw new Error('#scene <canvas> not found in DOM')
  if (!overlayRoot) throw new Error('#chat-overlay element not found in DOM')

  // --- 1. Auth Lifecycle (Strictly before telemetry) ---
  const lesson = await fetchActiveLesson()
  const studentId =
    new URLSearchParams(location.search).get('studentId') ?? CONFIG.DEFAULT_STUDENT_ID
  const auth = await fetchSession(studentId, lesson.lessonId)

  telemetry.configure({
    sessionId: auth.sessionId,
    token: auth.token,
    studentId: auth.studentId,
    lessonId: auth.lessonId,
  })
  telemetry.emit(XapiVerb.Launched, 'lesson', { lessonId: lesson.lessonId })

  // --- 2. Dynamic Asset Loading ---
  const scene = createScene()
  const model = await loadModel(scene, lesson.modelUrl)
  console.info('[boot] model loaded', { name: model.name, children: model.children.length })

  // --- 3. Renderer & Sensor Tracking ---
  const { renderer, viewRig, startLoop } = createRenderer(canvas)
  sensorTracker.start(viewRig, auth.sessionId)

  const machine = createStateMachine(lesson)

  attachInteraction(scene, {
    viewRig,
    onHit(_object, _point) {
      // Dynamic mesh interaction logic — wires to machine.registerTrial() in next phase
    },
  })

  // --- 4. AI Chat: subscribe FIRST, then wire submit, then connect ---
  const chat = mountChatOverlay(overlayRoot)

  // Anything the backend pushes (coach replies, history batch, guardrail) renders here
  aiCoach.subscribe((msg) => chat.append(msg))

  // Student messages: append locally + send via WS
  chat.onSubmit((text) => {
    chat.append({
      role: 'student',
      text,
      timestamp: new Date().toISOString(),
    })
    aiCoach.sendStudentMessage(text)
    telemetry.emit(XapiVerb.Asked, 'ai-coach', { length: text.length })
  })

  aiCoach.connect({
    sessionId: auth.sessionId,
    studentId: auth.studentId,
    lessonId: auth.lessonId,
    token: auth.token,
  })

  // --- Render loop ---
  startLoop(() => {
    viewRig.render(renderer, scene)
  })

  ;(window as unknown as Record<string, unknown>).__mmaxr = {
    lesson,
    auth,
    machine,
    scene,
    renderer,
    chat,
    aiCoach,
    telemetry,
    sensorTracker,
  }
}

boot().catch((err) => {
  console.error('[boot] fatal:', err)
  const el = document.getElementById('fatal')
  if (el) {
    el.textContent = `Session failed: ${(err as Error).message}`
    el.style.display = 'block'
  }
})