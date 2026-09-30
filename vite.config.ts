import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { crx } from "@crxjs/vite-plugin";
import { fileURLToPath } from "node:url";
import manifest from "./manifest.json";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** Source files CRXJS builds as standalone IIFE bundles (`*.iife.ts?script`). */
const IIFE_SOURCE_RE = /\.iife\.(ts|tsx|js|jsx|mjs|cjs)$/;

/**
 * CRXJS builds every `*.iife.ts?script` import into a self-contained IIFE
 * (`src/content/*.iife.js`, the file the service worker passes to
 * `chrome.scripting.executeScript({ files })`), but it also leaves the
 * intermediate ESM entry chunk it emitted for the same module in the bundle
 * (`assets/*.iife.ts-<hash>.js`). Nothing references that chunk, yet it is a
 * full second copy of axe-core plus the rule set. Drop it from the output.
 * Chunks that some other chunk still imports are left alone.
 */
function dropUnreferencedIifeModuleChunks(): Plugin {
  return {
    name: "a11y:drop-iife-module-chunks",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type !== "chunk" || !output.isEntry) continue;
        if (!output.facadeModuleId || !IIFE_SOURCE_RE.test(output.facadeModuleId)) continue;
        const referenced = Object.values(bundle).some(
          (other) =>
            other.type === "chunk" &&
            other !== output &&
            (other.imports.includes(fileName) || other.dynamicImports.includes(fileName)),
        );
        if (!referenced) delete bundle[fileName];
      }
    },
  };
}

/**
 * Nothing on a web page needs to load extension files: the content scripts are
 * injected with `chrome.scripting.executeScript({ files })`, which does not
 * require `web_accessible_resources`, and the React pages run on the
 * extension origin. Exposing `assets/*` to `<all_urls>` only makes the
 * extension fingerprintable, so the hand-written entry is dropped here (CRXJS
 * still adds its own narrow entry for the dynamically injected IIFE files).
 */
const NOT_WEB_ACCESSIBLE = new Set(["assets/*", "src/content/*.iife.js"]);

const buildManifest = {
  ...manifest,
  web_accessible_resources: manifest.web_accessible_resources
    .map((entry) => ({
      ...entry,
      resources: entry.resources.filter((res) => !NOT_WEB_ACCESSIBLE.has(res)),
    }))
    .filter((entry) => entry.resources.length > 0),
};

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    crx({ manifest: buildManifest }),
    dropUnreferencedIifeModuleChunks(),
  ],
  resolve: {
    alias: {
      "@shared": r("./shared"),
      "@src": r("./src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        sidepanel: r("./src/sidepanel/index.html"),
        options: r("./src/options/index.html"),
        offscreen: r("./src/offscreen/index.html"),
        devtools: r("./src/devtools/index.html"),
        devtoolsPanel: r("./src/devtools/panel.html"),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
});
