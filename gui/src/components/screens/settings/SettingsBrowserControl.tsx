import {
  ArrowsClockwise,
  CaretRight,
  Check,
  CheckCircle,
  CircleNotch,
  ClipboardText,
  CursorClick,
  FolderOpen,
  PuzzlePiece,
  Warning,
} from "@phosphor-icons/react";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEffect, useState, type ReactNode } from "react";

import { SettingsDisclosureCard } from "@/components/screens/settings/settings-disclosure";
import { SettingsPanelHeader } from "@/components/screens/settings/settings-ui";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { COPY_FEEDBACK_MS, copyTextToClipboard } from "@/lib/clipboard";
import {
  openBrowserControlExtensionsPage,
  openBrowserControlTestPage,
  type BrowserControlBrowser,
} from "@/lib/browser-control";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useBrowserControlStore } from "@/stores/browser-control";

import {
  browserControlErrorTitle,
  browserControlMaintenance,
  browserControlSetupLine,
  browserControlStatusCard,
  browserControlVerifiedView,
  type BrowserControlErrorSource,
  type BrowserControlGuideBrowser,
  type BrowserControlSetupLine,
  type BrowserControlStatusCard,
  type BrowserControlViewInput,
} from "./browser-control-view";
import { ExternalLinkIcon } from "./external-link";

type BrowserControlCopy = ReturnType<typeof useCopy>["browserControl"];

const BROWSER_CONTROL_GUIDE_URL =
  "https://datawhalechina.github.io/hello-generic-agent/part1/chapter2/#_2-1-1-chrome-安装步骤";
const BROWSER_CONTROL_TEST_PAGE_URL = "https://example.com";

const BROWSER_LABELS: Record<BrowserControlBrowser, string> = {
  chrome: "Chrome",
  edge: "Edge",
};

/** Where the setup guide renders: the unverified page's main card, or
 * the verified page's 「重新安装或修复插件」 fold. */
type SetupGuideMode = "setup" | "repair";

/**
 * Shared view-state for this tab. The page shell and the setup guide
 * both derive everything from the store + copy (the pure decisions live
 * in `browser-control-view.ts`), so nothing threads a wall of props.
 */
function useBrowserControlView() {
  const copy = useCopy().browserControl;
  const status = useBrowserControlStore((s) => s.status);
  const verified = useBrowserControlStore((s) => s.verified);
  const verificationHydrated = useBrowserControlStore(
    (s) => s.verificationHydrated,
  );
  const bridge = useBrowserControlStore((s) => s.bridge);
  const layout = useBrowserControlStore((s) => s.layout);
  const layoutError = useBrowserControlStore((s) => s.layoutError);
  const lastProbe = useBrowserControlStore((s) => s.lastProbe);
  const testOutcome = useBrowserControlStore((s) => s.testOutcome);
  const error = useBrowserControlStore((s) => s.error);
  const probing = useBrowserControlStore((s) => s.probing);
  const syncingLayout = useBrowserControlStore((s) => s.syncingLayout);
  const ensureLayout = useBrowserControlStore((s) => s.ensureLayout);

  const input: BrowserControlViewInput = {
    status,
    verified,
    verificationHydrated,
    bridge,
    layoutError,
    testOutcome,
    error,
    probing,
  };
  const extensionDir = layout?.extensionDir ?? lastProbe?.extensionDir ?? "";

  return {
    copy,
    input,
    layoutError,
    syncingLayout,
    ensureLayout,
    layoutReady: Boolean(extensionDir),
    tabCount: bridge?.tabCount ?? lastProbe?.tabCount ?? 0,
  };
}

/**
 * Open-external and copy helpers with a local error line, owned by the
 * setup guide (each guide instance has its own error slot and its own
 * 「已复制」 states, which never bleed into each other).
 */
function useOpenActions(copy: BrowserControlCopy) {
  const layout = useBrowserControlStore((s) => s.layout);
  const ensureLayout = useBrowserControlStore((s) => s.ensureLayout);
  const [openError, setOpenError] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);

  const openExtensionsPage = async (target: BrowserControlBrowser) => {
    setOpenError(null);
    const url =
      target === "chrome" ? "chrome://extensions" : "edge://extensions";
    try {
      await openBrowserControlExtensionsPage(target);
    } catch {
      setOpenError(copy.openExtensionsFallback(url));
    }
  };

  const openGuide = async () => {
    setOpenError(null);
    try {
      await openUrl(BROWSER_CONTROL_GUIDE_URL);
    } catch {
      setOpenError(copy.openGuideFallback(BROWSER_CONTROL_GUIDE_URL));
    }
  };

  const openTestPage = async (target: BrowserControlBrowser) => {
    setOpenError(null);
    try {
      await openBrowserControlTestPage(target);
    } catch {
      setOpenError(copy.openTestPageFallback(BROWSER_CONTROL_TEST_PAGE_URL));
    }
  };

  const showFolder = async () => {
    setOpenError(null);
    const currentLayout = layout ?? (await ensureLayout());
    if (!currentLayout) return;
    try {
      await revealItemInDir(currentLayout.extensionDir);
    } catch {
      setOpenError(copy.showFolderFallback);
    }
  };

  const copyPath = async () => {
    const currentLayout = layout ?? (await ensureLayout());
    if (!currentLayout) return;
    await copyTextToClipboard(currentLayout.extensionDir);
    setCopiedPath(true);
    window.setTimeout(() => setCopiedPath(false), COPY_FEEDBACK_MS);
  };

  const copyAddress = async () => {
    await copyTextToClipboard(copy.extensionsAddress);
    setCopiedAddress(true);
    window.setTimeout(() => setCopiedAddress(false), COPY_FEEDBACK_MS);
  };

  return {
    openError,
    copiedPath,
    copiedAddress,
    openExtensionsPage,
    openGuide,
    openTestPage,
    showFolder,
    copyPath,
    copyAddress,
  };
}

/**
 * Settings → Browser Control tab. Managed-runtime only (mirrors the
 * Channels tab gating). The full setup / status / repair experience
 * lives inline here — the same content the TopBar indicator and the
 * attention banner deep-link to, the way Channels works. There is no
 * separate dialog: configuration has a single home.
 *
 * The page branches on whether setup was ever verified, not on the live
 * status alone (2026-10-08, D1): a verified install always gets the
 * status card, the maintenance row and the repair fold; an unverified
 * one gets the setup guide, whose step 3 carries the only primary.
 *
 * Action anchoring: 测试连接 lives in setup step 3 while setting up and
 * in the quiet row under the status card once verified; the card itself
 * holds no buttons. The row carries maintenance only (test, demo).
 *
 * Elevation note: this renders on the Settings `bg-app` canvas, so its
 * cards are `bg-surface` raised insets (not `bg-elevated`, which was
 * right only when this was a floating dialog body).
 */
export function SettingsBrowserControl({
  onRunDemo,
}: {
  onRunDemo?: () => void;
}) {
  const fullCopy = useCopy();
  const view = useBrowserControlView();
  const { copy } = view;
  const [showRepair, setShowRepair] = useState(false);

  const { layoutReady, syncingLayout, layoutError, ensureLayout } = view;
  useEffect(() => {
    if (layoutReady || syncingLayout || layoutError) return;
    void ensureLayout();
  }, [ensureLayout, layoutError, layoutReady, syncingLayout]);

  const card = browserControlStatusCard(view.input);
  const maintenance = browserControlMaintenance(card);

  return (
    <div className="space-y-7">
      <SettingsPanelHeader
        title={fullCopy.settings.tabs.browser.title}
        subtitle={copy.tabSubtitle}
      />

      <div className="space-y-3">
        {browserControlVerifiedView(view.input) ? (
          <>
            <ConnectionStatusCard card={card} tabCount={view.tabCount} />

            {(maintenance.test || maintenance.demo) && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                <div className="flex flex-wrap gap-2">
                  {maintenance.test && <TestConnectionButton variant="ghost" />}
                </div>
                {maintenance.demo && (
                  <Button
                    variant="accent-secondary"
                    size="sm"
                    title={copy.runDemoTitle}
                    onClick={() => onRunDemo?.()}
                  >
                    {copy.runDemo}
                  </Button>
                )}
              </div>
            )}

            <SettingsDisclosureCard
              open={showRepair}
              onToggle={() => setShowRepair((show) => !show)}
              header={
                <span className="min-w-0 truncate text-ui-compact font-medium text-ink">
                  {copy.reinstallOrRepair}
                </span>
              }
              bodyClassName="p-3.5"
            >
              <SetupGuide mode="repair" />
            </SettingsDisclosureCard>
          </>
        ) : (
          <div className="rounded-callout border border-line bg-surface p-3.5">
            <SetupGuide mode="setup" />
          </div>
        )}
      </div>
    </div>
  );
}

/** 测试连接: ghost in the maintenance row, primary in setup step 3. */
function TestConnectionButton({ variant }: { variant: "ghost" | "primary" }) {
  const copy = useCopy().browserControl;
  const probing = useBrowserControlStore((s) => s.probing);
  const probe = useBrowserControlStore((s) => s.probe);
  return (
    <Button
      variant={variant}
      size="sm"
      disabled={probing}
      onClick={() => void probe("manual")}
      leadingIcon={
        probing ? (
          <CircleNotch size={13} weight="thin" className="spin" />
        ) : (
          <CursorClick size={13} weight="thin" />
        )
      }
    >
      {probing ? copy.testing : copy.test}
    </Button>
  );
}

function SetupGuide({ mode }: { mode: SetupGuideMode }) {
  const view = useBrowserControlView();
  const { copy } = view;
  const open = useOpenActions(copy);
  const [browser, setBrowser] = useState<BrowserControlGuideBrowser>("chrome");
  const [showTrouble, setShowTrouble] = useState(false);
  const repair = mode === "repair";
  // Inline code sinks to `bg-app` on the setup card's `bg-surface`; the
  // repair fold's body already is `bg-app`, so there it rises instead.
  const codeSurface = repair ? "bg-surface" : "bg-app";
  const knownBrowser = browser === "other" ? null : browser;
  const setupLine = repair ? null : browserControlSetupLine(view.input);

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-ui-meta text-ink-muted">{copy.browserLabel}</span>
        <SegmentedControl<BrowserControlGuideBrowser>
          ariaLabel={copy.browserLabel}
          size="sm"
          value={browser}
          onValueChange={setBrowser}
          options={[
            { value: "chrome", label: BROWSER_LABELS.chrome },
            { value: "edge", label: BROWSER_LABELS.edge },
            { value: "other", label: copy.browserOther },
          ]}
        />
      </div>

      <SetupStep
        index={1}
        title={
          knownBrowser
            ? copy.stepOpen(BROWSER_LABELS[knownBrowser])
            : copy.stepOpenOther
        }
      >
        {browser === "chrome" ? (
          <StepHint>
            {copy.stepOpenHintPrefix}
            <StrongTerm>{copy.developerMode}</StrongTerm>
            {copy.stepOpenHintSuffix}
          </StepHint>
        ) : browser === "edge" ? (
          // Edge's switch position is not verified on a real install, so
          // its hint names the switch without saying where it sits.
          <StepHint>
            {copy.stepOpenHintNoPositionPrefix}
            <StrongTerm>{copy.developerModeEdge}</StrongTerm>
            {copy.stepOpenHintNoPositionSuffix}
          </StepHint>
        ) : (
          <StepHint>
            {copy.stepOpenOtherHintPrefix}
            <StrongTerm>{copy.developerMode}</StrongTerm>
            {copy.stepOpenHintNoPositionSuffix}
          </StepHint>
        )}
        {knownBrowser ? (
          <div className="mt-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void open.openExtensionsPage(knownBrowser)}
              leadingIcon={<ExternalLinkIcon />}
            >
              {copy.openExtensions}
            </Button>
          </div>
        ) : (
          // Core opens only Chrome / Edge; any other Chromium browser
          // gets the address to type.
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code
              className={cn(
                "select-text rounded-[3px] px-1.5 py-0.5 font-mono text-ui-label text-ink",
                codeSurface,
              )}
            >
              {copy.extensionsAddress}
            </code>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void open.copyAddress()}
              leadingIcon={<ClipboardText size={13} weight="thin" />}
            >
              {open.copiedAddress ? copy.copied : copy.copyAddress}
            </Button>
          </div>
        )}
      </SetupStep>

      <SetupStep index={2} title={copy.stepDrag}>
        {view.layoutReady ? (
          <>
            <StepHint>
              {copy.stepDragHintPrefix}
              <strong className="font-medium text-ink">
                {copy.stepDragWholePrefix}
                <code
                  className={cn(
                    "rounded-[3px] px-1 py-0.5 font-mono text-ui-label text-ink",
                    codeSurface,
                  )}
                >
                  {copy.folderName}
                </code>
                {copy.stepDragWholeSuffix}
              </strong>
              {copy.stepDragHintSuffix}
            </StepHint>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void open.showFolder()}
                leadingIcon={<FolderOpen size={13} weight="thin" />}
              >
                {copy.showFolder}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void open.copyPath()}
                leadingIcon={<ClipboardText size={13} weight="thin" />}
              >
                {open.copiedPath ? copy.copied : copy.copyPath}
              </Button>
            </div>
            {repair && (
              <StepHint className="mt-2">{copy.stepDragReloadHint}</StepHint>
            )}
          </>
        ) : view.layoutError ? (
          <div className="mt-2">
            <div className="rounded-sm border border-error/20 bg-error/[var(--opacity-subtle)] px-3 py-2 text-ui-meta leading-notice text-error">
              <div>{copy.stepPrepareFailed}</div>
              <ErrorDetail>{view.layoutError}</ErrorDetail>
            </div>
            <div className="mt-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={view.syncingLayout}
                onClick={() => void view.ensureLayout()}
                leadingIcon={
                  view.syncingLayout ? (
                    <CircleNotch size={13} weight="thin" className="spin" />
                  ) : (
                    <ArrowsClockwise size={13} weight="thin" />
                  )
                }
              >
                {copy.retryPrepare}
              </Button>
            </div>
          </div>
        ) : (
          // Preparing: the spinner alone (no 重新准备 beside it — two
          // spinners for one wait).
          <div className="mt-2 flex items-center gap-2 text-ui-meta leading-notice text-ink-muted">
            <CircleNotch size={13} weight="thin" className="spin" />
            <span>{copy.preparingPath}</span>
          </div>
        )}
      </SetupStep>

      {view.layoutReady && (
        <SetupStep index={3} title={copy.stepTest}>
          <StepHint>
            {repair
              ? knownBrowser
                ? copy.stepTestHintRepair
                : copy.stepTestHintRepairOther
              : knownBrowser
                ? copy.stepTestHint
                : copy.stepTestHintOther}
          </StepHint>
          {(knownBrowser || !repair) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {knownBrowser && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void open.openTestPage(knownBrowser)}
                  leadingIcon={<ExternalLinkIcon />}
                >
                  {copy.openTestPage}
                </Button>
              )}
              {/* The current actionable next step of the whole setup —
                  the only primary on this tab while not yet verified.
                  The repair fold has none: once verified, 测试连接 sits
                  in the maintenance row. */}
              {!repair && <TestConnectionButton variant="primary" />}
            </div>
          )}
          {setupLine && (
            <div className="mt-2.5 text-ui-meta leading-notice">
              <SetupStatusLine line={setupLine} />
            </div>
          )}
        </SetupStep>
      )}

      {open.openError && (
        <div className="rounded-sm border border-error/20 bg-error/[var(--opacity-subtle)] px-3 py-2 text-ui-meta leading-notice text-error">
          {open.openError}
        </div>
      )}

      {view.layoutReady && (
        <div className="border-t border-line-subtle pt-2.5">
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={showTrouble}
            className="-ml-2 h-6 px-2 text-ui-meta text-ink-muted"
            onClick={() => setShowTrouble((show) => !show)}
            leadingIcon={
              <CaretRight
                size={11}
                weight="bold"
                className={cn(
                  "transition-transform duration-(--motion-fast) ease-firm motion-reduce:transition-none",
                  showTrouble && "rotate-90",
                )}
              />
            }
          >
            {copy.troubleShow}
          </Button>
          {showTrouble && (
            <div className="mt-2 grid gap-2 text-ui-meta leading-notice text-ink-muted">
              <div>
                {copy.troubleDragFailsPrefix}
                <StrongTerm>{copy.loadUnpacked}</StrongTerm>
                {copy.troubleDragFailsSuffix}
              </div>
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-2 h-6 px-2 text-ui-meta"
                  title={copy.openGuideTitle}
                  onClick={() => void open.openGuide()}
                  trailingIcon={<ExternalLinkIcon />}
                >
                  {copy.openGuide}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StepHint({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "mt-1 text-ui-meta leading-notice text-ink-muted",
        className,
      )}
    >
      {children}
    </div>
  );
}

function StrongTerm({ children }: { children: ReactNode }) {
  return <strong className="font-medium text-ink">{children}</strong>;
}

/** Raw error text under a worded title: selectable, wraps anywhere.
 * Technical text (exceptions, OS errors) is mono; the bridge's own
 * messages are Chinese sentences and stay in the text face. */
function ErrorDetail({
  mono = true,
  children,
}: {
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "mt-1 select-text whitespace-pre-wrap break-words text-ui-tertiary leading-notice text-error/80",
        mono && "font-mono",
      )}
    >
      {children}
    </div>
  );
}

/** Icon column + a title line, with any further lines below the title. */
function StatusLine({
  icon,
  title,
  titleClassName = "text-ink-soft",
  children,
}: {
  icon: ReactNode;
  title: string;
  titleClassName?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      {icon}
      <div className="min-w-0 flex-1">
        <div className={titleClassName}>{title}</div>
        {children}
      </div>
    </div>
  );
}

const STATUS_ICON_CLASS = "mt-0.5 shrink-0";

function SuccessIcon() {
  // Filled: the app-wide "done" mark (settings-badges.tsx).
  return (
    <CheckCircle
      size={14}
      weight="fill"
      className={cn(STATUS_ICON_CLASS, "text-success")}
    />
  );
}

function NeutralIcon() {
  return (
    <PuzzlePiece
      size={14}
      weight="thin"
      className={cn(STATUS_ICON_CLASS, "text-ink-soft")}
    />
  );
}

function SpinnerIcon() {
  return (
    <CircleNotch
      size={14}
      weight="thin"
      className={cn(STATUS_ICON_CLASS, "spin text-ink-soft")}
    />
  );
}

/** Worded title (per source), the raw detail below, and 正在自动重试 for
 * the bridge failures that retry on their own. */
function ErrorStatus({ error }: { error: BrowserControlErrorSource }) {
  const fullCopy = useCopy();
  return (
    <StatusLine
      icon={
        <Warning
          size={14}
          weight="thin"
          className={cn(STATUS_ICON_CLASS, "text-error")}
        />
      }
      title={browserControlErrorTitle(error, fullCopy)}
      titleClassName="text-error"
    >
      {error.detail && (
        <ErrorDetail mono={error.source !== "bridge"}>
          {error.detail}
        </ErrorDetail>
      )}
      {error.source === "bridge" && error.retrying && (
        <div className="mt-1 text-ui-tertiary leading-notice text-ink-muted">
          {fullCopy.topbar.browserControlPopover.retrying}
        </div>
      )}
    </StatusLine>
  );
}

/**
 * The verified page's status card. No buttons inside (2026-10-08, D2):
 * the live state needs no recheck, and testing / the demo sit in the
 * maintenance row below.
 */
function ConnectionStatusCard({
  card,
  tabCount,
}: {
  card: BrowserControlStatusCard;
  tabCount: number;
}) {
  const copy = useCopy().browserControl;

  if (card.kind === "error") {
    return (
      <div className="rounded-sm border border-error/20 bg-error/[var(--opacity-subtle)] px-3 py-2 text-ui-meta leading-notice">
        <ErrorStatus error={card.error} />
      </div>
    );
  }

  if (card.kind === "connected" || card.kind === "noTabs") {
    const connected = card.kind === "connected";
    const detail = connected
      ? copy.connectedStatusDetail(tabCount)
      : copy.connectedNoTabsStatusDetail;
    return (
      // Connected is the quiet state: a hairline, no fill.
      <div className="rounded-sm border border-line-subtle bg-transparent px-3 py-2 text-ui-meta leading-notice">
        <StatusLine
          icon={<SuccessIcon />}
          title={connected ? copy.connectedStatus : copy.connectedNoTabsStatus}
        >
          {detail && <StatusDetail>{detail}</StatusDetail>}
          {connected && (
            // The honest scope (06-16 design audit): when and how it
            // acts, and that reading a page shares every open tab's
            // title and URL with the model.
            <div className="mt-1.5 text-ui-tertiary leading-notice text-ink-muted">
              {copy.connectedScope}
            </div>
          )}
          {card.kind === "connected" && card.testPassed && (
            // A manual test's quiet confirmation, next to the button that
            // ran it; no toast.
            <div className="mt-1.5 flex items-center gap-1 text-ui-tertiary leading-notice text-ink-muted">
              <Check size={11} weight="bold" className="shrink-0" />
              <span>{copy.testPassed}</span>
            </div>
          )}
        </StatusLine>
      </div>
    );
  }

  return (
    <div className="rounded-sm border border-line bg-surface px-3 py-2 text-ui-meta leading-notice">
      {card.kind === "offline" ? (
        <StatusLine icon={<NeutralIcon />} title={copy.offlineStatus}>
          <StatusDetail>{copy.offlineStatusDetail}</StatusDetail>
        </StatusLine>
      ) : (
        <StatusLine icon={<SpinnerIcon />} title={copy.connectingStatus} />
      )}
    </div>
  );
}

function StatusDetail({ children }: { children: ReactNode }) {
  return (
    <div className="mt-0.5 text-ui-tertiary leading-dense text-ink-muted">
      {children}
    </div>
  );
}

/** Setup step 3's inline line: no card, just icon and words. */
function SetupStatusLine({ line }: { line: BrowserControlSetupLine }) {
  const copy = useCopy().browserControl;
  switch (line.kind) {
    case "connecting":
      return (
        <StatusLine icon={<SpinnerIcon />} title={copy.connectingStatus} />
      );
    case "notConnected":
      return (
        <StatusLine icon={<NeutralIcon />} title={copy.notConnectedStatus} />
      );
    case "passed":
      return <StatusLine icon={<SuccessIcon />} title={copy.testPassed} />;
    case "connected":
      return <StatusLine icon={<SuccessIcon />} title={copy.connectedStatus} />;
    case "noTabs":
      return (
        <StatusLine icon={<SuccessIcon />} title={copy.connectedNoTabsStatus} />
      );
    case "error":
      return <ErrorStatus error={line.error} />;
  }
}

function SetupStep({
  index,
  title,
  children,
}: {
  index: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-line bg-app font-mono text-ui-label font-medium tabular-nums text-ink-soft">
        {index}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-ui-secondary font-medium text-ink">{title}</div>
        {children}
      </div>
    </div>
  );
}
