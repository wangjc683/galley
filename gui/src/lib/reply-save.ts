import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

/**
 * Save a reply's Markdown source to a file the user picks: the reply
 * bar's 保存 and the message menu's (main chat ticket 38), one action.
 * Default filename `galley-{timestamp}.md` — the product name, not "ga"
 * (GA is reserved for the engine per the naming rules; image saves
 * already used galley-). The timestamp keeps successive saves from
 * clobbering each other; the user can edit it in the dialog before
 * confirming. Resolves true once written, false when the dialog was
 * cancelled; rejects when writing failed.
 */
export async function saveReplyMarkdown(source: string): Promise<boolean> {
  const stamp = new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[-:T]/g, "")
    // YYYYMMDDhhmmss is hard to scan; insert one dash between date
    // and time so the default name reads cleanly.
    .replace(/^(\d{8})(\d{6})$/, "$1-$2");
  const path = await save({
    defaultPath: `galley-${stamp}.md`,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  // User cancelled: save() resolves to null.
  if (!path) return false;
  await writeTextFile(path, source);
  return true;
}
