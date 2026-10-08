import {
  Check,
  CircleNotch,
  FolderOpen,
  Warning,
  X,
} from "@phosphor-icons/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import {
  SettingsFieldLabel,
  SettingsPanelHeader,
} from "@/components/screens/settings/settings-ui";
import type { PathValidation } from "@/components/screens/onboarding/StepAttach";
import { AdvancedRuntimeSettings } from "@/components/screens/settings/runtime/AdvancedRuntimeSettings";
import { BuiltinRuntimeCard } from "@/components/screens/settings/runtime/BuiltinRuntimeCard";
import {
  clearExternalAccessExpandRequest,
  isExternalAccessExpandRequested,
} from "@/components/screens/settings/runtime/external-access-intent";
import { GAVersionCard } from "@/components/screens/settings/runtime/GAVersionCard";
import { HealthCheckSection } from "@/components/screens/settings/runtime/HealthCheckSection";
import { SettingsDisclosureRow } from "@/components/screens/settings/settings-disclosure";
import type { SettingsRuntimeProps } from "@/components/screens/settings/runtime/types";
import { Button } from "@/components/ui/button";
import { isImeCompositionKeydown } from "@/lib/ime";
import { useCopy } from "@/lib/i18n";
import {
  BUNDLED_PYTHON_VERSION,
  validateGAPath,
} from "@/lib/onboarding-validation";
import { EXAMPLE_GA_PATH } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useManagedModelsStore } from "@/stores/managed-models";
import type { ManagedRuntimeDiagnostics } from "@/types/inspector";
import type { RuntimeKind } from "@/types/session";

/**
 * Settings → Runtime tab. DESIGN.md §9 Runtime tab.
 *
 * GA Path supports both the folder picker (Tauri shell integration)
 * and manual typing — the latter covers paste-from-elsewhere, paths
 * that don't exist yet (preconfiguring before `git clone`), and quick
 * tweaks. Bridge Python stays picker-suppressed; the python-probe
 * (lib/python-probe.ts) owns interpreter selection in V0.1.
 *
 * Re-run health check routes back through Onboarding's StepHealth in
 * revisit mode — one canonical health-check UX.
 * Open Setup Assistant routes back through the full Onboarding flow
 * without clearing existing conversations or saved settings.
 *
 * No app-version line here: version + manual update check live in
 * Settings → About, update discovery in the TopBar indicator.
 */
export function SettingsRuntime({
  info,
  hasRunningSessions,
  activeRuntimeKind,
  hasManagedRuntimeConfigured,
  hasExternalRuntimeConfigured,
  useExternalPython,
  onChangeGAPath,
  onReRunHealthCheck,
  onOpenSetupAssistant,
  onToggleExternalPython,
  onChangeRuntimeKind,
  onOpenModels,
  onCommitGAPath,
}: SettingsRuntimeProps) {
  const copy = useCopy();
  const runtimeCopy = copy.settings.runtime;
  // Open by default while external is the runtime in use, or when
  // coming back from 「跑一次 Health Check」 (launched from inside this
  // accordion — see `external-access-intent`).
  const [externalExpanded, setExternalExpanded] = useState(
    () =>
      isExternalAccessExpandRequested() || activeRuntimeKind === "external",
  );
  const [highlightedRuntimeKind, setHighlightedRuntimeKind] =
    useState<RuntimeKind | null>(null);
  const highlightTimerRef = useRef<number | null>(null);

  useEffect(() => {
    clearExternalAccessExpandRequest();
    return () => {
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  const activateRuntimeKind = (kind: RuntimeKind) => {
    if (kind === activeRuntimeKind) return;
    setExternalExpanded(kind === "external");
    setHighlightedRuntimeKind(kind);
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedRuntimeKind(null);
      highlightTimerRef.current = null;
    }, 900);
    onChangeRuntimeKind?.(kind);
  };

  // Rendered as fragment children of ExternalRuntimeAccess's space-y
  // stack, so every block inside the accordion shares one rhythm with
  // the status/switch row — no divider, no extra nesting.
  const externalRuntimeDetails = (
    <>
      <PathField
        label={runtimeCopy.externalPath}
        value={info.gaPath}
        placeholder={EXAMPLE_GA_PATH}
        onPick={onChangeGAPath}
        onCommit={onCommitGAPath}
        hint={runtimeCopy.pathHint}
      />

      <PythonPanel
        useExternal={useExternalPython}
        externalPath={info.pythonVersion}
        onToggle={onToggleExternalPython}
      />

      {/* Only once an external session has reported its checkout's
          HEAD: before that the values are the bundled engine's own
          (高级诊断 → 内核版本 already shows those). */}
      {info.gaCommitRuntimeKind === "external" && (
        <GAVersionCard
          gaCommit={info.gaCommit}
          gaCommitDate={info.gaCommitDate}
          gaBaseline={info.gaBaseline}
        />
      )}

      <HealthCheckSection onReRunHealthCheck={onReRunHealthCheck} />
    </>
  );

  return (
    <div className="space-y-7">
      <SettingsPanelHeader
        title={copy.settings.tabs.runtime.title}
        subtitle={runtimeCopy.subtitle}
      />

      <BuiltinRuntimeCard
        value={activeRuntimeKind}
        hasManagedRuntimeConfigured={hasManagedRuntimeConfigured}
        hasRunningSessions={hasRunningSessions}
        highlighted={highlightedRuntimeKind === "managed"}
        onOpenModels={onOpenModels}
        onActivate={() => activateRuntimeKind("managed")}
      />

      <AdvancedRuntimeSettings
        expanded={externalExpanded}
        value={activeRuntimeKind}
        gaPath={info.gaPath}
        hasExternalRuntimeConfigured={hasExternalRuntimeConfigured}
        hasRunningSessions={hasRunningSessions}
        highlighted={highlightedRuntimeKind === "external"}
        managedDiagnosticsSlot={
          activeRuntimeKind === "managed" ? (
            <ManagedRuntimeCard diagnostics={info.managedRuntime} />
          ) : undefined
        }
        onOpenSetupAssistant={onOpenSetupAssistant}
        onToggleExpanded={() => setExternalExpanded((current) => !current)}
        onActivate={() => activateRuntimeKind("external")}
      >
        {externalRuntimeDetails}
      </AdvancedRuntimeSettings>

    </div>
  );
}

// ---------------- Python (bundled / external) ----------------

/**
 * Python interpreter panel. Two visual modes:
 *
 *   - **Bundled (default, v0.1.1+)**: read-only lines showing
 *     "CPython <version>" + bundled detail. Galley ships its own
 *     CPython with GA deps pre-staged via scripts/bundle-python.sh, so
 *     the user doesn't pick anything. A small "使用外部 Python…" toggle
 *     underneath reveals the legacy picker for advanced users
 *     (custom GA forks, live venv iteration).
 *
 *   - **External**: the python-probe-selected path as a read-only mono
 *     line (read-only display is borderless — Settings §9 Runtime
 *     layering rule). "跑一次 Health Check" below (in the parent)
 *     re-runs the probe. A "改回 Galley 内置 Python" toggle returns to
 *     bundled mode.
 *
 * Toggle hands off to the parent via `onToggle(bool)` — caller
 * persists through `setGAConfig({useExternalPython})`. UI confirms
 * implicitly: changing the toggle is the user's intent declaration.
 */
function PythonPanel({
  useExternal,
  externalPath,
  onToggle,
}: {
  useExternal: boolean;
  externalPath: string;
  onToggle?: (useExternal: boolean) => void;
}) {
  const copy = useCopy().settings.runtime;
  if (!useExternal) {
    return (
      <div>
        <SettingsFieldLabel>Python</SettingsFieldLabel>
        <div className="mt-1.5 font-mono text-ui-secondary text-ink">
          CPython {BUNDLED_PYTHON_VERSION}
        </div>
        <div className="mt-0.5 text-ui-tertiary leading-secondary text-ink-muted">
          {copy.bundledPythonDetail}
        </div>
        {onToggle && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onToggle(true)}
            className="mt-1.5 px-0 text-ui-tertiary hover:bg-transparent hover:underline"
          >
            {copy.useExternalPython}
          </Button>
        )}
      </div>
    );
  }
  // The probe owns selection (no picker); the resolved path is shown
  // for visibility, and 「跑一次 Health Check」 below re-probes.
  return (
    <div>
      <SettingsFieldLabel>Python</SettingsFieldLabel>
      <div
        className="mt-1.5 select-text truncate font-mono text-ui-secondary text-ink"
        title={externalPath}
      >
        {externalPath}
      </div>
      <div className="mt-0.5 text-ui-tertiary leading-secondary text-ink-muted">
        {copy.externalPythonHint}
      </div>
      {onToggle && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onToggle(false)}
          className="mt-1.5 px-0 text-ui-tertiary hover:bg-transparent hover:underline"
        >
          {copy.useBundledPython}
        </Button>
      )}
    </div>
  );
}

// ---------------- Managed runtime diagnostics ----------------

function ManagedRuntimeCard({
  diagnostics,
}: {
  diagnostics?: ManagedRuntimeDiagnostics;
}) {
  const copy = useCopy().settings.runtime;
  const [expanded, setExpanded] = useState(false);
  const models = useManagedModelsStore((s) => s.models);
  const upstreamShort =
    diagnostics?.upstreamCommit.slice(0, 7) ?? copy.notLoaded;
  const defaultModel = models.find((m) => m.isDefault) ?? models[0];
  const promptStatus = diagnostics
    ? `${diagnostics.promptProfileId} · ${diagnostics.promptHash}`
    : copy.notLoaded;
  const missingSeedFiles =
    diagnostics?.state.memorySeed.criticalFilesMissing.length ?? 0;
  const memorySeedStatus = diagnostics
    ? diagnostics.state.memorySeed.criticalFilesPresent
      ? `${copy.complete} · ${diagnostics.paths.memoryDir}`
      : `${copy.missingCriticalFiles(missingSeedFiles)} · ${diagnostics.paths.memorySeedDir}`
    : copy.notLoaded;
  const modelStatus =
    models.length === 0
      ? copy.notConfigured
      : `${copy.modelCount(models.length)} · ${copy.keysOnDemand}${
          defaultModel ? ` · ${defaultModel.displayName}` : ""
        }`;
  return (
    <SettingsDisclosureRow
      title={copy.advancedDiagnostics}
      open={expanded}
      onToggle={() => setExpanded((v) => !v)}
    >
      <div>
        <RuntimeDiagnosticRow label={copy.kernelVersion} value={upstreamShort} />
        <RuntimeDiagnosticRow
          label={copy.diagPatches}
          value={
            diagnostics
              ? `${diagnostics.patchStackId} · ${copy.patchCount(diagnostics.patchCount)}`
              : copy.notLoaded
          }
        />
        <RuntimeDiagnosticRow
          label={copy.diagCode}
          value={
            diagnostics
              ? diagnostics.code.agentmainExists
                ? diagnostics.paths.codeRoot
                : `${diagnostics.paths.codeRoot} · ${copy.pendingPackage}`
              : copy.notLoaded
          }
        />
        <RuntimeDiagnosticRow label={copy.diagPrompts} value={promptStatus} />
        <RuntimeDiagnosticRow label={copy.memorySop} value={memorySeedStatus} />
        <RuntimeDiagnosticRow
          label={copy.diagState}
          value={
            diagnostics
              ? diagnostics.state.initialized
                ? diagnostics.paths.stateRoot
                : `${diagnostics.paths.stateRoot} · ${copy.uninitialized}`
              : copy.notLoaded
          }
        />
        <RuntimeDiagnosticRow label={copy.models} value={modelStatus} />
        <RuntimeDiagnosticRow
          label={copy.configFile}
          value={
            diagnostics
              ? diagnostics.state.modelConfigExists
                ? diagnostics.paths.modelConfigPath
                : `${diagnostics.paths.modelConfigPath} · ${copy.notGenerated}`
              : copy.notLoaded
          }
        />
      </div>
      <p className="mt-3 text-ui-tertiary leading-secondary text-ink-muted">
        {copy.diagnosticsNote}
      </p>
    </SettingsDisclosureRow>
  );
}

function RuntimeDiagnosticRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-3 py-1">
      <div className="w-24 shrink-0 text-ui-tertiary text-ink-muted">{label}</div>
      <div
        className="min-w-0 select-text truncate font-mono text-ui-tertiary text-ink-soft"
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * Path field with two modes:
 *   - picker:   value + folder picker button (no manual typing)
 *   - editable: input is typeable; commit on Enter / blur / a press
 *               outside the field. Folder picker stays available when
 *               `onPick` is also provided.
 *
 * Editable mode runs `validateGAPath` debounced (300ms) and renders an
 * inline status line. Commit is blocked only on `not-found` — picker
 * also accepts whatever the OS dialog returns without validation, so
 * typed paths follow the same trust model except for the impossible
 * case. Esc reverts the draft and leaves the field (Settings keeps the
 * dialog open while a text field has focus).
 */
function PathField({
  label,
  value,
  placeholder,
  hint,
  onPick,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder?: string;
  hint?: string;
  onPick?: () => void;
  /** When provided, the input becomes editable + validates on type +
   * commits on Enter / blur. Picker (if `onPick` set) still works in
   * parallel. */
  onCommit?: (path: string) => Promise<void>;
}) {
  const copy = useCopy().settings.runtime;
  const editable = !!onCommit;
  const [draft, setDraft] = useState(value);
  const [validation, setValidation] = useState<PathValidation>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  // Esc's own blur must not commit: that blur runs inside the keydown
  // handler, before the reverted draft has rendered, so it would still
  // see the dirty draft.
  const revertingRef = useRef(false);
  // The draft currently being validated / committed. An outside press
  // commits and the blur that follows it would commit the same draft
  // again (double save, double toast) while the first is in flight.
  const committingRef = useRef<string | null>(null);

  // Re-sync draft + validation when the saved value changes externally
  // (picker commit, store hydration). Uses React's "adjust state on
  // prop change" pattern — compare during render, write state, let
  // React bail out and re-render with the new value. Avoids the
  // cascading-render issue of doing the same in an effect.
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const [lastSyncedValue, setLastSyncedValue] = useState(value);
  if (lastSyncedValue !== value) {
    setLastSyncedValue(value);
    setDraft(value);
    setValidation(null);
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setDraft(next);
    // Decide synchronously whether validation will be needed; the
    // async fs probe is scheduled in the effect below. Doing the
    // null / checking transition here (driven by user input) keeps
    // the effect free of synchronous setState in its body.
    const trimmed = next.trim();
    if (trimmed === "" || trimmed === value) {
      setValidation(null);
    } else {
      setValidation({ kind: "checking" });
    }
  };

  // Debounced async validation. The effect body itself does no
  // synchronous state writes — only schedules a timeout that calls
  // setValidation inside its callback (which is fine per the
  // set-state-in-effect rule). State transitions for the trivial
  // cases happen in handleChange + the prop-sync block above.
  useEffect(() => {
    if (!editable) return;
    const trimmed = draft.trim();
    if (trimmed === "" || trimmed === value) return;
    const id = setTimeout(() => {
      void (async () => {
        const v = await validateGAPath(trimmed);
        setValidation(v);
      })();
    }, 300);
    return () => clearTimeout(id);
  }, [draft, editable, value]);

  const tryCommit = async () => {
    const trimmed = draft.trim();
    if (trimmed === "" || trimmed === value) {
      // Empty or no-op → silently revert UI to saved value.
      setDraft(value);
      setValidation(null);
      return;
    }
    if (committingRef.current === trimmed) return;
    committingRef.current = trimmed;
    try {
      // Force a settled validation result so a fast Enter doesn't slip
      // a `not-found` path through during the debounce window.
      setValidation({ kind: "checking" });
      const v = await validateGAPath(trimmed);
      setValidation(v);
      if (v?.kind === "not-found") {
        // Block commit; keep draft + error visible so the user can fix.
        return;
      }
      await onCommit!(trimmed);
    } finally {
      committingRef.current = null;
    }
  };

  // Galley's Buttons keep focus where it is on mouse press
  // (`preventMouseFocus`), so typing a path and then pressing
  // 「跑一次 Health Check」 or 「切换到外部 GA」 never blurs this input —
  // the action would run on the old path and the draft would be lost.
  // While a draft exists, any press outside the field commits it first,
  // as the blur would have (same as the Models tab number fields). The
  // field includes 「选择」, whose own mouse-down guard keeps the picker
  // result from racing a commit.
  const commitBeforeOutsidePress = useEffectEvent(() => {
    void tryCommit();
  });
  const dirty = editable && draft !== value;
  useEffect(() => {
    if (!dirty) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        fieldRef.current?.contains(event.target)
      ) {
        return;
      }
      commitBeforeOutsidePress();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [dirty]);

  const handleBlur = () => {
    if (revertingRef.current) return;
    void tryCommit();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isImeCompositionKeydown(e)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDraft(value);
      setValidation(null);
      revertingRef.current = true;
      e.currentTarget.blur();
      revertingRef.current = false;
    }
  };

  return (
    <div ref={fieldRef}>
      <SettingsFieldLabel>{label}</SettingsFieldLabel>
      <div className="mt-1.5 flex gap-2">
        <input
          type="text"
          value={editable ? draft : value}
          placeholder={placeholder}
          readOnly={!editable}
          onChange={editable ? handleChange : undefined}
          onBlur={editable ? handleBlur : undefined}
          onKeyDown={editable ? handleKeyDown : undefined}
          spellCheck={false}
          className={cn(
            "min-w-0 flex-1 rounded-sm border border-line bg-surface px-3 py-2 font-mono text-ui-secondary text-ink outline-none transition-colors duration-(--motion-fast) ease-firm placeholder:text-ink-muted/70",
            editable &&
              "focus:border-brand focus:ring-[3px] focus:ring-brand/20",
          )}
        />
        <Button
          variant="accent-secondary"
          size="md"
          // Prevent the input's blur-commit from firing before the
          // picker's selection lands. Otherwise a dirty draft would
          // commit, then immediately get overwritten by the picker
          // result — double toast, confusing audit trail.
          onMouseDown={(e) => e.preventDefault()}
          onClick={onPick}
          className="shrink-0 px-3 py-2 text-ui-secondary"
          leadingIcon={<FolderOpen size={13} weight="thin" />}
        >
          {copy.choose}
        </Button>
      </div>
      {editable && <ValidationLine validation={validation} />}
      {hint && (
        <div className="mt-1.5 text-ui-tertiary leading-secondary text-ink-muted">
          {hint}
        </div>
      )}
    </div>
  );
}

function ValidationLine({ validation }: { validation: PathValidation }) {
  const copy = useCopy().settings.runtime;
  if (!validation) return null;
  const cls = "mt-2 flex items-center gap-1.5 text-ui-secondary";
  switch (validation.kind) {
    case "ok":
      return (
        <div className={cn(cls, "text-success")}>
          <Check size={12} weight="thin" />
          {copy.validPath}
          {validation.foundAgentmain && (
            <span className="text-ink-muted">· {copy.agentmainVisible}</span>
          )}
        </div>
      );
    case "missing-agentmain":
      return (
        <div className={cn(cls, "text-warning")}>
          <Warning size={12} weight="thin" />
          {copy.pathMissingAgentmain}
        </div>
      );
    case "not-found":
      return (
        <div className={cn(cls, "text-error")}>
          <X size={12} weight="thin" />
          {copy.pathNotFound}
        </div>
      );
    case "checking":
      return (
        <div className={cn(cls, "text-ink-muted")}>
          <span className="spin">
            <CircleNotch size={12} weight="thin" />
          </span>
          {copy.checking}
        </div>
      );
  }
}
