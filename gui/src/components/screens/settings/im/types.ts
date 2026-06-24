import type { useCopy } from "@/lib/i18n";

export type ImCopy = ReturnType<typeof useCopy>["settings"]["im"];
export type FeishuSetupStep =
  ImCopy["feishuSetupSections"][number]["steps"][number];
export type FeishuSetupStepPart = FeishuSetupStep["parts"][number];
export type BusyAction = "connect" | "rescan" | "stop" | "disconnect" | "restart" | null;
