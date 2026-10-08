/**
 * Settings → Shortcuts tab. Lists the keyboard shortcuts Galley wires
 * up — the global ones plus the composer and overlay keys. Pulled out
 * of EmptyState's hint footer (which felt like chrome dilution on the
 * first-impression screen) — docs/design/overlays-and-settings.md §10
 * lists the canonical set; this view is the user-facing presentation
 * of that table.
 *
 * Read-only: the list is static, and rebinding is left for a later
 * version (the subtitle says so).
 *
 * OS-conditional display: rows with a platform modifier (Mod/Alt)
 * resolve through formatShortcut so Mac sees glyphs and Win sees
 * Ctrl+K word names. KbdCombo spaces dense Mac chords as
 * "⌘ + K" inside this page, and a chip holding a lone modifier glyph
 * takes the system font (`.shortcut-glyph`, see lib/shortcuts.ts).
 * Rows without a modifier (Enter, Esc, arrows) render the same on
 * both OSes.
 */

import { isMac } from "@/lib/platform";
import {
  formatShortcut,
  isSymbolGlyph,
  shortcutParts,
} from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import {
  SettingsPanelHeader,
  SettingsSectionLabel,
} from "@/components/screens/settings/settings-ui";
import { useCopy } from "@/lib/i18n";

interface ShortcutRow {
  /** Canonical key combo, rendered as kbd-style chips. */
  combo: string;
  /** What the combo does, in the user's voice. */
  action: string;
  /** Optional one-liner clarifying scope or caveat. */
  note?: string;
}

interface ShortcutGroup {
  title: string;
  rows: ShortcutRow[];
}

function buildGroups(copy: ReturnType<typeof useCopy>): ShortcutGroup[] {
  const shortcuts = copy.settings.shortcuts;
  return [
    {
      title: shortcuts.navigation,
      rows: [
        {
          combo: formatShortcut("Mod+K"),
          action: shortcuts.openCommandPalette,
        },
        { combo: formatShortcut("Mod+N"), action: shortcuts.newConversation },
        { combo: formatShortcut("Mod+,"), action: shortcuts.openSettings },
      ],
    },
    {
      title: shortcuts.composer,
      rows: [
        { combo: "Enter", action: shortcuts.sendMessage },
        { combo: "Shift+Enter", action: shortcuts.newline },
        { combo: "→", action: shortcuts.acceptSuggestion },
        { combo: "Esc", action: shortcuts.cancelGoalMode },
      ],
    },
    {
      title: shortcuts.conversation,
      rows: [
        {
          combo: `${formatShortcut("Alt+↑")} / ${formatShortcut("Alt+↓")}`,
          action: shortcuts.jumpQuestion,
          // Mac users had the original "macOS 文本编辑原生快捷键保留"
          // phrasing — preserved verbatim so Mac UX is byte-identical
          // through the A4 migration. Win gets a parallel sentence that
          // doesn't reference macOS.
          note: isMac ? shortcuts.nativeEditingMac : shortcuts.nativeEditing,
        },
        // ⌘= rather than ⌘+: the unshifted key US layouts press, and
        // what the macOS View menu shows (⌘+ works too).
        {
          combo: `${formatShortcut("Mod+=")} / ${formatShortcut("Mod+-")}`,
          action: shortcuts.fontSizeStep,
        },
        { combo: formatShortcut("Mod+0"), action: shortcuts.fontSizeReset },
      ],
    },
    {
      title: shortcuts.overlays,
      rows: [
        { combo: "Esc", action: shortcuts.closeOverlay },
        { combo: "↑ / ↓", action: shortcuts.moveList },
        // Two chips like "Shift + Enter", not formatShortcut("Mod+Enter"):
        // that gives Mac "⌘↵", and ↵ falls back to the same undersized
        // Menlo glyph the modifiers had.
        {
          combo: `${formatShortcut("Mod")}+Enter`,
          action: shortcuts.submitProjectDialog,
        },
      ],
    },
  ];
}

export function SettingsShortcuts() {
  const copy = useCopy();
  const groups = buildGroups(copy);
  return (
    <div className="space-y-7">
      <SettingsPanelHeader
        title={copy.settings.tabs.shortcuts.title}
        subtitle={copy.settings.shortcuts.subtitle}
      />

      {groups.map((g) => (
        <section key={g.title}>
          <SettingsSectionLabel>{g.title}</SettingsSectionLabel>
          <ul className="m-0 mt-2 list-none divide-y divide-line overflow-hidden rounded-sm border border-line bg-surface p-0">
            {/* Combos are unique within a group (Esc sits in two
                groups, each its own list), so they key the rows. */}
            {g.rows.map((r) => (
              <li
                key={r.combo}
                className="flex items-center gap-3 px-3 py-2.5"
              >
                <KbdCombo combo={r.combo} />
                <div className="min-w-0 flex-1">
                  <div className="text-ui-compact text-ink">{r.action}</div>
                  {r.note && (
                    <div className="mt-0.5 text-ui-tertiary text-ink-muted">
                      {r.note}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * Splits combo strings into readable key chips. Settings has more
 * room than sidebar hints, so compact macOS chords like "⌘K" become
 * "⌘ + K" here while global shortcut hints stay terse.
 */
function KbdCombo({ combo }: { combo: string }) {
  const chords = combo.split(/\s+\/\s+/);
  return (
    <div className="flex shrink-0 items-center gap-1">
      {chords.map((chord, chordIndex) => (
        <span key={chordIndex} className="inline-flex items-center gap-1">
          {chordIndex > 0 && (
            <span className="px-0.5 text-ui-label text-ink-muted">/</span>
          )}
          {shortcutParts(chord).map((part, partIndex) => (
            <span key={partIndex} className="inline-flex items-center gap-1">
              {partIndex > 0 && (
                <span className="text-ui-micro text-ink-muted">+</span>
              )}
              <kbd
                className={cn(
                  "inline-flex min-w-[28px] items-center justify-center rounded-sm border border-line bg-app px-1.5 py-0.5 font-mono text-ui-label text-ink",
                  isSymbolGlyph(part) && "shortcut-glyph",
                )}
              >
                {part}
              </kbd>
            </span>
          ))}
        </span>
      ))}
    </div>
  );
}
