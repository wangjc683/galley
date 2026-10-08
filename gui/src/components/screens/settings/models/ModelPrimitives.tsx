import { CheckCircle, Info, WarningCircle } from "@phosphor-icons/react";
import { useId, type KeyboardEvent, type ReactNode } from "react";

import {
  SettingsStatusBadge,
  SettingsTag,
} from "@/components/screens/settings/settings-badges";
import { TooltipLabel } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { useCopy } from "@/lib/i18n";
import { managedModelProtocolLabel } from "@/lib/managed-model-preset-copy";
import { cn } from "@/lib/utils";
import type { ManagedModelProtocol } from "@/types/managed-models";

import type { ProbeAction, ProbeState } from "./types";

export function SettingsInput({
  label,
  labelTrailing,
  value,
  onChange,
  placeholder,
  type = "text",
  trailing,
  reserveTrailing = false,
  onKeyDown,
}: {
  label: string;
  labelTrailing?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "password";
  trailing?: ReactNode;
  reserveTrailing?: boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}) {
  const inputId = useId();
  return (
    <div>
      {/* Field-tier label (same tier as SettingsFieldLabel): these
          inputs always render inside nested editors, where page-level
          uppercase eyebrows are off-limits. */}
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label
          htmlFor={inputId}
          className="block text-ui-meta font-medium text-ink-soft"
        >
          {label}
        </label>
        {labelTrailing}
      </div>
      <div className="relative">
        <input
          id={inputId}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          spellCheck={false}
          className={cn(
            "w-full rounded-sm border border-line bg-surface px-3 py-2 font-mono text-ui-secondary text-ink outline-none transition-colors duration-(--motion-fast) ease-firm placeholder:text-ink-muted/70 focus:border-brand focus:ring-[3px] focus:ring-brand/20",
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

/** The line a blocked editor shows: it refused to be replaced (another
 * editor was asked for) because it holds unsaved input. */
export function EditorBlockedHint() {
  const copy = useCopy().settings.models;
  return (
    <div className="mt-1 flex items-center gap-1 text-ui-meta text-warning">
      <WarningCircle size={12} weight="fill" className="shrink-0" />
      <span>{copy.editorBlockedHint}</span>
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
  authKind,
}: {
  status: "present" | "missing" | "unknown";
  authKind?: "api_key" | "chatgpt_codex_oauth" | "none";
}) {
  const copy = useCopy().settings.models;
  if (authKind === "none") {
    // No-auth endpoint: a neutral marker, not a warning — nothing is
    // missing, the provider was deliberately saved without a key.
    return <SettingsTag>{copy.noAuthBadge}</SettingsTag>;
  }
  if (status === "present") return null;
  // Codex signs in with ChatGPT — there is no key to be missing.
  const isCodex = authKind === "chatgpt_codex_oauth";
  return (
    <SettingsStatusBadge tone="warning" icon={WarningCircle}>
      {status === "unknown"
        ? isCodex
          ? copy.codexLoginStatusUnknownShort
          : copy.keyStatusUnknownShort
        : isCodex
          ? copy.codexLoginNeededShort
          : copy.keyNeedsResaveShort}
    </SettingsStatusBadge>
  );
}

export function ProtocolBadge({
  protocol,
  apiBase,
}: {
  protocol: ManagedModelProtocol;
  apiBase: string;
}) {
  const copy = useCopy().settings.models;
  const label = managedModelProtocolLabel(copy, protocol);
  return (
    <span
      className="shrink-0 text-ui-tertiary leading-4 text-ink-muted/55"
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
