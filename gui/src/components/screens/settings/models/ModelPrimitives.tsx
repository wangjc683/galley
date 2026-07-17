import {
  CheckCircle,
  Info,
  MagnifyingGlass,
  WarningCircle,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { TooltipLabel } from "@/components/ui/tooltip";
import { ScrollFade } from "@/components/ui/scroll-fade";
import { Skeleton } from "@/components/ui/skeleton";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { ManagedModelProtocol } from "@/types/managed-models";

import { protocolLabel } from "./model-settings-utils";
import type { ProbeAction, ProbeState } from "./types";

export function ModelSelectionList({
  title,
  value,
  options,
  filter,
  onFilterChange,
  onChange,
}: {
  title: string;
  value: string;
  options: string[];
  filter: string;
  onFilterChange: (value: string) => void;
  onChange: (value: string) => void;
}) {
  const copy = useCopy().settings.models;
  const normalizedFilter = filter.trim().toLowerCase();
  const selectedValue = value.trim();
  const filteredOptions = options.filter((option) =>
    option.toLowerCase().includes(normalizedFilter),
  );
  const visibleOptions = filteredOptions.slice(0, 80);

  return (
    <div className="space-y-2 border-t border-line pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-ui-secondary font-medium text-ink">{title}</div>
        <div className="relative w-full max-w-[260px]">
          <MagnifyingGlass
            size={12}
            weight="thin"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted"
          />
          <input
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            placeholder={copy.filterModels}
            spellCheck={false}
            className="w-full rounded-sm border border-line bg-surface py-1.5 pl-7 pr-2.5 text-ui-meta text-ink outline-none transition-colors placeholder:text-ink-muted/70 focus:border-brand focus:ring-[3px] focus:ring-brand/20"
          />
        </div>
      </div>
      <ScrollFade maxHeightClass="max-h-[220px]">
        <div className="divide-y divide-line">
          {visibleOptions.length === 0 && (
            <EmptyRow text={copy.noMatchingModels} />
          )}
          {visibleOptions.map((option) => {
            const selected = option === selectedValue;
            return (
              <button
                key={option}
                type="button"
                title={option}
                aria-pressed={selected}
                onClick={() => onChange(option)}
                className={cn(
                  "flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/20",
                  selected ? "bg-brand-soft text-ink" : "text-ink hover:bg-hover",
                )}
              >
                <span className="flex w-4 shrink-0 items-center justify-center">
                  {selected && (
                    <CheckCircle
                      size={12}
                      weight="fill"
                      className="text-brand-strong"
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-ui-meta">
                  {option}
                </span>
              </button>
            );
          })}
        </div>
      </ScrollFade>
      {filteredOptions.length > visibleOptions.length && (
        <div className="text-ui-tertiary text-ink-muted">
          {copy.visibleOptionsHint(visibleOptions.length)}
        </div>
      )}
    </div>
  );
}

export function SettingsInput({
  label,
  labelTrailing,
  value,
  onChange,
  placeholder,
  type = "text",
  trailing,
  reserveTrailing = false,
}: {
  label: string;
  labelTrailing?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "password";
  trailing?: ReactNode;
  reserveTrailing?: boolean;
}) {
  return (
    <div>
      {/* Field-tier label (same tier as SettingsFieldLabel): these
          inputs always render inside nested editors, where page-level
          uppercase eyebrows are off-limits. */}
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label className="block text-ui-meta font-medium text-ink-soft">
          {label}
        </label>
        {labelTrailing}
      </div>
      <div className="relative">
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          className={cn(
            "w-full rounded-sm border border-line bg-surface px-3 py-2 font-mono text-ui-secondary text-ink outline-none transition-colors placeholder:text-ink-muted/70 focus:border-brand focus:ring-[3px] focus:ring-brand/20",
            (trailing || reserveTrailing) && "pr-10",
          )}
        />
        {trailing && (
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
            {trailing}
          </div>
        )}
      </div>
    </div>
  );
}

export function InlineProbeStatus({
  state,
  action,
}: {
  state: ProbeState;
  action: ProbeAction;
}) {
  if (state.kind !== "success" || state.action !== action) return null;
  return (
    <span
      className="inline-flex min-h-7 max-w-[220px] shrink items-center gap-1 px-1 text-ui-tertiary leading-none text-success"
      title={state.message}
    >
      <CheckCircle size={11} weight="fill" className="shrink-0" />
      <span className="truncate">{state.message}</span>
    </span>
  );
}

export function ProbeErrorLine({
  state,
  action,
  className,
}: {
  state: ProbeState;
  action: ProbeAction;
  className?: string;
}) {
  if (state.kind !== "error" || state.action !== action) return null;
  return (
    <div className={cn("mt-2", className)}>
      <StatusLine state={state} />
    </div>
  );
}

function StatusLine({ state }: { state: ProbeState }) {
  if (state.kind !== "success" && state.kind !== "error") return null;
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-sm border px-3 py-2 text-ui-secondary",
        "select-text",
        state.kind === "success"
          ? "border-success/20 bg-success/[var(--opacity-subtle)] text-success"
          : "border-error/20 bg-error/[var(--opacity-subtle)] text-error",
      )}
    >
      {state.kind === "success" ? (
        <CheckCircle size={12} weight="fill" />
      ) : (
        <WarningCircle size={12} weight="fill" />
      )}
      {state.message}
    </div>
  );
}

export function ErrorLine({ message }: { message: string }) {
  return (
    <div className="select-text rounded-sm border border-error/20 bg-error/[var(--opacity-subtle)] px-3 py-2 text-ui-secondary text-error">
      {message}
    </div>
  );
}

export function InfoLine({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-1.5 rounded-sm border border-line bg-elevated/55 px-3 py-2 text-ui-secondary leading-dense text-ink-soft">
      <Info
        size={12}
        weight="bold"
        className="mt-0.5 shrink-0 text-ink-muted"
      />
      <span>{message}</span>
    </div>
  );
}

/**
 * Provider-list loading placeholder — two ghost rows in the shape the
 * ProviderCard headers will land in (§2.7: skeleton for content-shaped
 * loads, spinner only for action-busy states).
 */
export function LoadingRow() {
  return (
    <div aria-hidden className="flex flex-col gap-4 px-3 py-3.5">
      <div className="flex items-center gap-2.5">
        <Skeleton className="size-4" />
        <Skeleton className="h-3.5 w-36" />
        <Skeleton className="ml-auto h-3.5 w-14" />
      </div>
      <div className="flex items-center gap-2.5">
        <Skeleton className="size-4" />
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="ml-auto h-3.5 w-14" />
      </div>
    </div>
  );
}

export function EmptyRow({ text }: { text: string }) {
  return <div className="px-3 py-3 text-ui-secondary text-ink-muted">{text}</div>;
}

export function CredentialBadge({
  status,
}: {
  status: "present" | "missing" | "unknown";
}) {
  const copy = useCopy().settings.models;
  if (status === "present") return null;
  if (status === "unknown") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-warning/[var(--opacity-soft)] px-1.5 py-px text-ui-micro text-warning">
        <WarningCircle size={10} weight="fill" />
        {copy.keyStatusUnknownShort}
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-warning/[var(--opacity-soft)] px-1.5 py-px text-ui-micro text-warning">
      <WarningCircle size={10} weight="fill" />
      {copy.keyNeedsResaveShort}
    </span>
  );
}

export function ProtocolBadge({
  protocol,
  apiBase,
}: {
  protocol: ManagedModelProtocol;
  apiBase: string;
}) {
  const label = protocolLabel(protocol);
  return (
    <span
      className="shrink-0 text-ui-micro leading-4 text-ink-muted/55"
      title={`${label} · ${apiBase}`}
    >
      {label}
    </span>
  );
}

export function InfoTooltip({ label, text }: { label: string; text: string }) {
  return (
    <TooltipLabel
      text={text}
      align="start"
      contentClassName="max-w-[260px] p-2 leading-4"
    >
      <button
        type="button"
        aria-label={label}
        className="inline-flex size-5 items-center justify-center rounded-sm text-ink-muted hover:bg-hover hover:text-ink"
      >
        <Info size={11} weight="bold" />
      </button>
    </TooltipLabel>
  );
}
