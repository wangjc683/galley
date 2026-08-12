import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MarkdownView } from "@/components/conversation/MarkdownView";
import { mendStreamingMarkdown } from "@/lib/mend-streaming-markdown";

/**
 * End-to-end measure of the thing `mendStreamingMarkdown` exists to fix.
 *
 * A *retroactive change* is a frame whose rendered text is not a pure
 * extension of the previous frame's — i.e. characters already on screen were
 * rewritten, which is what forces an already-laid-out paragraph to re-wrap
 * behind the cursor. Ordinary growth (the next chunk appended) is not counted.
 *
 * This counts characters only, so it is a lower bound: it cannot see the
 * serif-to-mono switch when a code span closes, which widens the run beyond
 * the two backticks it removes.
 *
 * Baseline when this landed, at STEP 6 over the answer below:
 *
 *   unmended   16 events, 230 characters displaced (worst single event 75)
 *   mended      6 events,  20 characters displaced
 *
 * Events fall by 63% but displacement by 91% — the ones that survive are
 * emphasis, deliberately out of scope, and they are all small. That gap is
 * the point: what makes a reflow noticeable is how far the text moves, not
 * how often something changes.
 */

const TICK = "`";
const C = (s: string) => TICK + s + TICK;

const ANSWER = [
  `刚才那个问题的根因在 ${C("core/src/session/lifecycle.rs")} 里。`,
  ``,
  `**结论**：${C("dispatch_session_send")} 没有检查 ${C("agent_running")} 就直接透传，`,
  `所以 bridge 收到 mid-run 消息会立刻 ${C("run_in_progress.set()")}，把还没开跑的`,
  `排队消息**谎报为已开跑**。`,
  ``,
  `具体看这几个地方：`,
  ``,
  `- ${C("RunnerManager")} 的 per-session ${C("VecDeque")} —— 队列本体`,
  `- ${C("open_run")} 而不是 ${C("agent_running")} —— **出队门**，后者轮间有假空闲窗口`,
  `- ${C("turn_start")} 事件 —— 现在会无条件失效 ${C("pendingAskUser")}`,
  ``,
  `细节可以看 [IPC 协议文档](https://github.com/example/galley/blob/main/docs/ipc-protocol.md)，`,
  `里面 ${C("schemaVersion: 1")} 那一节写得比较清楚。`,
].join("\n");

/** One 20 Hz flush is worth roughly this many characters. */
const STEP = 6;

function renderedText(source: string): string {
  return (
    renderToStaticMarkup(<MarkdownView variant="agent" source={source} />)
      .replace(/<[^>]*>/g, " ")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      // Stripping tags injects a space at every element boundary, and a
      // growing tail keeps moving that boundary. Without collapsing, the
      // trailing space alone reads as a change on nearly every frame.
      .replace(/\s+/g, " ")
      .trim()
  );
}

function commonPrefixLength(a: string, b: string): number {
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) {
    index += 1;
  }
  return index;
}

function measure(transform: (source: string) => string) {
  let previous = "";
  let events = 0;
  let churn = 0;
  for (let cut = STEP; cut <= ANSWER.length; cut += STEP) {
    const current = renderedText(transform(ANSWER.slice(0, cut)));
    if (previous && !current.startsWith(previous)) {
      events += 1;
      churn += previous.length - commonPrefixLength(previous, current);
    }
    previous = current;
  }
  return { events, churn };
}

describe("streaming reflow", () => {
  const raw = measure((source) => source);
  const mended = measure(mendStreamingMarkdown);

  it("the unmended stream rewrites already-rendered text repeatedly", () => {
    expect(raw.events).toBeGreaterThanOrEqual(12);
  });

  it("mending removes most of the displacement", () => {
    expect(mended.events).toBeLessThan(raw.events);
    expect(mended.churn).toBeLessThanOrEqual(raw.churn * 0.25);
  });

  it("settles to exactly the raw source", () => {
    // The mend is display-only: once every marker has closed it must be the
    // identity, or the finished answer would differ from what the model sent.
    expect(mendStreamingMarkdown(ANSWER)).toBe(ANSWER);
  });
});
