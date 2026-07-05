import feishuLogoMaskUrl from "@/assets/feishu-logo-mask.png";
import { cn } from "@/lib/utils";

export function WeChatGlyph({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-sm transition-colors",
        active ? "text-ink" : "text-ink-soft",
      )}
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none">
        <path
          fill="currentColor"
          d="M10.2 3.8c-4.6 0-8.3 2.9-8.3 6.4 0 2 1.2 3.7 3.1 4.9l-.6 3.1 3.3-1.6c.8.2 1.6.3 2.5.3 4.6 0 8.3-2.9 8.3-6.4s-3.7-6.7-8.3-6.7Z"
        />
        <path
          fill="currentColor"
          stroke="var(--color-surface)"
          strokeLinejoin="round"
          strokeWidth="1.35"
          d="M15 10.1c4 0 7.2 2.5 7.2 5.7 0 1.8-1 3.4-2.7 4.4l.5 2.4-2.7-1.3c-.7.2-1.5.3-2.3.3-4 0-7.2-2.6-7.2-5.8s3.2-5.7 7.2-5.7Z"
        />
        <circle cx="7.3" cy="9.1" r="1.05" className="fill-elevated" />
        <circle cx="12.2" cy="9.1" r="1.05" className="fill-elevated" />
        <circle cx="13.1" cy="15.5" r="0.9" className="fill-elevated" />
        <circle cx="17.4" cy="15.5" r="0.9" className="fill-elevated" />
      </svg>
    </span>
  );
}

export function TelegramGlyph({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-sm transition-colors",
        active ? "text-ink" : "text-ink-soft",
      )}
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none">
        <path
          fill="currentColor"
          d="M21.6 3.2c.9-.35 1.8.44 1.56 1.38l-3.1 14.6c-.2.94-1.3 1.36-2.08.8l-4.44-3.25-2.25 2.63c-.6.7-1.75.42-1.96-.48l-1.1-4.6-5-1.56c-.94-.3-.98-1.62-.06-1.98L21.6 3.2Z"
        />
        <path
          fill="var(--color-surface)"
          d="m9.4 14.1 8.2-7.5c.3-.27-.05-.44-.42-.22L7.1 12.6l2.3 1.5Z"
        />
      </svg>
    </span>
  );
}

export function FeishuGlyph({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-sm transition-colors",
        active ? "text-ink" : "text-ink-soft",
      )}
    >
      <span
        className="size-5 bg-current"
        style={{
          WebkitMaskImage: `url(${feishuLogoMaskUrl})`,
          WebkitMaskPosition: "center",
          WebkitMaskRepeat: "no-repeat",
          WebkitMaskSize: "contain",
          maskImage: `url(${feishuLogoMaskUrl})`,
          maskPosition: "center",
          maskRepeat: "no-repeat",
          maskSize: "contain",
        }}
      />
    </span>
  );
}
