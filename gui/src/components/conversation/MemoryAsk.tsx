import { CircleNotch, Notebook } from "@phosphor-icons/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import { memoryErrorText, type SetLedgerSwitchArgs } from "@/lib/memory";
import { useMemoryStore } from "@/stores/memory";
import { useUiStore } from "@/stores/ui";
import { makeAppError } from "@/types/app-error";

type AnswerKey = "from-now" | "look-back" | "decline";

const ANSWERS: Record<AnswerKey, SetLedgerSwitchArgs> = {
  "from-now": { action: "enable", lookBack: false },
  "look-back": { action: "enable", lookBack: true },
  // 先不要 = off without clearing; the switch leaves `undecided`, so
  // the main chat never asks again.
  decline: { action: "disable", clear: false },
};

/**
 * Answering the ask: one Core call (`set_ledger_switch`), then the ask
 * goes away by itself — the switch is no longer `undecided`. In demo
 * mode (TEMPORARY, ticket 04b trial) an answer only hides it until the
 * view remounts; nothing reaches Core.
 */
function useMemoryAskAnswer(demo: boolean) {
  const copy = useCopy().memory;
  const setSwitch = useMemoryStore((s) => s.setSwitch);
  const [busy, setBusy] = useState<AnswerKey | null>(null);
  const [demoAnswered, setDemoAnswered] = useState(false);
  const answer = async (key: AnswerKey) => {
    if (demo) {
      setDemoAnswered(true);
      return;
    }
    setBusy(key);
    try {
      await setSwitch(ANSWERS[key]);
    } catch (e) {
      useUiStore.getState().pushToast(
        makeAppError({
          category: "business",
          severity: "error",
          title: copy.askFailed,
          message: memoryErrorText(e),
          hint: null,
          retryable: false,
          context: "set_ledger_switch",
          traceback: null,
        }),
      );
    } finally {
      setBusy(null);
    }
  };
  return { busy, answer, hidden: demo && demoAnswered };
}

/** The three answers, in reading order. Equal weight: this is the
 * user's call, so neither "yes" is dressed up over 「先不要」. */
function AnswerButtons({
  busy,
  onAnswer,
}: {
  busy: AnswerKey | null;
  onAnswer: (key: AnswerKey) => void;
}) {
  const copy = useCopy().memory;
  const spinner = (key: AnswerKey) =>
    busy === key ? (
      <CircleNotch size={13} weight="thin" className="spin" />
    ) : undefined;
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={busy !== null}
        leadingIcon={spinner("from-now")}
        onClick={() => onAnswer("from-now")}
      >
        {copy.askFromNow}
      </Button>
      <TooltipLabel text={copy.askLookBackTooltip}>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy !== null}
          leadingIcon={spinner("look-back")}
          onClick={() => onAnswer("look-back")}
        >
          {copy.askLookBack}
        </Button>
      </TooltipLabel>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={busy !== null}
        leadingIcon={spinner("decline")}
        onClick={() => onAnswer("decline")}
      >
        {copy.askDecline}
      </Button>
    </>
  );
}

/**
 * Form A (ticket 04b trial): the main chat's one-time memory ask as a
 * strip above the Composer — the quietest form, in the busy choice's
 * slot and skin (MainChatBusyChoice). The text says what is read, who
 * else sees it, where it stays and where to turn it off; it never
 * enters the model's context.
 */
export function MemoryAskStrip({ demo = false }: { demo?: boolean }) {
  const copy = useCopy().memory;
  const { busy, answer, hidden } = useMemoryAskAnswer(demo);
  if (hidden) return null;
  return (
    <div
      role="group"
      aria-label={copy.askTitle}
      data-role="memory-ask"
      className="mb-1.5 flex items-center gap-3 rounded-md border border-line bg-surface py-2 pl-3 pr-2"
    >
      <p className="m-0 min-w-0 flex-1 text-ui-meta leading-dense text-ink-muted">
        <span className="font-medium text-ink-soft">{copy.askTitle}</span>{" "}
        {copy.askBody}
      </p>
      <div className="flex shrink-0 items-center gap-1.5">
        <AnswerButtons busy={busy} onAnswer={(key) => void answer(key)} />
      </div>
    </div>
  );
}

/**
 * Form B (ticket 04b trial): the same ask as a card at the end of the
 * timeline, after the last reply — ruling 10's card form, on the card
 * family's skeleton (onboarding-and-cards.md §6: elevated surface, 1px
 * border, shadow-card, 12px radius, 16px padding, a 16px thin icon on
 * the left). Not a message: it never enters the model's context.
 */
export function MemoryAskCard({ demo = false }: { demo?: boolean }) {
  const copy = useCopy().memory;
  const { busy, answer, hidden } = useMemoryAskAnswer(demo);
  if (hidden) return null;
  return (
    <div
      role="group"
      aria-label={copy.askTitle}
      data-role="memory-ask"
      className="my-6 rounded-md border border-line bg-elevated p-4 shadow-card"
    >
      <div className="flex items-start gap-3">
        <Notebook
          size={16}
          weight="thin"
          className="mt-0.5 shrink-0 text-ink-soft"
        />
        <div className="min-w-0 flex-1">
          <div className="text-ui-compact font-medium text-ink">
            {copy.askTitle}
          </div>
          <p className="m-0 mt-1 text-ui-secondary leading-secondary text-ink-soft">
            {copy.askBody}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <AnswerButtons busy={busy} onAnswer={(key) => void answer(key)} />
          </div>
        </div>
      </div>
    </div>
  );
}
