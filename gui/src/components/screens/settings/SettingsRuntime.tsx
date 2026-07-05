import {
  Check,
  CircleNotch,
  FolderOpen,
  Package,
  Warning,
  X,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import {
  SettingsPanelHeader,
  SettingsSectionLabel,
} from "@/components/screens/settings/settings-ui";
import type { PathValidation } from "@/components/screens/onboarding/StepAttach";
import { AdvancedRuntimeSettings } from "@/components/screens/settings/runtime/AdvancedRuntimeSettings";
import { BuiltinRuntimeCard } from "@/components/screens/settings/runtime/BuiltinRuntimeCard";
import { GAVersionCard } from "@/components/screens/settings/runtime/GAVersionCard";
import { HealthCheckSection } from "@/components/screens/settings/runtime/HealthCheckSection";
import { RuntimeAccordionRow } from "@/components/screens/settings/runtime/RuntimeAccordionRow";
import type { SettingsRuntimeProps } from "@/components/screens/settings/runtime/types";
import { SettingsUpdateControl } from "@/components/screens/settings/SettingsUpdateControl";
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
import { usePrefsStore } from "@/stores/prefs";
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
 * baseline + version are read-only mono labels at the bottom.
 */
export function SettingsRuntime({
  info,
  hasRunningSessions,
  activeRuntimeKind,
  hasManagedRuntimeConfigured,
  hasExternalRuntimeConfigured,
  useExternalPython,
  onChangeGAPath,
  onChangeBridgePython,
  onReRunHealthCheck,
  onOpenSetupAssistant,
  onToggleExternalPython,
  onChangeRuntimeKind,
  onOpenModels,
  onCommitGAPath,
}: SettingsRuntimeProps) {
  const copy = useCopy();
  const runtimeCopy = copy.settings.runtime;
  const [externalExpanded, setExternalExpanded] = useState(
    activeRuntimeKind === "external",
  );
  const [highlightedRuntimeKind, setHighlightedRuntimeKind] =
    useState<RuntimeKind | null>(null);
  const highlightTimerRef = useRef<number | null>(null);

  useEffect(() => {
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

  const externalRuntimeDetails = (
    <div className="space-y-7 border-t border-line pt-6">
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
        onChangeExternalPath={onChangeBridgePython}
        onToggle={onToggleExternalPython}
      />

      <GAVersionCard
        gaCommit={info.gaCommit}
        gaCommitDate={info.gaCommitDate}
        gaBaseline={info.gaBaseline}
      />

      <HealthCheckSection onReRunHealthCheck={onReRunHealthCheck} />
    </div>
  );

  return (
    <div className="space-y-7">
      <SettingsPanelHeader
        title={copy.settings.tabs.runtime.label}
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

      <div className="border-t border-line pt-4">
        <SettingsUpdateControl
          hasRunningSessions={hasRunningSessions}
          leading={
            <div className="font-mono text-ui-label text-ink-muted">
              Galley v{info.workbenchVersion}
            </div>
          }
        />
      </div>
    </div>
  );
}

// ---------------- Python (bundled / external) ----------------

/**
 * Python interpreter panel. Two visual modes:
 *
 *   - **Bundled (default, v0.1.1+)**: read-only card showing
 *     "Galley 内置 Python <version>". Galley ships its own CPython
 *     with GA deps pre-staged via scripts/bundle-python.sh, so the
 *     user doesn't pick anything. A small "使用外部 Python…" toggle
 *     under the card reveals the legacy picker for advanced users
 *     (custom GA forks, live venv iteration).
 *
 *   - **External**: a read-only PathField mirrors the
 *     python-probe-selected path the way it did pre-v0.1.1. Same
 *     "Re-run Health Check" button below (in the parent) re-triggers
 *     the probe. A "改回 Galley 内置 Python" toggle returns to
 *     bundled mode.
 *
 * Toggle hands off to the parent via `onToggle(bool)` — caller
 * persists through `setGAConfig({useExternalPython})`. UI confirms
 * implicitly: changing the toggle is the user's intent declaration.
 */
function PythonPanel({
  useExternal,
  externalPath,
  onChangeExternalPath,
  onToggle,
}: {
  useExternal: boolean;
  externalPath: string;
  onChangeExternalPath?: () => void;
  onToggle?: (useExternal: boolean) => void;
}) {
  const copy = useCopy().settings.runtime;
  if (!useExternal) {
    return (
      <div>
        <SettingsSectionLabel>Python</SettingsSectionLabel>
        <div className="mt-2 flex items-center gap-3 rounded-sm border border-line bg-surface px-3 py-2.5">
          <Package size={18} weight="thin" className="shrink-0 text-ink-soft" />
          <div className="min-w-0">
            <div className="font-mono text-[12.5px] text-ink">
              CPython {BUNDLED_PYTHON_VERSION}
            </div>
            <div className="mt-0.5 text-[11.5px] text-ink-muted">
              {copy.bundledPythonDetail}
            </div>
          </div>
        </div>
        {onToggle && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onToggle(true)}
            className="mt-2 px-0 text-[11.5px] hover:bg-transparent hover:underline"
          >
            {copy.useExternalPython}
          </Button>
        )}
      </div>
    );
  }
  return (
    <div>
      <PathField
        label="Python"
        value={externalPath}
        // External mode keeps the V0.1-era picker-suppressed behavior:
        // the probe owns selection; we surface the resolved path for
        // visibility, and Re-run Health Check (button below in
        // parent) re-probes when needed.
        onPick={onChangeExternalPath}
        readOnly
        hint={copy.externalPythonHint}
      />
      {onToggle && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onToggle(false)}
          className="mt-2 px-0 text-[11.5px] hover:bg-transparent hover:underline"
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
  const activeRuntimeKind = usePrefsStore((s) => s.activeRuntimeKind);
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
      : `${copy.missing} · ${missingSeedFiles} ${copy.criticalFiles} · ${diagnostics.paths.memorySeedDir}`
    : copy.notLoaded;
  const modelStatus =
    models.length === 0
      ? copy.notConfigured
      : `${models.length} ${copy.models} · ${copy.keysOnDemand}${
          defaultModel ? ` · ${defaultModel.displayName}` : ""
        }`;
  return (
    <RuntimeAccordionRow
      title={copy.advancedDiagnostics}
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
    >
      <div>
        <RuntimeDiagnosticRow
          label={copy.currentMode}
          value={
            activeRuntimeKind === "managed" ? copy.bundledGA : copy.externalGA
          }
        />
        <RuntimeDiagnosticRow label={copy.kernelVersion} value={upstreamShort} />
        <RuntimeDiagnosticRow
          label="Patch stack"
          value={
            diagnostics
              ? `${diagnostics.patchStackId} · ${diagnostics.patchCount} patches`
              : copy.notLoaded
          }
        />
        <RuntimeDiagnosticRow
          label="Code"
          value={
            diagnostics
              ? diagnostics.code.agentmainExists
                ? diagnostics.paths.codeRoot
                : `${diagnostics.paths.codeRoot} · ${copy.pendingPackage}`
              : copy.notLoaded
          }
        />
        <RuntimeDiagnosticRow label="Prompts" value={promptStatus} />
        <RuntimeDiagnosticRow label={copy.memorySop} value={memorySeedStatus} />
        <RuntimeDiagnosticRow
          label="State"
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
          label="Config file"
          value={
            diagnostics
              ? diagnostics.state.modelConfigExists
                ? diagnostics.paths.modelConfigPath
                : `${diagnostics.paths.modelConfigPath} · ${copy.notGenerated}`
              : copy.notLoaded
          }
        />
      </div>
      <p className="mt-3 text-ui-tertiary leading-[1.55] text-ink-muted">
        {copy.diagnosticsNote}
      </p>
    </RuntimeAccordionRow>
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
 * Path field with three modes:
 *   - readonly: display-only (Python — value comes from probe)
 *   - picker:   value + folder picker button (no manual typing)
 *   - editable: input is typeable; commit on Enter / blur. Folder
 *               picker stays available when `onPick` is also provided.
 *
 * Editable mode runs `validateGAPath` debounced (300ms) and renders an
 * inline status line. Commit is blocked only on `not-found` — picker
 * also accepts whatever the OS dialog returns without validation, so
 * typed paths follow the same trust model except for the impossible
 * case.
 */
function PathField({
  label,
  value,
  placeholder,
  hint,
  onPick,
  onCommit,
  readOnly = false,
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
  /** When true, the field shows the value but suppresses the picker —
   * used for Bridge Python (see capabilities constraint comment above). */
  readOnly?: boolean;
}) {
  const copy = useCopy().settings.runtime;
  const editable = !!onCommit;
  const [draft, setDraft] = useState(value);
  const [validation, setValidation] = useState<PathValidation>(null);

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
      e.currentTarget.blur();
    }
  };

  return (
    <div>
      <SettingsSectionLabel>{label}</SettingsSectionLabel>
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={editable ? draft : value}
          placeholder={placeholder}
          readOnly={!editable}
          onChange={editable ? handleChange : undefined}
          onBlur={editable ? () => void tryCommit() : undefined}
          onKeyDown={editable ? handleKeyDown : undefined}
          spellCheck={false}
          className={cn(
            "min-w-0 flex-1 rounded-sm border border-line bg-surface px-3 py-2 font-mono text-[12.5px] text-ink outline-none placeholder:text-ink-muted/70",
            editable &&
              "focus:border-brand focus:ring-[3px] focus:ring-brand/20",
          )}
        />
        {!readOnly && (
          <Button
            variant="accent-secondary"
            size="md"
            // Prevent the input's blur-commit from firing before the
            // picker's selection lands. Otherwise a dirty draft would
            // commit, then immediately get overwritten by the picker
            // result — double toast, confusing audit trail.
            onMouseDown={(e) => e.preventDefault()}
            onClick={onPick}
            className="shrink-0 px-3 py-2 text-[12.5px]"
            leadingIcon={<FolderOpen size={13} weight="thin" />}
          >
            {copy.choose}
          </Button>
        )}
      </div>
      {editable && <ValidationLine validation={validation} />}
      {hint && <div className="mt-1.5 text-[12px] text-ink-muted">{hint}</div>}
    </div>
  );
}

function ValidationLine({ validation }: { validation: PathValidation }) {
  const copy = useCopy().settings.runtime;
  if (!validation) return null;
  const cls = "mt-2 flex items-center gap-1.5 text-[12.5px]";
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
