import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge doesn't know our custom theme tokens, and its default
 * heuristic classifies any unrecognized `text-*` class as a text COLOR.
 * That made `cn("text-ui-micro", …, "text-success")` silently drop the
 * font-size class (both landed in the color group; later wins) — chrome
 * text then inherited the 16px browser default. Register the chrome
 * type-scale tokens (globals.css @theme) in their real groups so size
 * and color merge independently.
 *
 * Keep these lists in sync with the `--text-ui-*` / `--leading-*`
 * tokens in styles/globals.css.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "ui-compact",
            "ui-secondary",
            "ui-meta",
            "ui-tertiary",
            "ui-label",
            "ui-micro",
            "ui-kbd",
          ],
        },
      ],
      leading: [{ leading: ["code", "secondary", "notice", "dense"] }],
    },
  },
});

/**
 * Merge Tailwind class names safely (later classes win on conflicts).
 *
 * Re-exported from shadcn convention so component code can `import { cn }
 * from "@/lib/utils"`.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
