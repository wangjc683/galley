import { ArrowClockwise, CircleNotch, Play } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";

import {
  SettingsDisclosureList,
  SettingsDisclosureRow,
} from "@/components/screens/settings/settings-disclosure";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import type { ChannelPrimaryAction } from "./channel-view";

/**
 * Small pieces shared by the four channel card bodies, so the set-up
 * view reads the same on every platform: status line → error block →
 * one primary action → a folded row for the form and steps.
 */

/** The card's status line. `indent` aligns it under a numbered step
 * list (the onboarding view); everywhere else it starts flush. */
export function ChannelStatusHint({
  indent = false,
  children,
}: {
  indent?: boolean;
  children: ReactNode;
}) {
  return (
    <p
      className={cn(
        "text-ui-meta leading-dense text-ink-muted",
        indent && "pl-7",
      )}
    >
      {children}
    </p>
  );
}

/** The set-up view's one primary action: resume a paused channel, retry
 * a failed one, or a disabled 处理中… while it connects. */
export function ChannelPrimaryButton({
  action,
  disabled,
  pending,
  onClick,
}: {
  action: ChannelPrimaryAction;
  disabled: boolean;
  /** This card's start call is in flight. */
  pending: boolean;
  onClick: () => void;
}) {
  const imCopy = useCopy().settings.im;
  const spinner = <CircleNotch size={13} weight="thin" className="spin" />;
  if (action === "working") {
    return (
      <div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled
          leadingIcon={spinner}
        >
          {imCopy.working}
        </Button>
      </div>
    );
  }
  const Icon = action === "resume" ? Play : ArrowClockwise;
  return (
    <div>
      <Button
        type="button"
        size="sm"
        variant="primary"
        disabled={disabled}
        leadingIcon={pending ? spinner : <Icon size={13} weight="thin" />}
        onClick={onClick}
      >
        {pending
          ? imCopy.working
          : action === "resume"
            ? imCopy.resumeReceiving
            : imCopy.retry}
      </Button>
    </div>
  );
}

/** One folded list row (caret on the right) holding what a set-up
 * channel rarely needs again: the credential form and the setup steps. */
export function ChannelFold({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <SettingsDisclosureList>
      <SettingsDisclosureRow
        title={title}
        open={open}
        onToggle={() => setOpen((value) => !value)}
      >
        <div className="space-y-4">{children}</div>
      </SettingsDisclosureRow>
    </SettingsDisclosureList>
  );
}

/** The owner-only note: one sentence, with the platform's "who else can
 * reach the bot" in the slot. Discord adds its two channel declarations
 * as children (they must stay visible in every state). */
export function ChannelSecurityNote({
  others,
  children,
}: {
  others: string;
  children?: ReactNode;
}) {
  const imCopy = useCopy().settings.im;
  return (
    <div className="space-y-1.5 text-ui-tertiary leading-notice text-ink-muted">
      <p>{imCopy.ownerSecurityNote(others)}</p>
      {children}
    </div>
  );
}
