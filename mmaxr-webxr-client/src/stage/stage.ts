import {
  createCosmos,
  createSoundscape,
  createSwitchPreference,
  createVeil,
  guessQuality,
  type Cosmos,
  type Soundscape,
  type Veil,
} from "../ambience/index.js";
import { LOGIN_MOOD, LOGIN_PALETTE } from "./theme.js";

/**
 * The persistent stage behind every page: the cosmos, the soundscape and the veil. It outlives
 * page changes, so the sky, the music and the colour carry on while pages swap in front of them.
 */
export interface Stage {
  readonly cosmos: Cosmos;
  readonly sound: Soundscape;
  readonly veil: Veil;
  readonly reducedMotion: boolean;
  /** A duration, shortened when the student prefers reduced motion. */
  time(ms: number): number;
  /**
   * Silence the shell's music while a lab runs (labs have their own sound), and bring it back
   * afterwards. The bed fades first, then the audio pauses completely.
   */
  setQuiet(on: boolean): void;
  /** Show the cosmos (sign-in pages, experiments) or hand the screen to a lesson. */
  setCosmic(on: boolean): void;
  /** Lift the cosmos above the page for a descent, so a lesson can mount unseen underneath. */
  beginJourney(): void;
  /** Fade the descent away, then hand the screen to the lesson. */
  endJourney(fadeMs: number): Promise<void>;
  dispose(): void;
}

const SOUND_KEY = "mmaxr.sound";

/** Build the stage and attach it to the page. */
export function createStage(doc: Document): Stage {
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const hints = navigator as Navigator & { deviceMemory?: number };
  const quality = guessQuality({ cores: hints.hardwareConcurrency, memoryGb: hints.deviceMemory });

  const layer = doc.createElement("div");
  layer.className = "cosmos-layer";
  layer.setAttribute("aria-hidden", "true");
  // Hidden until a cosmic page (sign-in pages, experiments) asks for it, so it never covers a lesson.
  layer.hidden = true;
  doc.body.prepend(layer);
  const cosmos = createCosmos({ palette: LOGIN_PALETTE, quality, reducedMotion });
  layer.append(cosmos.element);
  if (!cosmos.supported) doc.body.classList.add("no-webgl");

  const preference = createSwitchPreference(readStorage(), SOUND_KEY, true);
  const sound = createSoundscape({
    enabled: preference.get(),
    mood: LOGIN_MOOD,
    onEnabledChange: (on) => preference.set(on),
  });
  const removeUnlock = sound.listenForUnlock(doc);
  let quiet = false;
  let quietTimer = 0;
  const applySuspended = (): void => sound.setSuspended(doc.hidden || quiet);
  const onVisibility = applySuspended;
  doc.addEventListener("visibilitychange", onVisibility);

  const veil = createVeil(doc.body, "#000000");

  const setCosmic = (on: boolean): void => {
    doc.body.classList.toggle("is-cosmic", on);
    layer.hidden = !on;
    cosmos.setRunning(on);
  };

  return {
    cosmos,
    sound,
    veil,
    reducedMotion,
    time: (ms) => (reducedMotion ? Math.min(ms, 220) : ms),
    setCosmic,
    setQuiet(on) {
      window.clearTimeout(quietTimer);
      quiet = on;
      if (on) {
        sound.setBedLevel(0, 1);
        quietTimer = window.setTimeout(applySuspended, 1200);
      } else applySuspended();
    },
    beginJourney() {
      setCosmic(true);
      doc.body.classList.add("is-journey");
    },
    async endJourney(fadeMs) {
      if (fadeMs > 0 && typeof layer.animate === "function") {
        const fade = layer.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: fadeMs,
          easing: "cubic-bezier(0.4, 0, 0.2, 1)",
          fill: "forwards",
        });
        await fade.finished.catch(() => undefined);
        doc.body.classList.remove("is-journey");
        setCosmic(false);
        fade.cancel();
        return;
      }
      doc.body.classList.remove("is-journey");
      setCosmic(false);
    },
    dispose() {
      window.clearTimeout(quietTimer);
      removeUnlock();
      doc.removeEventListener("visibilitychange", onVisibility);
      cosmos.dispose();
      sound.dispose();
      veil.dispose();
      layer.remove();
    },
  };
}

/** `localStorage`, or null where the browser blocks it. */
function readStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
