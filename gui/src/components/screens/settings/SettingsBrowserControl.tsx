import {
  ArrowSquareOut,
  ArrowsClockwise,
  CaretRight,
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

import { SettingsPanelHeader } from "@/components/screens/settings/settings-ui";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  openBrowserControlExtensionsPage,
  openBrowserControlTestPage,
  type BrowserControlBrowser,
} from "@/lib/browser-control";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useBrowserControlStore } from "@/stores/browser-control";

type BrowserControlCopy = ReturnType<typeof useCopy>["browserControl"];

const BROWSER_CONTROL_GUIDE_URL =
  "https://datawhalechina.github.io/hello-generic-agent/part1/chapter2/#_2-1-1-chrome-安装步骤";
const BROWSER_CONTROL_TEST_PAGE_URL = "https://example.com";

const BROWSER_LABELS: Record<BrowserControlBrowser, string> = {
  chrome: "Chrome",
  edge: "Edge",
};

/**
 * Shared view-state for this tab. Both the page shell and the setup
 * guide derive everything from the store + copy, so nothing threads a
 * wall of props anymore.
 */
function useBrowserControlView() {
  const copy = useCopy().browserControl;
  const layout = useBrowserControlStore((s) => s.layout);
  const layoutError = useBrowserControlStore((s) => s.layoutError);
  const status = useBrowserControlStore((s) => s.status);
  const lastProbe = useBrowserControlStore((s) => s.lastProbe);
  const busy = useBrowserControlStore((s) => s.busy);
  const error = useBrowserControlStore((s) => s.error);
  const ensureLayout = useBrowserControlStore((s) => s.ensureLayout);
  const probe = useBrowserControlStore((s) => s.probe);

  const extensionDir = layout?.extensionDir ?? lastProbe?.extensionDir ?? "";
  const connected = status === "connected";
  const connectedNoTabs = status === "connected_no_tabs";
  const offline = status === "offline";
  const needsWebpage = offline || connectedNoTabs;
  const bridgeReady = connected || connectedNoTabs;
  const layoutReady = Boolean(extensionDir);
  const statusMessage = connected
    ? copy.connectedStatus
    : connectedNoTabs
      ? copy.connectedNoTabsStatus
      : offline
        ? copy.offlineStatus
        : error || lastProbe?.message || copy.waitingStatus;
  const statusDetail = connected
    ? copy.connectedStatusDetail(lastProbe?.tabCount ?? 0)
    : connectedNoTabs
      ? copy.connectedNoTabsStatusDetail
      : offline
        ? copy.offlineStatusDetail
        : "";

  return {
    copy,
    layoutError,
    status,
    busy,
    ensureLayout,
    probe,
    connected,
    needsWebpage,
    bridgeReady,
    layoutReady,
    statusMessage,
    statusDetail,
  };
}

/**
 * Open-external helpers with a local error line. Instantiated where the
 * buttons live (page shell and setup guide each own their error slot).
 */
function useOpenActions(copy: BrowserControlCopy) {
  const layout = useBrowserControlStore((s) => s.layout);
  const ensureLayout = useBrowserControlStore((s) => s.ensureLayout);
  const [openError, setOpenError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
    await navigator.clipboard.writeText(currentLayout.extensionDir);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return {
    openError,
    copied,
    openExtensionsPage,
    openGuide,
    openTestPage,
    showFolder,
    copyPath,
  };
}

/**
 * Settings → Browser Control tab. Managed-runtime only (mirrors the
 * Channels tab gating). The full setup / status / repair experience
 * lives inline here — the same content the TopBar indicator and the
 * attention banner deep-link to, the way Channels works. There is no
 * separate dialog: configuration has a single home.
 *
 * Action anchoring: state-advancing actions (open test page / recheck /
 * test) live inside the status card or the setup step they belong to —
 * the floating bottom action row was a leftover of the old dialog's
 * action bar. The quiet row below the card carries maintenance only
 * (retest, repair toggle, demo).
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
  const open = useOpenActions(copy);
  const [showRepair, setShowRepair] = useState(false);

  const { layoutReady, busy, layoutError, ensureLayout } = view;
  useEffect(() => {
    if (layoutReady || busy || layoutError) return;
    void ensureLayout();
  }, [busy, ensureLayout, layoutError, layoutReady]);

  return (
    <div className="space-y-7">
      <SettingsPanelHeader
        title={fullCopy.settings.tabs.browser.label}
        subtitle={copy.tabSubtitle}
      />

      <div className="space-y-3">
        {view.connected || view.needsWebpage ? (
          <>
            <ConnectionStatusCard
              busy={view.busy}
              connected={view.bridgeReady}
              status={view.status}
              statusDetail={view.statusDetail}
              statusMessage={view.statusMessage}
              actions={
                view.needsWebpage ? (
                  <TestPageActions
                    copy={copy}
                    busy={view.busy}
                    layoutReady={view.layoutReady}
                    openError={showRepair ? null : open.openError}
                    openTestPage={open.openTestPage}
                    onRecheck={() => void view.probe("recheck")}
                  />
                ) : undefined
              }
            />

            <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
              <div className="flex flex-wrap gap-2">
                {view.connected && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={view.busy || !view.layoutReady}
                    onClick={() => void view.probe("manual")}
                    leadingIcon={
                      view.busy ? (
                        <CircleNotch size={13} weight="thin" className="spin" />
                      ) : (
                        <ArrowsClockwise size={13} weight="thin" />
                      )
                    }
                  >
                    {view.busy ? copy.testing : copy.retest}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowRepair((show) => !show)}
                  leadingIcon={<PuzzlePiece size={13} weight="thin" />}
                >
                  {showRepair
                    ? copy.hideRepair
                    : view.needsWebpage
                      ? copy.reinstallOrRepair
                      : copy.repairTitle}
                </Button>
              </div>
              {view.connected && (
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

            {showRepair && (
              <div className="rounded-callout border border-line bg-surface p-3.5">
                <SetupGuide includeTest showTestStatus={false} />
              </div>
            )}
          </>
        ) : (
          <div className="rounded-callout border border-line bg-surface p-3.5">
            <SetupGuide includeTest showTestStatus />
          </div>
        )}
      </div>
    </div>
  );
}

function TestPageActions({
  copy,
  busy,
  layoutReady,
  openError,
  openTestPage,
  onRecheck,
}: {
  copy: BrowserControlCopy;
  busy: boolean;
  layoutReady: boolean;
  openError: string | null;
  openTestPage: (browser: BrowserControlBrowser) => Promise<void>;
  onRecheck: () => void;
}) {
  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void openTestPage("chrome")}
          leadingIcon={<ArrowSquareOut size={13} weight="thin" />}
        >
          {copy.openChromeTestPage}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void openTestPage("edge")}
          leadingIcon={<ArrowSquareOut size={13} weight="thin" />}
        >
          {copy.openEdgeTestPage}
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={busy || !layoutReady}
          onClick={onRecheck}
          leadingIcon={
            busy ? (
              <CircleNotch size={13} weight="thin" className="spin" />
            ) : (
              <ArrowsClockwise size={13} weight="thin" />
            )
          }
        >
          {busy ? copy.testing : copy.recheck}
        </Button>
      </div>
      {openError && (
        <div className="mt-2 rounded-sm border border-error/20 bg-error/[var(--opacity-subtle)] px-3 py-2 text-ui-meta leading-notice text-error">
          {openError}
        </div>
      )}
    </div>
  );
}

function SetupGuide({
  includeTest,
  showTestStatus,
}: {
  includeTest: boolean;
  showTestStatus: boolean;
}) {
  const view = useBrowserControlView();
  const { copy } = view;
  const open = useOpenActions(copy);
  const [browser, setBrowser] = useState<BrowserControlBrowser>("chrome");
  const [showTrouble, setShowTrouble] = useState(false);

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-ui-meta text-ink-muted">{copy.browserLabel}</span>
        <SegmentedControl<BrowserControlBrowser>
          ariaLabel={copy.browserLabel}
          size="sm"
          value={browser}
          onValueChange={setBrowser}
          options={[
            { value: "chrome", label: BROWSER_LABELS.chrome },
            { value: "edge", label: BROWSER_LABELS.edge },
          ]}
        />
      </div>

      <SetupStep index={1} title={copy.stepOpen(BROWSER_LABELS[browser])}>
        <StepHint>
          {copy.stepOpenHintPrefix}
          <StrongTerm>{copy.developerMode}</StrongTerm>
          {copy.stepOpenHintSuffix}
        </StepHint>
        <div className="mt-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void open.openExtensionsPage(browser)}
            leadingIcon={<ArrowSquareOut size={13} weight="thin" />}
          >
            {copy.openExtensions}
          </Button>
        </div>
      </SetupStep>

      <SetupStep index={2} title={copy.stepDrag}>
        {view.layoutReady ? (
          <>
            <StepHint>
              {copy.stepDragHintPrefix}
              <strong className="font-medium text-ink">
                {copy.stepDragWholePrefix}
                <code className="rounded-[3px] bg-app px-1 py-0.5 font-mono text-ui-label text-ink">
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
                {open.copied ? copy.copied : copy.copyPath}
              </Button>
            </div>
          </>
        ) : (
          <div className="mt-2">
            {view.layoutError ? (
              <div className="rounded-sm border border-error/20 bg-error/[var(--opacity-subtle)] px-3 py-2 text-ui-meta leading-notice text-error">
                <div>{copy.stepPrepareFailed}</div>
                <div className="mt-1 select-text break-all font-mono text-ui-label leading-notice opacity-80">
                  {view.layoutError}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-ui-meta leading-notice text-ink-muted">
                <CircleNotch size={13} weight="thin" className="spin" />
                <span>{copy.preparingPath}</span>
              </div>
            )}
            <div className="mt-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={view.busy}
                onClick={() => void view.ensureLayout()}
                leadingIcon={
                  view.busy ? (
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
        )}
      </SetupStep>

      {includeTest && view.layoutReady && (
        <SetupStep index={3} title={copy.stepTest}>
          <StepHint>{copy.stepTestHint}</StepHint>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void open.openTestPage(browser)}
              leadingIcon={<ArrowSquareOut size={13} weight="thin" />}
            >
              {copy.openTestPage}
            </Button>
            <Button
              // The current actionable next step of the whole setup —
              // the only primary on this tab while not yet connected.
              variant="primary"
              size="sm"
              disabled={view.busy}
              onClick={() => void view.probe("manual")}
              leadingIcon={
                view.busy ? (
                  <CircleNotch size={13} weight="thin" className="spin" />
                ) : (
                  <CursorClick size={13} weight="thin" />
                )
              }
            >
              {view.busy ? copy.testing : copy.test}
            </Button>
          </div>
          {showTestStatus && (
            <div className="mt-2.5">
              <ConnectionStatusCard
                busy={view.busy}
                connected={view.bridgeReady}
                status={view.status}
                statusDetail={view.statusDetail}
                statusMessage={view.statusMessage}
                embedded
              />
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
          <button
            type="button"
            onClick={() => setShowTrouble((show) => !show)}
            className="flex items-center gap-1 text-ui-meta text-ink-muted transition-colors hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
          >
            <CaretRight
              size={11}
              weight="bold"
              className={cn(
                "transition-transform duration-[120ms]",
                showTrouble && "rotate-90",
              )}
            />
            {showTrouble ? copy.troubleHide : copy.troubleShow}
          </button>
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
                  trailingIcon={<ArrowSquareOut size={12} weight="thin" />}
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

function StepHint({ children }: { children: ReactNode }) {
  return (
    <div className="mt-1 text-ui-meta leading-notice text-ink-muted">
      {children}
    </div>
  );
}

function StrongTerm({ children }: { children: ReactNode }) {
  return <strong className="font-medium text-ink">{children}</strong>;
}

function ConnectionStatusCard({
  actions,
  busy,
  connected,
  status,
  statusDetail,
  statusMessage,
  embedded = false,
}: {
  actions?: ReactNode;
  busy: boolean;
  connected: boolean;
  status: string;
  statusDetail?: string;
  statusMessage: string;
  embedded?: boolean;
}) {
  const offline = status === "offline";
  return (
    <div
      className={cn(
        "text-ui-meta leading-notice",
        embedded
          ? connected
            ? "text-ink-muted"
            : status === "error"
              ? "text-error"
              : "text-ink-muted"
          : cn(
              "rounded-sm border px-3 py-2",
              connected
                ? "border-line-subtle bg-transparent text-ink-muted"
                : status === "error"
                  ? "border-error/20 bg-error/[var(--opacity-subtle)] text-error"
                  : "border-line bg-surface text-ink-muted",
            ),
      )}
    >
      <div className="flex items-start gap-2">
        {busy ? (
          <CircleNotch size={14} weight="thin" className="mt-0.5 shrink-0 spin" />
        ) : connected ? (
          <CheckCircle
            size={14}
            weight="thin"
            className="mt-0.5 shrink-0 text-success"
          />
        ) : offline ? (
          <PuzzlePiece size={14} weight="thin" className="mt-0.5 shrink-0" />
        ) : (
          <Warning size={14} weight="thin" className="mt-0.5 shrink-0" />
        )}
        <span className="min-w-0">
          <span className="block">{statusMessage}</span>
          {statusDetail && (
            <span className="mt-0.5 block text-ui-tertiary leading-dense text-ink-soft">
              {statusDetail}
            </span>
          )}
          {actions}
        </span>
      </div>
    </div>
  );
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
