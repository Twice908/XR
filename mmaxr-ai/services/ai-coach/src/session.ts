import { applyGuardrails } from '@mmaxr/guardrails';
import { fallbackReply } from './fallback';
import { buildSystemPrompt, describeSnapshot } from './prompt';
import type { ProviderRegistry } from './providers';
import { ProviderError, type ChatTurn } from './providers/types';
import type { Assignment, ClientMessage, CoachReason, EventKind, Hello, Mode, ServerMessage, Snapshot, TruthTube } from './protocol';

const MAX_HISTORY_TURNS = 10;
const MAX_TEXT = 600;
const MIN_NUDGE_GAP_MS = 20_000;

export interface SessionDeps {
  registry: ProviderRegistry;
  /** Reads this session's hidden answers from the lesson service. Resolves null when unavailable. */
  loadAssignment: () => Promise<Assignment | null>;
  send: (msg: ServerMessage) => void;
  now?: () => number;
  log?: (line: string) => void;
}

/** One connected student. Holds the conversation, the mode, and the hidden answers used only by the guard. */
export class CoachSession {
  private hello: Hello | null = null;
  private mode: Mode = 'proactive';
  private history: ChatTurn[] = [];
  private truth: TruthTube[] | null = null;
  private lastNudgeAt = 0;
  private busy = false;
  private counter = 0;
  private readonly now: () => number;
  private readonly log: (line: string) => void;

  constructor(private readonly deps: SessionDeps) {
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? (() => {});
  }

  get currentMode(): Mode {
    return this.mode;
  }

  announce() {
    const p = this.deps.registry.active;
    this.deps.send({ type: 'ready', mode: this.mode, provider: p.name, model: p.model, configured: p.isConfigured() });
  }

  async handle(msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case 'hello':
        this.hello = { lessonId: msg.lessonId, title: msg.title, labType: msg.labType, summary: msg.summary };
        void this.refreshAssignment();
        return;
      case 'mode':
        this.mode = msg.mode;
        this.deps.send({ type: 'mode', mode: this.mode });
        return;
      case 'ask':
        return this.respond('reply', `The student says: “${String(msg.text).slice(0, MAX_TEXT)}”`, 'ask', msg.snapshot, String(msg.text).slice(0, MAX_TEXT));
      case 'event':
        return this.nudge(msg.kind, msg.detail, msg.snapshot);
      case 'reveal':
        return this.wrapUp(msg.snapshot);
    }
  }

  private assignment: Assignment | null = null;

  private async refreshAssignment(): Promise<Assignment | null> {
    try {
      this.assignment = (await this.deps.loadAssignment()) ?? this.assignment;
    } catch {
      /* keep whatever we had; the guard fails closed without it */
    }
    return this.assignment;
  }

  private async nudge(kind: EventKind, detail: string | undefined, snapshot: Snapshot | undefined) {
    if (this.mode !== 'proactive') return;
    const t = this.now();
    if (t - this.lastNudgeAt < MIN_NUDGE_GAP_MS || this.busy) return;
    this.lastNudgeAt = t;
    const what = (detail ?? kind).slice(0, 300);
    await this.respond('nudge', `[lab event] ${what} Say one short coaching question about it.`, kind, snapshot, `[lab event] ${what}`);
  }

  private async wrapUp(snapshot: Snapshot | undefined) {
    if (this.mode === 'off') return;
    // Disclosure is the server's call: nothing is said until the lesson service confirms the analysis was submitted.
    const a = await this.refreshAssignment();
    if (!a?.submitted) {
      this.log('wrap-up requested before submission; ignored');
      return;
    }
    this.truth = a.tubes.slice(0, 12) as TruthTube[];
    await this.respond('wrapup', '[lab finished] The student has submitted. Give the wrap-up now.', 'reveal', snapshot, '[lab finished]', 380);
  }

  private async respond(reason: CoachReason, userTurn: string, kind: EventKind | 'ask' | 'reveal', snapshot: Snapshot | undefined, historyText: string, maxTokens = 220) {
    if (this.mode === 'off') {
      this.deps.send({ type: 'coach_off' });
      return;
    }
    if (this.busy && reason === 'reply') return; // one answer at a time
    this.busy = true;
    this.deps.send({ type: 'thinking' });

    const provider = this.deps.registry.active;
    const hello: Hello = this.hello ?? { lessonId: 'unknown', title: 'a science lab', labType: 'unknown' };
    if (this.truth === null && this.assignment === null) await this.refreshAssignment();
    const state = describeSnapshot(snapshot);
    const turns: ChatTurn[] = [...this.history, { role: 'user', text: state ? `${userTurn}\n\n${state}` : userTurn }];

    let text: string;
    let degraded = false;
    let blocked = false;
    try {
      text = await provider.complete({ system: buildSystemPrompt(hello, this.truth), turns, maxTokens });
      const revealed = this.truth !== null;
      const verdicts = (snapshot?.tubes ?? []).filter((t) => t.conclusion).map((t) => ({ tube: t.n, verdict: t.conclusion as string }));
      const phs = (snapshot?.tubes ?? []).map((t) => t.recordedPh).filter((n): n is number => n !== null);
      const secrets = revealed ? [] : (this.assignment?.tubes ?? []).map((t) => ({ tube: t.tube, terms: [t.name, t.formula], verdict: t.type, ph: t.ph }));
      const guarded = applyGuardrails(text, { allowNumbers: true, secrets, enforceTubeClaims: !revealed, allowedVerdicts: verdicts, allowedPh: phs });
      if (guarded.wasBlocked) this.log(`guard blocked a reply (${guarded.reasons.join(',')})`);
      text = guarded.safeResponse;
      blocked = guarded.wasBlocked;
    } catch (err) {
      degraded = true;
      const kindName = err instanceof ProviderError ? err.kind : 'error';
      this.log(`provider ${provider.name} unavailable (${kindName}): ${(err as Error).message.slice(0, 160)}`);
      text = fallbackReply(kind);
    } finally {
      this.busy = false;
    }

    this.history.push({ role: 'user', text: historyText }, { role: 'assistant', text });
    if (this.history.length > MAX_HISTORY_TURNS * 2) this.history.splice(0, this.history.length - MAX_HISTORY_TURNS * 2);
    this.deps.send({ type: 'coach', id: `c${++this.counter}`, text, reason, provider: provider.name, blocked, degraded });
  }
}
