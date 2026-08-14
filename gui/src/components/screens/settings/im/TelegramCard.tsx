import { Check, CircleNotch, Power } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import {
  deleteTelegramImConfig,
  getTelegramImConfig,
  saveTelegramImConfig,
  startImSupervisor,
  stopImSupervisor,
  unbindTelegramImOwner,
  type ImSupervisorState,
  type ImSupervisorStatus,
  type TelegramImConfig,
} from "@/lib/im-supervisor";

import { ChannelActionsMenu } from "./ChannelActionsMenu";
import { ChannelCard } from "./ChannelCard";
import { ChannelErrorBlock } from "./ChannelErrorBlock";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { TelegramCommandReference } from "./CommandReference";
import { ConnectionSteps } from "./ConnectionSteps";
import { stepWithLink } from "./step-link";
import { TelegramGlyph } from "./Glyphs";
import { OwnerBoundRow, BindCodeCallout } from "./OwnerBinding";
import { StatusBadge } from "./StatusBadge";
import { shouldAutoExpand, telegramStatusHintForState } from "./status";

/**
 * Telegram channel card. Same owner-paired flow as Feishu with a much
 * shorter setup: one Bot Token from @BotFather instead of an app
 * console round-trip. The token is stored in the credential store and
 * never echoed back; blank input on save keeps the stored token.
 */
/** Last-loaded config — same first-frame-correctness cache as
 * FeishuCard; see the note there and in useImSupervisorStatus. */
let cachedTelegramConfig: TelegramImConfig | null = null;

export function TelegramCard({
  status,
  statusLoadError,
  onStatusChange,
}: {
  status: ImSupervisorStatus | null;
  statusLoadError: string | null;
  onStatusChange: (status: ImSupervisorStatus | null) => void;
}) {
  const appCopy = useCopy();
  const imCopy = appCopy.settings.im;
  const [config, setConfigState] = useState<TelegramImConfig | null>(
    () => cachedTelegramConfig,
  );
  const setConfig = (next: TelegramImConfig | null) => {
    cachedTelegramConfig = next;
    setConfigState(next);
  };
  const [botToken, setBotToken] = useState("");
  const [localBusy, setLocalBusy] = useState<
    "load" | "save" | "connect" | "stop" | "disconnect" | "unbind" | null
  >(cachedTelegramConfig ? null : "load");
  const [localError, setLocalError] = useState<string | null>(null);
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(
    null,
  );
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);
  const [confirmUnbindOpen, setConfirmUnbindOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getTelegramImConfig()
      .then((next) => {
        if (cancelled) return;
        setConfig(next);
        setLocalError(null);
      })
      .catch((e) => {
        if (!cancelled) {
          setLocalError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLocalBusy(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const canSaveCredentials =
    botToken.trim().length > 0 || Boolean(config?.hasBotToken);
  const canStartService = Boolean(config?.hasBotToken);
  const derivedState: ImSupervisorState =
    status?.state ?? (config?.hasBotToken ? "stopped" : "not_connected");
  const expanded = expandedOverride ?? shouldAutoExpand(derivedState);
  const running = derivedState === "running";
  const canPause = derivedState === "running";
  const canDisconnect =
    derivedState === "running" ||
    derivedState === "expired" ||
    derivedState === "error" ||
    derivedState === "stopped";
  const busy = localBusy !== null;

  const run = async (
    action: Exclude<typeof localBusy, null | "load">,
    fn: () => Promise<void>,
  ) => {
    setLocalBusy(action);
    setLocalError(null);
    try {
      await fn();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e));
    } finally {
      setLocalBusy(null);
    }
  };

  const saveCredentials = () =>
    run("save", async () => {
      const saved = await saveTelegramImConfig({
        botToken: botToken.trim() || null,
      });
      setConfig(saved);
      setBotToken("");
      onStatusChange(null);
      setExpandedOverride(true);
    });

  const connect = () =>
    run("connect", async () => {
      onStatusChange(await startImSupervisor("telegram", false));
    });

  const stop = () =>
    run("stop", async () => {
      onStatusChange(await stopImSupervisor("telegram"));
    });

  const disconnect = () =>
    run("disconnect", async () => {
      const nextConfig = await deleteTelegramImConfig();
      setConfig(nextConfig);
      setBotToken("");
      onStatusChange(null);
    });

  const unbind = () =>
    run("unbind", async () => {
      onStatusChange(await unbindTelegramImOwner());
      setConfig(await getTelegramImConfig());
    });

  // Owner binding view state. The live status wins (it carries the
  // pairing code while running unbound); the persisted config covers
  // the stopped-but-bound case.
  const ownerUserId = status?.ownerOpenId ?? config?.ownerUserId ?? null;
  const ownerBoundAt = config?.ownerBoundAt ?? null;
  const bindCode = ownerUserId ? null : (status?.bindCode ?? null);

  return (
    <>
      <ChannelCard
        expanded={expanded}
        onToggle={() => setExpandedOverride(!expanded)}
        glyph={<TelegramGlyph active={expanded} />}
        title={imCopy.telegramTitle}
        badge={
          <StatusBadge
            state={derivedState}
            iconStateOverride={
              derivedState === "stopped" ? "not_connected" : undefined
            }
            labelOverride={
              derivedState === "running"
                ? imCopy.telegramServiceStarted
                : derivedState === "stopped"
                  ? imCopy.telegramNotStarted
                  : undefined
            }
          />
        }
        busy={busy}
        actions={
          canPause || canDisconnect ? (
            <ChannelActionsMenu
              disabled={busy}
              canStop={canPause}
              canDisconnect={canDisconnect}
              onStop={stop}
              onDisconnect={() => setConfirmDisconnectOpen(true)}
            />
          ) : null
        }
      >
        <div className="space-y-4 pl-8 pr-1">
          <ConnectionSteps
            steps={
              running
                ? imCopy.telegramConnectedSteps
                : imCopy.telegramSetupSteps.map((step) =>
                    stepWithLink(step, "@BotFather", "https://t.me/BotFather"),
                  )
            }
            status={telegramStatusHintForState(derivedState, imCopy)}
          />

          {running ? (
            <TelegramCommandReference imCopy={imCopy} />
          ) : (
            <>
              <div className="max-w-[460px]">
                <label className="block">
                  <span className="mb-1.5 block text-ui-meta font-medium text-ink-soft">
                    {imCopy.telegramBotTokenLabel}
                  </span>
                  <input
                    type="password"
                    value={botToken}
                    onChange={(e) => setBotToken(e.target.value)}
                    placeholder={
                      config?.hasBotToken
                        ? imCopy.telegramTokenSavedPlaceholder
                        : imCopy.telegramBotTokenPlaceholder
                    }
                    spellCheck={false}
                    className="w-full rounded-sm border border-line bg-surface px-3 py-2 font-mono text-ui-secondary text-ink outline-none transition-colors duration-(--motion-fast) ease-firm placeholder:text-ink-muted/70 focus:border-brand focus:ring-[3px] focus:ring-brand/20"
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  // Primary tracks the current actionable step, same rule
                  // as the Feishu card: saving is the next step until the
                  // token is stored, then starting takes primary.
                  variant={canStartService ? "secondary" : "primary"}
                  size="sm"
                  disabled={busy || !canSaveCredentials}
                  leadingIcon={
                    localBusy === "save" ? (
                      <CircleNotch size={13} className="spin" />
                    ) : (
                      <Check size={13} />
                    )
                  }
                  onClick={saveCredentials}
                >
                  {localBusy === "save"
                    ? imCopy.working
                    : imCopy.telegramSaveCredentials}
                </Button>
                <Button
                  type="button"
                  variant={canStartService ? "primary" : "secondary"}
                  size="sm"
                  disabled={busy || !canStartService}
                  leadingIcon={
                    localBusy === "connect" ? (
                      <CircleNotch size={13} className="spin" />
                    ) : (
                      <Power size={13} />
                    )
                  }
                  onClick={connect}
                >
                  {localBusy === "connect"
                    ? imCopy.working
                    : imCopy.telegramStartService}
                </Button>
                {localBusy === "load" ? (
                  <span className="text-ui-meta text-ink-muted">
                    {imCopy.telegramConfigLoading}
                  </span>
                ) : null}
              </div>
            </>
          )}

          {ownerUserId ? (
            <OwnerBoundRow
              ownerId={ownerUserId}
              boundAt={ownerBoundAt}
              boundLabel={imCopy.telegramBoundLabel}
              boundAtLabel={imCopy.telegramBoundAt}
              unbindLabel={imCopy.telegramUnbind}
              workingLabel={imCopy.working}
              busy={busy}
              working={localBusy === "unbind"}
              onUnbind={() => setConfirmUnbindOpen(true)}
            />
          ) : bindCode ? (
            <BindCodeCallout
              title={imCopy.telegramBindWaitingTitle}
              lead={imCopy.telegramBindWaitingLead}
              code={bindCode}
              afterCode={imCopy.telegramBindWaitingAfterCode}
            />
          ) : null}

          <p className="text-ui-tertiary leading-notice text-ink-muted">
            {imCopy.telegramOwnerSecurityNote}
          </p>

          <ChannelErrorBlock
            error={localError ?? statusLoadError ?? status?.lastError ?? null}
          />
        </div>
      </ChannelCard>

      <ConfirmActionDialog
        open={confirmUnbindOpen}
        onOpenChange={setConfirmUnbindOpen}
        busy={busy}
        title={imCopy.telegramUnbindDialogTitle}
        body={imCopy.telegramUnbindDialogBody}
        confirmLabel={imCopy.telegramUnbind}
        onConfirm={() => {
          setConfirmUnbindOpen(false);
          void unbind();
        }}
      />

      <ConfirmActionDialog
        open={confirmDisconnectOpen}
        onOpenChange={setConfirmDisconnectOpen}
        busy={busy}
        title={imCopy.telegramDisconnectDialogTitle}
        body={imCopy.telegramDisconnectDialogBody}
        confirmLabel={imCopy.disconnect}
        onConfirm={() => {
          setConfirmDisconnectOpen(false);
          void disconnect();
        }}
      />
    </>
  );
}
