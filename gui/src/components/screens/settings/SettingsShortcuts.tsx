/**
 * Settings → Shortcuts tab. Lists every global keyboard shortcut
 * the V0.1 build wires up. Pulled out of EmptyState's hint footer
 * (which felt like chrome dilution on the first-impression screen)
 * — DESIGN.md §10 lists the canonical set; this view is the user-
 * facing presentation of that table.
 *
 * V0.1 read-only: rebinding lands in V0.2 Settings → Shortcuts as
 * row-level edit affordances. For now the list is static.
 *
 * OS-conditional display: rows with a platform modifier (Mod/Alt)
 * resolve through formatShortcut so Mac sees glyphs and Win sees
 * Ctrl+K word names. KbdCombo spaces dense Mac chords as
 * "⌘ + K" inside this page. Rows without a modifier (Enter, Esc,
 * arrows, Tab) render the same on both OSes.
 */

import { isMac } from "@/lib/platform";
import { formatShortcut } from "@/lib/shortcuts";
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
      ],
    },
    {
      title: shortcuts.overlays,
      rows: [
        { combo: "Esc", action: shortcuts.closeOverlay },
        { combo: "↑ / ↓", action: shortcuts.moveList },
        { combo: "Tab", action: shortcuts.enterSubmenu },
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
        title={copy.settings.tabs.shortcuts.label}
        subtitle={copy.settings.shortcuts.subtitle}
      />

      {groups.map((g) => (
        <section key={g.title}>
          <SettingsSectionLabel>{g.title}</SettingsSectionLabel>
          <ul className="m-0 mt-2 list-none divide-y divide-line overflow-hidden rounded-sm border border-line bg-surface p-0">
            {g.rows.map((r) => (
              <li
                key={r.combo}
                className="flex items-center gap-3 px-3 py-2.5"
              >
                <KbdCombo combo={r.combo} />
                <div className="min-w-0 flex-1">
                  <div className="text-ui-compact text-ink">{r.action}</div>
                  {r.note && (
                    <div className="mt-0.5 text-ui-label italic text-ink-muted">
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
              <kbd className="inline-flex min-w-[28px] items-center justify-center rounded-sm border border-line bg-app px-1.5 py-0.5 font-mono text-ui-label text-ink">
                {part}
              </kbd>
            </span>
          ))}
        </span>
      ))}
    </div>
  );
}

function shortcutParts(chord: string): string[] {
  if (chord.includes("+")) {
    return chord.split("+").filter(Boolean);
  }
  const compactMacChord = chord.match(/^([⌘⌃⌥⇧]+)(.+)$/);
  if (!compactMacChord) return [chord];
  return [...compactMacChord[1], compactMacChord[2]];
}
