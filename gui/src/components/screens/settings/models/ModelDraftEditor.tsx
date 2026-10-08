import { CircleNotch, PlugsConnected, Plus, X } from "@phosphor-icons/react";
import { useContext, useEffect, useRef, useState } from "react";

import { Button, IconButton } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import { useManagedModelsStore } from "@/stores/managed-models";
import { cn } from "@/lib/utils";
import type {
  ManagedModelAuthKind,
  ManagedModelProtocol,
} from "@/types/managed-models";

import { ModelAdvancedOptionsPanel } from "./AdvancedModelOptions";
import {
  EditorBlockedHint,
  InlineProbeStatus,
  ProbeErrorLine,
  SettingsInput,
} from "./ModelPrimitives";
import type { ModelDraftState, ProbeState } from "./types";
import { useModelConfigErrorToast } from "./use-model-config-toast";
import {
  editorBlockedFlashClass,
  ModelDraftBlockedContext,
} from "./use-provider-model-controller";

export function ModelDraftEditor({
  draft,
  title,
  protocol,
  authKind,
  saving,
  keyMissing,
  modelProbeState,
  allModelCount,
  onChange,
  onCancel,
  onTest,
  onSave,
}: {
  draft: ModelDraftState;
  title?: string;
  protocol: ManagedModelProtocol;
  authKind: ManagedModelAuthKind;
  saving: boolean;
  keyMissing: boolean;
  modelProbeState: ProbeState;
  allModelCount: number;
  onChange: (patch: Partial<ModelDraftState>) => void;
  onCancel: () => void;
  onTest: () => void;
  onSave: () => void;
}) {
  const appCopy = useCopy();
  const copy = appCopy.settings.models;
  const defaults = useManagedModelsStore((s) => s.defaults);
  const saveDefaults = useManagedModelsStore((s) => s.saveDefaults);
  const reportActionError = useModelConfigErrorToast();
  const blocked = useContext(ModelDraftBlockedContext);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // A blocked manual-add draft has no 我的模型 row to scroll back to
  // (an existing model's draft does — Settings scrolls that row), so it
  // brings itself into view.
  const rootRef = useRef<HTMLDivElement>(null);
  const isNewDraft = !draft.id;
  useEffect(() => {
    if (blocked.flash && isNewDraft) {
      rootRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [blocked.flash, isNewDraft]);
  const canTest =
    !keyMissing &&
    draft.model.trim() !== "" &&
    modelProbeState.kind !== "loading";
  const canSave = !keyMissing && draft.model.trim() !== "" && !saving;

  return (
    <div
      ref={rootRef}
      className={cn(
        "space-y-3 rounded-sm border border-line-strong/70 border-l-brand",
        "border-l-[3px] bg-elevated px-3 py-3",
        editorBlockedFlashClass(blocked.flash),
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-ui-compact font-medium text-ink">
            {draft.id ? copy.editModel : copy.manualAddModel}
          </div>
          {title && (
            <div className="mt-0.5 truncate text-ui-meta text-ink-muted">
              {title}
            </div>
          )}
          {!draft.id && allModelCount === 0 && (
            <div className="mt-0.5 text-ui-meta text-ink-muted">
              {copy.autoDefaultHint}
            </div>
          )}
          {blocked.hint && <EditorBlockedHint />}
        </div>
        <IconButton
          ariaLabel={copy.closeModelEditor}
          size="sm"
          onClick={onCancel}
        >
          <X size={12} weight="thin" />
        </IconButton>
      </div>
      <SettingsInput
        label={copy.modelName}
        value={draft.model}
        onChange={(model) => onChange({ model })}
        placeholder={copy.modelNamePlaceholder}
      />
      <SettingsInput
        label={copy.displayName}
        value={draft.displayName}
        onChange={(displayName) => onChange({ displayName })}
        placeholder={copy.displayNamePlaceholder}
      />
      <ModelAdvancedOptionsPanel
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        protocol={protocol}
        authKind={authKind}
        presetOptions={draft.presetOptions}
        defaults={defaults}
        overrides={draft.advancedOverrides}
        onChange={(advancedOverrides) => onChange({ advancedOverrides })}
        // 「设为所有模型的默认」 writes the DEFAULTS layer straight
        // through — defaults autosave like any settings page, and they
        // are global, not part of this draft. The model's own side of
        // the move (the promoted keys leaving its overrides) is just a
        // draft patch and still rides the editor's Save button.
        onPromoteToDefaults={(nextDefaults, nextOverrides) => {
          void saveDefaults(nextDefaults).catch((e: unknown) =>
            reportActionError(e, "set_managed_model_defaults"),
          );
          onChange({ advancedOverrides: nextOverrides });
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={!canTest}
          onClick={onTest}
          leadingIcon={
            modelProbeState.kind === "loading" &&
            modelProbeState.action === "model-test" ? (
              <span className="spin">
                <CircleNotch size={12} weight="thin" />
              </span>
            ) : (
              <PlugsConnected size={12} weight="thin" />
            )
          }
        >
          {copy.testModel}
        </Button>
        <InlineProbeStatus state={modelProbeState} action="model-test" />
        <Button
          variant="primary"
          size="sm"
          disabled={!canSave}
          onClick={onSave}
          leadingIcon={
            saving ? (
              <span className="spin">
                <CircleNotch size={12} weight="thin" />
              </span>
            ) : draft.id ? undefined : (
              // 「+」 only when this adds a model; saving an edit adds
              // nothing.
              <Plus size={12} weight="bold" />
            )
          }
        >
          {draft.id ? copy.saveModel : copy.enableModel}
        </Button>
      </div>
      <ProbeErrorLine state={modelProbeState} action="model-test" />
    </div>
  );
}
