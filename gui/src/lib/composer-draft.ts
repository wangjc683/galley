import type { PendingImageAttachment } from "@/types/conversation";

/**
 * Parking lot for unsent Composer drafts, keyed by surface (session id,
 * or "empty-state" for the new-conversation composer).
 *
 * Why it exists: MainView keys the Composer on `activeSessionId`, so a
 * session switch unmounts the component and destroys its internal
 * draft state. Glancing at another session must not wipe a half-written
 * message — the Composer write-through-saves here on every change and
 * re-seeds from here on mount.
 *
 * Persisted, text and quotes, not images (telegram-details ticket 01,
 * 2026-10-16; quotes since ticket 07). The
 * old contract here was "drafts die with the app — same contract as
 * every chat client"; Telegram is the counterexample (a draft per chat,
 * saved after typing pauses, deleted the moment it empties, always
 * saved on switch / blur / close). So every save also writes the
 * draft's text to localStorage, one key per draft (`galley.draft.<key>`),
 * and the module reads them back into memory when it first loads. A
 * draft is a UI convenience, not business data: it never goes to SQLite
 * or through Core (Rule 5), and stays on this machine.
 * - Written on every change, synchronously, only the key that changed
 *   (skipped when its text is what is already stored). No debounce: a
 *   Tauri window close need not fire `beforeunload` / `pagehide`, so the
 *   last keystroke before quitting has to be on disk already.
 * - Images are NOT persisted: their preview object URLs die with the
 *   app, and one base64 image can fill WebKit's ~5MB localStorage
 *   quota. A draft restored after a restart is its text alone; an
 *   image-only draft does not survive one.
 * - Quotes (ticket 07) are persisted with the text. A draft without
 *   quotes is stored as its bare text, as before; one with quotes as
 *   JSON, `{"galleyDraft":2,"text":…,"quotes":[…]}`. Reading takes
 *   either, so drafts stored before quotes existed still come back.
 * - Emptying, sending (`dropComposerDraft`) and deleting the session
 *   (`forgetDeletedSessions` in stores/sessions/shared.ts) remove the
 *   stored key at once.
 * - Any storage failure (quota, a WebView with storage disabled) falls
 *   back to memory only, silently — the stored copy of that key is
 *   removed so a stale older text cannot come back after a restart.
 *
 * Deliberately not a reactive store: the Composer only reads it at
 * mount and writes it on change. One reader renders from it: the
 * sidebar's assistant card says 「草稿：…」 while the main chat is not
 * open (main chat ticket 18), so writes notify `subscribeComposerDrafts`
 * listeners — nothing else changes. Drafts read back from storage are
 * in memory before anything can subscribe, so a restart shows the card's
 * 「草稿：…」 from the first render.
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
  /** Quoted selections waiting above the input (ticket 07), each the
   * selected text as it was; none when absent. */
  quotes?: string[];
}

const drafts = new Map<string, ComposerDraft>();

/** localStorage key prefix; the rest of the key is the draft key. */
export const DRAFT_STORAGE_PREFIX = "galley.draft.";

/** The value each key has on disk, so an unchanged draft is not
 * rewritten (an image added or removed re-saves the same text). */
const stored = new Map<string, string>();

/** The marker of the stored form with quotes. */
const QUOTED_DRAFT_VERSION = 2;

/** What a draft is stored as: its bare text, or with quotes, JSON.
 * Null when there is nothing to keep across a restart. */
function storedValue(draft: ComposerDraft): string | null {
  const quotes = draft.quotes ?? [];
  if (quotes.length === 0) {
    return draft.text.trim().length === 0 ? null : draft.text;
  }
  return JSON.stringify({
    galleyDraft: QUOTED_DRAFT_VERSION,
    text: draft.text,
    quotes,
  });
}

/** A stored value read back: JSON with quotes, or bare text (every
 * draft stored before ticket 07, and every one without quotes). */
function draftFromStored(value: string): ComposerDraft | null {
  if (value.startsWith(`{"galleyDraft":${QUOTED_DRAFT_VERSION}`)) {
    try {
      const parsed = JSON.parse(value) as {
        text?: unknown;
        quotes?: unknown;
      };
      const quotes = Array.isArray(parsed.quotes)
        ? parsed.quotes.filter(
            (quote): quote is string =>
              typeof quote === "string" && quote.trim() !== "",
          )
        : [];
      const text = typeof parsed.text === "string" ? parsed.text : "";
      if (quotes.length > 0) return { text, images: [], quotes };
      return text.trim() === "" ? null : { text, images: [] };
    } catch {
      // Not ours after all: bare text that happens to look like it.
    }
  }
  return value.trim().length === 0 ? null : { text: value, images: [] };
}

function draftStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    // Reading the property itself throws where storage is disabled.
    return null;
  }
}

function removeStoredText(key: string): void {
  stored.delete(key);
  try {
    draftStorage()?.removeItem(DRAFT_STORAGE_PREFIX + key);
  } catch {
    // Memory only from here.
  }
}

/** Remove the key's stored text, if this page stored one. */
function forgetStoredText(key: string): void {
  if (stored.has(key)) removeStoredText(key);
}

function storeDraft(key: string, draft: ComposerDraft): void {
  const value = storedValue(draft);
  if (value === null) {
    // An image-only draft has nothing to keep across a restart.
    forgetStoredText(key);
    return;
  }
  if (stored.get(key) === value) return;
  const storage = draftStorage();
  if (!storage) return;
  try {
    storage.setItem(DRAFT_STORAGE_PREFIX + key, value);
    stored.set(key, value);
  } catch {
    // Quota or a disabled store: keep the draft in memory only, and
    // don't leave an older text on disk to come back after a restart.
    removeStoredText(key);
  }
}

/** Read the stored drafts back into memory: once, when the module
 * loads (an app start). */
function loadStoredDrafts(): void {
  const storage = draftStorage();
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const name = storage.key(i);
      if (name?.startsWith(DRAFT_STORAGE_PREFIX)) keys.push(name);
    }
    for (const name of keys) {
      const value = storage.getItem(name);
      const key = name.slice(DRAFT_STORAGE_PREFIX.length);
      if (key === "" || value === null) continue;
      const draft = draftFromStored(value);
      if (!draft) {
        storage.removeItem(name);
        continue;
      }
      drafts.set(key, draft);
      stored.set(key, value);
    }
  } catch {
    // Whatever was read stays; the rest is memory only.
  }
}

loadStoredDrafts();

const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) listener();
}

/**
 * Hear about every save and drop, in the `useSyncExternalStore`
 * contract: returns the unsubscribe. A listener re-reads the key it
 * cares about with `readComposerDraft`; an entry keeps its identity
 * until its own key is written again, so a snapshot of one key stays
 * equal while other keys change.
 */
export function subscribeComposerDrafts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Write-through save, in memory and (text and quotes) on disk. An
 * empty draft (no text, no images, no quotes) deletes the entry so the
 * map only holds real drafts. */
export function saveComposerDraft(key: string, draft: ComposerDraft): void {
  if (
    draft.text.trim().length === 0 &&
    draft.images.length === 0 &&
    (draft.quotes?.length ?? 0) === 0
  ) {
    forgetStoredText(key);
    if (drafts.delete(key)) notifyListeners();
    return;
  }
  drafts.set(key, draft);
  storeDraft(key, draft);
  notifyListeners();
}

export function readComposerDraft(key: string): ComposerDraft | undefined {
  return drafts.get(key);
}

/**
 * Delete an entry (and its stored text) without touching its object
 * URLs. Called synchronously on submit — the post-submit render's
 * write-through would also clear it, but the Composer can unmount
 * before that render flushes (e.g. the EmptyState → MainView switch
 * right after the first send), which would otherwise resurrect the
 * just-sent text as a draft. Also called for every deleted session.
 */
export function dropComposerDraft(key: string): void {
  forgetStoredText(key);
  if (drafts.delete(key)) notifyListeners();
}
