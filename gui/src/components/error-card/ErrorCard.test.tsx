import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { zhCopy } from "@/i18n/locales/zh";
import { makeAppError } from "@/types/app-error";

import { ErrorCard } from "./ErrorCard";

/**
 * The receipt of a user action with 撤销 (main chat ticket 38): the
 * compact info toast — its title, no body line, the 撤销 button and the
 * × — the undo toast of a deleted message.
 */

describe("an undo toast", () => {
  it("is the title, 撤销 and the ×", () => {
    const words = zhCopy.conversation.deleteMessage;
    const markup = renderToStaticMarkup(
      <Tooltip.Provider>
        <ErrorCard
          onDismiss={() => {}}
          error={makeAppError({
            category: "business",
            severity: "info",
            title: words.deleted,
            message: "",
            hint: null,
            retryable: false,
            context: "delete_main_chat_message",
            traceback: null,
            action: { kind: "undo", label: words.undo, run: () => {} },
          })}
        />
      </Tooltip.Provider>,
    );
    expect(markup).toContain(`>${words.deleted}<`);
    const buttons = [...markup.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map(
      ([, inner]) => inner.replace(/<[^>]+>/g, ""),
    );
    expect(buttons).toEqual(["", words.undo]);
    expect(markup).toContain(`aria-label="${zhCopy.common.close}"`);
    // No 复制详情 on a receipt.
    expect(markup).not.toContain(zhCopy.errors.copyDetails);
  });
});

/**
 * A runner error with a hint (2026-11-10 audit, A5): the hint's title
 * and line, 复制详情 and the ×; no Retry, whatever `retryable` says, and
 * no traceback on screen.
 */
describe("a hinted error toast", () => {
  it("is the hint's words, 复制详情 and the ×", () => {
    const markup = renderToStaticMarkup(
      <Tooltip.Provider>
        <ErrorCard
          onDismiss={() => {}}
          error={makeAppError({
            category: "runtime",
            severity: "error",
            message: "429 Too Many Requests",
            hint: "quota_exceeded",
            retryable: true,
            context: "user_message",
            traceback: "Traceback (most recent call last): boom",
          })}
        />
      </Tooltip.Provider>,
    );
    expect(markup).toContain(`>${zhCopy.errors.quota.title}<`);
    expect(markup).toContain(`>${zhCopy.errors.quota.brief}<`);
    const buttons = [...markup.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map(
      ([, inner]) => inner.replace(/<[^>]+>/g, ""),
    );
    expect(buttons).toEqual(["", zhCopy.errors.copyDetails]);
    expect(markup).not.toContain("Traceback");
    expect(markup).not.toContain("429");
  });
});
