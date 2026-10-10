import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { logPerf, perfNow } from "@/lib/perf";
import { isWindows } from "@/lib/platform";
import { findCandidateByAlias } from "@/lib/python-probe";
import type { IPCCommand, IPCEvent, ReadyEvent } from "@/types/ipc";
import type { RuntimeKind } from "@/types/session";

/**
 * Bridge subprocess client.
 *
 * ## B2 M2 update
 *
 * The body of `spawnBridge` and the `BridgeClient` methods are now Tauri
 * `invoke()` wrappers against the Rust-side `RunnerManager`. The function
 * signatures are byte-identical to the v0.1 plugin-shell-backed version
 * (B2 invariant I1 locks the surface so callers don't change shape).
 * All bridge-process ownership lives in Rust now — spawn / stdin /
 * stdout / stderr / kill are commands invoked into Rust, and IPC events
 * arrive as Tauri events that this file fans back out to the registered
 * `BridgeHandlers` callbacks.
 *
 * ## Why this is still wired in TS
 *
 * The single-frontend v0.1 wiring (each spawn registers its own handlers
 * object, dispatches via `dispatchIPCEvent`) is kept intact for the GUI
 * front-end. A future iteration can replace this with slice stores
 * subscribing directly to Rust events.
 *
 * ## Stderr handling
 *
 * Stderr lines are NOT pushed event-by-event. The Rust side keeps a
 * rolling tail of the last 8 stderr lines; when `onClose` fires this
 * shim pulls the tail via the `runner_stderr_tail` command and synthesizes
 * a single `onStderr(joined)` callback if there's anything to surface.
 * That matches the v0.1 contract for the "Bridge crashed with this error"
 * toast (the only consumer of stderr) without paying the cost of a Tauri
 * event per line.
 */

export interface BridgeSpawnArgs {
  /**
   * Python interpreter path. Defaults to "python3" on macOS / Linux
   * and "python" on Windows (must be on PATH). Only consulted when
   * `useExternalPython` is true — v0.1.1+ defaults to the bundled
   * interpreter and this field is the escape-hatch target.
   */
  python?: string;
  /**
   * v0.1.1+: when false (default), spawn the Galley-bundled Python
   * at `$RESOURCE/python/`. Only the external (attach) runtime honors
   * it — see `shouldUseBundledPython` for the full rule.
   *
   * Dev mode (`pnpm tauri dev`) is always external because the
   * bundled tree doesn't materialize until `tauri build`.
   */
  useExternalPython?: boolean;
  /** Path to GA repo (forwarded to bridge as --ga-path). */
  gaPath: string;
  /** Stable session id (forwarded to bridge as --session-id). */
  sessionId: string;
  /** Working directory for the GA subprocess (--cwd). */
  cwd?: string;
  /** Optional Project Workspace root. Never used as subprocess cwd. */
  workspaceRoot?: string;
  /**
   * Working directory for the bridge process itself. Should be the
   * Workbench repo root so `python -m runner.workbench_bridge`
   * resolves the package.
   */
  bridgeCwd?: string;
  /** Initial LLM index (--llm-no). */
  llmIndex?: number;
  /** Stable LLM identity. External GA uses the raw `agent.list_llms()` name;
   * managed GA uses the Galley managed model id. */
  llmKey?: string;
  /** Extra environment variables passed to the Python child. */
  env?: Record<string, string>;
  /** Runtime profile. External is the legacy attach path. */
  runtimeKind?: RuntimeKind;
}

export interface BridgeClient {
  /** Subprocess pid. Resolved after spawn(). */
  pid: number;
  /** Send an IPCCommand to bridge stdin. */
  send(cmd: IPCCommand): Promise<void>;
  /** Send {kind: "shutdown"} and wait for close. Rust force-kills if hung. */
  shutdown(timeoutMs?: number): Promise<void>;
}

export interface BridgeHandlers {
  onEvent: (event: IPCEvent) => void;
  /** Stderr line (already trimmed). bridge writes Python tracebacks
   * here so it's worth surfacing as a toast / log. */
  onStderr?: (line: string) => void;
  /** Process exited (graceful or not). `code` is null when killed by signal. */
  onClose?: (code: number | null, signal: number | null) => void;
  /** Spawn / IO error. */
  onError?: (message: string) => void;
  /** Called when stdout emits a line that doesn't parse as JSON. Bridge's
   * stdout discipline (capture fd 1 + redirect sys.stdout to /dev/null)
   * should make this rare. */
  onMalformedLine?: (line: string) => void;
}

/**
 * Payload shapes emitted from Rust. Must match
 * `core/src/runner_commands.rs::RunnerEventEnvelope` / etc.
 */
interface RunnerEventEnvelope {
  sessionId: string;
  event: IPCEvent;
}
interface RunnerMalformedPayload {
  sessionId: string;
  line: string;
}
interface RunnerClosedPayload {
  sessionId: string;
  code: number | null;
  signal: number | null;
}

/**
 * A live runner's latest `ready`, folded with every later `llm_changed` /
 * `reasoning_effort_changed` (Core's `runner_manager::ready`). Same shape
 * as the `ready` event without `kind`. Handed out when a page attaches
 * after `ready` went by — apply it to the stores only
 * (`applyReadySnapshot`); it never triggers a history replay.
 */
export type ReadySnapshot = Omit<ReadyEvent, "kind">;

/** Arguments of Core's `ensure_session_runner` Tauri command. */
export interface EnsureBridgeArgs {
  sessionId: string;
  /** Start a brand-new session on this model instead of the session
   * row's persisted choice (the EmptyState picker's pending pick). */
  llmIndex?: number;
  llmKey?: string;
  /** Eviction-protected session for Core's LRU cap. */
  activeSessionId?: string;
  /** Transitional: the page's in-memory `gaConfig`, which Core resolves
   * with instead of the stored pref (see the Rust command's docs). */
  gaConfig?: {
    python: string;
    gaPath: string;
    bridgeCwd: string;
    useExternalPython: boolean;
  };
}

export interface EnsureBridgeResult {
  client: BridgeClient;
  /** True when Core started the runner (its `ready` arrives as an event
   * — already arrived when Core had history to replay first); false when
   * it was already alive — no `ready` will come. */
  spawned: boolean;
  /** The live runner's latest `ready` state (only when not spawned). */
  ready: ReadySnapshot | null;
}

/**
 * Core could not restore the session's history into its runner, even
 * after restarting it once (`{"error":"history_replay"}` from
 * `ensure_session_runner`, ticket 02b). The runner may still be alive,
 * unconfirmed. Not a bridge failure: an activation stays quiet, and a
 * send (`send_user_message` fails with the same tag) shows its "restore
 * timed out" copy.
 */
export class HistoryReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HistoryReplayError";
  }
}

/** The Rust error tag of an invoke failure, when it carries one. */
export function invokeErrorTag(e: unknown): string | null {
  const raw =
    typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
  try {
    const parsed = JSON.parse(raw) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : null;
  } catch {
    return null;
  }
}

/**
 * The runner a Core command hands back: `ensure_session_runner`'s whole
 * result (`runner_commands::EnsureSessionRunnerResult`), and the `runner`
 * of a `send_user_message` that needed one. `ready` only when not spawned.
 */
export interface RunnerHandle {
  pid: number;
  spawned: boolean;
  ready: ReadySnapshot | null;
}

interface SpawnRunnerArgsJson {
  python: string;
  gaPath: string;
  sessionId: string;
  cwd?: string;
  workspaceRoot?: string;
  bridgeCwd: string;
  llmIndex?: number;
  llmKey?: string;
  env: Array<[string, string]>;
  runtimeKind?: RuntimeKind;
  activeSessionId?: string;
}

/**
 * Whether a bridge spawn runs on the Galley-bundled interpreter.
 *
 * - Dev builds never do: the bundled tree only exists after
 *   `tauri build`.
 * - Bundled-engine (managed) sessions always do in a packaged build.
 *   The "使用外部 Python…" escape hatch lives under 接入外部 GA and is
 *   an attach-runtime setting; the bundled engine shipping on its own
 *   Python is a release contract (devlog 2026-06-04). GUI callers
 *   spread the whole `gaConfig` into the spawn args, so the flag must
 *   be ignored here rather than at each call site.
 *
 * Session runners resolve their interpreter in Core since ticket 02a
 * (`core/src/session_runner/spawn_config.rs`, `wants_bundled_python` —
 * the same rule); this copy still serves the LLM-list warmup spawn. Keep
 * the two in step.
 * - External (attach) sessions — and callers that omit `runtimeKind`,
 *   which is the legacy external default — honor `useExternalPython`.
 */
export function shouldUseBundledPython({
  isProd,
  runtimeKind,
  useExternalPython,
}: {
  isProd: boolean;
  runtimeKind?: RuntimeKind;
  useExternalPython?: boolean;
}): boolean {
  if (!isProd) return false;
  if (runtimeKind === "managed") return true;
  return !useExternalPython;
}

export async function spawnBridge(
  args: BridgeSpawnArgs,
  handlers: BridgeHandlers,
): Promise<BridgeClient> {
  const startedAt = perfNow();
  // Resolve python path: in production + bundled mode, point at the
  // packaged interpreter; otherwise honor the caller's choice. This is
  // a TS-side resolution because Tauri's $RESOURCE token is a build-
  // time bundle path and the JS side already knows whether bundling
  // happened (PROD env).
  const wantBundled = shouldUseBundledPython({
    isProd: import.meta.env.PROD,
    runtimeKind: args.runtimeKind,
    useExternalPython: args.useExternalPython,
  });
  const resolvePythonStartedAt = perfNow();
  const python = await resolvePythonPath(args.python, wantBundled);
  logPerf("bridge.resolvePythonPath", resolvePythonStartedAt, {
    sessionId: args.sessionId,
    wantBundled,
  });

  // Rust Core is authoritative for bridge cwd: dev resolves to the
  // repo root and production resolves to the packaged resource dir.
  // Keep this field only because the Tauri command schema still
  // requires it before Rust normalizes the runtime-specific value.
  const bridgeCwd = args.bridgeCwd?.trim() || ".";

  const spawnArgs: SpawnRunnerArgsJson = {
    python,
    gaPath: args.gaPath,
    sessionId: args.sessionId,
    cwd: args.cwd,
    workspaceRoot: args.workspaceRoot,
    bridgeCwd,
    llmIndex: args.llmIndex,
    llmKey: args.llmKey,
    env: args.env ? Object.entries(args.env) : [],
    runtimeKind: args.runtimeKind,
  };

  // Register listeners BEFORE invoking spawn so we don't miss the very
  // first event (the Rust side starts emitting `runner-event` from the
  // moment the broadcast subscription is set up inside spawn_runner).
  // The handlers stay registered until shutdown / kill / close fires
  // — `unlistenAll` then tears them down so we don't leak listeners
  // across multiple bridges per process.
  const sessionId = args.sessionId;
  const unlistenFns: UnlistenFn[] = [];
  let alreadyClosed = false;

  const teardown = () => {
    for (const u of unlistenFns) {
      try {
        u();
      } catch {
        // listeners may have unregistered themselves via webview reload
      }
    }
    unlistenFns.length = 0;
  };

  const onClosedSafe = async (code: number | null, signal: number | null) => {
    if (alreadyClosed) return;
    alreadyClosed = true;
    // Surface stderr tail (if any) before the onClose callback so the
    // toast in runtimeStore's onClose handler has the lines available
    // via the sync rolling buffer it maintains.
    try {
      const tail: string[] = await invoke("runner_stderr_tail", { sessionId });
      for (const line of tail) {
        handlers.onStderr?.(line);
      }
    } catch {
      // best-effort — manager may have already dropped the session
    }
    handlers.onClose?.(code, signal);
    teardown();
  };

  unlistenFns.push(
    await listen<RunnerEventEnvelope>("runner-event", (e) => {
      if (e.payload.sessionId !== sessionId) return;
      handlers.onEvent(e.payload.event);
    }),
  );
  unlistenFns.push(
    await listen<RunnerMalformedPayload>("runner-malformed", (e) => {
      if (e.payload.sessionId !== sessionId) return;
      handlers.onMalformedLine?.(e.payload.line);
    }),
  );
  unlistenFns.push(
    await listen<RunnerClosedPayload>("runner-closed", (e) => {
      if (e.payload.sessionId !== sessionId) return;
      void onClosedSafe(e.payload.code, e.payload.signal);
    }),
  );

  let pid: number;
  try {
    const invokeStartedAt = perfNow();
    pid = await invoke<number>("spawn_runner", { args: spawnArgs });
    logPerf("bridge.spawnRunnerInvoke", invokeStartedAt, {
      sessionId,
      runtimeKind: args.runtimeKind ?? "external",
      pid,
    });
  } catch (e) {
    teardown();
    const msg = formatInvokeError(e);
    handlers.onError?.(msg);
    // `formatInvokeError` already extracts the typed `error`/`detail`
    // from the Rust-side error JSON; re-attaching the raw invoke
    // string as `cause` would just duplicate information that's
    // already inside `msg`. lint guard intentionally silenced here.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(msg);
  }
  logPerf("bridge.spawnBridge", startedAt, {
    sessionId,
    runtimeKind: args.runtimeKind ?? "external",
    pid,
  });

  return {
    pid,
    send: async (cmd) => {
      try {
        await invoke("send_to_runner", { sessionId, command: cmd });
      } catch (e) {
        const msg = formatInvokeError(e);
        // Don't re-throw via the error handler — `send` is awaited by
        // callers (e.g. composer submit) and the failure is best
        // surfaced as an Error they can catch directly. Same rationale
        // as spawn's catch: `msg` already contains the extracted
        // discriminant + detail; attaching `cause` would be redundant.
        // eslint-disable-next-line preserve-caught-error
        throw new Error(msg);
      }
    },
    shutdown: async (timeoutMs = 3000) => {
      try {
        await invoke("shutdown_runner", { sessionId, timeoutMs });
      } catch {
        // graceful failed → fall through to close
      }
      void onClosedSafe(0, null);
    },
  };
}

/**
 * Listen for one session's runner events. Registered BEFORE anything that
 * can make the runner emit, so the first event (`ready`) is not missed.
 * The listeners stay up until the runner closes (or the returned client
 * shuts it down).
 */
async function listenToRunner(
  sessionId: string,
  handlers: BridgeHandlers,
): Promise<{ teardown: () => void; clientFor: (pid: number) => BridgeClient }> {
  const unlistenFns: UnlistenFn[] = [];
  let alreadyClosed = false;

  const teardown = () => {
    for (const u of unlistenFns) {
      try {
        u();
      } catch {
        // listeners may have unregistered themselves via webview reload
      }
    }
    unlistenFns.length = 0;
  };

  const onClosedSafe = async (code: number | null, signal: number | null) => {
    if (alreadyClosed) return;
    alreadyClosed = true;
    try {
      const tail: string[] = await invoke("runner_stderr_tail", { sessionId });
      for (const line of tail) {
        handlers.onStderr?.(line);
      }
    } catch {
      // best-effort — manager may have already dropped the session
    }
    handlers.onClose?.(code, signal);
    teardown();
  };

  unlistenFns.push(
    await listen<RunnerEventEnvelope>("runner-event", (e) => {
      if (e.payload.sessionId !== sessionId) return;
      handlers.onEvent(e.payload.event);
    }),
  );
  unlistenFns.push(
    await listen<RunnerMalformedPayload>("runner-malformed", (e) => {
      if (e.payload.sessionId !== sessionId) return;
      handlers.onMalformedLine?.(e.payload.line);
    }),
  );
  unlistenFns.push(
    await listen<RunnerClosedPayload>("runner-closed", (e) => {
      if (e.payload.sessionId !== sessionId) return;
      void onClosedSafe(e.payload.code, e.payload.signal);
    }),
  );

  const clientFor = (pid: number): BridgeClient => ({
    pid,
    send: async (cmd) => {
      try {
        await invoke("send_to_runner", { sessionId, command: cmd });
      } catch (e) {
        const msg = formatInvokeError(e);
        // eslint-disable-next-line preserve-caught-error
        throw new Error(msg);
      }
    },
    shutdown: async (timeoutMs = 3000) => {
      try {
        await invoke("shutdown_runner", { sessionId, timeoutMs });
      } catch {
        // graceful failed → fall through to close
      }
      void onClosedSafe(0, null);
    },
  });

  return { teardown, clientFor };
}

/**
 * Run a Core command that may start — or hand back — `sessionId`'s
 * runner, with this page's listeners up before it, so a runner it starts
 * cannot slip its first events (`ready`) past them. `runnerOf` picks the
 * runner out of the command's result; with none (e.g. a send Core
 * queued) the listeners come down again, as they do when the command
 * fails — its error is rethrown untouched for the caller to classify.
 */
export async function listenThenInvoke<T>(
  sessionId: string,
  handlers: BridgeHandlers,
  command: () => Promise<T>,
  runnerOf: (result: T) => RunnerHandle | null,
): Promise<{ result: T; runner: EnsureBridgeResult | null }> {
  const listeners = await listenToRunner(sessionId, handlers);
  let result: T;
  try {
    result = await command();
  } catch (e) {
    listeners.teardown();
    throw e;
  }
  const handle = runnerOf(result);
  if (!handle) {
    listeners.teardown();
    return { result, runner: null };
  }
  return {
    result,
    runner: {
      client: listeners.clientFor(handle.pid),
      spawned: handle.spawned,
      ready: handle.ready ?? null,
    },
  };
}

/**
 * Make sure a session has a live runner, through Core's shared path
 * (`ensure_session_runner`): Core returns the runner it already holds, or
 * starts one from the session row and prefs. Listeners go up before the
 * invoke so a freshly started runner's `ready` cannot slip past.
 *
 * Core never replaces a live runner here, so this is safe to call for a
 * session that may be mid-run elsewhere (CLI, Goal, a reloaded page).
 */
export async function ensureBridge(
  args: EnsureBridgeArgs,
  handlers: BridgeHandlers,
): Promise<EnsureBridgeResult> {
  const startedAt = perfNow();
  const { sessionId } = args;
  let runner: EnsureBridgeResult | null;
  try {
    ({ runner } = await listenThenInvoke(
      sessionId,
      handlers,
      () =>
        invoke<RunnerHandle>("ensure_session_runner", {
          sessionId,
          llmIndex: args.llmIndex,
          llmKey: args.llmKey,
          activeSessionId: args.activeSessionId,
          gaConfig: args.gaConfig,
        }),
      (handle) => handle,
    ));
  } catch (e) {
    const msg = formatInvokeError(e);
    if (invokeErrorTag(e) === "history_replay") {
      // Not a bridge failure: Core has (or had) a runner, it only could
      // not confirm the history. No bridge-failed toast; whoever needs
      // the history reports it.
      throw new HistoryReplayError(msg);
    }
    handlers.onError?.(msg);
    // Same as spawnBridge: `msg` already carries the typed discriminant
    // and detail.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(msg);
  }
  if (!runner) {
    // Core's ensure always answers with a runner; guard the type.
    throw new Error("Core's ensure_session_runner returned no runner.");
  }
  logPerf("bridge.ensureBridge", startedAt, {
    sessionId,
    pid: runner.client.pid,
    spawned: runner.spawned,
  });
  return runner;
}

/** Listen to a runner Core already holds (started elsewhere). */
export async function attachBridge(
  sessionId: string,
  pid: number,
  handlers: BridgeHandlers,
): Promise<BridgeClient> {
  const listeners = await listenToRunner(sessionId, handlers);
  return listeners.clientFor(pid);
}

/**
 * Resolve the Python interpreter the Rust side should spawn.
 *
 * Three input shapes the user / prefs can supply:
 *
 *   1. A capability alias name from the v0.1 era (`"python-brew-arm"`,
 *      `"python-ga-venv"`, etc.) — these are NOT executable paths.
 *      Translate to the absolute path the alias targets via the same
 *      lookup table `python-probe.ts` uses.
 *   2. The bare names `"python3"` / `"python"` — pass through so the
 *      OS resolves them against PATH (`Command::new("python3")` does
 *      a PATH lookup on Unix the same way the shell does).
 *   3. An absolute path the user pasted into Settings → Python — pass
 *      through unchanged.
 *
 * In production with bundled mode, the bundled interpreter wins
 * regardless of `userPath` — same behaviour as the v0.1.1 design.
 *
 * v0.2 plan: retire the capability alias list entirely (now that we
 * spawn through Rust, arbitrary absolute paths just work). Until then,
 * this shim keeps existing dogfood `gaConfig.python` values working.
 *
 * Core resolves session runners with a Rust copy of this rule
 * (`session_runner::resolve_user_python`); the shared fixture
 * `core/tests/fixtures/python-aliases.json` holds both to the same table.
 */
export async function resolvePythonPath(
  userPath: string | undefined,
  wantBundled: boolean,
): Promise<string> {
  if (wantBundled) {
    try {
      const { resourceDir, join } = await import("@tauri-apps/api/path");
      const base = await resourceDir();
      // PBS install_only puts python at bin/python3 on Unix, python.exe
      // at the bundle root on Windows.
      const rel = isWindows ? "python/python.exe" : "python/bin/python3";
      return await join(base, rel);
    } catch (e) {
      console.warn(
        "[bridge] resolvePythonPath: bundled path resolution failed; falling back to user path.",
        e,
      );
    }
  }
  const fallback = isWindows ? "python" : "python3";
  if (!userPath) {
    return fallback;
  }
  // Absolute path or bare command name — pass through.
  if (
    userPath.startsWith("/") ||
    userPath.startsWith("\\") ||
    /^[A-Z]:/.test(userPath)
  ) {
    return userPath;
  }
  if (userPath === "python3" || userPath === "python") {
    return userPath;
  }
  // Looks like a v0.1 capability alias (e.g. "python-brew-arm",
  // "python-ga-venv"). Translate to the absolute path the alias mapped
  // to. If the lookup fails (legacy alias removed, unrecognized value),
  // fall back to the default — better to try a likely-working PATH
  // resolution than spawn with a name the OS definitely can't resolve.
  try {
    const candidate = await findCandidateByAlias(userPath);
    if (candidate) {
      // The probe's `displayPath` has placeholder strings for the
      // PATH-resolved variants ("python3 (PATH)") — strip those back
      // to the bare command so `Command::new` does the PATH lookup.
      if (candidate.displayPath.endsWith("(PATH)")) {
        return userPath; // already a bare name
      }
      return candidate.displayPath;
    }
    console.warn(
      `[bridge] resolvePythonPath: unrecognized alias "${userPath}"; falling back to "${fallback}"`,
    );
  } catch (e) {
    console.warn(
      `[bridge] resolvePythonPath: alias lookup failed for "${userPath}"; falling back to "${fallback}"`,
      e,
    );
  }
  return fallback;
}

/**
 * Rust-side commands return errors as either a JSON-stringified typed
 * error (`{"error":"python_not_found","detail":"..."}`) or a plain string
 * (when the error wasn't a typed variant). Try to parse the JSON form
 * and surface a readable message either way.
 */
export function formatInvokeError(e: unknown): string {
  const raw =
    typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
  try {
    const parsed = JSON.parse(raw) as {
      error?: string;
      detail?: string;
      message?: string;
    };
    if (parsed.error) {
      const specific = actionableInvokeError(parsed.error);
      if (specific) return specific;
      const human = humanizeErrorTag(parsed.error);
      // Runner errors carry `detail`; Core API errors (`GalleyError`,
      // e.g. a session row ensure_session_runner could not read) carry
      // `message`.
      const detail = parsed.detail ?? parsed.message;
      return detail ? `${human}: ${detail}` : human;
    }
  } catch {
    // not JSON — fall through
  }
  return raw;
}

function actionableInvokeError(tag: string): string | null {
  switch (tag) {
    case "managed_model_not_configured":
      return "内置内核模型不可用。请在 Models 添加模型，或重新输入 API Key。";
    case "managed_runtime_invalid":
      return "Galley 内置运行时不完整。请重新安装或更新 Galley。";
    case "ga_path_invalid":
      return "接入的 GenericAgent 路径不可用。请到设置的 Runtime 页面重新选择 GA 目录。";
    default:
      return null;
  }
}

function humanizeErrorTag(tag: string): string {
  switch (tag) {
    case "python_not_found":
      return "Python not found";
    case "ga_path_invalid":
      return "GA path invalid";
    case "managed_runtime_invalid":
      return "Managed runtime invalid";
    case "managed_model_not_configured":
      return "Managed model not configured";
    case "bridge_cwd_invalid":
      return "Bridge working directory invalid";
    case "path_encoding":
      return "Path encoding error";
    case "spawn_io":
      return "Subprocess spawn failed";
    case "pipe_unavailable":
      return "Subprocess pipe unavailable";
    case "history_replay":
      return "History restore failed";
    case "dispatch_failed":
      return "Message dispatch failed";
    case "images_not_supported":
    case "images_not_queueable":
    case "images_not_allowed":
      return "Images not accepted";
    case "process_gone":
      return "Bridge process is gone";
    case "serialize":
      return "Command serialize failed";
    case "write_io":
      return "Bridge stdin write failed";
    default:
      return tag;
  }
}
