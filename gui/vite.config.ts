import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

/**
 * Release date of the version being built, for Settings → About.
 *
 * Definition: the commit date (YYYY-MM-DD) of tag `v<version>`, where
 * <version> is read from core/tauri.conf.json — the same source
 * `getVersion()` reports at runtime. Release CI builds from the pushed
 * tag, so the tag always resolves there. A dev build after the version
 * bump but before tagging resolves to null and About omits the date —
 * intentionally: no tag, no release, no date. Deliberately not a build
 * timestamp: the date describes the version, not the compile.
 */
function resolveReleaseDate(): string | null {
  try {
    const conf = JSON.parse(
      readFileSync(path.resolve(__dirname, "../core/tauri.conf.json"), "utf8"),
    ) as { version?: string };
    if (!conf.version) return null;
    const date = execFileSync(
      "git",
      ["log", "-1", "--format=%cs", `refs/tags/v${conf.version}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  } catch {
    return null;
  }
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  define: {
    __GALLEY_RELEASE_DATE__: JSON.stringify(resolveReleaseDate()),
  },

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // Manual chunking of large vendor deps so the main bundle stays
  // small and each vendor slice caches independently across app
  // updates (a markdown-render fix shouldn't force users to re-fetch
  // Shiki's grammars, and vice versa). Grouped by ecosystem, not by
  // individual package, to keep the chunk count bounded.
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          // Markdown pipeline (react-markdown + remark + Shiki +
          // oniguruma WASM). Heavy and only grows with content; keep
          // it isolated from app code churn.
          if (
            /[\\/]node_modules[\\/](react-markdown|remark|rehype|unified|micromark|shiki|vscode-oniguruma)[\\/]/.test(
              id,
            )
          ) {
            return "markdown";
          }
          // Radix primitives — the dialog / context-menu / dropdown
          // surface, second-largest vendor cluster after react itself.
          if (id.includes("@radix-ui")) {
            return "radix";
          }
          // Phosphor icon set — tree-shaken per-icon at the JS level
          // but the shared runtime is a clean seam.
          if (id.includes("@phosphor-icons")) {
            return "icons";
          }
          return undefined;
        },
      },
    },
  },
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching the Rust side (now at ../core)
      ignored: ["**/core/**"],
    },
  },
}));
