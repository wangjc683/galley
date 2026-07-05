import { CircleNotch, PlugsConnected, Plus, X } from "@phosphor-icons/react";
import { useState } from "react";

import { Button, IconButton } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type {
  ManagedModelAuthKind,
  ManagedModelProtocol,
} from "@/types/managed-models";

import { AdvancedModelOptions } from "./AdvancedModelOptions";
import {
  InlineProbeStatus,
  ProbeErrorLine,
  SettingsInput,
} from "./ModelPrimitives";
import type { ModelDraftState, ProbeState } from "./types";

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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const canTest =
    !keyMissing &&
    draft.model.trim() !== "" &&
    modelProbeState.kind !== "loading";
  const canSave = !keyMissing && draft.model.trim() !== "" && !saving;

  return (
    <div
      className={cn(
        "space-y-3 rounded-sm border border-line-strong/70 border-l-brand",
        "border-l-[3px] bg-elevated px-3 py-3",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-ui-secondary font-medium text-ink">
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
      <AdvancedModelOptions
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        protocol={protocol}
        authKind={authKind}
        options={draft.advancedOptions}
        recommendedOptions={draft.recommendedAdvancedOptions}
        onChange={(advancedOptions) => onChange({ advancedOptions })}
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
            ) : (
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
