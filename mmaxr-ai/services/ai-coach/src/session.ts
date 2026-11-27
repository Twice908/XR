import { applyGuardrails } from '@mmaxr/guardrails';
import { fallbackReply } from './fallback';
import { buildSystemPrompt, describeSnapshot } from './prompt';
import type { ProviderRegistry } from './providers';
import { ProviderError, type ChatTurn } from './providers/types';
import type { Assignment, ClientMessage, CoachReason, EventKind, Hello, Mode, ServerMessage, Snapshot, TruthTube } from './protocol';
import { Floor } from './floor';
import { splitSentences } from './voice/sentences';
import { noTts, type TtsEngine } from './voice/tts';

const MAX_HISTORY_TURNS = 10;
const MAX_TEXT = 600;
const MIN_NUDGE_GAP_MS = 20_000;

export interface SessionDeps {
  registry: ProviderRegistry;
  /** Reads this session's hidden answers from the lesson service. Resolves null when unavailable. */
  loadAssignment: () => Promise<Assignment | null>;
  send: (msg: ServerMessage) => void;
  /**
   * Reads the lab's public context (what is on screen, never answers) from the lesson service. Called at most once
   * per session, when the student asks their first question; resolves null when unavailable.
   */
  loadContext?: (lessonId: string) => Promise<string | null>;
  /** Speaks replies when the session has voice on. */
  tts?: TtsEngine;
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
  private counter = 0;
  /** The reply in progress, from "thinking" until its last sentence has been sent. At most one at a time. */
  private current: { id: string; reason: CoachReason; ctrl: AbortController } | null = null;
  private readonly floor: Floor;
  private voice = false;
  /** The lab's public context, once loaded. It joins the system prompt and stays there for the rest of the session. */
  private context: string | null = null;
  private contextLoad: Promise<void> | null = null;
  private readonly tts: TtsEngine;
  private readonly now: () => number;
  private readonly log: (line: string) => void;

  constructor(private readonly deps: SessionDeps) {
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? (() => {});
    this.tts = deps.tts ?? noTts;
    this.floor = new Floor(this.now);
  }

  get voiceOn(): boolean {
    return this.voice;
  }

  private get voiceAvailable(): boolean {
    return this.tts.available();
  }

  get currentMode(): Mode {
    return this.mode;
  }

  announce() {
    const p = this.deps.registry.active;
    this.deps.send({ type: 'ready', mode: this.mode, provider: p.name, model: p.model, configured: p.isConfigured(), voiceAvailable: this.voiceAvailable, voice: this.voice });
  }

  async handle(msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case 'hello':
        this.hello = { lessonId: msg.lessonId, title: msg.title, labType: msg.labType, summary: msg.summary };
        void this.refreshAssignment();
        if (msg.voice) this.setVoice(true);
        return;
      case 'voice':
        return this.setVoice(msg.on === true);
      case 'mode':
        this.mode = msg.mode;
        this.deps.send({ type: 'mode', mode: this.mode });
        return;
      case 'ask':
        await this.ensureContext();
        return this.respond('reply', `The student says: “${String(msg.text).slice(0, MAX_TEXT)}”`, 'ask', msg.snapshot, String(msg.text).slice(0, MAX_TEXT));
      case 'event':
        return this.nudge(msg.kind, msg.detail, msg.snapshot);
      case 'floor': {
        const change = { narrating: typeof msg.narrating === 'boolean' ? msg.narrating : undefined, talking: typeof msg.talking === 'boolean' ? msg.talking : undefined };
        if (this.floor.update(change)) this.cancel('talking');
        // Narration outranks a nudge: the nudge stops. A reply to a question carries on; the browser queues it.
        else if (change.narrating === true && this.current?.reason === 'nudge') this.cancel('narration');
        return;
      }
      case 'cancel':
        return this.cancel('cancelled', typeof msg.id === 'string' ? msg.id : undefined);
      case 'reveal':
        return this.wrapUp(msg.snapshot);
    }
  }

  private assignment: Assignment | null = null;

  private setVoice(on: boolean) {
    // Turning voice off stops the audio of the reply in progress (its text is already out), not the reply itself.
    this.voice = on && this.voiceAvailable;
    this.deps.send({ type: 'voice', on: this.voice, available: this.voiceAvailable });
  }

  /** Loads the lab's public context the first time the student asks something. Later questions reuse it. */
  private ensureContext(): Promise<void> {
    if (!this.contextLoad && this.hello && this.deps.loadContext) {
      const lessonId = this.hello.lessonId;
      this.contextLoad = this.deps
        .loadContext(lessonId)
        .then((c) => {
          this.context = c?.trim() || null;
          this.log(this.context ? `lab context loaded (${this.context.length} chars)` : 'no lab context for this lab');
        })
        .catch((err) => this.log(`lab context unavailable: ${(err as Error).message.slice(0, 120)}`));
    }
    return this.contextLoad ?? Promise.resolve();
  }

  /** Stops the reply in progress (or only reply `id`) and tells the browser to drop it. */
  private cancel(reason: 'superseded' | 'talking' | 'narration' | 'cancelled', id?: string) {
    const c = this.current;
    if (!c || (id && id !== c.id)) return;
    c.ctrl.abort();
    this.current = null;
    this.log(`reply ${c.id} cancelled (${reason})`);
    this.deps.send({ type: 'coach_cancelled', id: c.id, reason });
  }

  /** Sends the reply as audio, one sentence at a time, after its text. Stops when the reply is cancelled or voice goes off. */
  private async speak(id: string, text: string, signal: AbortSignal) {
    const sentences = splitSentences(text);
    for (const [seq, sentence] of sentences.entries()) {
      if (signal.aborted || !this.voice) return;
      const last = seq === sentences.length - 1;
      try {
        const audio = await this.tts.synthesize(sentence, signal);
        if (signal.aborted || !this.voice) return;
        this.deps.send({ type: 'coach_audio', id, seq, last, format: 'mp3', data: Buffer.from(audio).toString('base64'), text: sentence });
      } catch (err) {
        if (signal.aborted) return;
        this.log(`speech failed: ${(err as Error).message.slice(0, 120)}`);
        this.deps.send({ type: 'coach_audio', id, seq, last: true, format: 'mp3', data: '', text: sentence, error: true });
        return;
      }
    }
  }

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
    if (t - this.lastNudgeAt < MIN_NUDGE_GAP_MS) return;
    // A nudge never waits for its turn: if someone has the floor, it is dropped.
    const held = this.floor.canNudge(this.current !== null);
    if (held) {
      this.log(`nudge (${kind}) dropped: ${held}`);
      return;
    }
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
    // One reply at a time. A new question replaces the reply in progress; the wrap-up replaces anything.
    if (this.current) {
      if (reason === 'nudge') return;
      this.cancel('superseded');
    }
    const id = `c${++this.counter}`;
    const ctrl = new AbortController();
    const mine = { id, reason, ctrl };
    this.current = mine;
    this.deps.send({ type: 'thinking', id });

    const provider = this.deps.registry.active;
    const hello: Hello = this.hello ?? { lessonId: 'unknown', title: 'a science lab', labType: 'unknown' };
    if (this.truth === null && this.assignment === null) await this.refreshAssignment();
    if (ctrl.signal.aborted) return; // cancelled before the model was asked
    const state = describeSnapshot(snapshot);
    const turns: ChatTurn[] = [...this.history, { role: 'user', text: state ? `${userTurn}\n\n${state}` : userTurn }];

    let text: string;
    let degraded = false;
    let blocked = false;
    try {
      text = await provider.complete({ system: buildSystemPrompt(hello, this.truth, this.context), turns, maxTokens, signal: ctrl.signal });
      const revealed = this.truth !== null;
      const verdicts = snapshot?.claims?.map((c) => ({ tube: c.n, verdict: c.verdict })) ?? (snapshot?.tubes ?? []).filter((t) => t.conclusion).map((t) => ({ tube: t.n, verdict: t.conclusion as string }));
      const phs = (snapshot?.tubes ?? []).map((t) => t.recordedPh).filter((n): n is number => n !== null);
      const secrets = revealed ? [] : (this.assignment?.tubes ?? []).filter((t) => t.open !== false).map((t) => ({ tube: t.tube, terms: t.terms ?? [t.name, t.formula], verdict: t.type, ph: t.ph }));
      const guarded = applyGuardrails(text, { allowNumbers: true, secrets, enforceTubeClaims: !revealed, allowedVerdicts: verdicts, allowedPh: phs });
      if (guarded.wasBlocked) this.log(`guard blocked a reply (${guarded.reasons.join(',')})`);
      text = guarded.safeResponse;
      blocked = guarded.wasBlocked;
    } catch (err) {
      if (ctrl.signal.aborted) return;
      degraded = true;
      const kindName = err instanceof ProviderError ? err.kind : 'error';
      this.log(`provider ${provider.name} unavailable (${kindName}): ${(err as Error).message.slice(0, 160)}`);
      text = fallbackReply(kind, hello.labType);
    }
    if (ctrl.signal.aborted) return; // cancelled while thinking: nothing is sent, and it is not remembered

    this.history.push({ role: 'user', text: historyText }, { role: 'assistant', text });
    if (this.history.length > MAX_HISTORY_TURNS * 2) this.history.splice(0, this.history.length - MAX_HISTORY_TURNS * 2);
    const voice = this.voice && this.voiceAvailable;
    this.deps.send({ type: 'coach', id, text, reason, provider: provider.name, blocked, degraded, voice });
    if (voice) await this.speak(id, text, ctrl.signal);
    if (this.current === mine) this.current = null;
  }
}
