import { useCopy } from "@/lib/i18n";
import type { ImSupervisorPlatform } from "@/lib/im-supervisor";
import { cn } from "@/lib/utils";

import { INLINE_CODE_CLASS } from "../inline-code";
import { channelCommands } from "./channel-view";

/**
 * The running channel's text-command table: one shared command set
 * (`channelCommands`), with the platform's own title and hint.
 */
export function ChannelCommandReference({
  platform,
}: {
  platform: ImSupervisorPlatform;
}) {
  const imCopy = useCopy().settings.im;
  const { title, hint } = {
    wechat: {
      title: imCopy.wechatTextCommandsTitle,
      hint: imCopy.wechatTextCommandsHint,
    },
    feishu: {
      title: imCopy.feishuTextCommandsTitle,
      hint: imCopy.feishuTextCommandsHint,
    },
    telegram: {
      title: imCopy.telegramTextCommandsTitle,
      hint: imCopy.telegramTextCommandsHint,
    },
    discord: {
      title: imCopy.discordTextCommandsTitle,
      hint: imCopy.discordTextCommandsHint,
    },
  }[platform];

  return (
    <div className="min-w-0 rounded-sm bg-hover/35 px-2.5 py-2">
      <div className="space-y-1">
        <h4 className="text-ui-meta font-semibold leading-dense text-ink">
          {title}
        </h4>
        <p className="text-ui-meta leading-dense text-ink-muted">{hint}</p>
      </div>
      <ul className="mt-2 grid min-w-0 gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {channelCommands(platform, imCopy).map((item) => (
          <li
            key={item.command}
            className="grid min-w-0 gap-1 sm:grid-cols-[max-content_minmax(0,1fr)] sm:items-baseline sm:gap-2"
          >
            <code
              className={cn(
                INLINE_CODE_CLASS,
                "w-fit max-w-full whitespace-nowrap leading-notice",
              )}
            >
              {item.command}
            </code>
            <span className="min-w-0 text-ui-meta leading-notice text-ink-muted">
              {item.description}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
