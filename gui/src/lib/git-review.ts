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
export interface GitReviewResult {
  root: string;
  head: string | null;
  files: GitReviewFile[];
  patch: string | null;
  content: string | null;
  notice: string | null;
}
export type GitReviewRequest =
  | { action: "list"; path: string }
  | { action: "diff"; path: string; filePath: string; head: string | null };

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
  return messages.failed;
}
