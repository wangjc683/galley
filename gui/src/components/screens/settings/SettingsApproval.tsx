import * as Dialog from "@radix-ui/react-dialog";
import { Lightning, X } from "@phosphor-icons/react";
import { useState } from "react";

import {
  SettingsPanelHeader,
  SettingsSectionLabel,
} from "@/components/screens/settings/settings-ui";
import { Button, DialogActionRow, IconButton } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { IconTooltip } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
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
 * Two stacks:
 *
 *   1. Approval-required tools — checkbox list. Default V0.1 set is
 *      code_run / file_write / file_patch / start_long_term_update;
 *      user can prune. Toggling triggers onChangeRequiredTools with
 *      the new full list.
 *
 *   2. Always-allow rules — split per-project / global, each row
 *      shows tool name + remove button. Toggling fires the toast
 *      "已应用到所有 session" upstream so the user sees the
 *      side-effect (DESIGN.md §9 故意决策).
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

  const handleYoloToggle = (next: boolean) => {
    if (next) {
      // OFF → ON requires the activation modal (PRD §11.5).
      setActivationOpen(true);
    } else {
      // ON → OFF is harmless; no confirm.
      onChangeYoloMode(false);
    }
  };

  return (
    <div className="space-y-7">
      <SettingsPanelHeader
        title={copy.settings.tabs.approval.label}
        subtitle={approvalCopy.subtitle}
      />

      <YoloSection enabled={yoloMode} onToggle={handleYoloToggle} />

      <YoloActivationModal
        open={activationOpen}
        onOpenChange={setActivationOpen}
        onConfirm={() => {
          onChangeYoloMode(true);
          setActivationOpen(false);
        }}
      />

      {/* "Rules are disabled" announcement banner — kept OUTSIDE the
          dimmed container below so it stays at full opacity (it's a
          status banner, not part of the disabled content) and so the
          outer space-y-7 gives it normal 28px clearance from the
          disabled section. Previously it lived inside the opacity-50
          container with a -mb-2 negative margin and ended up
          overlapping the required-tools header. */}
      {yoloMode && (
        <div className="text-ui-meta italic text-ink-muted">
          {approvalCopy.yoloRulesPaused}
        </div>
      )}

      <div
        className={cn(
          "space-y-7",
          yoloMode && "pointer-events-none opacity-50",
        )}
        aria-disabled={yoloMode}
        title={yoloMode ? approvalCopy.yoloRulesTitle : undefined}
      >
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

// ---------------- YOLO mode ----------------

/**
 * Top-of-tab YOLO mode block (PRD §11.5 / DESIGN.md §9 Approval).
 *
 * Visually distinct from the lower per-tool settings:
 * - Lightning icon + apricot/warning hue calls attention
 * - Sits in its own bordered card so it isn't read as "another
 *   checkbox in the list"
 *
 * The actual confirm-on-activation modal is handled by
 * YoloActivationModal — keeping that out of this section means the
 * Switch's disabled-state logic doesn't have to wait for the modal
 * to mount.
 */
function YoloSection({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: (next: boolean) => void;
}) {
  const copy = useCopy().settings.approval;
  return (
    <div
      className={cn(
        "rounded-callout border bg-surface px-4 py-3.5",
        enabled ? "border-warning/30 bg-warning/[var(--opacity-subtle)]" : "border-line",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <Lightning
            size={18}
            weight="thin"
            className={cn(
              "mt-0.5 shrink-0",
              enabled ? "text-warning" : "text-ink-soft",
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-ink">
              <IconTooltip text={copy.yoloTooltip}>
                <span className="cursor-help underline decoration-line-strong decoration-dotted underline-offset-[3px]">
                  {copy.yoloMode}
                </span>
              </IconTooltip>
            </div>
            <div className="mt-1 text-ui-meta text-ink-muted">
              {copy.yoloDescription}
            </div>
          </div>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          ariaLabel={copy.toggleYolo}
          tone="warning"
        />
      </div>
      {enabled && (
        <div className="mt-3 flex items-center justify-between border-t border-warning/20 pt-3 text-ui-meta">
          <span className="text-warning">{copy.yoloEnabledTopbar}</span>
          <Button variant="ghost" size="sm" onClick={() => onToggle(false)}>
            {copy.turnOffNow}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Activation modal — shown when toggling YOLO from off to on
 * (PRD §11.5). Confirm button copy "是的，我知道在做什么"
 * deliberately not "确定" to prevent reflexive clicks.
 */
function YoloActivationModal({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const copy = useCopy();
  const approvalCopy = copy.settings.approval;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-overlay" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "fixed left-1/2 top-1/2 z-[60] w-[480px] max-w-[calc(100vw-32px)]",
            "-translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-elevated p-7 shadow-elevated",
          )}
        >
          <div className="flex items-center gap-2">
            <Lightning size={20} weight="thin" className="text-warning" />
            <Dialog.Title className="text-[18px] font-semibold text-ink">
              {approvalCopy.turnOnYoloTitle}
            </Dialog.Title>
          </div>

          <div className="mt-4 space-y-3 text-ui-compact text-ink-soft">
            <p>{approvalCopy.yoloModalIntro}</p>
            <ul className="space-y-1 pl-1 font-mono text-ui-secondary text-ink">
              <li>· {approvalCopy.filePatch}</li>
              <li>· {approvalCopy.fileWrite}</li>
              <li>· {approvalCopy.codeRun}</li>
              <li>· {approvalCopy.otherHighRisk}</li>
            </ul>
            <p>
              <span className="text-ink">{approvalCopy.goodFor}</span>
              {": "}
              {approvalCopy.goodForText}
            </p>
            <p>
              <span className="text-ink">{approvalCopy.notFor}</span>
              {": "}
              {approvalCopy.notForText}
            </p>
            <p className="text-ui-meta text-ink-muted">
              {approvalCopy.yoloIndicatorNote}
            </p>
          </div>

          <DialogActionRow className="mt-6">
            <Button
              variant="ghost"
              size="lg"
              onClick={() => onOpenChange(false)}
              autoFocus
            >
              {copy.common.cancel}
            </Button>
            <Button variant="warning" size="lg" onClick={onConfirm}>
              {approvalCopy.understandRisk}
            </Button>
          </DialogActionRow>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
