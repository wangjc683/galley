import {
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { SettingsDisclosureCard } from "@/components/screens/settings/settings-disclosure";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useCopy } from "@/lib/i18n";
import {
  DEFAULTS_REASONING_TIERS,
  FACTORY_MODEL_DEFAULTS,
  defaultsCustomCount,
  effectiveAdvancedOptions,
  hasPromotableOverrides,
  modelLayerBaseline,
  overrideCount,
  promoteOverridesToDefaults,
  withDefaultsOption,
  withLayeredOverride,
} from "@/lib/managed-model-layers";
import { cn } from "@/lib/utils";
import type {
  ManagedModelAuthKind,
  ManagedModelProtocol,
} from "@/types/managed-models";

import { EditModelDefaultsContext } from "./edit-model-defaults-context";
import { InfoTooltip } from "./ModelPrimitives";

/** The five layered keys that render as ordinary fields (reasoning
 * effort has its own row set above them). */
const LAYERED_FIELD_KEYS = [
  "max_retries",
  "read_timeout",
  "max_retry_after",
  "trim_keep_prefix",
  "stream",
] as const;

/** Reasoning-effort row sentinels. Neither is a stored value: FOLLOW
 * means "no key in advancedOverrides", UNSET means the `null`
 * tombstone. */
const FOLLOW_ROW = "__follow__";
const UNSET_ROW = "__unset__";

type AdvancedChoiceOption<TValue extends string> = {
  value: TValue;
  label: string;
};

type SettingsModelsCopy = ReturnType<typeof useCopy>["settings"]["models"];

/**
 * Model-layer advanced configuration (the model editor's fold).
 *
 * Every control shows the EFFECTIVE value
 * (`presetOptions` ⊕ `defaults` ⊕ `advancedOverrides`); whether that
 * value is inherited or this model's own is carried by ink — a control
 * whose key is absent from the overrides renders one step lighter,
 * the same following / override grammar the composer effort pill uses.
 */
export function ModelAdvancedOptionsPanel({
  open,
  onOpenChange,
  protocol,
  authKind = "api_key",
  presetOptions,
  defaults,
  overrides,
  onChange,
  onPromoteToDefaults,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  protocol: ManagedModelProtocol;
  authKind?: ManagedModelAuthKind;
  presetOptions: Record<string, unknown>;
  defaults: Record<string, unknown>;
  overrides: Record<string, unknown>;
  onChange: (overrides: Record<string, unknown>) => void;
  onPromoteToDefaults: (
    defaults: Record<string, unknown>,
    overrides: Record<string, unknown>,
  ) => void;
}) {
  const copy = useCopy().settings.models;
  const editDefaults = useContext(EditModelDefaultsContext);
  const isCodexOauth = authKind === "chatgpt_codex_oauth";
  const baseline = modelLayerBaseline(presetOptions, defaults);
  const effective = effectiveAdvancedOptions(
    presetOptions,
    defaults,
    overrides,
  );
  const uiKeys = modelPanelKeys(protocol, isCodexOauth);
  const overridden = overrideCount(overrides, uiKeys);

  const setOption = (key: string, value: string | number | boolean | null) => {
    onChange(withLayeredOverride(overrides, baseline, key, value));
  };
  const followBaseline = (key: string) => {
    const next = { ...overrides };
    delete next[key];
    onChange(next);
  };
  const isOwn = (key: string) => key in overrides;

  const baselineTier =
    typeof baseline.reasoning_effort === "string"
      ? baseline.reasoning_effort
      : null;
  const reasoningRow = !isOwn("reasoning_effort")
    ? FOLLOW_ROW
    : overrides.reasoning_effort === null
      ? UNSET_ROW
      : String(overrides.reasoning_effort);
  const reasoningRows: AdvancedChoiceOption<string>[] = [
    { value: FOLLOW_ROW, label: copy.reasoningFollowDefaults(baselineTier) },
    ...(baselineTier
      ? [{ value: UNSET_ROW, label: copy.reasoningProviderDecides }]
      : []),
    ...reasoningTierOptions(copy, protocol, isCodexOauth),
  ];

  return (
    <OptionsFold
      open={open}
      onOpenChange={onOpenChange}
      surface="inset"
      title={copy.advancedConfig}
      rightText={
        overridden > 0 ? copy.overrideCount(overridden) : copy.followDefaults
      }
    >
      <AdvancedChoiceField
        label={copy.reasoningEffort}
        value={reasoningRow}
        options={reasoningRows}
        info={copy.reasoningEffortInfo}
        inherited={!isOwn("reasoning_effort")}
        onChange={(next) => {
          if (next === FOLLOW_ROW) {
            followBaseline("reasoning_effort");
          } else {
            setOption("reasoning_effort", next === UNSET_ROW ? null : next);
          }
        }}
      />

      <LayeredNumberGrid
        copy={copy}
        options={effective}
        isOwn={isOwn}
        onChange={setOption}
      />

      {!isCodexOauth && (
        <AdvancedSwitchRow
          label={copy.streamResponse}
          checked={booleanAdvancedOption(effective.stream, true)}
          inherited={!isOwn("stream")}
          onCheckedChange={(checked) => setOption("stream", checked)}
        />
      )}

      {protocol === "openai" ? (
        <AdvancedChoiceField
          label={copy.apiMode}
          value={apiModeOption(effective.api_mode)}
          options={[
            { value: "chat_completions", label: copy.apiModeChat },
            { value: "responses", label: copy.apiModeResponses },
          ]}
          inherited={!isOwn("api_mode")}
          onChange={(value) => setOption("api_mode", value)}
        />
      ) : (
        <>
          <AdvancedChoiceField
            label={copy.thinkingType}
            value={thinkingTypeOption(effective.thinking_type)}
            options={[
              { value: "adaptive", label: copy.thinkingAdaptive },
              { value: "disabled", label: copy.thinkingDisabled },
            ]}
            inherited={!isOwn("thinking_type")}
            onChange={(value) => setOption("thinking_type", value)}
          />
          <AdvancedSwitchRow
            label={copy.claudeCodePassthrough}
            checked={booleanAdvancedOption(
              effective.fake_cc_system_prompt,
              false,
            )}
            inherited={!isOwn("fake_cc_system_prompt")}
            onCheckedChange={(checked) =>
              setOption("fake_cc_system_prompt", checked)
            }
            info={copy.claudeCodePassthroughInfo}
          />
        </>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="px-0 text-ink-muted"
          disabled={Object.keys(overrides).length === 0}
          onClick={() => onChange({})}
        >
          {copy.followDefaultsAll}
        </Button>
        <span className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="px-0 text-ink-muted"
            disabled={!hasPromotableOverrides(overrides)}
            onClick={() => {
              const next = promoteOverridesToDefaults(overrides, defaults);
              onPromoteToDefaults(next.defaults, next.overrides);
            }}
          >
            {copy.promoteToDefaults}
          </Button>
          <InfoTooltip
            label={copy.promoteToDefaults}
            text={copy.promoteToDefaultsInfo}
          />
        </span>
        {editDefaults && (
          <Button
            variant="ghost"
            size="sm"
            className="px-0 text-ink-muted"
            onClick={editDefaults}
          >
            {copy.editDefaults}
          </Button>
        )}
      </div>
    </OptionsFold>
  );
}

/**
 * The global defaults layer (Settings → 模型 → 默认高级配置). No
 * effective-value ink split here: there is nothing below this layer
 * but the factory recommendation, and the header counter already says
 * how much of it the user moved.
 *
 * Saves on every interaction like the rest of a settings page — which
 * is why the number fields commit on blur / Enter rather than per
 * keystroke.
 */
export function ModelDefaultsPanel({
  defaults,
  onChange,
  open: openProp,
  onOpenChange,
}: {
  defaults: Record<string, unknown>;
  onChange: (defaults: Record<string, unknown>) => void;
  /** Controlled open state, so 「编辑默认配置」 in a model editor can
   * expand it; uncontrolled when omitted. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const copy = useCopy().settings.models;
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  const values = { ...FACTORY_MODEL_DEFAULTS, ...defaults };
  const customCount = defaultsCustomCount(defaults);
  const setOption = (key: string, value: string | number | boolean | null) => {
    onChange(withDefaultsOption(defaults, key, value));
  };

  return (
    <OptionsFold
      open={open}
      onOpenChange={setOpen}
      title={copy.defaultsCardTitle}
      rightText={
        customCount > 0
          ? copy.advancedConfigSetCount(customCount)
          : copy.advancedConfigUsingRecommended
      }
    >
      <AdvancedChoiceField
        label={copy.reasoningEffort}
        value={
          typeof values.reasoning_effort === "string"
            ? values.reasoning_effort
            : ""
        }
        options={[
          { value: "", label: copy.reasoningDefault },
          ...DEFAULTS_REASONING_TIERS.map((tier) => ({
            value: tier as string,
            label: reasoningTierLabel(copy, tier),
          })),
        ]}
        info={copy.reasoningEffortInfo}
        onChange={(value) => setOption("reasoning_effort", value || null)}
      />

      <LayeredNumberGrid copy={copy} options={values} onChange={setOption} />

      <AdvancedSwitchRow
        label={copy.streamResponse}
        checked={booleanAdvancedOption(values.stream, true)}
        onCheckedChange={(checked) => setOption("stream", checked)}
      />

      <Button
        variant="ghost"
        size="sm"
        className="px-0 text-ink-muted"
        disabled={customCount === 0}
        onClick={() => onChange({})}
      >
        {copy.restoreRecommended}
      </Button>
    </OptionsFold>
  );
}

/** The four layered number fields, shared by both panels. */
function LayeredNumberGrid({
  copy,
  options,
  isOwn,
  onChange,
}: {
  copy: SettingsModelsCopy;
  options: Record<string, unknown>;
  /** Model layer only: which keys this model overrides itself. */
  isOwn?: (key: string) => boolean;
  onChange: (key: string, value: number) => void;
}) {
  const inherited = (key: string) => (isOwn ? !isOwn(key) : false);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <AdvancedNumberField
        label={copy.maxRetries}
        value={numberAdvancedOption(options.max_retries, 3)}
        min={0}
        inherited={inherited("max_retries")}
        onChange={(value) => onChange("max_retries", value)}
      />
      <AdvancedNumberField
        label={copy.readTimeout}
        value={numberAdvancedOption(options.read_timeout, 180)}
        min={5}
        suffix={copy.secondsSuffix}
        inherited={inherited("read_timeout")}
        onChange={(value) => onChange("read_timeout", value)}
      />
      <AdvancedNumberField
        label={copy.maxRetryAfter}
        value={numberAdvancedOption(
          options.max_retry_after,
          FACTORY_MODEL_DEFAULTS.max_retry_after as number,
        )}
        min={0}
        suffix={copy.secondsSuffix}
        info={copy.maxRetryAfterInfo}
        inherited={inherited("max_retry_after")}
        onChange={(value) => onChange("max_retry_after", value)}
      />
      <AdvancedNumberField
        label={copy.trimKeepPrefix}
        value={numberAdvancedOption(options.trim_keep_prefix, 0)}
        min={0}
        suffix={copy.messagesSuffix}
        info={copy.trimKeepPrefixInfo}
        inherited={inherited("trim_keep_prefix")}
        onChange={(value) => onChange("trim_keep_prefix", value)}
      />
    </div>
  );
}

/**
 * The advanced-config fold, in both homes: the Models page's
 * 「默认高级配置」 section (`card`, on the Settings canvas) and the model
 * editor's 「高级配置」 (`inset`, nested in the already-raised editor —
 * same header and caret, no fill of its own; see SettingsDisclosureCard).
 */
function OptionsFold({
  open,
  onOpenChange,
  surface = "card",
  title,
  rightText,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  surface?: "card" | "inset";
  title: string;
  rightText: string;
  children: ReactNode;
}) {
  return (
    <SettingsDisclosureCard
      open={open}
      onToggle={() => onOpenChange(!open)}
      surface={surface}
      header={
        <>
          <span className="min-w-0 truncate text-ui-compact font-medium text-ink">
            {title}
          </span>
          <span className="ml-auto shrink-0 text-ui-tertiary tabular-nums text-ink-muted">
            {rightText}
          </span>
        </>
      }
      bodyClassName="space-y-3 px-3"
    >
      {children}
    </SettingsDisclosureCard>
  );
}

/**
 * Protocol-aware tier list. `max` is valid on BOTH protocols: the
 * engine's Claude mapping (managed-ga `llmcore.py`) sends
 * `low→low, medium→medium, high→high, xhigh→max, max→max` and only
 * warns-and-ignores `none` / `minimal` — so those two are the
 * OpenAI-only pair, not `max`. Codex OAuth backends have no `minimal`
 * (the engine coerces it to medium), so the row is dropped there.
 */
function reasoningTierOptions(
  copy: SettingsModelsCopy,
  protocol: ManagedModelProtocol,
  codexOauth: boolean,
): AdvancedChoiceOption<string>[] {
  if (protocol !== "openai") {
    return [
      { value: "low", label: copy.reasoningLow },
      { value: "medium", label: copy.reasoningMedium },
      { value: "high", label: copy.reasoningHigh },
      { value: "xhigh", label: copy.reasoningXHigh },
      { value: "max", label: copy.reasoningMax },
    ];
  }
  const options: AdvancedChoiceOption<string>[] = [
    { value: "none", label: copy.reasoningNone },
    { value: "low", label: copy.reasoningLow },
    { value: "medium", label: copy.reasoningMedium },
    { value: "high", label: copy.reasoningHigh },
    { value: "xhigh", label: copy.reasoningXHigh },
    { value: "max", label: copy.reasoningMax },
  ];
  if (!codexOauth) {
    options.splice(1, 0, { value: "minimal", label: copy.reasoningMinimal });
  }
  return options;
}

function reasoningTierLabel(copy: SettingsModelsCopy, tier: string): string {
  switch (tier) {
    case "low":
      return copy.reasoningLow;
    case "medium":
      return copy.reasoningMedium;
    case "high":
      return copy.reasoningHigh;
    case "xhigh":
      return copy.reasoningXHigh;
    default:
      return copy.reasoningMax;
  }
}

/** The keys the model panel actually renders — what its header counter
 * reports as overridden. */
function modelPanelKeys(
  protocol: ManagedModelProtocol,
  codexOauth: boolean,
): string[] {
  const layered = LAYERED_FIELD_KEYS.filter(
    (key) => !(key === "stream" && codexOauth),
  );
  return [
    "reasoning_effort",
    ...layered,
    ...(protocol === "openai"
      ? ["api_mode"]
      : ["thinking_type", "fake_cc_system_prompt"]),
  ];
}

function AdvancedNumberField({
  label,
  value,
  min,
  suffix,
  info,
  inherited = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  suffix?: string;
  info?: string;
  /** Model layer: the value comes from a lower layer — one ink step
   * lighter. */
  inherited?: boolean;
  /** Fires only on commit (blur / Enter / a press elsewhere), already
   * clamped to `min`, and only when the value actually changes. The
   * defaults panel saves on it; the model layer only updates its
   * editor draft. */
  onChange: (value: number) => void;
}) {
  // null = "showing the committed value"; a string = the user is
  // typing. Never synced from props in an effect — there is nothing to
  // sync, the draft simply wins while it exists. Both layers keep the
  // text local: clamping per keystroke turned a read-timeout backspace
  // to "1" into "5" (min 5), so retyping "60" gave "560", and an
  // emptied field snapped back before it could be retyped.
  const [draft, setDraft] = useState<string | null>(null);
  const fieldRef = useRef<HTMLLabelElement>(null);
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    // Empty or unparsable text just falls back to the current value.
    const next = Number.parseInt(draft, 10);
    if (!Number.isFinite(next)) return;
    const clamped = Math.max(min, next);
    if (clamped !== value) onChange(clamped);
  };
  // Galley's Buttons keep focus where it is on mouse press
  // (`preventMouseFocus`), so pressing 「保存模型」 or 「恢复推荐值」
  // right after typing never blurs this input — the save would read
  // the old value and the stale draft would land on a later blur.
  // While a draft exists, any press outside the field commits it
  // first, as the blur would have.
  const commitBeforeOutsidePress = useEffectEvent(commit);
  const typing = draft !== null;
  useEffect(() => {
    if (!typing) return;
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
  }, [typing]);
  return (
    <label ref={fieldRef} className="block">
      <span className="mb-1.5 flex items-center gap-1.5 text-ui-meta font-medium text-ink-soft">
        <span>{label}</span>
        {info && <InfoTooltip label={label} text={info} />}
      </span>
      <span className="relative block">
        <input
          type="number"
          min={min}
          value={draft ?? String(value)}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          className={cn(
            "w-full rounded-sm border border-line bg-surface px-3 py-2 font-mono text-ui-secondary outline-none transition-colors duration-(--motion-fast) ease-firm",
            "placeholder:text-ink-muted/70 focus:border-brand focus:ring-[3px] focus:ring-brand/20",
            inherited ? "text-ink-muted" : "text-ink",
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
  info,
  inherited = false,
}: {
  label: string;
  value: TValue;
  options: AdvancedChoiceOption<TValue>[];
  onChange: (value: TValue) => void;
  info?: string;
  inherited?: boolean;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-ui-meta font-medium text-ink-soft">
        <span>{label}</span>
        {info && <InfoTooltip label={label} text={info} />}
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
                "inline-flex min-h-7 items-center rounded-sm border px-2 text-ui-meta",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
                active
                  ? cn(
                      "border-line bg-elevated shadow-card",
                      inherited ? "text-ink-muted" : "text-ink",
                    )
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
  inherited = false,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  info?: string;
  /** Model layer: the value comes from a lower layer. A switch has no
   * value text to lighten, so its label takes the inherited ink —
   * the same `ink-muted` step as an inherited number or choice. */
  inherited?: boolean;
}) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3">
      <div
        className={cn(
          "flex min-w-0 items-center gap-1.5 text-ui-secondary",
          inherited ? "text-ink-muted" : "text-ink",
        )}
      >
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

function apiModeOption(value: unknown): "chat_completions" | "responses" {
  return value === "responses" ? "responses" : "chat_completions";
}

function thinkingTypeOption(value: unknown): "adaptive" | "disabled" {
  return value === "disabled" ? "disabled" : "adaptive";
}

function numberAdvancedOption(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function booleanAdvancedOption(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
