import { createContext } from "react";

/**
 * Opens and scrolls to the page-level 默认高级配置 card. Provided by
 * Settings → 模型 so the model editor's fold can offer a way to the
 * layer its 「跟随默认」 refers to (09-22's header link, landed as a
 * footer action: the fold header is itself a button). Absent elsewhere,
 * and the action hides with it.
 */
export const EditModelDefaultsContext = createContext<(() => void) | null>(
  null,
);
