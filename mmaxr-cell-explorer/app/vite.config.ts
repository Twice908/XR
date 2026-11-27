import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { iwsdkDev } from "@iwsdk/vite-plugin-dev";
import { defineConfig, loadEnv, searchForWorkspaceRoot, type Plugin } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(here, "..");
const require = createRequire(import.meta.url);
const piperDist = dirname(require.resolve("piper-tts-web"));
/** XR's shared assets: lab narration scripts in narration/, their generated audio in audio/<lessonId>/. */
const xrAssets = resolve(workspaceRoot, "../mmaxr-assets");

/**
 * `pnpm narration` (MMA_NARRATION=1) serves the app over plain HTTP for MMAXR's narration generator page
 * (?narration-generator): the IWSDK dev plugin, which turns on HTTPS with a local certificate, is left out,
 * and the IWSDK project module only the lab needs is stubbed.
 */
const narrationOnly = process.env.MMA_NARRATION === "1";

// Built into the XR client's public folder and served from /cell-explorer/ beside it.
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, workspaceRoot, "");
  const piperVoiceId = env.PIPER_VOICE_ID || "en_GB-jenny_dioco-medium";
  const piperBasePath = env.PIPER_BASE_PATH || "";
  return {
    base: command === "serve" ? "/" : "/cell-explorer/",
    define: {
      __PIPER_VOICE_ID__: JSON.stringify(piperVoiceId),
      __PIPER_BASE_PATH__: JSON.stringify(piperBasePath),
    },
    assetsInclude: ["**/*.wav.gz", "**/*.mp3"],
    resolve: {
      // One three.js (super-three) and one UIKit graph, or UIKit instanceof checks fail.
      dedupe: ["three", "@pmndrs/uikit", "@pmndrs/uikit-horizon"],
    },
    server: {
      port: 5180,
      strictPort: true,
      // The generator also reads the XR labs' narration scripts, which live outside this workspace.
      fs: { allow: [searchForWorkspaceRoot(here), resolve(xrAssets, "narration")] },
    },
    optimizeDeps: {
      include: ["piper-tts-web", "wasm-media-encoders"],
      exclude: ["@babylonjs/havok"],
    },
    build: {
      outDir: resolve(here, "../../mmaxr-webxr-client/public/cell-explorer"),
      emptyOutDir: true,
    },
    plugins: [
      ...(narrationOnly ? [stubIwsdkProject()] : [iwsdkDev()]),
      ...(command === "serve" ? [piperDevAssets(), labNarrationSave()] : []),
    ],
  };
});

function stubIwsdkProject(): Plugin {
  return {
    name: "mmaxr-stub-iwsdk-project",
    resolveId: (id) => (id === "virtual:iwsdk-project" ? "\0virtual:iwsdk-project" : null),
    load: (id) => (id === "\0virtual:iwsdk-project" ? "export default {};" : null),
  };
}

// From MMAXR's apps/web/vite.config.ts, as is: serves Piper's runtime files and the local voice model.
function piperDevAssets(): Plugin {
  return {
    name: "mma-piper-dev-assets",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        const route = pathname.startsWith("/piper/")
          ? { root: resolve(piperDist, "piper"), path: pathname.slice("/piper/".length) }
          : pathname.startsWith("/onnx/")
            ? { root: resolve(piperDist, "onnx"), path: pathname.slice("/onnx/".length) }
            : pathname.startsWith("/piper-models/")
              ? { root: resolve(workspaceRoot, "audio"), path: pathname.slice("/piper-models/".length) }
              : undefined;
        if (!route || !route.path || basename(route.path) !== route.path) {
          next();
          return;
        }
        try {
          const contents = await readFile(resolve(route.root, route.path));
          response.statusCode = 200;
          response.setHeader("Content-Length", contents.byteLength);
          response.setHeader("Content-Type", mimeType(route.path));
          response.end(contents);
        } catch {
          next();
        }
      });
    },
  };
}

/**
 * Dev only: the narration generator POSTs each generated file for an XR lab here, and it is written to
 * mmaxr-assets/audio/<lessonId>/<cue>.mp3|vtt, where the lesson loader serves it. Only labs with a narration
 * script (mmaxr-assets/narration/<lessonId>.json) and plain cue file names are accepted.
 */
function labNarrationSave(): Plugin {
  return {
    name: "mmaxr-lab-narration-save",
    configureServer(server) {
      server.middlewares.use("/__narration/save", (request, response) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        const lesson = url.searchParams.get("lesson") ?? "";
        const file = url.searchParams.get("file") ?? "";
        const fail = (status: number, message: string) => {
          response.statusCode = status;
          response.end(message);
        };
        if (request.method !== "POST") return fail(405, "POST only");
        if (!/^[a-z0-9-]+$/.test(lesson) || !/^[a-z0-9-]+\.(mp3|vtt)$/.test(file)) return fail(400, "Bad lesson or file name");
        if (!existsSync(resolve(xrAssets, "narration", `${lesson}.json`))) return fail(404, "No narration script for that lesson");
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          const dir = resolve(xrAssets, "audio", lesson);
          void mkdir(dir, { recursive: true })
            .then(() => writeFile(resolve(dir, file), Buffer.concat(chunks)))
            .then(() => {
              response.statusCode = 204;
              response.end();
            })
            .catch((error: unknown) => fail(500, error instanceof Error ? error.message : "Write failed"));
        });
      });
    },
  };
}

function mimeType(path: string): string {
  if (path.endsWith(".wasm")) return "application/wasm";
  if (path.endsWith(".data") || path.endsWith(".onnx")) return "application/octet-stream";
  return "application/json; charset=utf-8";
}
