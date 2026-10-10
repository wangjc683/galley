import {
  CheckCircle,
  CircleNotch,
  DeviceMobileSlash,
  LinkBreak,
  QrCode,
  WarningCircle,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";

import { SettingsPanelHeader } from "@/components/screens/settings/settings-ui";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { useDayStamp } from "@/hooks/useDayStamp";
import { useCopy, useLanguage } from "@/lib/i18n";
import { formatMessageDateTime } from "@/lib/message-time";
import {
  cancelRemotePairing,
  pairRemotePhone,
  unpairRemotePhones,
  type RemoteStatus,
} from "@/lib/remote";

import { ErrorLine } from "./models/ModelPrimitives";
import {
  phonePageView,
  settleQr,
  svgDataUrl,
  type PhoneConnectionKind,
  type ShownQr,
} from "./phone-view";
import { SettingsStatusBadge } from "./settings-badges";

const STATUS_ICON: Record<PhoneConnectionKind, PhosphorIcon> = {
  online: CheckCircle,
  idle: DeviceMobileSlash,
  connecting: CircleNotch,
};

type Busy = "pair" | "unpair" | null;

/** End a pairing still waiting for its first phone (Core ignores it once
 * paired). Nothing to tell the user if it fails: the pairing ends by
 * itself after 10 minutes. */
function cancelPairing() {
  cancelRemotePairing().catch((e: unknown) => {
    console.warn("[remote] cancelling the pairing failed", e);
  });
}

/**
 * Settings → Phone (ticket 05d): pair an iPhone with this desktop, see
 * whether it is connected, unpair. Core's remote module owns all of it;
 * the page asks (`pair_remote_phone`, `cancel_remote_pairing`,
 * `unpair_remote_phones`) and shows the status it is given, live from
 * `remote-status`. The layout follows Core's `paired` alone: the desktop
 * is paired once the first phone has connected, not when a code exists.
 *
 * The pairing QR code appears only after Show pairing code and folds
 * away when a phone connects (the scan), when Core ends a pairing that
 * got no phone (10 minutes), on Hide pairing code, or when the page goes
 * away (it is local state). Hiding it and leaving the page also cancel
 * the pairing in Core, so a code nobody scanned stops working at once
 * (after Add a phone that is a no-op: the stored code stays). Core draws
 * it as an SVG, so the code — it carries the pairing key — is never text
 * in this page; there is deliberately no copy button. The wording never
 * names the relay: the phone connects to this computer, and the relay
 * being down reads as the network.
 *
 * Decision 10's background check: with "Keep running when the window
 * closes" off, closing the window quits Galley and the phones lose it,
 * so a hint with a button turns the existing preference on. Keeping the
 * computer awake on power is ticket 04 and not here.
 */
export function SettingsPhone({
  status,
  keepInBackgroundOnClose,
  onEnableKeepInBackground,
}: {
  status: RemoteStatus;
  keepInBackgroundOnClose: boolean;
  onEnableKeepInBackground: () => void;
}) {
  const appCopy = useCopy();
  const copy = appCopy.settings.phone;
  const language = useLanguage();
  const dayStamp = useDayStamp();
  const [qr, setQr] = useState<ShownQr | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmUnpairOpen, setConfirmUnpairOpen] = useState(false);

  // The scan, Core ending the pairing: the code goes.
  const shownQr = settleQr(status, qr);
  if (shownQr !== qr) setQr(shownQr);

  // Leaving the page (another tab, Settings closing) ends a pairing that
  // is still waiting for its phone.
  useEffect(() => cancelPairing, []);

  const lastConnectedText = status.lastPhoneConnectedAt
    ? formatMessageDateTime(status.lastPhoneConnectedAt, dayStamp, language)
    : null;
  const view = phonePageView({
    status,
    qr: shownQr,
    keepInBackgroundOnClose,
    lastConnectedText,
    copy,
  });
  const errorLine = error ?? view.pairingError;

  const toggleQr = async () => {
    if (shownQr !== null) {
      setQr(null);
      cancelPairing();
      return;
    }
    const since = status.lastPhoneConnectedAt;
    setBusy("pair");
    setError(null);
    try {
      const { qrSvg } = await pairRemotePhone();
      setQr({ svg: qrSvg, since, pairingSeen: false });
    } catch (e) {
      setError(copy.pairFailed(String(e)));
    } finally {
      setBusy(null);
    }
  };

  const unpair = async () => {
    setBusy("unpair");
    setError(null);
    setQr(null);
    try {
      await unpairRemotePhones();
    } catch (e) {
      setError(copy.unpairFailed(String(e)));
    } finally {
      setBusy(null);
    }
  };

  const showCodeButton = (variant: "primary" | "secondary") => (
    <Button
      type="button"
      size="sm"
      variant={view.showQr ? "secondary" : variant}
      disabled={busy !== null}
      leadingIcon={
        busy === "pair" ? (
          <CircleNotch size={13} weight="thin" className="spin" />
        ) : (
          <QrCode size={13} weight="thin" />
        )
      }
      onClick={() => void toggleQr()}
    >
      {view.showQr ? copy.hideCode : copy.showCode}
    </Button>
  );

  const qrBlock =
    view.showQr && shownQr !== null ? (
      <div className="flex flex-wrap items-center gap-5 px-3 py-3">
        <div className="flex h-[168px] w-[168px] shrink-0 items-center justify-center rounded-sm border border-line bg-elevated">
          <img
            src={svgDataUrl(shownQr.svg)}
            alt={copy.qrAlt}
            draggable={false}
            className="h-[148px] w-[148px] select-none"
          />
        </div>
        <div className="min-w-0 max-w-[440px] flex-1 space-y-2 text-ui-compact leading-secondary text-ink-soft">
          {copy.scanSteps.map((step) => (
            <p key={step}>{step}</p>
          ))}
          {view.showQrExpiry && <p>{copy.qrExpiry}</p>}
          <p className="text-ui-meta leading-dense text-ink-muted">
            {copy.scanWarning}
          </p>
        </div>
      </div>
    ) : null;

  return (
    <div className="space-y-7">
      <SettingsPanelHeader
        title={appCopy.settings.tabs.phone.title}
        subtitle={copy.subtitle}
      />

      <div className="space-y-3">
        {view.layout === "pair" ? (
          <div className="divide-y divide-line rounded-sm border border-line bg-surface">
            <PhoneRow title={copy.pairTitle} description={copy.pairDescription}>
              {showCodeButton("primary")}
            </PhoneRow>
            {qrBlock}
          </div>
        ) : (
          <div className="divide-y divide-line rounded-sm border border-line bg-surface">
            {view.status && (
              <PhoneRow
                title={view.status.title}
                description={view.status.detail}
              >
                <SettingsStatusBadge
                  tone={view.status.badge.tone}
                  icon={STATUS_ICON[view.status.kind]}
                  spin={view.status.badge.spin}
                >
                  {view.status.badge.label}
                </SettingsStatusBadge>
              </PhoneRow>
            )}
            <PhoneRow title={copy.addTitle} description={copy.addDescription}>
              {showCodeButton("secondary")}
            </PhoneRow>
            {qrBlock}
            <PhoneRow
              title={copy.unpairTitle}
              description={copy.unpairDescription}
            >
              <Button
                type="button"
                size="sm"
                variant="destructive-soft"
                disabled={busy !== null}
                leadingIcon={
                  busy === "unpair" ? (
                    <CircleNotch size={13} weight="thin" className="spin" />
                  ) : (
                    <LinkBreak size={13} weight="thin" />
                  )
                }
                onClick={() => setConfirmUnpairOpen(true)}
              >
                {copy.unpair}
              </Button>
            </PhoneRow>
          </div>
        )}

        {errorLine && <ErrorLine message={errorLine} />}

        {view.showBackgroundHint && (
          <div className="flex flex-wrap items-center gap-3 rounded-sm border border-warning/25 bg-warning/[var(--opacity-subtle)] px-3 py-2.5">
            <WarningCircle
              size={16}
              weight="bold"
              className="shrink-0 text-warning"
            />
            <div className="min-w-0 flex-1">
              <div className="text-ui-secondary font-medium text-ink">
                {copy.backgroundHintTitle}
              </div>
              <div className="mt-0.5 text-ui-tertiary leading-notice text-ink-muted">
                {copy.backgroundHintBody}
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onEnableKeepInBackground}
            >
              {copy.backgroundHintAction}
            </Button>
          </div>
        )}
      </div>

      <ConfirmActionDialog
        open={confirmUnpairOpen}
        onOpenChange={setConfirmUnpairOpen}
        busy={busy === "unpair"}
        title={copy.unpairDialogTitle}
        body={copy.unpairDialogBody}
        confirmLabel={copy.unpair}
        onConfirm={() => {
          setConfirmUnpairOpen(false);
          void unpair();
        }}
      />
    </div>
  );
}

/** The General tab's row grammar: title + one-line description on the
 * left, the control on the right. */
function PhoneRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-ui-compact font-medium text-ink">{title}</div>
        <div className="mt-0.5 max-w-[600px] text-ui-meta leading-snug text-ink-muted">
          {description}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
