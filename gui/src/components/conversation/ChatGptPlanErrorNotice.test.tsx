import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LocalFilesContext } from "@/lib/local-files";

import { MessageAgent } from "./MessageAgent";

/**
 * A ChatGPT plan error the engine ended a turn with (SIWC ticket 04, PRD
 * ruling 7) reads as Galley's notice with its action, not as the
 * engine's English prose; an unrelated error stays the reply it was.
 */

function html(node: ReactNode): string {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <LocalFilesContext.Provider value={() => undefined}>
        {node}
      </LocalFilesContext.Provider>
    </Tooltip.Provider>,
  );
}

describe("a ChatGPT plan error in the conversation", () => {
  it("shows the usage limit in Galley's words with Manage usage", () => {
    const out = html(
      <MessageAgent messageId="msg_s_3_assistant">
        {
          "!!!Error: HTTP 429: ChatGPT plan usage limit reached (subscription_sharing_usage_limit_exceeded): this is your plan's limit or the limit you set for Galley; manage usage at https://chatgpt.com/settings/usage"
        }
      </MessageAgent>,
    );
    expect(out).toContain('data-role="chatgpt-plan-error"');
    expect(out).toContain("已达到用量上限");
    expect(out).toContain("检查你的 ChatGPT 订阅，或你给 Galley 设的上限。");
    expect(out).toContain("管理用量");
    // The engine text is behind 「原始输出」, folded.
    expect(out).toContain("原始输出");
    expect(out).not.toContain("subscription_sharing_usage_limit_exceeded");
  });

  it("offers signing in again from Settings when the sign-in was revoked", () => {
    const out = html(
      <MessageAgent>
        {
          "!!!Error: HTTP 401: ChatGPT sign-in was revoked or disconnected (token_revoked); sign in again in Settings → Models"
        }
      </MessageAgent>,
    );
    expect(out).toContain("ChatGPT 登录已失效，需要重新登录。");
    expect(out).toContain("去设置登录");
  });

  it("leaves another plan code, and an unrelated error, as the reply's text", () => {
    for (const text of [
      "!!!Error: ChatGPT plan temporarily unavailable (subscription_sharing_usage_unavailable)",
      "!!!Error: HTTP 401: invalid api key",
    ]) {
      const out = html(<MessageAgent>{text}</MessageAgent>);
      expect(out, text).not.toContain('data-role="chatgpt-plan-error"');
      expect(out, text).toContain(text.slice("!!!Error: ".length, 40));
    }
  });
});
