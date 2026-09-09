import { createContext } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppCopy } from "@/lib/i18n";

export interface GitReviewFile {
  path: string;
  status:
    | "added"
    | "modified"
    | "deleted"
    | "type_changed"
    | "conflicted"
    | "untracked";
}
export interface GitCommit {
  id: string;
  subject: string;
  author: string;
  /** ISO 8601 author date. */
  authoredAt: string;
}
export interface GitReviewResult {
  root: string;
  head: string | null;
  files: GitReviewFile[];
  patch: string | null;
  content: string | null;
  notice: string | null;
  /** Resolved full id of an explicitly chosen baseline; absent when the
   * comparison used HEAD. */
  base?: string;
  /** `log` only. */
  commits?: GitCommit[];
}
export type GitReviewRequest =
  | { action: "list"; path: string; base?: string }
  | {
      action: "diff";
      path: string;
      filePath: string;
      head: string | null;
      base?: string;
    }
  | { action: "log"; path: string };

export const GitReviewContext = createContext<{
  isOpen: boolean;
  toggle: (source: HTMLElement) => void;
} | null>(null);

export function reviewGit(request: GitReviewRequest): Promise<GitReviewResult> {
  return invoke("review_git", { request });
}

export function gitReviewError(error: unknown, copy: AppCopy): string {
  const reason = String(error);
  const messages = copy.gitReview;
  if (reason.includes("git_review_not_repository"))
    return messages.notRepository;
  if (reason.includes("git_review_unavailable")) return messages.unavailable;
  if (reason.includes("git_review_timeout")) return messages.timeout;
  if (reason.includes("git_review_too_large")) return messages.tooLarge;
  if (reason.includes("git_review_encoding")) return messages.encoding;
  if (reason.includes("git_review_changed")) return messages.changed;
  if (reason.includes("git_review_invalid_base")) return messages.invalidBase;
  return messages.failed;
}

/** Commit dates in the baseline picker: month, day and time in the
 * viewer's locale; unparseable input is shown as Git printed it. */
export function formatCommitDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
