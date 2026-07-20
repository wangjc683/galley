import { X } from "@phosphor-icons/react";
import { useState } from "react";

import { AutoDefaultConfirmModal } from "@/components/screens/settings/AutoDefaultConfirmModal";
import {
  SettingsPanelHeader,
  SettingsSectionLabel,
} from "@/components/screens/settings/settings-ui";
import { IconButton } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useCopy } from "@/lib/i18n";
import type { ApprovalConfig } from "@/components/screens/settings/settings-types";

interface SettingsApprovalProps {
  config: ApprovalConfig;
  yoloMode: boolean;
  /** Total project count. Used to conditionally render the
   * "Per-project" section — hidden when user has no projects AND no
   * existing per-project rules (don't surface a feature that points
   * at nothing). When projects exist OR there are legacy rules, the
   * section shows so the user can manage / clean up. */
  projectCount?: number;
  onChangeYoloMode: (enabled: boolean) => void;
  onChangeRequiredTools?: (tools: string[]) => void;
  onRemoveAlwaysAllow?: (scope: "project" | "global", tool: string) => void;
}

/**
 * Settings → Approval tab. DESIGN.md §9 Approval tab.
 *
 * Three stacks:
 *
 *   1. Default mode for new sessions (自动执行 / 逐步审批) — a
 *      SegmentedControl over the legacy `yolo_mode` pref. Sessions
 *      without an explicit per-session override (the composer pill)
 *      follow this default; overridden sessions stay pinned.
 *      Switching the default TO 自动执行 requires the confirm modal.
 *
 *   2. Approval-required tools — checkbox list. Default V0.1 set is
 *      code_run / file_write / file_patch / start_long_term_update;
 *      user can prune. Toggling triggers onChangeRequiredTools with
 *      the new full list.
 *
 *   3. Always-allow rules — split per-project / global, each row
 *      shows tool name + remove button. These rules apply to any
 *      session running 逐步审批, so the section is always editable
 *      (no more dimming while the default is 自动执行).
 */
export function SettingsApproval({
  config,
  yoloMode,
  projectCount = 0,
  onChangeYoloMode,
  onChangeRequiredTools,
  onRemoveAlwaysAllow,
}: SettingsApprovalProps) {
  const copy = useCopy();
  const approvalCopy = copy.settings.approval;
  const showPerProject =
    projectCount > 0 || config.alwaysAllowProject.length > 0;
  const [activationOpen, setActivationOpen] = useState(false);
  const toggleRequired = (tool: string, checked: boolean) => {
    const next = checked
      ? [...new Set([...config.requiredTools, tool])]
      : config.requiredTools.filter((t) => t !== tool);
    onChangeRequiredTools?.(next);
  };

  const handleDefaultModeChange = (mode: "auto" | "approval") => {
    if (mode === "auto" && !yoloMode) {
      // approval → auto widens what runs unattended for every
      // non-overridden session: confirm first.
      setActivationOpen(true);
    } else if (mode === "approval" && yoloMode) {
      // auto → approval narrows; no confirm.
      onChangeYoloMode(false);
    }
  };

  return (
    <div className="space-y-7">
      <SettingsPanelHeader
        title={copy.settings.tabs.approval.label}
        subtitle={approvalCopy.subtitle}
      />

      <DefaultModeSection
        defaultAuto={yoloMode}
        onChangeMode={handleDefaultModeChange}
      />

      <AutoDefaultConfirmModal
        open={activationOpen}
        onOpenChange={setActivationOpen}
        onConfirm={() => {
          onChangeYoloMode(true);
          setActivationOpen(false);
        }}
      />

      <div className="space-y-7">
        <div className="text-ui-meta text-ink-muted">
          {approvalCopy.rulesScopeHint}
        </div>
        <div>
          <SettingsSectionLabel>
            {approvalCopy.requiredTools}
          </SettingsSectionLabel>
          <div className="mt-2 divide-y divide-line overflow-hidden rounded-sm border border-line bg-surface">
            {DEFAULT_TOOLS.map((tool) => {
              const required = config.requiredTools.includes(tool);
              return (
                <Checkbox
                  key={tool}
                  checked={required}
                  onCheckedChange={(c) => toggleRequired(tool, c)}
                  className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-hover"
                >
                  <span className="font-mono text-ui-secondary text-ink">
                    {tool}
                  </span>
                  <span className="text-ui-label text-ink-muted">
                    {
                      (approvalCopy.toolDescriptions as Record<string, string>)[
                        tool
                      ]
                    }
                  </span>
                </Checkbox>
              );
            })}
          </div>
        </div>

        {showPerProject && (
          <div>
            <SettingsSectionLabel>
              {approvalCopy.projectAllowlist(config.alwaysAllowProject.length)}
            </SettingsSectionLabel>
            <RuleList
              rules={config.alwaysAllowProject}
              onRemove={(tool) => onRemoveAlwaysAllow?.("project", tool)}
              empty={approvalCopy.noProjectRules}
            />
          </div>
        )}

        <div>
          <SettingsSectionLabel>
            {approvalCopy.globalAllowlist(config.alwaysAllowGlobal.length)}
          </SettingsSectionLabel>
          <RuleList
            rules={config.alwaysAllowGlobal}
            onRemove={(tool) => onRemoveAlwaysAllow?.("global", tool)}
            empty={approvalCopy.noGlobalRules}
          />
        </div>

        <div className="text-ui-meta text-ink-muted">
          {approvalCopy.allowlistHint}
        </div>
      </div>
    </div>
  );
}

// ---------------- default mode ----------------

/**
 * Top-of-tab default-mode block (DESIGN.md §9 Approval).
 *
 * The SegmentedControl edits the DEFAULT for new / non-overridden
 * sessions — per-session control lives on the composer pill, and
 * scope teaching is one description line here. Neutral chrome on
 * purpose: 自动执行 is the product default, not an alarm state.
 */
function DefaultModeSection({
  defaultAuto,
  onChangeMode,
}: {
  defaultAuto: boolean;
  onChangeMode: (mode: "auto" | "approval") => void;
}) {
  const copy = useCopy();
  const approvalCopy = copy.settings.approval;
  const modeCopy = copy.composer.approvalMode;
  return (
    <div className="rounded-callout border border-line bg-surface px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-ink">
            {approvalCopy.defaultModeTitle}
          </div>
          <div className="mt-1 text-ui-meta text-ink-muted">
            {approvalCopy.defaultModeDescription}
          </div>
        </div>
        <SegmentedControl
          value={defaultAuto ? "auto" : "approval"}
          onValueChange={onChangeMode}
          ariaLabel={approvalCopy.defaultModeTitle}
          options={[
            { value: "auto", label: modeCopy.autoName },
            { value: "approval", label: modeCopy.approvalName },
          ]}
        />
      </div>
    </div>
  );
}

// ---------------- internals ----------------

const DEFAULT_TOOLS = [
  "code_run",
  "file_write",
  "file_patch",
  "start_long_term_update",
];

function RuleList({
  rules,
  empty,
  onRemove,
}: {
  rules: string[];
  empty: string;
  onRemove: (tool: string) => void;
}) {
  const copy = useCopy().settings.approval;
  if (rules.length === 0) {
    return (
      <div className="mt-2 rounded-callout border border-dashed border-line px-3 py-3 text-ui-secondary italic text-ink-muted">
        {empty}
      </div>
    );
  }
  return (
    <div className="mt-2 divide-y divide-line overflow-hidden rounded-sm border border-line bg-surface">
      {rules.map((tool) => (
        <div
          key={tool}
          className="flex items-center justify-between px-3 py-2.5 text-ui-secondary"
        >
          <span className="font-mono text-ink">{tool}</span>
          <IconButton
            onClick={() => onRemove(tool)}
            ariaLabel={`${copy.removeRule}: ${tool}`}
            title={copy.removeRule}
            variant="danger"
            size="xs"
          >
            <X size={12} weight="thin" />
          </IconButton>
        </div>
      ))}
    </div>
  );
}
