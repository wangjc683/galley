import { Check, CircleNotch, Power } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import {
  deleteTelegramImConfig,
  getImSupervisorStatus,
  getTelegramImConfig,
  saveTelegramImConfig,
  startImSupervisor,
  stopImSupervisor,
  unbindTelegramImOwner,
  type ImSupervisorState,
  type ImSupervisorStatus,
  type TelegramImConfig,
} from "@/lib/im-supervisor";

import { SettingsInput } from "../models/ModelPrimitives";

import { ChannelActionsMenu } from "./ChannelActionsMenu";
import { ChannelCard } from "./ChannelCard";
import { ChannelErrorBlock } from "./ChannelErrorBlock";
import {
  ChannelFold,
  ChannelPrimaryButton,
  ChannelSecurityNote,
  ChannelStatusHint,
} from "./ChannelParts";
import {
  canPauseChannel,
  channelBadgeKind,
  channelCardView,
  configuredPrimaryAction,
  errorReplacesStatusHint,
  isChannelSetUp,
} from "./channel-view";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { ChannelCommandReference } from "./CommandReference";
import { ConnectionSteps } from "./ConnectionSteps";
import { stepWithLink } from "./step-link";
import { TelegramGlyph } from "./Glyphs";
import { OwnerBoundRow, BindCodeCallout } from "./OwnerBinding";
import { StatusBadge } from "./StatusBadge";
import { channelStatusHint, shouldAutoExpand } from "./status";

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
  const canPause = canPauseChannel(status);
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
      // Saving does not touch Core's run state (a failed channel stays
      // failed until restarted), so re-read it rather than guess.
      onStatusChange(await getImSupervisorStatus("telegram").catch(() => null));
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
  const setUp = isChannelSetUp("telegram", derivedState, ownerUserId);
  const view = channelCardView("telegram", derivedState, setUp);
  const errorText = localError ?? statusLoadError ?? status?.lastError ?? null;
  const statusHint = errorReplacesStatusHint(derivedState, errorText)
    ? null
    : channelStatusHint("telegram", derivedState, setUp, imCopy);
  const primaryAction = configuredPrimaryAction(derivedState);

  const setupSteps = imCopy.telegramSetupSteps.map((step) =>
    stepWithLink(step, "@BotFather", "https://t.me/BotFather"),
  );
  const tokenInput = (
    <div className="max-w-[460px]">
      <SettingsInput
        label={imCopy.telegramBotTokenLabel}
        type="password"
        value={botToken}
        onChange={setBotToken}
        placeholder={
          config?.hasBotToken
            ? imCopy.telegramTokenSavedPlaceholder
            : imCopy.telegramBotTokenPlaceholder
        }
      />
    </div>
  );
  const saveButton = (
    <Button
      type="button"
      // Primary tracks the current actionable step, same rule as the
      // Feishu card: saving is the next step until the token is stored,
      // then starting (or the set-up view's resume / retry) takes it.
      variant={canStartService || setUp ? "secondary" : "primary"}
      size="sm"
      disabled={busy || !canSaveCredentials}
      leadingIcon={
        localBusy === "save" ? (
          <CircleNotch size={13} weight="thin" className="spin" />
        ) : (
          <Check size={13} weight="thin" />
        )
      }
      onClick={saveCredentials}
    >
      {localBusy === "save" ? imCopy.working : imCopy.save}
    </Button>
  );
  const loadingNote =
    localBusy === "load" ? (
      <span className="text-ui-meta text-ink-muted">
        {imCopy.telegramConfigLoading}
      </span>
    ) : null;
  const owner = ownerUserId ? (
    <OwnerBoundRow
      ownerId={ownerUserId}
      boundAt={ownerBoundAt}
      busy={busy}
      working={localBusy === "unbind"}
      onUnbind={() => setConfirmUnbindOpen(true)}
    />
  ) : bindCode ? (
    <BindCodeCallout
      lead={imCopy.telegramBindWaitingLead}
      code={bindCode}
      afterCode={imCopy.telegramBindWaitingAfterCode}
    />
  ) : null;
  const errorBlock = (
    <ChannelErrorBlock
      platform="telegram"
      state={derivedState}
      error={errorText}
    />
  );
  const securityNote = (
    <ChannelSecurityNote others={imCopy.telegramOwnerScope} />
  );

  return (
    <>
      <ChannelCard
        expanded={expanded}
        onToggle={() => setExpandedOverride(!expanded)}
        glyph={<TelegramGlyph active={expanded} />}
        title={imCopy.telegramTitle}
        badge={
          <StatusBadge
            kind={channelBadgeKind("telegram", derivedState, setUp)}
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
          {view === "running" ? (
            <>
              {statusHint ? (
                <ChannelStatusHint>{statusHint}</ChannelStatusHint>
              ) : null}
              {errorBlock}
              <ChannelCommandReference platform="telegram" />
              {owner}
              {securityNote}
            </>
          ) : view === "configured" ? (
            <>
              {statusHint ? (
                <ChannelStatusHint>{statusHint}</ChannelStatusHint>
              ) : null}
              {errorBlock}
              {primaryAction ? (
                <ChannelPrimaryButton
                  action={primaryAction}
                  disabled={busy}
                  pending={localBusy === "connect"}
                  onClick={connect}
                />
              ) : null}
              <ChannelFold title={imCopy.changeBotTokenOrSteps}>
                <ConnectionSteps steps={setupSteps} />
                {tokenInput}
                <div className="flex flex-wrap items-center gap-2">
                  {saveButton}
                  {loadingNote}
                </div>
              </ChannelFold>
              {owner}
              {securityNote}
            </>
          ) : (
            <>
              <ConnectionSteps steps={setupSteps} status={statusHint} />
              {errorBlock}
              {tokenInput}
              <div className="flex flex-wrap items-center gap-2">
                {saveButton}
                <Button
                  type="button"
                  variant={canStartService ? "primary" : "secondary"}
                  size="sm"
                  disabled={busy || !canStartService}
                  leadingIcon={
                    localBusy === "connect" ? (
                      <CircleNotch size={13} weight="thin" className="spin" />
                    ) : (
                      <Power size={13} weight="thin" />
                    )
                  }
                  onClick={connect}
                >
                  {localBusy === "connect"
                    ? imCopy.working
                    : imCopy.telegramStartService}
                </Button>
                {loadingNote}
              </div>
              {owner}
              {securityNote}
            </>
          )}
        </div>
      </ChannelCard>

      <ConfirmActionDialog
        open={confirmUnbindOpen}
        onOpenChange={setConfirmUnbindOpen}
        busy={busy}
        title={imCopy.telegramUnbindDialogTitle}
        body={imCopy.telegramUnbindDialogBody}
        confirmLabel={imCopy.ownerUnbind}
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
