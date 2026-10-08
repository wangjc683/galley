import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, CircleNotch, Power } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import {
  deleteFeishuImConfig,
  getFeishuImConfig,
  getImSupervisorStatus,
  saveFeishuImConfig,
  startImSupervisor,
  stopImSupervisor,
  unbindFeishuImOwner,
  type FeishuImConfig,
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
import { FeishuSetupGuide } from "./FeishuSetupGuide";
import { FeishuGlyph } from "./Glyphs";
import { OwnerBoundRow, BindCodeCallout } from "./OwnerBinding";
import { StatusBadge } from "./StatusBadge";
import { channelStatusHint, shouldAutoExpand } from "./status";

/** Last-loaded config, module-level for the same reason as the
 * status cache in useImSupervisorStatus: re-entering Channels should
 * paint the card's real state on the first frame instead of deriving
 * a wrong default from null and snapping when the fetch lands. */
let cachedFeishuConfig: FeishuImConfig | null = null;

export function FeishuCard({
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
  const [config, setConfigState] = useState<FeishuImConfig | null>(
    () => cachedFeishuConfig,
  );
  const setConfig = (next: FeishuImConfig | null) => {
    cachedFeishuConfig = next;
    setConfigState(next);
  };
  const [appId, setAppId] = useState(cachedFeishuConfig?.appId ?? "");
  const [appSecret, setAppSecret] = useState("");
  const [localBusy, setLocalBusy] = useState<
    | "load"
    | "open"
    | "save"
    | "connect"
    | "stop"
    | "disconnect"
    | "unbind"
    | null
  >(cachedFeishuConfig ? null : "load");
  const [localError, setLocalError] = useState<string | null>(null);
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(
    null,
  );
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);
  const [confirmUnbindOpen, setConfirmUnbindOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getFeishuImConfig()
      .then((next) => {
        if (cancelled) return;
        setConfig(next);
        setAppId(next.appId);
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

  const savedAppId = config?.appId.trim() ?? "";
  const trimmedAppId = appId.trim();
  const hasSavedSecretForApp =
    Boolean(config?.hasAppSecret) && trimmedAppId === savedAppId;
  const hasUsableSecret = appSecret.trim().length > 0 || hasSavedSecretForApp;
  const canSaveCredentials = trimmedAppId.length > 0 && hasUsableSecret;
  const canStartService =
    trimmedAppId.length > 0 &&
    trimmedAppId === savedAppId &&
    Boolean(config?.hasAppSecret);
  const derivedState: ImSupervisorState =
    status?.state ??
    (config?.appId && config.hasAppSecret ? "stopped" : "not_connected");
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
      const saved = await saveFeishuImConfig({
        appId: appId.trim(),
        appSecret: appSecret.trim() || null,
      });
      setConfig(saved);
      setAppSecret("");
      // Saving does not touch Core's run state (a failed channel stays
      // failed until restarted), and a new App ID clears the owner, so
      // re-read the status rather than guess.
      onStatusChange(await getImSupervisorStatus("feishu").catch(() => null));
      setExpandedOverride(true);
    });

  const connect = () =>
    run("connect", async () => {
      onStatusChange(await startImSupervisor("feishu", false));
    });

  const stop = () =>
    run("stop", async () => {
      onStatusChange(await stopImSupervisor("feishu"));
    });

  const disconnect = () =>
    run("disconnect", async () => {
      const nextConfig = await deleteFeishuImConfig();
      setConfig(nextConfig);
      setAppId("");
      setAppSecret("");
      onStatusChange(null);
    });

  const unbind = () =>
    run("unbind", async () => {
      onStatusChange(await unbindFeishuImOwner());
      setConfig(await getFeishuImConfig());
    });

  // Owner binding view state. The live status wins (it carries the
  // pairing code while running unbound); the persisted config covers
  // the stopped-but-bound case.
  const ownerOpenId = status?.ownerOpenId ?? config?.ownerOpenId ?? null;
  const ownerBoundAt = config?.ownerBoundAt ?? null;
  const bindCode = ownerOpenId ? null : (status?.bindCode ?? null);
  const setUp = isChannelSetUp("feishu", derivedState, ownerOpenId);
  const view = channelCardView("feishu", derivedState, setUp);
  const errorText = localError ?? statusLoadError ?? status?.lastError ?? null;
  const statusHint = errorReplacesStatusHint(derivedState, errorText)
    ? null
    : channelStatusHint("feishu", derivedState, setUp, imCopy);
  const primaryAction = configuredPrimaryAction(derivedState);

  const openFeishuConsole = () =>
    run("open", async () => {
      await openUrl("https://open.feishu.cn/");
    });

  const credentialsForm = (
    <div className="grid gap-3 md:grid-cols-2">
      <div>
        <SettingsInput
          label={imCopy.feishuAppIdLabel}
          value={appId}
          onChange={setAppId}
          placeholder={imCopy.feishuAppIdPlaceholder}
        />
        {/* Core clears the owner when the App ID changes (open_id is
            per app), so say so before the save, not after. */}
        {ownerOpenId ? (
          <p className="mt-1.5 text-ui-tertiary leading-notice text-ink-muted">
            {imCopy.feishuAppIdChangeUnbinds}
          </p>
        ) : null}
      </div>
      <SettingsInput
        label={imCopy.feishuAppSecretLabel}
        type="password"
        value={appSecret}
        onChange={setAppSecret}
        placeholder={
          hasSavedSecretForApp
            ? imCopy.feishuSecretSavedPlaceholder
            : imCopy.feishuAppSecretPlaceholder
        }
      />
    </div>
  );
  const saveAction = (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        // Primary tracks the current actionable step: while credentials
        // aren't saved yet, saving IS the next step; once the service can
        // start (or the set-up view shows resume / retry), save demotes to
        // a secondary re-save.
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
      {localBusy === "load" ? (
        <span className="text-ui-meta text-ink-muted">
          {imCopy.feishuConfigLoading}
        </span>
      ) : null}
    </div>
  );
  const startAction = (
    <div className="flex flex-wrap items-center gap-2">
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
        {localBusy === "connect" ? imCopy.working : imCopy.feishuStartService}
      </Button>
    </div>
  );
  const owner = ownerOpenId ? (
    <OwnerBoundRow
      ownerId={ownerOpenId}
      boundAt={ownerBoundAt}
      busy={busy}
      working={localBusy === "unbind"}
      onUnbind={() => setConfirmUnbindOpen(true)}
    />
  ) : bindCode ? (
    <BindCodeCallout
      lead={imCopy.feishuBindWaitingLead}
      code={bindCode}
      afterCode={`${imCopy.feishuBindWaitingAfterCode} ${imCopy.feishuOwnerScopeAdvice}`}
    />
  ) : null;
  const errorBlock = (
    <ChannelErrorBlock
      platform="feishu"
      state={derivedState}
      error={errorText}
    />
  );
  const securityNote = <ChannelSecurityNote others={imCopy.feishuOwnerScope} />;

  return (
    <>
      <ChannelCard
        expanded={expanded}
        onToggle={() => setExpandedOverride(!expanded)}
        glyph={<FeishuGlyph active={expanded} />}
        title={imCopy.feishuTitle}
        badge={
          <StatusBadge kind={channelBadgeKind("feishu", derivedState, setUp)} />
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
              <ChannelCommandReference platform="feishu" />
              {/* Read-only reference once paired: the Open Platform side
                  is done, but its steps stay a click away. */}
              <ChannelFold title={imCopy.feishuSetupCollapsed}>
                <FeishuSetupGuide
                  imCopy={imCopy}
                  onOpenConsole={openFeishuConsole}
                  openDisabled={busy}
                />
              </ChannelFold>
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
              <ChannelFold title={imCopy.feishuChangeCredentials}>
                <FeishuSetupGuide
                  imCopy={imCopy}
                  onOpenConsole={openFeishuConsole}
                  openDisabled={busy}
                  credentialsForm={credentialsForm}
                  saveAction={saveAction}
                />
              </ChannelFold>
              {owner}
              {securityNote}
            </>
          ) : view === "feishu_first_run" ? (
            <>
              {/* Running but nobody paired yet: sections 4–6 (long
                  connection, events, publishing) happen now, against
                  the live service, so the guide stays open. */}
              {statusHint ? (
                <ChannelStatusHint>{statusHint}</ChannelStatusHint>
              ) : null}
              {errorBlock}
              <FeishuSetupGuide
                imCopy={imCopy}
                onOpenConsole={openFeishuConsole}
                openDisabled={busy}
                credentialsForm={credentialsForm}
                saveAction={saveAction}
              />
              {owner}
              {securityNote}
            </>
          ) : (
            <>
              <FeishuSetupGuide
                imCopy={imCopy}
                onOpenConsole={openFeishuConsole}
                openDisabled={busy}
                credentialsForm={credentialsForm}
                saveAction={saveAction}
                startAction={startAction}
              />
              {statusHint ? (
                <ChannelStatusHint indent>{statusHint}</ChannelStatusHint>
              ) : null}
              {errorBlock}
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
        title={imCopy.feishuUnbindDialogTitle}
        body={imCopy.feishuUnbindDialogBody}
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
        title={imCopy.feishuDisconnectDialogTitle}
        body={imCopy.feishuDisconnectDialogBody}
        confirmLabel={imCopy.disconnect}
        onConfirm={() => {
          setConfirmDisconnectOpen(false);
          void disconnect();
        }}
      />
    </>
  );
}
