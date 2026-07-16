import { CopySimple, Minus, Square, X } from "@phosphor-icons/react";
import { getCurrentWindow, type Window } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Windows-only custom window controls: minimize / maximize-restore /
 * close. Lives at the far right of TopBar and hugs the window's right
 * edge (TopBar drops its pr-3 on Win for exactly this).
 *
 * Per Win 11 Fluent: each button is 46px wide and full-height (44px
 * here to match TopBar; Win 11's own title bar is 32px, but a 44px
 * chrome bar reads as "Galley chrome with Win-flavored controls"
 * which we prefer over centred 30px buttons floating in a taller bar).
 * Buttons touch each other with no gap.
 *
 * Hover: gray for min/max, red for close — Galley's `bg-danger` token
 * rather than literal Win 11 red so the chrome stays inside our
 * design system. Close hover also swaps the icon to `bg-elevated`
 * (light) for contrast on the red fill.
 *
 * Maximize-state tracking: subscribe to `onResized` and re-poll
 * `isMaximized()` after every resize event (Tauri 2 doesn't surface a
 * dedicated maximize-state event). This means the icon swaps slightly
 * after the resize completes — acceptable; Win 11's own controls have
 * a similar visible delay.
 *
 * Defensive: if `getCurrentWindow()` is unavailable (Vite dev in plain
 * browser, no Tauri host), the buttons render but no-op on click. We
 * never reach this path in shipped builds because TopBar gates
 * rendering on `!isMac`.
 */
export function WindowControls() {
  const copy = useCopy();
  const [maximized, setMaximized] = useState(false);
  const [focused, setFocused] = useState(true);
  const [appWindow, setAppWindow] = useState<Window | null>(null);

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    void (async () => {
      try {
        const win = getCurrentWindow();
        if (cancelled) return;
        setAppWindow(win);

        const initialMaximized = await win.isMaximized();
        if (!cancelled) setMaximized(initialMaximized);

        const resizeFn = await win.onResized(() => {
          void win.isMaximized().then((m) => {
            if (!cancelled) setMaximized(m);
          });
        });
        if (cancelled) resizeFn();
        else unlisteners.push(resizeFn);

        // Win convention: chrome desaturates when the window loses
        // focus. Initial state defaults to `true` since the window is
        // virtually always focused at mount; the listener corrects it
        // the first time focus actually shifts.
        const focusFn = await win.onFocusChanged(({ payload }) => {
          if (!cancelled) setFocused(payload);
        });
        if (cancelled) focusFn();
        else unlisteners.push(focusFn);
      } catch {
        // Non-Tauri host or permission denied — buttons will render
        // but on-click calls below short-circuit when appWindow is null.
      }
    })();

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, []);

  return (
    <div
      className={cn(
        "flex shrink-0 items-stretch transition-opacity duration-(--motion-fast)",
        !focused && "opacity-50",
      )}
    >
      <ControlButton
        ariaLabel={copy.app.minimize}
        onClick={() => void appWindow?.minimize()}
      >
        <Minus size={12} weight="thin" />
      </ControlButton>
      <ControlButton
        ariaLabel={maximized ? copy.app.restoreWindow : copy.app.maximize}
        onClick={() => void appWindow?.toggleMaximize()}
      >
        {maximized ? (
          <CopySimple size={12} weight="thin" />
        ) : (
          <Square size={12} weight="thin" />
        )}
      </ControlButton>
      <ControlButton
        ariaLabel={copy.common.close}
        variant="close"
        onClick={() => void appWindow?.close()}
      >
        <X size={12} weight="thin" />
      </ControlButton>
    </div>
  );
}

function ControlButton({
  children,
  onClick,
  ariaLabel,
  variant = "default",
}: {
  children: React.ReactNode;
  onClick: () => void;
  ariaLabel: string;
  variant?: "default" | "close";
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      // Tauri drag region opts out automatically for <button>, but
      // setting data-tauri-drag-region="false" is belt-and-suspenders
      // in case Tauri 2's auto-exclusion ever regresses.
      data-tauri-drag-region="false"
      className={cn(
        "flex h-11 w-[46px] shrink-0 items-center justify-center text-ink-soft",
        variant === "default" && "hover:bg-hover hover:text-ink",
        variant === "close" && "hover:bg-danger hover:text-elevated",
      )}
    >
      {children}
    </button>
  );
}
