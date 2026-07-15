import { CaretDown, CaretRight } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type {
  ManagedModelAuthKind,
  ManagedModelProtocol,
} from "@/types/managed-models";

import { InfoTooltip } from "./ModelPrimitives";

type AdvancedChoiceOption<TValue extends string> = {
  value: TValue;
  label: string;
};

export function AdvancedModelOptions({
  open,
  onOpenChange,
  protocol,
  authKind = "api_key",
  options,
  recommendedOptions,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  protocol: ManagedModelProtocol;
  authKind?: ManagedModelAuthKind;
  options: Record<string, unknown>;
  recommendedOptions: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}) {
  const copy = useCopy().settings.models;
  const effectiveOptions = { ...recommendedOptions, ...options };
  const customCount = advancedCustomCount(
    effectiveOptions,
    recommendedOptions,
    protocol,
    authKind,
  );

  const setOption = (key: string, value: string | number | boolean | null) => {
    const next = { ...effectiveOptions };
    if (value === null || value === "") {
      delete next[key];
    } else {
      next[key] = value;
    }
    onChange(next);
  };

  const maxRetries = numberAdvancedOption(
    effectiveOptions.max_retries,
    recommendedOptions.max_retries,
    3,
  );
  const readTimeout = numberAdvancedOption(
    effectiveOptions.read_timeout,
    recommendedOptions.read_timeout,
    180,
  );
  const stream = booleanAdvancedOption(
    effectiveOptions.stream,
    recommendedOptions.stream,
    true,
  );
  const rawApiMode = stringAdvancedOption(
    effectiveOptions.api_mode,
    recommendedOptions.api_mode,
    "chat_completions",
  );
  const apiMode: "chat_completions" | "responses" =
    rawApiMode === "responses" ? "responses" : "chat_completions";
  const trimKeepPrefix = numberAdvancedOption(
    effectiveOptions.trim_keep_prefix,
    recommendedOptions.trim_keep_prefix,
    0,
  );
  const openaiReasoning = stringAdvancedOption(
    effectiveOptions.reasoning_effort,
    null,
    "",
  ) as "" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  const isCodexOauth = authKind === "chatgpt_codex_oauth";
  const claudeReasoning = stringAdvancedOption(
    effectiveOptions.reasoning_effort,
    null,
    "",
  ) as "" | "low" | "medium" | "high" | "xhigh";
  const rawThinkingType = stringAdvancedOption(
    effectiveOptions.thinking_type,
    recommendedOptions.thinking_type,
    "adaptive",
  );
  const thinkingType: "adaptive" | "disabled" =
    rawThinkingType === "disabled" ? "disabled" : "adaptive";
  const claudeCodePassthrough = booleanAdvancedOption(
    effectiveOptions.fake_cc_system_prompt,
    recommendedOptions.fake_cc_system_prompt,
    false,
  );

  return (
    <div className="rounded-sm border border-line/70 bg-elevated/35">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-elevated/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/20"
      >
        <span className="flex min-w-0 items-center gap-2">
          {open ? (
            <CaretDown size={12} weight="bold" className="text-ink-muted" />
          ) : (
            <CaretRight size={12} weight="bold" className="text-ink-muted" />
          )}
          <span className="text-ui-secondary font-medium text-ink">
            {copy.advancedConfig}
          </span>
        </span>
        <span className="shrink-0 text-ui-tertiary text-ink-muted">
          {customCount > 0
            ? copy.advancedConfigSetCount(customCount)
            : copy.advancedConfigUsingRecommended}
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-line px-3 py-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <AdvancedNumberField
              label={copy.maxRetries}
              value={maxRetries}
              min={0}
              onChange={(value) => setOption("max_retries", value)}
            />
            <AdvancedNumberField
              label={copy.readTimeout}
              value={readTimeout}
              min={5}
              suffix={copy.secondsSuffix}
              onChange={(value) => setOption("read_timeout", value)}
            />
            <AdvancedNumberField
              label={copy.trimKeepPrefix}
              value={trimKeepPrefix}
              min={0}
              suffix={copy.messagesSuffix}
              info={copy.trimKeepPrefixInfo}
              onChange={(value) =>
                // 0 = GA's own default (keep nothing) — drop the key so the
                // generated model config stays minimal.
                setOption("trim_keep_prefix", value === 0 ? null : value)
              }
            />
          </div>

          {!isCodexOauth && (
            <AdvancedSwitchRow
              label={copy.streamResponse}
              checked={stream}
              onCheckedChange={(checked) => setOption("stream", checked)}
            />
          )}

          {protocol === "openai" ? (
            <>
              <AdvancedChoiceField
                label={copy.apiMode}
                value={apiMode}
                options={[
                  { value: "chat_completions", label: copy.apiModeChat },
                  { value: "responses", label: copy.apiModeResponses },
                ]}
                onChange={(value) => setOption("api_mode", value)}
              />
              <AdvancedChoiceField
                label={copy.reasoningEffort}
                value={isCodexOauth && openaiReasoning === "minimal" ? "medium" : openaiReasoning}
                options={openaiReasoningOptions(copy, isCodexOauth)}
                onChange={(value) =>
                  setOption("reasoning_effort", value || null)
                }
              />
            </>
          ) : (
            <>
              <AdvancedChoiceField
                label={copy.thinkingType}
                value={thinkingType}
                options={[
                  { value: "adaptive", label: copy.thinkingAdaptive },
                  { value: "disabled", label: copy.thinkingDisabled },
                ]}
                onChange={(value) => setOption("thinking_type", value)}
              />
              <AdvancedChoiceField
                label={copy.reasoningEffort}
                value={claudeReasoning}
                options={[
                  { value: "", label: copy.reasoningDefault },
                  { value: "low", label: copy.reasoningLow },
                  { value: "medium", label: copy.reasoningMedium },
                  { value: "high", label: copy.reasoningHigh },
                  { value: "xhigh", label: copy.reasoningXHigh },
                ]}
                onChange={(value) =>
                  setOption("reasoning_effort", value || null)
                }
              />
              <AdvancedSwitchRow
                label={copy.claudeCodePassthrough}
                checked={claudeCodePassthrough}
                onCheckedChange={(checked) =>
                  setOption("fake_cc_system_prompt", checked)
                }
                info={copy.claudeCodePassthroughInfo}
              />
            </>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="px-0 text-ink-muted"
            onClick={() => onChange(recommendedOptions)}
          >
            {copy.restoreRecommended}
          </Button>
        </div>
      )}
    </div>
  );
}

function openaiReasoningOptions(
  copy: ReturnType<typeof useCopy>["settings"]["models"],
  codexOauth: boolean,
): AdvancedChoiceOption<
  "" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
>[] {
  // "max" is OpenAI-protocol only: GA passes it through both api modes,
  // while the Claude path's output_config mapping warns and ignores it
  // (llmcore.py `_apply_claude_thinking`) — so the Claude branch below
  // intentionally stops at xhigh.
  const options: AdvancedChoiceOption<
    "" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
  >[] = [
    { value: "", label: copy.reasoningDefault },
    { value: "none", label: copy.reasoningNone },
    { value: "low", label: copy.reasoningLow },
    { value: "medium", label: copy.reasoningMedium },
    { value: "high", label: copy.reasoningHigh },
    { value: "xhigh", label: copy.reasoningXHigh },
    { value: "max", label: copy.reasoningMax },
  ];
  if (!codexOauth) {
    options.splice(2, 0, { value: "minimal", label: copy.reasoningMinimal });
  }
  return options;
}

function AdvancedNumberField({
  label,
  value,
  min,
  suffix,
  info,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  suffix?: string;
  info?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1.5 text-ui-meta font-medium text-ink-soft">
        <span>{label}</span>
        {info && <InfoTooltip label={label} text={info} />}
      </span>
      <span className="relative block">
        <input
          type="number"
          min={min}
          value={value}
          onChange={(event) => {
            const next = Number.parseInt(event.currentTarget.value, 10);
            if (Number.isFinite(next)) onChange(Math.max(min, next));
          }}
          className={cn(
            "w-full rounded-sm border border-line bg-surface px-3 py-2 font-mono text-ui-secondary text-ink outline-none transition-colors",
            "placeholder:text-ink-muted/70 focus:border-brand focus:ring-[3px] focus:ring-brand/20",
            suffix && "pr-12",
          )}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ui-tertiary text-ink-muted">
            {suffix}
          </span>
        )}
      </span>
    </label>
  );
}

function AdvancedChoiceField<TValue extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: TValue;
  options: AdvancedChoiceOption<TValue>[];
  onChange: (value: TValue) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 text-ui-meta font-medium text-ink-soft">
        {label}
      </div>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value || "default"}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={cn(
                "inline-flex min-h-7 items-center rounded-sm border px-2 text-ui-meta transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
                active
                  ? "border-line bg-elevated text-ink shadow-card"
                  : "border-transparent text-ink-muted hover:bg-hover hover:text-ink",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AdvancedSwitchRow({
  label,
  checked,
  onCheckedChange,
  info,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  info?: string;
}) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-1.5 text-ui-secondary text-ink">
        <span>{label}</span>
        {info && <InfoTooltip label={label} text={info} />}
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        ariaLabel={label}
        size="sm"
      />
    </div>
  );
}

function advancedCustomCount(
  options: Record<string, unknown>,
  recommended: Record<string, unknown>,
  protocol: ManagedModelProtocol,
  authKind?: ManagedModelAuthKind,
): number {
  const keys =
    protocol === "openai"
      ? [
          "max_retries",
          "read_timeout",
          "trim_keep_prefix",
          ...(authKind === "chatgpt_codex_oauth" ? [] : ["stream"]),
          "api_mode",
          "reasoning_effort",
        ]
      : [
          "max_retries",
          "read_timeout",
          "trim_keep_prefix",
          "stream",
          "thinking_type",
          "reasoning_effort",
          "fake_cc_system_prompt",
        ];
  return keys.filter((key) => {
    const current = options[key] ?? null;
    const baseline = recommended[key] ?? null;
    return current !== baseline;
  }).length;
}

function numberAdvancedOption(
  value: unknown,
  recommended: unknown,
  fallback: number,
): number {
  const raw = value ?? recommended;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function booleanAdvancedOption(
  value: unknown,
  recommended: unknown,
  fallback: boolean,
): boolean {
  const raw = value ?? recommended;
  return typeof raw === "boolean" ? raw : fallback;
}

function stringAdvancedOption(
  value: unknown,
  recommended: unknown,
  fallback: string,
): string {
  const raw = value ?? recommended;
  return typeof raw === "string" ? raw : fallback;
}
