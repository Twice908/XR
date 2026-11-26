import { GAMIFICATION } from '../config'
import { claimPack, packStore, RewardsError } from '../services/rewards'
import { telemetry } from '../services/telemetry'
import { userAuth } from '../services/userAuth'
import { showPackNotice } from './packNotice'

let started = false

/**
 * Turn on the reward loop: when the server accepts a lab's submission, claim its pack and say so. Nothing here
 * runs when the GAMIFICATION flag is off, so the client then behaves exactly like the plain build.
 */
export function initGamification() {
  if (!GAMIFICATION || started) return
  started = true
  const claimed = new Set<string>()
  telemetry.onSubmitted((sessionId) => {
    if (claimed.has(sessionId) || !userAuth.current()) return
    claimed.add(sessionId)
    claimPack(sessionId)
      .then((claim) => {
        if (claim.created) packStore.set(packStore.unopened + 1)
        showPackNotice(claim)
      })
      .catch((err) => {
        claimed.delete(sessionId)
        // A reward failing must never get in the way of the lab: log it and move on.
        if (!(err instanceof RewardsError && err.status === 409)) console.warn('[rewards] claim failed', err)
      })
  })
  if (userAuth.current()) void packStore.refresh()
}
