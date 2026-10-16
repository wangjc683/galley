import type { AgentTurn, Turn, UserTurn } from "@/types/conversation";

/**
 * TEMP variant switcher (telegram-details 05) — 「演示连发」: a short
 * main chat with two bursts of yours (three messages, then two, the
 * second of them two lines) and a message alone, shown in place of the
 * main chat's own conversation while the pill's demo is on. Display
 * only: nothing is written, sent or asked of the model.
 *
 * No burst of its own in the demo: by the grouping rule a reply ends its
 * group (its action row is the gap under it), so two of its bubbles sit
 * 4px apart only when a question it asked is followed by another of its
 * rows with no answer of yours in between, which a conversation does not
 * produce.
 */

const at = (hhmm: string) => `2026-10-16T${hhmm}:00+08:00`;

function user(id: string, content: string, time: string): UserTurn {
  return {
    role: "user",
    content,
    createdAt: at(time),
    messageId: `td-demo-${id}`,
  };
}

function reply(id: string, text: string): AgentTurn {
  return {
    role: "agent",
    finalAnswer: text,
    tools: [],
    messageId: `td-demo-${id}`,
  };
}

export const TD_DEMO_TURNS: Turn[] = [
  user("u1", "明天厦门天气怎么样？", "09:12"),
  reply(
    "a1",
    "明天多云转晴，23 到 30℃，东南风 3 级，下午湿度高一些，出门不用带伞。",
  ),
  user("u2", "对了", "09:20"),
  user("u3", "周六想去鼓浪屿，帮我看看上午的船票还有没有", "09:20"),
  user("u4", "两个人", "09:21"),
  reply(
    "a2",
    "周六上午厦鼓码头 8:30、9:00、9:30 三班都还有票，两个人坐 8:30 那班最从容，中午前能逛完菽庄花园。要我先锁 8:30 的两张吗？",
  ),
  user("u5", "先不订", "09:24"),
  user("u6", "等我问一下她几点能出门\n晚上再跟你说", "09:24"),
  reply("a3", "好，晚上你说一声我就订。"),
  user("u7", "谢谢", "09:25"),
  reply("a4", "不客气。"),
];
