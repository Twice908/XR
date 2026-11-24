#!/usr/bin/env node

const RED = '\x1b[31m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m', RESET = '\x1b[0m', DIM = '\x1b[2m'
const OK = `${GREEN}✓${RESET}`, FAIL = `${RED}✗${RESET}`, WARN = `${YELLOW}⚠${RESET}`

const E = {
  AUTH: 'http://localhost:3004/auth/session',
  LESSONS: 'http://localhost:3007/lessons/active',
  SESSIONS: 'http://localhost:3002/sessions',
  ANALYZE: 'http://localhost:3002/analyze',
  AI_COACH_WS: 'ws://localhost:3003',
}

function head(s) { console.log(`\n${CYAN}━━━ ${s} ━━━${RESET}`) }

async function probeAuth() {
  head('1. AUTH SERVICE (3004)')
  try {
    const res = await fetch(E.AUTH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: 'student_99', lessonId: 'physics-101' }),
    })
    console.log(`${res.ok ? OK : FAIL} POST ${E.AUTH} -> ${res.status}`)
    if (!res.ok) { console.log(`${DIM}${await res.text()}${RESET}`); return null }
    const data = await res.json()
    console.log(`${DIM}response keys: ${Object.keys(data).join(', ')}${RESET}`)
    if (data.sessionId) console.log(`${OK} sessionId = ${CYAN}${data.sessionId}${RESET}`)
    else { console.log(`${FAIL} MISSING sessionId`); return null }
    if (data.token) console.log(`${OK} token (${data.token.length} chars)`)
    else console.log(`${WARN} no token`)
    if (data.studentId) console.log(`${OK} studentId = ${data.studentId}`)
    if (data.lessonId) console.log(`${OK} lessonId = ${data.lessonId}`)
    return data
  } catch (err) {
    console.log(`${FAIL} ${err.message}`); return null
  }
}

async function probeLessons() {
  head('2. LESSON SERVICE (3007)')
  try {
    const res = await fetch(E.LESSONS)
    console.log(`${res.ok ? OK : FAIL} GET ${E.LESSONS} -> ${res.status}`)
    if (!res.ok) return null
    const data = await res.json()
    console.log(`${DIM}top-level keys: ${Object.keys(data).join(', ')}${RESET}`)
    if (data.modelUrl) console.log(`${OK} modelUrl = ${data.modelUrl}`)
    else console.log(`${FAIL} MISSING modelUrl`)
    if (data.simulation) {
      console.log(`${OK} simulation keys: ${Object.keys(data.simulation).join(', ')}`)
      for (const k of ['atomicNumber','nInitial','nFinal','anomalyTrialNumber','anomalyShiftMultiplier']) {
        const v = data.simulation[k]
        if (typeof v === 'number') console.log(`  ${OK} ${k} = ${v}`)
        else console.log(`  ${FAIL} ${k} (${typeof v})`)
      }
    } else console.log(`${FAIL} MISSING simulation`)
    return data
  } catch (err) { console.log(`${FAIL} ${err.message}`); return null }
}

async function probeSessions() {
  head('3. DASHBOARD · SESSIONS (3002)')
  try {
    const res = await fetch(E.SESSIONS)
    console.log(`${res.ok ? OK : FAIL} GET ${E.SESSIONS} -> ${res.status}`)
    if (!res.ok) return null
    const data = await res.json()
    const isArr = Array.isArray(data)
    console.log(`${OK} ${isArr ? `array len=${data.length}` : 'object'}`)
    if (isArr && data.length > 0) console.log(`${DIM}first item keys: ${Object.keys(data[0]).join(', ')}${RESET}`)
    return data
  } catch (err) { console.log(`${FAIL} ${err.message}`); return null }
}

async function probeAnalyze(sessionId) {
  head(`4. DASHBOARD · ANALYZE (3002) — sessionId=${sessionId || '<none>'}`)
  if (!sessionId) { console.log(`${WARN} skipped (no sessionId)`); return null }
  try {
    const url = `${E.ANALYZE}/${sessionId}`
    const res = await fetch(url)
    console.log(`${res.ok ? OK : FAIL} GET ${url} -> ${res.status}`)
    if (!res.ok) { console.log(`${DIM}${await res.text()}${RESET}`); return null }
    const data = await res.json()
    console.log(`${DIM}top-level keys: ${Object.keys(data).join(', ')}${RESET}`)
    for (const k of ['sessionId','timestamp','scores','metrics','trace']) {
      console.log(`  ${k in data ? OK : FAIL} ${k}`)
    }
    if (data.scores) console.log(`${OK} scores keys: ${Object.keys(data.scores).join(', ')}`)
    if (data.metrics) console.log(`${OK} metrics keys: ${Object.keys(data.metrics).join(', ')}`)
    if (Array.isArray(data.trace)) {
      console.log(`${OK} trace: ${data.trace.length} events`)
      if (data.trace.length > 0) console.log(`${DIM}first event: ${JSON.stringify(data.trace[0])}${RESET}`)
    }
    return data
  } catch (err) { console.log(`${FAIL} ${err.message}`); return null }
}

async function probeAiCoach(auth) {
  head('5. AI COACH WS (3003)')
  if (typeof WebSocket === 'undefined') { console.log(`${WARN} no global WebSocket — Node <22`); return }
  if (!auth?.sessionId) { console.log(`${WARN} skipped (no sessionId)`); return }
  await new Promise((resolve) => {
    const url = `${E.AI_COACH_WS}?sessionId=${auth.sessionId}&studentId=${auth.studentId||'student_99'}&lessonId=${auth.lessonId||'physics-101'}&token=${auth.token||''}`
    console.log(`${DIM}connecting to ${url}${RESET}`)
    const ws = new WebSocket(url)
    const timer = setTimeout(() => { console.log(`${FAIL} timeout 5s`); ws.close(); resolve() }, 5000)
    ws.onopen = () => console.log(`${OK} connected`)
    ws.onerror = (e) => { console.log(`${FAIL} error ${e.message||''}`); clearTimeout(timer); resolve() }
    ws.onclose = (ev) => { console.log(`${WARN} closed code=${ev.code}`); clearTimeout(timer); resolve() }
    ws.onmessage = (ev) => { console.log(`${OK} recv: ${String(ev.data).slice(0,200)}`); clearTimeout(timer); ws.close(); resolve() }
  })
}

async function main() {
  console.log(`${CYAN}MMAXR Backend Contract Probe${RESET}`)
  const auth = await probeAuth()
  const lesson = await probeLessons()
  await probeSessions()
  await probeAnalyze(auth?.sessionId)
  await probeAiCoach(auth)
  console.log(`\n${CYAN}━━━ SUMMARY ━━━${RESET}`)
  if (auth?.sessionId) console.log(`${OK} Auth OK — sessionId=${auth.sessionId}`)
  if (lesson?.modelUrl) console.log(`${OK} Lesson OK — modelUrl present`)
  if (auth?.sessionId) {
    console.log(`\n${DIM}Reuse for dashboard:${RESET}`)
    console.log(`  export SESSION_ID="${auth.sessionId}"`)
    console.log(`  curl http://localhost:3002/analyze/$SESSION_ID`)
  }
}

main().catch((err) => { console.error(`${FAIL} ${err.stack}`); process.exit(1) })