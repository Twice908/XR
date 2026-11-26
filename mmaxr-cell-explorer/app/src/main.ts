/*
 * Entry for the cell explorer bundle. In development, `?narration-generator` opens MMAXR's narration generator
 * (copied from MMAXR's apps/web as is): it turns every module's narration scripts into MP3 and captions with
 * Piper, voice en_GB-jenny_dioco-medium. Anything else runs the Plant vs Animal Cell lab.
 */
const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("App root element is missing");

if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("narration-generator")) {
  // Developer tool for generating narration audio. It sits outside the lab.
  root.innerHTML = '<div class="shell-loading" role="status">Loading narration generator...</div>';
  void import("./narration-generator.js")
    .then(({ mountNarrationGenerator }) => mountNarrationGenerator(root))
    .catch((error: unknown) => {
      root.textContent = error instanceof Error ? error.message : "The narration generator could not load.";
    });
} else {
  void import("./cell-lab.js");
}
