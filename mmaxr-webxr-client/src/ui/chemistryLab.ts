import type { ChemistryLessonContract } from '../services/lessons'
import { baseColorName } from '../services/colors'
import type { ChemistryMachine, Conclusion } from '../state/machine'

/**
 * Astryx-style spatial HUD for the Chemistry Lab.
 * Pure HTML + Tailwind (CDN) + a small token layer (.ax-*) injected once.
 *
 * Window events (all tubeId values are 1-based):
 *   LISTENS  'updateTubeColor'   { tubeId, color }   -> updates the live swatch in the table
 *   LISTENS  'revealDisclosure'  {}                  -> opens the Disclosure panel (after submit)
 *   EMITS    'indicatorSelected' { indicatorId }
 *   EMITS    'predictionMade'    { tubeId, indicatorId, predictedColor }
 *   EMITS    'indicatorApplied'  { tubeId, indicatorId, slot, observedColor }
 *   EMITS    'conclusionSet'     { tubeId, conclusion }
 *   EMITS    'analysisSubmitted' {}
 */

const PREDICTION_PALETTE = [
  { name: 'Red', hex: '#ef4444' },
  { name: 'Orange', hex: '#f97316' },
  { name: 'Yellow', hex: '#eab308' },
  { name: 'Green', hex: '#22c55e' },
  { name: 'Blue', hex: '#3b82f6' },
  { name: 'Purple', hex: '#a855f7' },
  { name: 'Pink', hex: '#ec4899' },
  { name: 'Clear', hex: '#d4d4d8' },
]

const COLOR_HEX: Record<string, string> = {
  red: '#ef4444', blue: '#3b82f6', purple: '#a855f7', pink: '#ec4899',
  yellow: '#eab308', green: '#22c55e', orange: '#f97316', brown: '#92400e',
  clear: '#d4d4d8', colorless: '#d4d4d8', grey: '#71717a', gray: '#71717a',
}

const STYLE_ID = 'astryx-chem-styles'
const STYLES = `
:root{
  --ax-bg: rgba(10,14,28,.62);
  --ax-bg-strong: rgba(8,11,24,.86);
  --ax-border: rgba(148,163,255,.22);
  --ax-cyan: #22d3ee;
  --ax-violet: #a78bfa;
  --ax-lime: #a3e635;
  --ax-text: #f1f5ff;
  --ax-muted: #94a3c8;
}
.ax-panel{
  background: linear-gradient(160deg, var(--ax-bg-strong), var(--ax-bg));
  border:1px solid var(--ax-border);
  border-radius:20px;
  backdrop-filter: blur(18px) saturate(140%);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
  box-shadow: 0 0 0 1px rgba(34,211,238,.06), 0 20px 60px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.08);
  color: var(--ax-text);
  font-family: 'Inter', system-ui, sans-serif;
}
.ax-eyebrow{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--ax-cyan);font-weight:700}
.ax-chip{
  display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:14px;
  border:1px solid var(--ax-border);background:rgba(255,255,255,.04);color:var(--ax-text);
  font-size:12px;font-weight:600;cursor:pointer;transition:all .15s ease;text-align:left;
}
.ax-chip:hover{background:rgba(34,211,238,.1);border-color:rgba(34,211,238,.5)}
.ax-chip.is-active{
  background:rgba(34,211,238,.16);border-color:var(--ax-cyan);
  box-shadow:0 0 18px rgba(34,211,238,.45), inset 0 0 12px rgba(34,211,238,.15);
}
.ax-chip small{display:block;font-size:9px;font-weight:500;color:var(--ax-muted);letter-spacing:.04em}
.ax-dot{width:12px;height:12px;border-radius:999px;border:1px solid rgba(255,255,255,.4);flex:none}
.ax-table th{
  position:sticky;top:0;background:rgba(6,9,20,.9);color:var(--ax-muted);
  font-size:10px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;padding:10px 10px;text-align:left;
}
.ax-table td{padding:10px;border-top:1px solid rgba(148,163,255,.1);font-size:12px;vertical-align:top}
.ax-table tr:hover td{background:rgba(34,211,238,.04)}
.ax-select{
  width:100%;background:rgba(255,255,255,.06);border:1px solid var(--ax-border);color:var(--ax-text);
  border-radius:8px;padding:4px 6px;font-size:12px;outline:none;
}
.ax-select:focus{border-color:var(--ax-cyan);box-shadow:0 0 10px rgba(34,211,238,.4)}
.ax-select option{background:#0b1020}
.ax-btn{
  border-radius:12px;padding:11px 16px;font-weight:700;font-size:13px;letter-spacing:.04em;
  transition:all .15s ease;cursor:pointer;border:1px solid transparent;
}
.ax-btn-primary{
  background:linear-gradient(90deg,#06b6d4,#8b5cf6);color:#fff;
  box-shadow:0 0 22px rgba(139,92,246,.45);
}
.ax-btn-primary:hover{filter:brightness(1.15)}
.ax-btn-primary:disabled{filter:grayscale(1) brightness(.6);box-shadow:none;cursor:not-allowed}
.ax-btn-ghost{background:transparent;color:var(--ax-muted);border-color:var(--ax-border)}
.ax-btn-ghost:hover{color:#fff;border-color:rgba(255,255,255,.4)}
.ax-swatch{
  display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 4px;border-radius:14px;
  border:1px solid var(--ax-border);background:rgba(255,255,255,.03);cursor:pointer;transition:all .15s;
  color:var(--ax-muted);font-size:10px;
}
.ax-swatch:hover{border-color:rgba(255,255,255,.5)}
.ax-swatch.is-active{border-color:var(--ax-cyan);background:rgba(34,211,238,.14);box-shadow:0 0 16px rgba(34,211,238,.4);color:#fff}
.ax-swatch span.ax-orb{width:30px;height:30px;border-radius:999px;border:1px solid rgba(255,255,255,.35);box-shadow:inset 0 -6px 10px rgba(0,0,0,.25), 0 0 12px currentColor}
.ax-input{
  width:100%;background:rgba(255,255,255,.06);border:1px solid var(--ax-border);border-radius:10px;
  padding:9px 12px;font-size:13px;color:#fff;outline:none;
}
.ax-input:focus{border-color:var(--ax-cyan);box-shadow:0 0 12px rgba(34,211,238,.4)}
.ax-scrim{background:rgba(3,5,14,.6);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
@keyframes ax-pop{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}
.ax-pop{animation:ax-pop .18s ease-out}
.ax-ok{color:var(--ax-lime)} .ax-bad{color:#fb7185}
`

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

function colorHex(name: string): string {
  return COLOR_HEX[baseColorName(name)] ?? '#94a3b8'
}

function emit(name: string, detail: Record<string, unknown> = {}): void {
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

export interface ChemistryLabOptions {
  onApplied: (tubeIndex: number, resultColor: string) => void
}

export interface ChemistryLabController {
  handleTubeClick: (tubeIndex: number) => void
  refresh: () => void
  dispose: () => void
}

interface PendingPrediction {
  tubeIndex: number
  indicatorId: string
}

export function mountChemistryLab(
  root: HTMLElement,
  lesson: ChemistryLessonContract,
  machine: ChemistryMachine,
  options: ChemistryLabOptions,
): ChemistryLabController {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = STYLES
    document.head.appendChild(style)
  }

  let selectedIndicatorId: string | null = null
  let pendingPrediction: PendingPrediction | null = null
  let showDisclosure = false
  let toastTimeout: number | null = null
  /** Live liquid color per tube (index), pushed by 'updateTubeColor'. */
  const liveColor: Record<number, string> = {}

  const indicatorName = (id: string) => lesson.indicators.find((i) => i.id === id)?.name ?? id

  function showToast(msg: string) {
    const el = root.querySelector<HTMLDivElement>('#chem-toast')
    if (!el) return
    el.innerHTML = `<div class="ax-panel ax-pop px-4 py-2 text-sm pointer-events-none">${esc(msg)}</div>`
    if (toastTimeout) clearTimeout(toastTimeout)
    toastTimeout = window.setTimeout(() => { el.innerHTML = '' }, 2200)
  }

  // ---------- render ----------

  function render(): void {
    const slotCount = lesson.config.requiredIndicatorsToSelect
    const revealed = machine.revealed

    root.innerHTML = `
      <div class="absolute inset-0 pointer-events-none">

        <!-- Indicator selection dock -->
        <div class="absolute top-3 left-3 right-[600px] flex justify-center pointer-events-none">
          <div class="ax-panel pointer-events-auto px-4 py-3 max-w-full">
            <div class="ax-eyebrow mb-2">Indicators · pick one, then click a tube</div>
            <div class="grid grid-cols-4 gap-2">
              ${lesson.indicators.map((ind) => `
                <button data-indicator="${esc(ind.id)}" class="ax-chip ${selectedIndicatorId === ind.id ? 'is-active' : ''}" ${revealed ? 'disabled' : ''}>
                  <span class="ax-dot" style="background:${ind.colors ? colorHex(ind.colors.neutral) : 'conic-gradient(#ef4444,#eab308,#22c55e,#3b82f6,#a855f7,#ef4444)'}"></span>
                  <span>${esc(ind.name)}<small>${esc(ind.source)}</small></span>
                </button>`).join('')}
            </div>
          </div>
        </div>

        <!-- Holographic data table -->
        <div class="ax-panel absolute top-3 right-3 bottom-3 w-[580px] pointer-events-auto flex flex-col overflow-hidden">
          <div class="p-5 pb-3">
            <div class="ax-eyebrow">Holographic Data Table</div>
            <h2 class="text-lg font-bold tracking-tight mt-1">${esc(lesson.title)}</h2>
            <p class="text-xs mt-1" style="color:var(--ax-muted)">
              ${selectedIndicatorId
                ? `Active: <b style="color:var(--ax-cyan)">${esc(indicatorName(selectedIndicatorId))}</b> — click a test tube`
                : 'Select an indicator to begin'}
            </p>
          </div>
          <div class="flex-1 overflow-auto">
            <table class="ax-table w-full border-collapse">
              <thead><tr>
                <th>Test Tube</th><th>Initial Color</th>
                ${Array.from({ length: slotCount }, (_, i) => `<th>Indicator ${i + 1}</th>`).join('')}
                <th>Conclusion</th><th>pH Value</th>
              </tr></thead>
              <tbody>${machine.tubes.map((t, i) => renderRow(t, i, slotCount, revealed)).join('')}</tbody>
            </table>
          </div>
          <div class="p-4 flex gap-2" style="border-top:1px solid var(--ax-border)">
            ${revealed
              ? `<button id="view-disclosure" class="ax-btn ax-btn-primary flex-1">View Disclosure</button>`
              : `<button id="submit-btn" class="ax-btn ax-btn-primary flex-1">Submit Analysis</button>`}
          </div>
        </div>

        <div id="chem-toast" class="absolute top-1/2 left-1/3 -translate-x-1/2 -translate-y-1/2 z-20"></div>
        ${pendingPrediction ? renderPredictionModal() : ''}
        ${showDisclosure ? renderDisclosure() : ''}
      </div>`
    attachListeners()
  }

  function renderRow(tube: ChemistryMachine['tubes'][number], i: number, slotCount: number, revealed: boolean): string {
    const cells = Array.from({ length: slotCount }, (_, slot) => {
      const indId = tube.indicatorsApplied[slot]
      if (!indId) return `<td style="color:#475577">—</td>`
      const color = tube.observedColors[slot]
      return `<td>
        <div class="flex items-center gap-1.5"><span class="ax-dot" style="background:${colorHex(color)};box-shadow:0 0 8px ${colorHex(color)}"></span>${esc(color)}</div>
        <div style="font-size:9px;color:var(--ax-muted);margin-top:2px">${esc(indicatorName(indId))}</div>
      </td>`
    }).join('')

    const concl = revealed
      ? `<span style="text-transform:capitalize">${esc(tube.conclusion ?? 'not set')}</span>`
      : `<select data-conclusion="${i}" class="ax-select">
          <option value="">—</option>
          ${(['acid', 'base', 'neutral'] as Conclusion[]).map((c) =>
            `<option value="${c}" ${tube.conclusion === c ? 'selected' : ''}>${c[0].toUpperCase() + c.slice(1)}</option>`).join('')}
        </select>`

    const live = liveColor[i] ?? 'Clear'
    return `<tr>
      <td><b>Tube ${i + 1}</b></td>
      <td><div class="flex items-center gap-1.5"><span class="ax-dot" style="background:${colorHex(live)}"></span>${esc(live)}</div></td>
      ${cells}
      <td>${concl}</td>
      <td>${revealed ? `<b class="font-mono" style="color:var(--ax-cyan)">${esc(tube.solution.ph)}</b>` : `<span style="color:#475577">—</span>`}</td>
    </tr>`
  }

  function renderPredictionModal(): string {
    const p = pendingPrediction!
    const ind = lesson.indicators.find((i) => i.id === p.indicatorId)
    if (!ind) return ''
    return `
      <div class="ax-scrim fixed inset-0 z-50 flex items-center justify-center pointer-events-auto">
        <div class="ax-panel ax-pop w-full max-w-md mx-4 p-6">
          <div class="ax-eyebrow">Prediction</div>
          <h3 class="text-xl font-bold mt-1">What color do you predict?</h3>
          <p class="text-sm mt-1 mb-4" style="color:var(--ax-muted)">Tube ${p.tubeIndex + 1} + <b style="color:var(--ax-cyan)">${esc(ind.name)}</b></p>
          <div class="grid grid-cols-4 gap-2 mb-4">
            ${PREDICTION_PALETTE.map((c) => `
              <button data-predict-color="${c.name}" class="ax-swatch">
                <span class="ax-orb" style="background:${c.hex};color:${c.hex}"></span>${c.name}
              </button>`).join('')}
          </div>
          <input id="predict-custom-color" class="ax-input mb-5" placeholder="Or type a color (e.g. pale pink)" />
          <div class="flex justify-end gap-2">
            <button id="predict-cancel" class="ax-btn ax-btn-ghost">Cancel</button>
            <button id="predict-confirm" class="ax-btn ax-btn-primary">Drop Indicator</button>
          </div>
        </div>
      </div>`
  }

  function renderDisclosure(): string {
    const correct = machine.tubes.filter((t) => t.conclusion === normalizeType(t.solution.type)).length
    return `
      <div class="ax-scrim fixed inset-0 z-50 flex items-center justify-center pointer-events-auto">
        <div class="ax-panel ax-pop w-full max-w-3xl mx-4 p-6 max-h-[90vh] flex flex-col">
          <div class="ax-eyebrow">Disclosure</div>
          <h3 class="text-xl font-bold mt-1">Analysis Results</h3>
          <p class="text-sm mt-1 mb-4" style="color:var(--ax-muted)">You classified <b class="ax-ok">${correct}</b> of ${machine.tubes.length} solutions correctly.</p>
          <div class="overflow-auto">
            <table class="ax-table w-full border-collapse">
              <thead><tr><th>Tube</th><th>Solution</th><th>Formula</th><th>Type</th><th>pH</th><th>Your Answer</th></tr></thead>
              <tbody>
                ${machine.tubes.map((t, i) => {
                  const actual = normalizeType(t.solution.type)
                  const ok = t.conclusion === actual
                  return `<tr>
                    <td><b>Tube ${i + 1}</b></td>
                    <td>${esc(t.solution.name)}</td>
                    <td class="font-mono" style="color:var(--ax-violet)">${esc(t.solution.formula)}</td>
                    <td style="text-transform:capitalize">${esc(actual)}</td>
                    <td class="font-mono" style="color:var(--ax-cyan)">${esc(t.solution.ph)}</td>
                    <td class="${ok ? 'ax-ok' : 'ax-bad'}" style="text-transform:capitalize">${ok ? '✓' : '✗'} ${esc(t.conclusion ?? 'not set')}</td>
                  </tr>`
                }).join('')}
              </tbody>
            </table>
          </div>
          <div class="flex justify-end mt-5"><button id="disclosure-close" class="ax-btn ax-btn-primary">Close</button></div>
        </div>
      </div>`
  }

  function normalizeType(type: string): Conclusion {
    const t = (type ?? '').toLowerCase()
    if (t.includes('acid')) return 'acid'
    if (t.includes('base') || t.includes('alkaline')) return 'base'
    return 'neutral'
  }

  // ---------- behavior ----------

  function submitAnalysis(): void {
    if (machine.revealed) return
    machine.submit()
    emit('analysisSubmitted')
    showDisclosure = true
    render()
  }

  function attachListeners(): void {
    root.querySelectorAll<HTMLButtonElement>('[data-indicator]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const id = btn.dataset.indicator!
        selectedIndicatorId = selectedIndicatorId === id ? null : id
        if (selectedIndicatorId) emit('indicatorSelected', { indicatorId: id })
        render()
      }))

    root.querySelector('#submit-btn')?.addEventListener('click', submitAnalysis)
    root.querySelector('#view-disclosure')?.addEventListener('click', () => { showDisclosure = true; render() })
    root.querySelector('#disclosure-close')?.addEventListener('click', () => { showDisclosure = false; render() })

    root.querySelectorAll<HTMLSelectElement>('[data-conclusion]').forEach((sel) =>
      sel.addEventListener('change', () => {
        const idx = Number(sel.dataset.conclusion)
        const val = sel.value as Conclusion | ''
        if (!val) return
        machine.setConclusion(idx, val)
        emit('conclusionSet', { tubeId: idx + 1, conclusion: val })
      }))

    if (pendingPrediction) {
      let chosen: string | null = null
      const swatches = root.querySelectorAll<HTMLButtonElement>('[data-predict-color]')
      swatches.forEach((btn) =>
        btn.addEventListener('click', () => {
          swatches.forEach((b) => b.classList.remove('is-active'))
          btn.classList.add('is-active')
          chosen = btn.dataset.predictColor ?? null
        }))

      root.querySelector('#predict-cancel')?.addEventListener('click', () => { pendingPrediction = null; render() })
      root.querySelector('#predict-confirm')?.addEventListener('click', () => {
        const custom = root.querySelector<HTMLInputElement>('#predict-custom-color')?.value.trim()
        const predicted = custom || chosen
        if (!predicted) { showToast('Pick a color or type one'); return }

        const { tubeIndex, indicatorId } = pendingPrediction!
        pendingPrediction = null

        machine.logPrediction(tubeIndex, indicatorId, predicted)
        emit('predictionMade', { tubeId: tubeIndex + 1, indicatorId, predictedColor: predicted })

        const result = machine.applyIndicator(tubeIndex, indicatorId, predicted)
        if (!result) { showToast('Could not apply indicator'); render(); return }

        emit('indicatorApplied', {
          tubeId: tubeIndex + 1,
          indicatorId,
          slot: machine.tubes[tubeIndex].indicatorsApplied.length - 1,
          observedColor: result.resultColor,
        })
        options.onApplied(tubeIndex, result.resultColor)
        render()
      })
    }
  }

  function handleTubeClick(tubeIndex: number): void {
    if (machine.revealed) { showToast('Analysis already submitted'); return }
    if (!selectedIndicatorId) { showToast('Select an indicator first'); return }
    const tube = machine.tubes[tubeIndex]
    if (!tube) return
    if (tube.indicatorsApplied.length >= machine.maxIndicatorsPerTube) { showToast('Tube is full'); return }
    if (tube.indicatorsApplied.includes(selectedIndicatorId)) { showToast('Indicator already applied to this tube'); return }
    pendingPrediction = { tubeIndex, indicatorId: selectedIndicatorId }
    render()
  }

  // ---------- inbound events (Three.js logic -> UI) ----------

  const onUpdateTubeColor = (e: Event) => {
    const { tubeId, color } = (e as CustomEvent<{ tubeId: number; color: string }>).detail ?? {}
    if (typeof tubeId !== 'number' || !color) return
    liveColor[tubeId - 1] = color
    render()
  }
  const onRevealDisclosure = () => { if (!machine.revealed) machine.submit(); showDisclosure = true; render() }

  window.addEventListener('updateTubeColor', onUpdateTubeColor)
  window.addEventListener('revealDisclosure', onRevealDisclosure)

  render()
  return {
    handleTubeClick,
    refresh: render,
    dispose() {
      window.removeEventListener('updateTubeColor', onUpdateTubeColor)
      window.removeEventListener('revealDisclosure', onRevealDisclosure)
      root.innerHTML = ''
    },
  }
}
