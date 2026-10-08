import { Check, CircleNotch, Power } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import {
  deleteDiscordImConfig,
  getDiscordImConfig,
  getImSupervisorStatus,
  saveDiscordImConfig,
  startImSupervisor,
  stopImSupervisor,
  unbindDiscordImOwner,
  type DiscordImConfig,
  type ImSupervisorState,
  type ImSupervisorStatus,
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
import { DiscordGlyph } from "./Glyphs";
import { OwnerBoundRow, BindCodeCallout } from "./OwnerBinding";
import { StatusBadge } from "./StatusBadge";
import { channelStatusHint, shouldAutoExpand } from "./status";

/**
 * Discord channel card. Same single-token, owner-paired shape as the
 * Telegram card — the setup is one step longer (the bot has to be invited
 * into a server and MESSAGE CONTENT INTENT has to be on), and the running
 * state is the multi-channel one: each server channel or thread is its own
 * supervisor context, activated by @-mentioning the bot there. Channel
 * activation and exit live in Discord itself, not in this card.
 */
/** Last-loaded config — same first-frame-correctness cache as the other
 * channel cards; see the note in useImSupervisorStatus. */
let cachedDiscordConfig: DiscordImConfig | null = null;

export function DiscordCard({
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
  const [config, setConfigState] = useState<DiscordImConfig | null>(
    () => cachedDiscordConfig,
  );
  const setConfig = (next: DiscordImConfig | null) => {
    cachedDiscordConfig = next;
    setConfigState(next);
  };
  const [botToken, setBotToken] = useState("");
  const [localBusy, setLocalBusy] = useState<
    "load" | "save" | "connect" | "stop" | "disconnect" | "unbind" | null
  >(cachedDiscordConfig ? null : "load");
  const [localError, setLocalError] = useState<string | null>(null);
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(
    null,
  );
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);
  const [confirmUnbindOpen, setConfirmUnbindOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getDiscordImConfig()
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
      const saved = await saveDiscordImConfig({
        botToken: botToken.trim() || null,
      });
      setConfig(saved);
      setBotToken("");
      // Saving does not touch Core's run state (a failed channel stays
      // failed until restarted), so re-read it rather than guess.
      onStatusChange(await getImSupervisorStatus("discord").catch(() => null));
      setExpandedOverride(true);
    });

  const connect = () =>
    run("connect", async () => {
      onStatusChange(await startImSupervisor("discord", false));
    });

  const stop = () =>
    run("stop", async () => {
      onStatusChange(await stopImSupervisor("discord"));
    });

  const disconnect = () =>
    run("disconnect", async () => {
      const nextConfig = await deleteDiscordImConfig();
      setConfig(nextConfig);
      setBotToken("");
      onStatusChange(null);
    });

  const unbind = () =>
    run("unbind", async () => {
      onStatusChange(await unbindDiscordImOwner());
      setConfig(await getDiscordImConfig());
    });

  // Owner binding view state. The live status wins (it carries the
  // pairing code while running unbound); the persisted config covers
  // the stopped-but-bound case.
  const ownerUserId = status?.ownerOpenId ?? config?.ownerUserId ?? null;
  const ownerBoundAt = config?.ownerBoundAt ?? null;
  const bindCode = ownerUserId ? null : (status?.bindCode ?? null);
  const setUp = isChannelSetUp("discord", derivedState, ownerUserId);
  const view = channelCardView("discord", derivedState, setUp);
  const errorText = localError ?? statusLoadError ?? status?.lastError ?? null;
  const statusHint = errorReplacesStatusHint(derivedState, errorText)
    ? null
    : channelStatusHint("discord", derivedState, setUp, imCopy);
  const primaryAction = configuredPrimaryAction(derivedState);

  const setupSteps = imCopy.discordSetupSteps.map((step) =>
    stepWithLink(
      step,
      "Discord Developer Portal",
      "https://discord.com/developers/applications",
    ),
  );
  const tokenInput = (
    <div className="max-w-[460px]">
      <SettingsInput
        label={imCopy.discordBotTokenLabel}
        type="password"
        value={botToken}
        onChange={setBotToken}
        placeholder={
          config?.hasBotToken
            ? imCopy.discordTokenSavedPlaceholder
            : imCopy.discordBotTokenPlaceholder
        }
      />
    </div>
  );
  const saveButton = (
    <Button
      type="button"
      // One primary per card: saving is the next step until the token
      // is stored, then starting (or the set-up view's resume / retry)
      // takes it.
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
        {imCopy.discordConfigLoading}
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
      lead={imCopy.discordBindWaitingLead}
      code={bindCode}
      afterCode={imCopy.discordBindWaitingAfterCode}
    />
  ) : null;
  const errorBlock = (
    <ChannelErrorBlock
      platform="discord"
      state={derivedState}
      error={errorText}
    />
  );
  // The two declarations the setup guide is the only line of defence for
  // (PRD 外审票 1 / 2): channel output is visible to everyone who can see
  // the channel, and everything the owner says in an activated channel
  // goes to the agent. They stay visible in every state (OAS Channels).
  const securityNote = (
    <ChannelSecurityNote others={imCopy.discordOwnerScope}>
      <p>{imCopy.discordChannelVisibilityNote}</p>
      <p>{imCopy.discordChannelScopeNote}</p>
    </ChannelSecurityNote>
  );

  return (
    <>
      <ChannelCard
        expanded={expanded}
        onToggle={() => setExpandedOverride(!expanded)}
        glyph={<DiscordGlyph active={expanded} />}
        title={imCopy.discordTitle}
        badge={
          <StatusBadge
            kind={channelBadgeKind("discord", derivedState, setUp)}
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
              {/* Discord keeps its running steps: they explain channel
                  activation, which the other platforms don't have. */}
              <ConnectionSteps steps={imCopy.discordConnectedSteps} />
              <ChannelCommandReference platform="discord" />
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
                    : imCopy.discordStartService}
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
        title={imCopy.discordUnbindDialogTitle}
        body={imCopy.discordUnbindDialogBody}
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
        title={imCopy.discordDisconnectDialogTitle}
        body={imCopy.discordDisconnectDialogBody}
        confirmLabel={imCopy.disconnect}
        onConfirm={() => {
          setConfirmDisconnectOpen(false);
          void disconnect();
        }}
      />
    </>
  );
}
