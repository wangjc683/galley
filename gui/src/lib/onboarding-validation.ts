/**
 * Onboarding validation primitives — Stage 3 Task 5.
 *
 * Replaces the mock validation that shipped with the Onboarding flow
 * (#5). Uses Tauri's fs plugin to do real `exists()` checks against
 * the user-picked path and the GA repo's expected layout.
 *
 * Filesystem layer + a Python / GA runtime probe. The runtime probe
 * catches `mykey.py` import failures, missing GA deps, and model-list
 * failures before the user reaches the main Composer.
 */

import type { PathValidation } from "@/components/screens/onboarding/StepAttach";
import { resolvePythonPath } from "@/lib/bridge";
import {
  probeGARuntime,
  probePython,
  type ProbeResult,
  type RuntimeProbeResult,
} from "@/lib/python-probe";
import type { HealthCheckItem } from "@/types/inspector";

interface HealthCheckLabels {
  gaPathExists: string;
  agentmainVisible: string;
  mykeyExists: string;
  memoryVisible: string;
  assetsVisible: string;
  pythonInterpreter: string;
  bundledPython: string;
  loadablePython: string;
  llmConnection: string;
  llmConnectionDetail: string;
  entryModule: string;
  llmConfigFile: string;
  memoryStore: string;
  resourcesDir: string;
  bundledPythonDetail: (version: string) => string;
  runtimeReadyDetail: (count: number) => string;
  llmConnectionPassed: string;
  llmConnectionSkipped: string;
  noLoadablePython: string;
}

const DEFAULT_HEALTH_CHECK_LABELS: HealthCheckLabels = {
  gaPathExists: "GA 路径存在",
  agentmainVisible: "agentmain.py 可见",
  mykeyExists: "mykey.py 存在",
  memoryVisible: "memory/ 目录可见",
  assetsVisible: "assets/ 目录可见",
  pythonInterpreter: "Python 解释器",
  bundledPython: "Galley 内置 Python",
  loadablePython: "查找能加载 GA 的 Python",
  llmConnection: "LLM 连接测试",
  llmConnectionDetail: "真实测试，最多 1 个输出 token",
  entryModule: "GA 入口模块",
  llmConfigFile: "LLM 配置文件",
  memoryStore: "L1-L4 记忆存储",
  resourcesDir: "GA 资源目录",
  bundledPythonDetail: (version: string) =>
    `CPython ${version} · 已附带 GA 依赖`,
  runtimeReadyDetail: (count: number) => `已加载 ${count} 个模型配置`,
  llmConnectionPassed: "测试消息已返回",
  llmConnectionSkipped: "运行环境未通过，未发送测试消息",
  noLoadablePython:
    "在常见路径未找到能加载 GA 的 Python · 请先在 GA 目录把依赖装到一个 .venv 里",
};

// Trimmed paths only — leading/trailing whitespace from the input is
// stripped before validation. Tauri's `exists()` is async; calls are
// debounced upstream so we don't query on every keystroke.

/**
 * Validate the user's chosen GA path for the Attach step.
 *
 * Three terminal outcomes:
 *   - `not-found`        path doesn't exist on disk
 *   - `missing-agentmain` path exists but agentmain.py is missing —
 *                         user picked a different directory
 *   - `ok`               path exists and contains agentmain.py
 *
 * Returns `null` for empty input (no feedback to show).
 */
export async function validateGAPath(rawPath: string): Promise<PathValidation> {
  const path = rawPath.trim();
  if (!path) return null;
  // Expand `~` and normalize separators / mixed slashes via Tauri's
  // path API. Critical on Windows — see `resolvePath` comment for the
  // user-reported bug this fixes.
  const resolved = await resolvePath(path);
  let pathOk: boolean;
  try {
    pathOk = await fsExists(resolved);
  } catch (e) {
    console.warn("[onboarding] fs.exists(path) failed:", e);
    return { kind: "not-found", rawPath: path };
  }
  if (!pathOk) return { kind: "not-found", rawPath: path };

  let agentmainOk = false;
  try {
    agentmainOk = await fsExists(await joinPath(resolved, "agentmain.py"));
  } catch (e) {
    console.warn("[onboarding] fs.exists(agentmain.py) failed:", e);
  }
  if (!agentmainOk) return { kind: "missing-agentmain", rawPath: path };
  return { kind: "ok", foundAgentmain: true, rawPath: path };
}

/**
 * Version of the bundled CPython, mirrored from
 * scripts/bundle-python.sh's `PBS_PYTHON_VERSION`. Surfaced in the
 * Health Check row + Settings → Runtime panel as the user-facing
 * version label. Update together when the bundle script's pin moves.
 */
export const BUNDLED_PYTHON_VERSION = "3.11.15";

/**
 * Run the health check against the chosen path. Each check fires
 * sequentially with a brief delay so the user sees the progression —
 * same visual rhythm as the original mock, but the final runtime rows
 * now execute a subprocess probe that mirrors bridge startup closely:
 * import GA, instantiate GenericAgent, collect `list_llms()`, then
 * optionally send a one-token smoke request.
 *
 * Caller passes:
 *   - `path`: the validated GA path
 *   - `onUpdate(items)`: called every time the check list changes
 *     (running / success / warning state transitions)
 *   - `signal`: AbortSignal so the host can cancel if the user
 *     navigates away from the Health step mid-run
 *   - `options.useExternalPython`: when true, run the probe. Default
 *     false — use the same bundled-vs-dev Python resolution as bridge spawn.
 *   - `options.python`: persisted Python alias / absolute path, used
 *     when external Python mode is enabled.
 *   - `options.smokeTest`: when true, send a tiny model request after
 *     local runtime validation succeeds.
 *   - `options.onPythonProbed`: only fired when `useExternalPython`
 *     is true. Receives the winning alias (Tauri shell-capability
 *     name like "python-framework-3-14") or null when every
 *     candidate failed. Onboarding uses this to seed gaConfig.python
 *     so the subsequent bridge spawn uses the right interpreter.
 *
 * Resolves when the run completes (or aborts). The final `items`
 * snapshot is also passed to onUpdate; callers don't need to track
 * the return value separately.
 */
export async function runHealthChecks(
  path: string,
  onUpdate: (items: HealthCheckItem[]) => void,
  signal: AbortSignal,
  options?: {
    useExternalPython?: boolean;
    python?: string;
    smokeTest?: boolean;
    onPythonProbed?: (alias: string | null, result: ProbeResult) => void;
    labels?: HealthCheckLabels;
  },
): Promise<HealthCheckItem[]> {
  const resolved = await resolvePath(path.trim());
  const labels = options?.labels ?? DEFAULT_HEALTH_CHECK_LABELS;
  const probes: HealthProbe[] = [
    {
      name: labels.gaPathExists,
      detail: path,
      check: () => fsExists(resolved),
    },
    {
      name: labels.agentmainVisible,
      detail: labels.entryModule,
      check: async () => fsExists(await joinPath(resolved, "agentmain.py")),
    },
    {
      name: labels.mykeyExists,
      detail: labels.llmConfigFile,
      check: async () => fsExists(await joinPath(resolved, "mykey.py")),
      // mykey.py is user-supplied + .gitignored. Keep the file-presence
      // row as a warning so the later runtime probe can provide the
      // authoritative import/model-loading error.
      warnOnMissing: true,
    },
    {
      name: labels.memoryVisible,
      detail: labels.memoryStore,
      check: async () => fsExists(await joinPath(resolved, "memory")),
      warnOnMissing: true,
    },
    {
      name: labels.assetsVisible,
      detail: labels.resourcesDir,
      check: async () => fsExists(await joinPath(resolved, "assets")),
      warnOnMissing: true,
    },
  ];

  const useExternalPython = options?.useExternalPython ?? false;
  // Two row identities. External mode says "Python interpreter"
  // because Galley may switch to a discovered venv; bundled mode names
  // the packaged interpreter directly.
  const pythonRow: HealthCheckItem = useExternalPython
    ? {
        name: labels.pythonInterpreter,
        detail: labels.loadablePython,
        state: "pending",
      }
    : {
        name: labels.bundledPython,
        detail: labels.bundledPythonDetail(BUNDLED_PYTHON_VERSION),
        state: "pending",
      };
  const llmRow: HealthCheckItem = {
    name: labels.llmConnection,
    detail: labels.llmConnectionDetail,
    state: "pending",
  };
  let items: HealthCheckItem[] = [
    ...probes.map<HealthCheckItem>((p) => ({
      name: p.name,
      detail: p.detail,
      state: "pending",
    })),
    pythonRow,
    llmRow,
  ];
  onUpdate(items);

  for (let i = 0; i < probes.length; i++) {
    if (signal.aborted) return items;
    // Flip current row to running so the user sees the spinner walk
    // down the list.
    items = items.map((c, idx) => (idx === i ? { ...c, state: "running" } : c));
    onUpdate(items);

    // Brief paced delay so the animation reads as deliberate work
    // rather than a flash. Real fs.exists() is <1ms.
    await sleep(220);
    if (signal.aborted) return items;

    let ok: boolean;
    try {
      ok = await probes[i].check();
    } catch (e) {
      console.warn(`[onboarding] health probe ${probes[i].name} failed:`, e);
      ok = false;
    }
    const finalState: HealthCheckItem["state"] = ok
      ? "success"
      : probes[i].warnOnMissing
        ? "warning"
        : "failed";
    items = items.map((c, idx) =>
      idx === i ? { ...c, state: finalState } : c,
    );
    onUpdate(items);
  }

  // Runtime rows. Both bundled and external modes run a real subprocess
  // probe now; this catches `mykey.py` import failures before the user
  // reaches the main Composer.
  if (signal.aborted) return items;
  const pythonIdx = items.length - 2;
  const llmIdx = items.length - 1;
  items = items.map((c, idx) =>
    idx === pythonIdx ? { ...c, state: "running" } : c,
  );
  onUpdate(items);

  const smokeTest = options?.smokeTest ?? false;
  const runtimeProbe = useExternalPython
    ? await runExternalRuntimeProbe(resolved, signal, labels, options)
    : await runBundledRuntimeProbe(resolved, labels, {
        python: options?.python,
        smokeTest,
      });
  if (signal.aborted) return items;

  items = applyRuntimeProbeResult(items, {
    pythonIdx,
    llmIdx,
    labels,
    smokeTest,
    result: runtimeProbe.result,
    pythonDetail: runtimeProbe.pythonDetail,
    runtimeFailureDetail: runtimeProbe.runtimeFailureDetail,
  });
  onUpdate(items);

  return items;
}

// ---------------- internals ----------------

interface HealthProbe {
  name: string;
  detail: string;
  check: () => Promise<boolean>;
  /** Treat false result as `warning` not `error`. For non-critical
   * files like mykey.py / memory/ that user may set up later. */
  warnOnMissing?: boolean;
}

interface RuntimeProbeOutcome {
  result: RuntimeProbeResult;
  pythonDetail: string;
  runtimeFailureDetail?: string;
}

async function runExternalRuntimeProbe(
  resolvedGaPath: string,
  signal: AbortSignal,
  labels: HealthCheckLabels,
  options:
    | {
        useExternalPython?: boolean;
        python?: string;
        smokeTest?: boolean;
        onPythonProbed?: (alias: string | null, result: ProbeResult) => void;
      }
    | undefined,
): Promise<RuntimeProbeOutcome> {
  const probeResult = await probePython(resolvedGaPath, signal, {
    smokeTest: options?.smokeTest ?? false,
  });
  options?.onPythonProbed?.(probeResult.winner?.alias ?? null, probeResult);
  const winningAttempt = probeResult.attempts.find(
    (attempt) => attempt.outcome === "ok",
  );
  const llmFailureAttempt = probeResult.attempts.find(
    (attempt) => attempt.outcome === "llm-failed",
  );
  const decisiveAttempt = winningAttempt ?? llmFailureAttempt;
  if (probeResult.winner && decisiveAttempt?.result) {
    return {
      result: decisiveAttempt.result,
      pythonDetail: `${probeResult.winner.label} · ${probeResult.winner.displayPath}`,
    };
  }
  const lastAttempt = probeResult.attempts[probeResult.attempts.length - 1];
  return {
    result: lastAttempt?.result ?? {
      ok: false,
      llms: [],
      smokeTested: false,
      errorStage: "runtime",
      error: labels.noLoadablePython,
    },
    pythonDetail: labels.loadablePython,
    runtimeFailureDetail: lastAttempt?.detail ?? labels.noLoadablePython,
  };
}

async function runBundledRuntimeProbe(
  resolvedGaPath: string,
  labels: HealthCheckLabels,
  options: { python?: string; smokeTest: boolean },
): Promise<RuntimeProbeOutcome> {
  // Unlike the external path (which catches per-candidate inside
  // runSingleProbe), this is a single invoke with no fallback — a
  // rejection here must become a failed row, or the health check
  // never settles and Continue stays disabled.
  try {
    const wantBundled = import.meta.env.PROD;
    const python = await resolvePythonPath(options.python, wantBundled);
    const result = await probeGARuntime(python, resolvedGaPath, {
      smokeTest: options.smokeTest,
    });
    return {
      result,
      pythonDetail: labels.bundledPythonDetail(BUNDLED_PYTHON_VERSION),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      result: {
        ok: false,
        llms: [],
        smokeTested: false,
        errorStage: "spawn",
        error: message,
      },
      pythonDetail: labels.bundledPythonDetail(BUNDLED_PYTHON_VERSION),
      runtimeFailureDetail: message,
    };
  }
}

function applyRuntimeProbeResult(
  items: HealthCheckItem[],
  args: {
    pythonIdx: number;
    llmIdx: number;
    labels: HealthCheckLabels;
    smokeTest: boolean;
    result: RuntimeProbeResult;
    pythonDetail: string;
    runtimeFailureDetail?: string;
  },
): HealthCheckItem[] {
  const llmCount = args.result.llms.length;
  if (args.result.ok) {
    return items.map((item, idx) => {
      if (idx === args.pythonIdx) {
        return {
          ...item,
          state: "success",
          detail:
            llmCount > 0
              ? `${args.pythonDetail} · ${args.labels.runtimeReadyDetail(llmCount)}`
              : args.pythonDetail,
        };
      }
      if (idx === args.llmIdx) {
        return {
          ...item,
          state: args.smokeTest ? "success" : "warning",
          detail: args.smokeTest
            ? args.labels.llmConnectionPassed
            : args.labels.llmConnectionSkipped,
        };
      }
      return item;
    });
  }

  const failedInLLM = args.result.errorStage === "llm";
  const detail = runtimeFailureMessage(args.result, args.runtimeFailureDetail);
  return items.map((item, idx) => {
    if (idx === args.pythonIdx) {
      return {
        ...item,
        state: failedInLLM ? "success" : "failed",
        detail: failedInLLM
          ? `${args.pythonDetail} · ${args.labels.runtimeReadyDetail(llmCount)}`
          : detail,
      };
    }
    if (idx === args.llmIdx) {
      return {
        ...item,
        state: "failed",
        detail: failedInLLM ? detail : args.labels.llmConnectionSkipped,
      };
    }
    return item;
  });
}

function runtimeFailureMessage(
  result: RuntimeProbeResult,
  fallback?: string,
): string {
  const error = result.error?.trim();
  if (error) return error;
  const stderr = result.stderr?.trim();
  if (stderr) return stderr.split("\n").slice(-3).join("\n");
  return fallback ?? "GA runtime probe failed";
}

async function fsExists(path: string): Promise<boolean> {
  // Routes through our custom `path_exists` Tauri command (Rust side,
  // core/src/lib.rs) instead of `@tauri-apps/plugin-fs`'s
  // `exists()`. The plugin-fs version is gated by `fs:scope` in
  // capabilities/default.json which defaults to a user-profile glob
  // allow-list — fine for Tauri's sandboxed-web threat model, but
  // wrong for Galley: a v0.1-alpha Windows user with GA at
  // `D:\projects_2026\GenericAgent` saw every health-check row fail
  // because `D:\` wasn't in the allow-list. See the command's doc
  // comment for the full rationale. Lazy import keeps a Vite-only
  // dev build loadable when the Tauri shim isn't present.
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("path_exists", { path });
}

/**
 * Expand `~` to the user's home directory **and** normalize the path
 * to the platform-native form via Tauri's path API.
 *
 * The normalize step was added 2026-05-15 after a Windows v0.1-alpha.1
 * user report: picking a valid GA folder via the OS dialog was still
 * flagged as "错误路径" by validateGAPath, but appending a trailing
 * `\` in the input box made it pass. Root cause was the old
 * `joinPath` doing string concat with a hardcoded `/`, producing
 * mixed-separator paths like `C:\Users\foo\GA/agentmain.py` that
 * Tauri's fs:scope check on Windows handles inconsistently — the
 * trailing `\` happened to nudge it into a code path that worked.
 * Routing both expansion and join through `@tauri-apps/api/path`
 * gives us platform-correct separators on all targets.
 */
async function resolvePath(path: string): Promise<string> {
  let p = path;
  if (p.startsWith("~")) {
    try {
      const { homeDir } = await import("@tauri-apps/api/path");
      const home = await homeDir();
      p = home + p.slice(1);
    } catch (e) {
      console.warn("[onboarding] homeDir lookup failed; using raw path.", e);
    }
  }
  try {
    const { normalize } = await import("@tauri-apps/api/path");
    p = await normalize(p);
  } catch (e) {
    console.warn("[onboarding] path normalize failed; using raw path.", e);
  }
  return p;
}

/**
 * Platform-native path join. Delegates to `@tauri-apps/api/path.join`
 * so Windows gets `\` and POSIX gets `/`. See `resolvePath` above for
 * the Windows-specific bug that motivated routing this through Tauri.
 */
async function joinPath(a: string, b: string): Promise<string> {
  try {
    const { join } = await import("@tauri-apps/api/path");
    return await join(a, b);
  } catch (e) {
    console.warn(
      "[onboarding] joinPath via Tauri API failed; falling back.",
      e,
    );
    // POSIX-only fallback; only hit if the Tauri path plugin isn't
    // loadable (Vite-only dev). Accept either trailing separator.
    if (a.endsWith("/") || a.endsWith("\\")) return a + b;
    return a + "/" + b;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
