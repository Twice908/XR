import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { iwsdkDev } from "@iwsdk/vite-plugin-dev";
import { defineConfig } from "vite";

const here = dirname(fileURLToPath(import.meta.url));

// Built into the XR client's public folder and served from /cell-explorer/ beside it.
export default defineConfig({
  base: "/cell-explorer/",
  assetsInclude: ["**/*.mp3"],
  resolve: {
    // One three.js (super-three) and one UIKit graph, or UIKit instanceof checks fail.
    dedupe: ["three", "@pmndrs/uikit", "@pmndrs/uikit-horizon"],
  },
  server: { port: 5180, strictPort: true },
  build: {
    outDir: resolve(here, "../../mmaxr-webxr-client/public/cell-explorer"),
    emptyOutDir: true,
  },
  plugins: [iwsdkDev()],
});
