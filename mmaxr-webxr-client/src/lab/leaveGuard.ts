import { XapiVerb } from '@mmaxr/schema'
import { GAMIFICATION } from '../config'
import { leaveProgress } from '../gamification/leaveProgress'
import { telemetry } from '../services/telemetry'
import { button, dialog } from '../ui/components'
import { h } from '../ui/dom'

/** Ask before leaving a lab that is still running. Resolves true to leave. */
export function askLeave(): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false
    const done = (leave: boolean) => {
      if (answered) return
      answered = true
      d.close()
      resolve(leave)
    }
    const d = dialog({
      title: 'Leave the lab?',
      description: 'You are leaving in the middle of the lab. Your rubric points won’t be saved or scored.',
      onClose: () => done(false),
    })
    const stay = button('No, continue', { variant: 'primary', onClick: () => done(false) })
    // What finishing would still earn. The dialog never waits for it: it appears if the server answers in time.
    if (GAMIFICATION && telemetry.sessionId) d.body.append(leaveProgress(telemetry.sessionId))
    d.body.append(h('div', { class: 'dialog-actions' }, button('Yes, leave', { variant: 'destructive', onClick: () => done(true) }), stay))
    stay.focus()
  })
}

/** Record that the student left before finishing, and send it now. */
export function markLeft(via: 'button' | 'closed') {
  telemetry.emit(XapiVerb.INVESTIGATED, { action: 'leave_lab', data: { via } })
  telemetry.flushBeacon()
}

/**
 * Guard a lab page: the router asks `confirmLeave` before any in-app navigation, and closing or reloading the tab
 * gets the browser's own prompt (it cannot show custom text) and is recorded as leaving.
 */
export function leaveGuard() {
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (!telemetry.inProgress) return
    e.preventDefault()
    e.returnValue = ''
  }
  const onPageHide = () => {
    if (telemetry.inProgress) markLeft('closed')
  }
  window.addEventListener('beforeunload', onBeforeUnload)
  window.addEventListener('pagehide', onPageHide)
  return {
    async confirmLeave(): Promise<boolean> {
      if (!telemetry.inProgress) return true
      if (!(await askLeave())) return false
      markLeft('button')
      return true
    },
    dispose() {
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('pagehide', onPageHide)
    },
  }
}
