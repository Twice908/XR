import * as THREE from 'three'
import { CONFIG } from './config'
import { fetchActiveLesson } from './services/lessons'
import { fetchSession } from './services/auth'
import { telemetry } from './services/telemetry'
import { aiCoach } from './services/aiCoach'
import { sensorTracker } from './services/sensorTracker'
import { createStateMachine } from './state/machine'
import { createRenderer } from './three/renderer'
import { createScene, loadModel } from './three/scene'
import { loadChemistryScene } from './three/chemistryScene'
import { attachInteraction } from './three/interaction'
import { mountChatOverlay } from './ui/chatOverlay'
import { mountChemistryLab } from './ui/chemistryLab'
import { XapiVerb } from '@mmaxr/schema'

async function boot() {
  const canvas = document.getElementById('scene') as HTMLCanvasElement | null
  const overlayRoot = document.getElementById('chat-overlay') as HTMLElement | null
  const chemRoot = document.getElementById('chemistry-overlay') as HTMLElement | null
  const fatalEl = document.getElementById('fatal') as HTMLElement | null

  if (!canvas || !overlayRoot || !chemRoot) throw new Error('DOM elements missing')

  const lesson = await fetchActiveLesson('chemistry')
  console.info('[boot] lesson loaded', { lessonId: lesson.lessonId, type: lesson.type })

  const studentId = new URLSearchParams(location.search).get('studentId') ?? CONFIG.DEFAULT_STUDENT_ID
  const auth = await fetchSession(studentId, lesson.lessonId)

  telemetry.configure({
    sessionId: auth.sessionId, token: auth.token, studentId: auth.studentId, lessonId: auth.lessonId,
  })
  telemetry.emit(XapiVerb.Launched, 'lesson', { lessonId: lesson.lessonId })

  const scene = createScene()
  const baseModel = await loadModel(scene, lesson.modelUrl)
  console.info('[boot] base model loaded', { name: baseModel.name })

  const { renderer, viewRig, startLoop } = createRenderer(canvas)
  sensorTracker.start(viewRig, auth.sessionId)

  // Adjust Camera for Chemistry Layout (Sidebar on Right)
  if (lesson.type === 'chemistry_indicators' && viewRig.camera instanceof THREE.PerspectiveCamera) {
    viewRig.camera.position.set(-1.2, 1.2, 2.5)
    viewRig.camera.lookAt(-1.2, 0.4, 0)
  }

  const machine = createStateMachine(lesson)

  if (lesson.type === 'chemistry_indicators' && machine.type === 'chemistry_indicators') {
    const chemScene = await loadChemistryScene(scene, lesson)
    console.info('[boot] chemistry scene ready — tubes:', chemScene.tubes.length)

    const ui = mountChemistryLab(chemRoot, lesson, machine, {
      onApplied: (tubeIndex, resultColor) => {
        const tube = chemScene.tubes[tubeIndex]
        if (tube) tube.setColor(resultColor)
        window.dispatchEvent(new CustomEvent('updateTubeColor', { detail: { tubeId: tubeIndex + 1, color: resultColor } }))
      },
    })

    attachInteraction(scene, {
      viewRig,
      renderer,
      onClick: (object) => {
        const idx = chemScene.getTubeIndexFromObject(object)
        if (idx !== null) ui.handleTubeClick(idx)
      },
    })

    ;(window as unknown as Record<string, unknown>).__chem = { chemScene, ui }
  } else {
    attachInteraction(scene, { viewRig, renderer, onClick: () => {} })
  }

  const chat = mountChatOverlay(overlayRoot)
  aiCoach.subscribe((msg) => chat.append(msg))
  chat.onSubmit((text) => {
    chat.append({ role: 'student', text, timestamp: new Date().toISOString() })
    aiCoach.sendStudentMessage(text)
    telemetry.emit(XapiVerb.Asked, 'ai-coach', { length: text.length })
  })
  aiCoach.connect({ sessionId: auth.sessionId, studentId: auth.studentId, lessonId: auth.lessonId, token: auth.token })

  startLoop(() => { viewRig.render(renderer, scene) })
  
  ;(window as unknown as Record<string, unknown>).__mmaxr = { lesson, auth, machine, scene, renderer, chat, aiCoach, telemetry, sensorTracker }
}

boot().catch((err) => {
  console.error('[boot] fatal:', err)
  const el = document.getElementById('fatal')
  if (el) { el.textContent = `Session failed: ${(err as Error).message}`; el.style.display = 'block' }
})