/**
 * Who may speak when, for one student. One voice at a time, in this order:
 *
 *   1. The student (holding the talk button): everything else stops.
 *   2. Lab narration (recorded lines, played by the browser): never interrupted, never dropped.
 *   3. A coach reply to the student's question: always answered. The browser plays it after the current narration line.
 *   4. A coach nudge (proactive mode): only in a quiet moment, otherwise dropped, not delayed. A late nudge is noise.
 *
 * The browser reports narration and talking; a state it forgets to clear expires, so a lost message cannot silence the
 * coach for good.
 */
export interface FloorOptions {
  /** Quiet time needed after a narration line ends before a nudge may start. */
  quietAfterNarrationMs?: number;
  /** A narration line longer than this is assumed finished (the "ended" message was lost). */
  maxNarrationMs?: number;
  /** Talking longer than this is assumed finished. */
  maxTalkingMs?: number;
}

export class Floor {
  private narratingSince: number | null = null;
  private narrationEndedAt = -Infinity;
  private talkingSince: number | null = null;
  private readonly quietMs: number;
  private readonly maxNarrationMs: number;
  private readonly maxTalkingMs: number;

  constructor(
    private readonly now: () => number = Date.now,
    opts: FloorOptions = {},
  ) {
    this.quietMs = opts.quietAfterNarrationMs ?? 8_000;
    this.maxNarrationMs = opts.maxNarrationMs ?? 30_000;
    this.maxTalkingMs = opts.maxTalkingMs ?? 60_000;
  }

  /** Records what the browser reported. Returns true when the student has just started talking. */
  update(change: { narrating?: boolean; talking?: boolean }): boolean {
    const t = this.now();
    if (change.narrating === true) this.narratingSince = t;
    if (change.narrating === false && this.narratingSince !== null) {
      this.narratingSince = null;
      this.narrationEndedAt = t;
    }
    let startedTalking = false;
    if (change.talking === true) {
      startedTalking = !this.talking;
      this.talkingSince = t;
    }
    if (change.talking === false) this.talkingSince = null;
    return startedTalking;
  }

  get narrating(): boolean {
    if (this.narratingSince === null) return false;
    if (this.now() - this.narratingSince > this.maxNarrationMs) {
      this.narrationEndedAt = this.narratingSince + this.maxNarrationMs;
      this.narratingSince = null;
      return false;
    }
    return true;
  }

  get talking(): boolean {
    if (this.talkingSince === null) return false;
    if (this.now() - this.talkingSince > this.maxTalkingMs) {
      this.talkingSince = null;
      return false;
    }
    return true;
  }

  /** May the coach start an unprompted nudge now? (`coachSpeaking`: a reply is still being said.) */
  canNudge(coachSpeaking: boolean): string | null {
    if (this.talking) return 'student talking';
    if (this.narrating) return 'narration playing';
    if (this.now() - this.narrationEndedAt < this.quietMs) return 'narration just ended';
    if (coachSpeaking) return 'coach still speaking';
    return null;
  }
}
