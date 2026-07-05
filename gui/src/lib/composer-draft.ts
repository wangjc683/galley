import type { PendingImageAttachment } from "@/types/conversation";

/**
 * In-memory parking lot for unsent Composer drafts, keyed by surface
 * (session id, or "empty-state" for the new-conversation composer).
 *
 * Why it exists: MainView keys the Composer on `activeSessionId`, so a
 * session switch unmounts the component and destroys its internal
 * draft state. Glancing at another session must not wipe a half-written
 * message — the Composer write-through-saves here on every change and
 * re-seeds from here on mount.
 *
 * Deliberately NOT persisted (drafts die with the app — same contract
 * as every chat client) and deliberately not a reactive store: nothing
 * renders from it; it's a mount-time read + change-time write.
 *
 * Ownership notes:
 * - `text` is stored fully expanded (paste-fold placeholders resolved).
 *   The fold registry lives and dies with the Composer instance; storing
 *   display text with orphaned placeholders would submit literal
 *   "[Pasted text #1 +50 lines]" markers after a restore. The fold
 *   cosmetics are lost on restore; the content is not.
 * - `images[].previewUrl` object URLs stay ALIVE while parked (the
 *   image hook skips its unmount revocation when a draft key is set).
 *   This module never revokes — revocation belongs to the Composer's
 *   remove / clear paths. A parked draft whose session never reopens
 *   holds its object URLs until app close; bounded by the per-draft
 *   attachment cap, accepted.
 */
export interface ComposerDraft {
  text: string;
  images: PendingImageAttachment[];
}

const drafts = new Map<string, ComposerDraft>();

/** Write-through save. An empty draft (no text, no images) deletes the
 * entry so the map only holds real drafts. */
export function saveComposerDraft(key: string, draft: ComposerDraft): void {
  if (draft.text.trim().length === 0 && draft.images.length === 0) {
    drafts.delete(key);
    return;
  }
  drafts.set(key, draft);
}

export function readComposerDraft(key: string): ComposerDraft | undefined {
  return drafts.get(key);
}

/**
 * Delete an entry without touching its object URLs. Called synchronously
 * on submit — the post-submit render's write-through would also clear
 * it, but the Composer can unmount before that render flushes (e.g. the
 * EmptyState → MainView switch right after the first send), which would
 * otherwise resurrect the just-sent text as a draft.
 */
export function dropComposerDraft(key: string): void {
  drafts.delete(key);
}
