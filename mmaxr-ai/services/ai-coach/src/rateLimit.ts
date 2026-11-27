/** A fixed one-minute window: at most `limit` hits per window. */
export class RateWindow {
  private start: number;
  private count = 0;

  constructor(
    private readonly limit: number,
    private readonly now: () => number = Date.now,
    private readonly windowMs = 60_000,
  ) {
    this.start = now();
  }

  /** Records a hit; false when the window is already full. */
  take(): boolean {
    const t = this.now();
    if (t - this.start >= this.windowMs) {
      this.start = t;
      this.count = 0;
    }
    if (this.count >= this.limit) return false;
    this.count++;
    return true;
  }

  /** Whole seconds until the window resets. */
  secondsLeft(): number {
    return Math.max(1, Math.ceil((this.windowMs - (this.now() - this.start)) / 1000));
  }
}
