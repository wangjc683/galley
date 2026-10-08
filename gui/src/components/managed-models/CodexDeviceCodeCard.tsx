import { Check, Copy } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { COPY_FEEDBACK_MS, copyTextToClipboard } from "@/lib/clipboard";
import { useLanguage, type AppCopy } from "@/lib/i18n";
import { isChineseLanguage } from "@/lib/language";
import { cn } from "@/lib/utils";

type ModelsCopy = AppCopy["settings"]["models"];

interface CodexDeviceCodeCardProps {
  userCode: string;
  copy: ModelsCopy;
  className?: string;
}

export function CodexDeviceCodeCard({
  userCode,
  copy,
  className,
}: CodexDeviceCodeCardProps) {
  const [copied, setCopied] = useState(false);
  // Uppercase + tracking is a Latin eyebrow treatment only, as in
  // SettingsSectionLabel (2026-10-07): on 「设备码」 it only spreads the
  // Han characters apart.
  const latinEyebrow = !isChineseLanguage(useLanguage());
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const onCopy = async () => {
    try {
      await copyTextToClipboard(userCode);
      setCopied(true);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(
        () => setCopied(false),
        COPY_FEEDBACK_MS,
      );
    } catch (error) {
      console.warn("[CodexDeviceCodeCard] copy failed", error);
    }
  };

  return (
    <div
      className={cn(
        "rounded-sm border border-brand/25 bg-brand-soft px-3 py-2.5",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div
            className={cn(
              "text-ui-label font-semibold text-ink-muted",
              latinEyebrow && "uppercase tracking-[0.08em]",
            )}
          >
            {copy.chatgptCodexDeviceCode}
          </div>
          <div
            aria-label={copy.chatgptCodexDeviceCode}
            className="select-text mt-1 break-all font-mono text-[20px] font-semibold tracking-[0.08em] text-ink"
          >
            {userCode}
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0"
          onClick={() => void onCopy()}
          leadingIcon={
            copied ? (
              <Check size={12} weight="bold" />
            ) : (
              <Copy size={12} weight="thin" />
            )
          }
        >
          {copied ? copy.deviceCodeCopied : copy.copyDeviceCode}
        </Button>
      </div>
    </div>
  );
}
