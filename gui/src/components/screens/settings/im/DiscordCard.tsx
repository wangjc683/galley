import { Check, CircleNotch, Power } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import {
  deleteDiscordImConfig,
  getDiscordImConfig,
  saveDiscordImConfig,
  startImSupervisor,
  stopImSupervisor,
  unbindDiscordImOwner,
  type DiscordImConfig,
  type ImSupervisorState,
  type ImSupervisorStatus,
} from "@/lib/im-supervisor";

import { ChannelActionsMenu } from "./ChannelActionsMenu";
import { ChannelCard } from "./ChannelCard";
import { ChannelErrorBlock } from "./ChannelErrorBlock";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { DiscordCommandReference } from "./CommandReference";
import { ConnectionSteps } from "./ConnectionSteps";
import { DiscordGlyph } from "./Glyphs";
import { OwnerBoundRow, BindCodeCallout } from "./OwnerBinding";
import { StatusBadge } from "./StatusBadge";
import { discordStatusHintForState } from "./status";

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
  const attentionState = derivedState === "expired" || derivedState === "error";
  // Same ready gate as the other cards: don't derive auto-expansion from
  // null config/status — it guesses wrong for configured users and snaps
  // shut when the fetches land.
  const ready = config !== null && status !== null;
  const expanded =
    expandedOverride ??
    (ready &&
      (attentionState ||
        derivedState === "not_connected" ||
        derivedState === "stopped"));
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
      const saved = await saveDiscordImConfig({
        botToken: botToken.trim() || null,
      });
      setConfig(saved);
      setBotToken("");
      onStatusChange(null);
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

  return (
    <>
      <ChannelCard
        expanded={expanded}
        onToggle={() => setExpandedOverride(!expanded)}
        glyph={<DiscordGlyph active={expanded} />}
        title={imCopy.discordTitle}
        badge={
          <StatusBadge
            state={derivedState}
            iconStateOverride={
              derivedState === "stopped" ? "not_connected" : undefined
            }
            labelOverride={
              derivedState === "running"
                ? imCopy.discordServiceStarted
                : derivedState === "stopped"
                  ? imCopy.discordNotStarted
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
              running ? imCopy.discordConnectedSteps : imCopy.discordSetupSteps
            }
            status={discordStatusHintForState(derivedState, imCopy)}
          />

          {running ? (
            <DiscordCommandReference imCopy={imCopy} />
          ) : (
            <>
              <div className="max-w-[460px]">
                <label className="block">
                  <span className="mb-1.5 block text-ui-meta font-medium text-ink-soft">
                    {imCopy.discordBotTokenLabel}
                  </span>
                  <input
                    type="password"
                    value={botToken}
                    onChange={(e) => setBotToken(e.target.value)}
                    placeholder={
                      config?.hasBotToken
                        ? imCopy.discordTokenSavedPlaceholder
                        : imCopy.discordBotTokenPlaceholder
                    }
                    spellCheck={false}
                    className="w-full rounded-sm border border-line bg-surface px-3 py-2 font-mono text-ui-secondary text-ink outline-none transition-colors duration-(--motion-fast) ease-firm placeholder:text-ink-muted/70 focus:border-brand focus:ring-[3px] focus:ring-brand/20"
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  // One primary per card: saving is the next step until the
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
                    : imCopy.discordSaveCredentials}
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
                    : imCopy.discordStartService}
                </Button>
                {localBusy === "load" ? (
                  <span className="text-ui-meta text-ink-muted">
                    {imCopy.discordConfigLoading}
                  </span>
                ) : null}
              </div>
            </>
          )}

          {ownerUserId ? (
            <OwnerBoundRow
              ownerId={ownerUserId}
              boundAt={ownerBoundAt}
              boundLabel={imCopy.discordBoundLabel}
              boundAtLabel={imCopy.discordBoundAt}
              unbindLabel={imCopy.discordUnbind}
              workingLabel={imCopy.working}
              busy={busy}
              working={localBusy === "unbind"}
              onUnbind={() => setConfirmUnbindOpen(true)}
            />
          ) : bindCode ? (
            <BindCodeCallout
              title={imCopy.discordBindWaitingTitle}
              lead={imCopy.discordBindWaitingLead}
              code={bindCode}
              afterCode={imCopy.discordBindWaitingAfterCode}
            />
          ) : null}

          {/* The two declarations the setup guide is the only line of
              defence for (PRD 外审票 1 / 2): channel output is visible to
              everyone who can see the channel, and everything the owner
              says in an activated channel goes to the agent. */}
          <div className="space-y-1.5 text-ui-tertiary leading-notice text-ink-muted">
            <p>{imCopy.discordOwnerSecurityNote}</p>
            <p>{imCopy.discordChannelVisibilityNote}</p>
            <p>{imCopy.discordChannelScopeNote}</p>
          </div>

          <ChannelErrorBlock
            error={localError ?? statusLoadError ?? status?.lastError ?? null}
          />
        </div>
      </ChannelCard>

      <ConfirmActionDialog
        open={confirmUnbindOpen}
        onOpenChange={setConfirmUnbindOpen}
        busy={busy}
        title={imCopy.discordUnbindDialogTitle}
        body={imCopy.discordUnbindDialogBody}
        confirmLabel={imCopy.discordUnbind}
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
