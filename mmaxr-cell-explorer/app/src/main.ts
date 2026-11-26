import { manifest, mountCellExplorer } from "@mma/bio-cell-explorer";
import { createSoundscape, createSwitchPreference, type Soundscape } from "@mma/engine-ambience";
import projectOptions from "virtual:iwsdk-project";

/*
 * Host for MMAXR's Plant vs Animal Cell inside XR. The lab runs exactly as in MMAXR; this file only gives it a
 * soundscape and tells the XR page (our parent frame) what happens, so XR's server can record the run.
 */

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("App root element is missing");

/** Messages to the XR lab page. Same origin only: the bundle is served beside the client. */
const tell = (message: Record<string, unknown>): void => {
  if (window.parent !== window) window.parent.postMessage({ source: "mmaxr-cell", ...message }, window.location.origin);
};

function readStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// The same sound switch as the rest of XR ("mmaxr.sound").
const preference = createSwitchPreference(readStorage(), "mmaxr.sound", true);
const soundscape = createSoundscape({
  enabled: preference.get(),
  mood: { rootMidi: 40, intervals: [0, 7, 14, 16, 21], brightness: 0.34 },
  onEnabledChange: (on) => preference.set(on),
});
soundscape.listenForUnlock(document);
document.addEventListener("visibilitychange", () => soundscape.setSuspended(document.hidden));
soundscape.setBedLevel(0, 0);

/**
 * In XR a lab has no constant background music: the pad the lab raises stays silent, while its cues, chords and
 * narration play as in MMAXR.
 */
const sound = new Proxy(soundscape, {
  get(target, key) {
    if (key === "setBedLevel") return () => target.setBedLevel(0, 0.3);
    const value = Reflect.get(target, key, target) as unknown;
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
  },
}) as Soundscape;

const chapterOf = (missionId: string): string | null => {
  const goal = manifest.missions.find((mission) => mission.id === missionId)?.goal as { chapter?: unknown } | undefined;
  return typeof goal?.chapter === "string" ? goal.chapter : null;
};

mountCellExplorer(root, {
  worldOptions: projectOptions,
  sound,
  onExit: () => tell({ type: "exit" }),
  onLearningEvent: (event) => {
    const payload = event.payload as Record<string, unknown>;
    if (event.type === "mission_completed") tell({ type: "mission", missionId: payload.missionId, chapter: chapterOf(String(payload.missionId)) });
    else if (event.type === "hint_used") tell({ type: "hint", missionId: payload.missionId });
    else tell({ type: "answer", assessmentId: payload.assessmentId, optionIndex: payload.selectedOptionIndex });
  },
});
tell({ type: "ready" });
