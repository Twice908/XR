import { createStage, type Stage } from "./stage.js";

let shared: Stage | null = null;

/** The one stage (cosmos, soundscape and veil) behind every page, created on first use. */
export function getStage(): Stage {
  shared ??= createStage(document);
  return shared;
}

export type { Stage };
