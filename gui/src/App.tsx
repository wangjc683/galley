import { useCallback, useMemo, useState } from "react";

import { ToastHost } from "@/components/error-card/ToastHost";
import { AppShell } from "@/components/layout/AppShell";
import { MainHeader } from "@/components/layout/MainHeader";
import { Sidebar } from "@/components/layout/Sidebar";
import { resolveSidebarRuntimeIndicator } from "@/components/layout/sidebar/runtime-indicator";
import { CommandPalette } from "@/components/overlay/CommandPalette";
import { ThemeProvider } from "@/components/theme/ThemeContext";
import { BrowserControlAttentionSurface } from "@/components/screens/BrowserControlAttentionBanner";
import { EmptyState } from "@/components/screens/EmptyState";
import { MainView } from "@/components/screens/MainView";
import { Onboarding } from "@/components/screens/onboarding/Onboarding";
import { Settings } from "@/components/screens/settings/Settings";
import type { SettingsTab } from "@/components/screens/settings/settings-types";
import { YoloIntroDialog } from "@/components/screens/YoloIntroDialog";
import { ArchivedDialog } from "@/components/screens/archived/ArchivedDialog";
import { EarlierDialog } from "@/components/screens/earlier/EarlierDialog";
import { CreateProjectDialog } from "@/components/screens/project/CreateProjectDialog";
import {
  ConfirmDeleteProjectDialog,
  EditProjectDialog,
} from "@/components/screens/project/EditProjectDialog";
import { CopyProvider, copyForLanguage } from "@/lib/i18n";
import { useAppHydrationEffects } from "@/hooks/useAppHydrationEffects";
import { useBrowserControlStartupEffect } from "@/hooks/useBrowserControlStartupEffect";
import { useExternalCoreEvents } from "@/hooks/useExternalCoreEvents";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { useGoalEffects } from "@/hooks/useGoalEffects";
import { useImSupervisorStatus } from "@/hooks/useImSupervisorStatus";
import { useProjectNavigation } from "@/hooks/useProjectNavigation";
import { useThemeAndCloseHintEffects } from "@/hooks/useThemeAndCloseHintEffects";
import {
  getGoalStatus,
  goalMasterSessionTitle,
  markGoalResultSeen,
  startDesktopGoal,
  stopGoal,
} from "@/lib/goals";
import {
  aggregateChannelsState,
  restartEnabledImSupervisors,
} from "@/lib/im-supervisor";
import { ensureHistoryReplayComplete } from "@/lib/ipc/history-replay";
import { resolveLanguagePreference } from "@/lib/language";
import { logPerf, perfNow } from "@/lib/perf";
import {
  currentLLMDisplayName,
  managedModelsToLLMs,
} from "@/lib/managed-model-options";
import { bucketSession } from "@/lib/sessions";
import type { EpigraphCondition } from "@/lib/epigraphs";
import { useAppUpdateStore } from "@/stores/app-update";
import { useBrowserControlStore } from "@/stores/browser-control";
import {
  EMPTY_APPROVALS,
  EMPTY_DECISIONS,
  EMPTY_TURNS,
  useMessagesStore,
} from "@/stores/messages";
import { useManagedModelsStore } from "@/stores/managed-models";
import { usePrefsStore } from "@/stores/prefs";
import { useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";
import { makeAppError } from "@/types/app-error";
import type { PendingImageAttachment } from "@/types/conversation";
import type { GoalBrief, GoalLaunchConfig } from "@/types/goal";
import type { ApprovalDecision } from "@/types/ipc";

/**
 * V0.1 Stage 2 #8 — App entry.
 *
 * State lives in the Zustand slices under `stores/`. App is now
 * mostly wiring: pull screen / approval / runtime out of the stores,
 * feed them down to the four screens (Onboarding, Empty State, Main
 * View, plus the modal-y Settings + Command Palette + ToastHost),
 * route component callbacks back to store actions.
 */
function App() {
  const screen = useUiStore((s) => s.screen);
  const setScreen = useUiStore((s) => s.setScreen);

  const paletteOpen = useUiStore((s) => s.paletteOpen);
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);

  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("runtime");
  const browserControlStatus = useBrowserControlStore((s) => s.status);

  // Sidebar live-status comes from `sessions` directly: messagesStore's
  // `fireSessionMirror` writes sidebar-visible fields (status,
  // pendingApprovalCount, hasPendingAskUser) onto each session row
  // whenever the conversation changes, but only generates a new
  // `sessions` array when those fields actually change. So a plain
  // selector with default strict-equality stays stable through
  // frequent non-sidebar updates like turn_progress streaming.
  const sessions = useSessionsStore((s) => s.sessions);
  const activeSessionId = useSessionsStore((s) => s.activeSessionId);
  const createSession = useSessionsStore((s) => s.createSession);
  const createSessionPersisted = useSessionsStore(
    (s) => s.createSessionPersisted,
  );
  // activateSession is the orchestrator — moved to sessionsStore in
  // B3 M5 so it sits next to active id ownership.
  const activateSession = useSessionsStore((s) => s.activateSession);
  const setActiveSession = useSessionsStore((s) => s.setActiveSession);
  const archiveSession = useSessionsStore((s) => s.archiveSession);
  const unarchiveSession = useSessionsStore((s) => s.unarchiveSession);
  const togglePinSession = useSessionsStore((s) => s.togglePinSession);
  const renameSession = useSessionsStore((s) => s.renameSession);
  const projects = useSessionsStore((s) => s.projects);
  const activeProjectFilter = useSessionsStore((s) => s.activeProjectFilter);
  const createProject = useSessionsStore((s) => s.createProject);
  const setActiveProjectFilter = useSessionsStore(
    (s) => s.setActiveProjectFilter,
  );
  const assignSessionToProject = useSessionsStore(
    (s) => s.assignSessionToProject,
  );
  const updateProject = useSessionsStore((s) => s.updateProject);
  const deleteProject = useSessionsStore((s) => s.deleteProject);
  const archiveSessionsBulk = useSessionsStore((s) => s.archiveSessionsBulk);
  const unarchiveSessionsBulk = useSessionsStore(
    (s) => s.unarchiveSessionsBulk,
  );
  const deleteSessionsPermanentlyBulk = useSessionsStore(
    (s) => s.deleteSessionsPermanentlyBulk,
  );
  const deleteSessionPermanently = useSessionsStore(
    (s) => s.deleteSessionPermanently,
  );
  const emptyArchive = useSessionsStore((s) => s.emptyArchive);
  const appendUserTurnExternal = useMessagesStore(
    (s) => s.appendUserTurnExternal,
  );
  const appendSystemTurn = useMessagesStore((s) => s.appendSystemTurn);
  // LLM / runtimeInfo / pet state now live in runtimeStore (M3a).
  // Subscribe to the active session's per-runtime entry so the
  // Composer pill + dropdown + Inspector tab re-render on changes.
  const activeRuntimeLLMs = useRuntimeStore((s) =>
    screen === "main" && activeSessionId
      ? s.byId[activeSessionId]?.llms
      : undefined,
  );
  const activeRuntimeDisplayName = useRuntimeStore((s) =>
    screen === "main" && activeSessionId
      ? s.byId[activeSessionId]?.llmDisplayName
      : undefined,
  );
  const cachedLLMs = useRuntimeStore((s) => s.cachedLLMs);
  const cachedLLMDisplayName = useRuntimeStore((s) => s.cachedLLMDisplayName);
  const pendingLLMIndex = useRuntimeStore((s) => s.pendingLLMIndex);
  const selectLLMForNewSession = useRuntimeStore(
    (s) => s.selectLLMForNewSession,
  );
  const selectLLMForSession = useRuntimeStore((s) => s.selectLLMForSession);
  const runtimeInfo = useRuntimeStore((s) => s.runtimeInfo);

  // Per-session conversation reads — activeSessionId comes from
  // sessionsStore (declared above), used by every selector below to
  // index into messagesStore.byId. EMPTY_* singletons keep React 19
  // strict-mode getSnapshot stable across renders.
  const approvalDecisions = useMessagesStore((s) =>
    activeSessionId
      ? (s.byId[activeSessionId]?.approvalDecisions ?? EMPTY_DECISIONS)
      : EMPTY_DECISIONS,
  );
  const recordApprovalDecision = useMessagesStore(
    (s) => s.recordApprovalDecision,
  );
  const approvalConfig = usePrefsStore((s) => s.approvalConfig);
  const setApprovalRequiredTools = usePrefsStore(
    (s) => s.setApprovalRequiredTools,
  );
  const removeAlwaysAllow = usePrefsStore((s) => s.removeAlwaysAllow);
  const yoloMode = usePrefsStore((s) => s.yoloMode);
  const setYoloMode = usePrefsStore((s) => s.setYoloMode);
  const yoloIntroSeen = usePrefsStore((s) => s.yoloIntroSeen);
  const acknowledgeYoloIntro = usePrefsStore((s) => s.acknowledgeYoloIntro);
  const conversationWidth = usePrefsStore((s) => s.conversationWidth);
  const setConversationWidth = usePrefsStore((s) => s.setConversationWidth);
  const conversationFontSize = usePrefsStore((s) => s.conversationFontSize);
  const setConversationFontSize = usePrefsStore(
    (s) => s.setConversationFontSize,
  );
  const languagePreference = usePrefsStore((s) => s.languagePreference);
  const setLanguagePreference = usePrefsStore((s) => s.setLanguagePreference);
  const themePreference = usePrefsStore((s) => s.themePreference);
  const setThemePreference = usePrefsStore((s) => s.setThemePreference);
  const petAttachedSessionId = useRuntimeStore((s) => s.petAttachedSessionId);
  const setPendingPetMigration = useUiStore((s) => s.setPendingPetMigration);

  const toasts = useUiStore((s) => s.toasts);
  const pushToast = useUiStore((s) => s.pushToast);
  const dismissToast = useUiStore((s) => s.dismissToast);
  const restartAppUpdate = useAppUpdateStore((s) => s.restart);
  const [emptyComposerFocusTick, setEmptyComposerFocusTick] = useState(0);

  const bridgeStatus = useRuntimeStore((s) =>
    activeSessionId
      ? (s.byId[activeSessionId]?.bridgeStatus ?? "idle")
      : "idle",
  );
  const sendIPCCommand = useRuntimeStore((s) => s.sendIPCCommand);
  const shutdownBridge = useRuntimeStore((s) => s.shutdownBridge);
  const setGAConfig = usePrefsStore((s) => s.setGAConfig);
  const setActiveRuntimeKind = usePrefsStore((s) => s.setActiveRuntimeKind);
  const gaConfig = usePrefsStore((s) => s.gaConfig);
  const activeRuntimeKind = usePrefsStore((s) => s.activeRuntimeKind);
  const wechatChannelsStatus = useImSupervisorStatus(
    "wechat",
    activeRuntimeKind === "managed",
  );
  const feishuChannelsStatus = useImSupervisorStatus(
    "feishu",
    activeRuntimeKind === "managed",
  );
  const managedModels = useManagedModelsStore((s) => s.models);
  const managedLLMs = useMemo(
    () => managedModelsToLLMs(managedModels, pendingLLMIndex),
    [managedModels, pendingLLMIndex],
  );
  const resolvedLanguage = useMemo(
    () => resolveLanguagePreference(languagePreference),
    [languagePreference],
  );
  const resolvedTheme = useThemeAndCloseHintEffects({
    languagePreference,
    themePreference,
  });
  const copy = useMemo(
    () => copyForLanguage(resolvedLanguage),
    [resolvedLanguage],
  );
  const managedLLMDisplayName = currentLLMDisplayName(
    managedLLMs,
    copy.app.unconfiguredModel,
  );
  const fallbackLLMs =
    activeRuntimeKind === "managed" ? managedLLMs : cachedLLMs;
  const fallbackLLMDisplayName =
    activeRuntimeKind === "managed"
      ? managedLLMDisplayName
      : cachedLLMDisplayName;
  const llms = activeRuntimeLLMs ?? fallbackLLMs;
  const llmDisplayName =
    activeRuntimeDisplayName ?? fallbackLLMDisplayName ?? "";
  const llmConfigHint =
    activeRuntimeKind === "managed" ? undefined : copy.app.externalModelHint;
  const hasConfiguredManagedModel = managedModels.some(
    (model) => model.credentialStatus !== "missing",
  );
  const requiresManagedModelConfig =
    activeRuntimeKind === "managed" && !hasConfiguredManagedModel;
  const sidebarRuntimeIndicator = resolveSidebarRuntimeIndicator(
    activeRuntimeKind,
    hasConfiguredManagedModel,
    gaConfig,
  );
  const openSettings = (tab: SettingsTab = "runtime") => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  };
  const openModelsForMissingConfig = () => openSettings("models");
  const showImageBlockedToast = (message: string) => {
    pushToast(
      makeAppError({
        category: "business",
        severity: "error",
        title: copy.toasts.imageBlocked,
        message,
        hint: null,
        retryable: false,
        context: "imagePaste",
        traceback: null,
        autoDismissMs: 4200,
      }),
    );
  };
  // Centralized reason → copy routing for the Composer's onImageBlocked.
  // The Composer only emits the reason; the toast copy (and which key it
  // lives under) is an App-level concern, so the mapping stays here.
  const handleImageBlocked = (
    reason: "goal" | "external" | "too-large" | "unsupported" | "too-many",
  ) => {
    const message =
      reason === "goal"
        ? copy.toasts.imageBlockedGoal
        : reason === "external"
          ? copy.toasts.imageBlockedExternal
          : reason === "too-large"
            ? copy.toasts.imageTooLarge
            : reason === "too-many"
              ? copy.toasts.imageTooMany
              : copy.toasts.imageUnsupported;
    showImageBlockedToast(message);
  };
  const openModelConfigFromSwitcher =
    activeRuntimeKind === "managed" ? () => openSettings("models") : undefined;
  const openLLMSwitcherFallback = () => {
    if (activeRuntimeKind === "managed") {
      openSettings("models");
      return;
    }
    setPaletteOpen(true);
  };
  const restartChannelsFromToast = async () => {
    try {
      const statuses = await restartEnabledImSupervisors();
      const wechat = statuses.find((status) => status.platform === "wechat");
      if (wechat) {
        wechatChannelsStatus.setStatus(wechat);
      }
      const feishu = statuses.find((status) => status.platform === "feishu");
      if (feishu) {
        feishuChannelsStatus.setStatus(feishu);
      }
      pushToast(
        makeAppError({
          id: "channels-restarted",
          category: "business",
          severity: "info",
          title:
            statuses.length > 0
              ? copy.toasts.channelsRestarted
              : copy.toasts.channelsRestartNone,
          message:
            statuses.length > 0 ? copy.toasts.channelsRestartedMessage : "",
          hint: null,
          retryable: false,
          context: "restart_enabled_im_supervisors",
          traceback: null,
          autoDismissMs: 4200,
        }),
      );
    } catch (e) {
      pushToast(
        makeAppError({
          id: "channels-restart-failed",
          category: "business",
          severity: "error",
          title: copy.toasts.channelsRestartFailed,
          message: e instanceof Error ? e.message : String(e),
          hint: null,
          retryable: false,
          context: "restart_enabled_im_supervisors",
          traceback: null,
        }),
      );
    }
  };

  const storeTurns = useMessagesStore((s) =>
    activeSessionId
      ? (s.byId[activeSessionId]?.turns ?? EMPTY_TURNS)
      : EMPTY_TURNS,
  );
  const storePending = useMessagesStore((s) =>
    activeSessionId
      ? (s.byId[activeSessionId]?.pendingApprovals ?? EMPTY_APPROVALS)
      : EMPTY_APPROVALS,
  );
  const agentRunning = useMessagesStore((s) =>
    activeSessionId ? (s.byId[activeSessionId]?.agentRunning ?? false) : false,
  );
  const isStopping = useMessagesStore((s) =>
    activeSessionId ? (s.byId[activeSessionId]?.isStopping ?? false) : false,
  );
  const hasRunningSessions = useMessagesStore((s) =>
    Object.values(s.byId).some((messages) => messages.agentRunning),
  );
  const pendingAskUser = useMessagesStore((s) =>
    activeSessionId ? (s.byId[activeSessionId]?.pendingAskUser ?? null) : null,
  );
  const appendUserTurn = useMessagesStore((s) => s.appendUserTurn);
  const appendSideQuestionUserTurn = useMessagesStore(
    (s) => s.appendSideQuestionUserTurn,
  );
  const removePendingApproval = useMessagesStore(
    (s) => s.removePendingApproval,
  );

  // Stable approve handler — passed down to MainView → ToolCallout
  // (React.memo'd). Keeping it referentially stable lets settled
  // ToolCallouts skip re-render during the low-frequency App renders
  // that still happen (bridgeStatus / pendingAskUser changes). The
  // deps are the only values the body reads.
  const handleApprove = useCallback(
    (approvalId: string, decision: ApprovalDecision) => {
      if (!activeSessionId) return;
      recordApprovalDecision(activeSessionId, approvalId, decision);
      removePendingApproval(activeSessionId, approvalId);
      if (bridgeStatus === "connected") {
        sendIPCCommand(activeSessionId, {
          kind: "approval_response",
          approvalId,
          decision,
        });
      }
    },
    [
      activeSessionId,
      recordApprovalDecision,
      removePendingApproval,
      bridgeStatus,
      sendIPCCommand,
    ],
  );

  const reportUserSendFailure = (sid: string, context: string, e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    console.warn("[main] send failed", { sid, message });
    const m = useMessagesStore.getState();
    m.setAgentRunning(sid, false);
    m.setCurrentTurnIndex(sid, null);
    m.setSendPhase(sid, null);
    m.clearInFlightContent(sid);
    useUiStore.getState().pushToast(
      makeAppError({
        category: "bridge",
        severity: "error",
        title: copy.errors.sendFailed,
        message,
        hint: null,
        retryable: true,
        context,
        traceback: null,
      }),
    );
  };

  const runBrowserControlDemo = async () => {
    if (requiresManagedModelConfig) {
      openModelsForMissingConfig();
      return;
    }
    let demoSid: string | null = null;
    try {
      const sid = createSession();
      demoSid = sid;
      await activateSession(sid);
      setScreen("main");
      const persisted = await appendUserTurn(
        sid,
        copy.browserControl.demoPrompt,
      );
      const absoluteTurnIndex = persisted.turnIndex;
      await sendIPCCommand(sid, {
        kind: "user_message",
        text: copy.browserControl.demoPrompt,
        images: [],
        absoluteTurnIndex,
      });
    } catch (e) {
      if (demoSid) {
        reportUserSendFailure(demoSid, "browser_control_demo", e);
      } else {
        const message = e instanceof Error ? e.message : String(e);
        useUiStore.getState().pushToast(
          makeAppError({
            category: "bridge",
            severity: "error",
            title: copy.errors.sendFailed,
            message,
            hint: null,
            retryable: true,
            context: "browser_control_demo",
            traceback: null,
          }),
        );
      }
    }
  };

  useAppHydrationEffects();
  const { activeGoals, sessionGoals, setActiveGoals } = useGoalEffects({
    activeSessionId,
    copy,
    pushToast,
    screen,
  });
  useBrowserControlStartupEffect(activeRuntimeKind);
  useGlobalShortcuts({ setEmptyComposerFocusTick, setSettingsTab });
  useExternalCoreEvents();

  // Session creation is **lazy** — we no longer auto-create on
  // landing in the empty screen. Earlier versions did, which
  // accumulated piles of "新对话" rows every time the user opened
  // and closed the app without ever typing. The Composer's
  // onSubmit handles createSession + activate at the moment the
  // user actually has intent. Sidebar's "New Chat" button still
  // creates an explicit session immediately, because that click
  // *is* the intent.

  // Conversation source of truth: messagesStore turns + pendingApprovals,
  // populated by ipc-handlers as bridge events stream in. When no session
  // is active, MainView renders the empty state instead of <Conversation>,
  // so these reduce to EMPTY_TURNS / EMPTY_APPROVALS without rendering.
  const turns = storeTurns;
  const pendingApprovals = storePending;
  // Composer Stop-mode is driven by the real `agentRunning` store flag
  // (set when user submits, cleared on turn_end / error / run_complete).
  const isRunning = agentRunning;

  // Always show history in the sidebar (including on the empty
  // screen) so a user composing in "new chat" can still see and
  // switch back to a prior session. Empty selection is signalled
  // by activeSession being undefined, not by hiding the list.
  //
  // Archived sessions are filtered out here so both Sidebar and
  // CommandPalette pull from the same pre-filtered list. The rows
  // still live in SQLite — the Archived dialog (sidebar footer)
  // surfaces them for Restore / Delete / Empty all.
  const visibleSessions = useMemo(
    () => sessions.filter((s) => s.status !== "archived"),
    [sessions],
  );
  const archivedCount = sessions.length - visibleSessions.length;
  // Epigraph condition = a read on the workspace pulse at the moment the
  // empty screen is entered. EmptyState snapshots this on mount, so it
  // frames arrival rather than mutating live (the live pulse is the
  // sidebar's job). silent = no sessions; working = something running;
  // quiet = inhabited but at rest.
  const epigraphCondition: EpigraphCondition =
    visibleSessions.length === 0
      ? "silent"
      : hasRunningSessions
        ? "working"
        : "quiet";
  const effectiveActiveId = screen === "main" ? activeSessionId : undefined;
  const activeSession = visibleSessions.find((s) => s.id === effectiveActiveId);
  // Map of master-session-id -> running/wrapping goal, so the Sidebar can
  // show a goal-running state on a master session row (the master itself
  // stays idle while its workers run).
  const goalMasterStatus = useMemo(() => {
    const map = new Map<string, GoalBrief>();
    for (const goal of activeGoals) {
      if (
        goal.masterSessionId &&
        (goal.status === "running" || goal.status === "wrapping")
      ) {
        map.set(goal.masterSessionId, goal);
      }
    }
    return map;
  }, [activeGoals]);
  const activeSessionGoal = activeSession
    ? (activeGoals.find((goal) => goal.masterSessionId === activeSession.id) ??
      (activeSession.projectId
        ? activeGoals.find((goal) => goal.projectId === activeSession.projectId)
        : undefined))
    : undefined;
  const activeSessionBusy =
    screen === "main" &&
    (isRunning || pendingApprovals.length > 0 || pendingAskUser !== null);
  const {
    activeGoalProjectIds,
    activeProject,
    assignSessionToProjectWithToast,
    createProjectOpen,
    deletingProject,
    editingProject,
    expandedProjectIds,
    openProjectInSidebar,
    projectReviewNowMs,
    projectViewOpen,
    setCreateProjectOpen,
    setDeletingProjectId,
    setEditingProjectId,
    startProjectConversation,
    toggleProjectExpanded,
    toggleProjectView,
  } = useProjectNavigation({
    activeGoals,
    activeProjectFilter,
    activeSessionBusy,
    assignSessionToProject,
    copy,
    projects,
    pushToast,
    setActiveProjectFilter,
    setActiveSession,
    setEmptyComposerFocusTick,
    setScreen,
    visibleSessions,
  });
  const openGoalProject = openProjectInSidebar;
  const startGoalFromComposer = async (
    objective: string,
    config: GoalLaunchConfig,
  ) => {
    if (requiresManagedModelConfig) {
      openModelsForMissingConfig();
      return;
    }
    try {
      let masterSessionId = activeSession?.id;
      const createdMasterSession = masterSessionId === undefined;
      if (!masterSessionId) {
        masterSessionId = await createSessionPersisted(
          activeProjectFilter,
          goalMasterSessionTitle(objective),
        );
        setScreen("main");
      }
      const projectId = activeSession?.projectId ?? activeProjectFilter;
      const shouldMirrorMasterProject =
        masterSessionId && (!activeSession || !activeSession.projectId);
      const result = await startDesktopGoal({
        objective,
        projectId: projectId ?? undefined,
        masterSessionId,
        runtimeKind: activeRuntimeKind,
        workerLimit: config.workerLimit,
        budgetSeconds: config.budgetSeconds,
        llmName: llmDisplayName,
        locale: resolvedLanguage,
      });
      const { goal, objectiveMessage, masterMessage } = result;
      appendUserTurnExternal(
        masterSessionId,
        objectiveMessage.content,
        objectiveMessage.origin,
        objectiveMessage.createdAt,
        false,
        objectiveMessage.turnIndex,
      );
      appendSystemTurn(masterSessionId, {
        role: "system",
        content: masterMessage.content,
        variant: "goal",
      });
      setActiveGoals((goals) => {
        const withoutCurrent = goals.filter(
          (candidate) => candidate.id !== goal.id,
        );
        return [...withoutCurrent, goal].sort(
          (a, b) => Date.parse(a.deadlineAt) - Date.parse(b.deadlineAt),
        );
      });
      if (shouldMirrorMasterProject) {
        void assignSessionToProject(masterSessionId, goal.projectId);
      }
      void getGoalStatus(goal.id)
        .then((snapshot) => {
          if (snapshot.project) {
            useSessionsStore
              .getState()
              .applyExternalProjectCreated(snapshot.project);
          }
          const master = snapshot.sessions.find(
            (session) => session.id === masterSessionId,
          );
          if (master) {
            useSessionsStore.getState().applyExternalSessionUpdated(master);
          }
        })
        .catch((e) => {
          console.debug("[goals] hydrate started goal project failed.", e);
        });
      setActiveProjectFilter(undefined);
      if (createdMasterSession) {
        setScreen("main");
      }
      pushToast(
        makeAppError({
          category: "business",
          severity: "info",
          title: copy.toasts.goalStarted,
          message: copy.toasts.goalStartedMessage(
            goal.workerLimit,
            Math.round(goal.budgetSeconds / 60),
          ),
          hint: null,
          retryable: false,
          context: "start_desktop_goal",
          traceback: null,
          action: {
            kind: "view_project",
            label: copy.toasts.viewProject,
            projectId: goal.projectId,
          },
          autoDismissMs: 4200,
        }),
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      pushToast(
        makeAppError({
          category: "business",
          severity: "error",
          title: copy.toasts.goalStartFailed,
          message,
          hint: null,
          retryable: true,
          context: "start_desktop_goal",
          traceback: null,
        }),
      );
      throw e;
    }
  };

  // Archived dialog open state — local UI state, no need to live in
  // the global store. Persisting across reloads would be confusing
  // (user expects modals to be closed on app re-open).
  const [archivedOpen, setArchivedOpen] = useState(false);
  // EarlierDialog: opens when the user clicks the collapsed
  // "Earlier (N)" row in the sidebar. Same local-state rationale as
  // archivedOpen.
  const [earlierOpen, setEarlierOpen] = useState(false);
  const earlierSessions = useMemo(
    () => visibleSessions.filter((s) => bucketSession(s) === "earlier"),
    [visibleSessions],
  );
  const openGoal = async (goalId: string) => {
    try {
      const snapshot = await getGoalStatus(goalId);
      const masterSessionId = snapshot.goal.masterSessionId;
      if (masterSessionId) {
        setActiveProjectFilter(undefined);
        void activateSession(masterSessionId);
        setScreen("main");
        if (
          snapshot.goal.status === "completed" ||
          snapshot.goal.status === "failed"
        ) {
          void markGoalResultSeen(snapshot.goal.id)
            .then((next) => {
              setActiveGoals((goals) =>
                goals
                  .map((goal) => (goal.id === next.id ? next : goal))
                  .filter((goal) => goal.id !== next.id),
              );
            })
            .catch((e) => {
              console.debug("[goals] mark result seen failed.", e);
            });
        }
        return;
      }
      openGoalProject(snapshot.goal.projectId);
    } catch (e) {
      console.warn("[goals] open goal failed.", e);
      const goal = activeGoals.find((candidate) => candidate.id === goalId);
      if (goal) openGoalProject(goal.projectId);
    }
  };
  const stopGoalFromTopbar = async (goalId: string) => {
    try {
      const next = await stopGoal(goalId);
      setActiveGoals((goals) =>
        goals.map((goal) => (goal.id === goalId ? next : goal)),
      );
    } catch (e) {
      console.warn("[goals] stop failed.", e);
    }
  };
  // Settings-driven Onboarding flows:
  // - Health Check revisit jumps directly to StepHealth and returns to
  //   Settings on completion.
  // - Setup Assistant starts from the same first screen as initial
  //   install, but keeps a Back to Settings escape hatch. Opening it
  //   has no side effect; settings only change when the user edits a
  //   step and completes it.
  //
  // Health Check revisit flow (Settings → Re-run Health Check):
  //   - true → Onboarding renders in "revisit" mode (skips Welcome /
  //     Attach, jumps to Health step, swaps button labels)
  //   - previousScreen remembers where the user was before triggering
  //     the revisit, so onComplete / onCancel can return them there +
  //     re-open Settings (the action itself was triggered from inside
  //     the Settings dialog, so "where I was" implicitly includes
  //     "with Settings open").
  const [healthCheckRevisit, setHealthCheckRevisit] = useState(false);
  const [setupAssistantFromSettings, setSetupAssistantFromSettings] =
    useState(false);
  const [revisitReturnScreen, setRevisitReturnScreen] =
    useState<import("@/stores/ui").Screen>("empty");

  const showBrowserControlAttention =
    activeRuntimeKind === "managed" &&
    (browserControlStatus === "not_connected" ||
      browserControlStatus === "error");

  // Onboarding takeover: no AppShell, no overlays besides the dev
  // toggle.
  if (screen === "onboarding") {
    const onboardingMode = healthCheckRevisit
      ? "revisit"
      : setupAssistantFromSettings
        ? "setup"
        : "fresh";
    const returnToSettings = () => {
      setHealthCheckRevisit(false);
      setSetupAssistantFromSettings(false);
      setScreen(revisitReturnScreen);
      setSettingsOpen(true);
    };
    const returnToMainAfterSetup = () => {
      setHealthCheckRevisit(false);
      setSetupAssistantFromSettings(false);
      setScreen("empty");
      setEmptyComposerFocusTick((tick) => tick + 1);
    };
    const saveExternalGAConfigIfChanged = async (
      gaPath: string,
      pythonAlias: string | null,
    ) => {
      const partial: { gaPath?: string; python?: string } = {};
      if (gaPath !== gaConfig.gaPath) partial.gaPath = gaPath;
      if (pythonAlias && pythonAlias !== gaConfig.python) {
        partial.python = pythonAlias;
      }
      if (Object.keys(partial).length > 0) {
        await setGAConfig(partial);
      }
    };

    return (
      <CopyProvider language={resolvedLanguage}>
        <ThemeProvider theme={resolvedTheme}>
          <Onboarding
            mode={onboardingMode}
            initialPath={
              healthCheckRevisit || setupAssistantFromSettings
                ? gaConfig.gaPath
                : undefined
            }
            canContinueWithCurrentModel={
              activeRuntimeKind === "managed" && hasConfiguredManagedModel
            }
            languagePreference={languagePreference}
            resolvedLanguage={resolvedLanguage}
            onChangeLanguagePreference={(preference) => {
              void setLanguagePreference(preference);
            }}
            onComplete={(gaPath, pythonAlias) => {
              // Persist the validated path + the probed Python alias so
              // subsequent bridge spawns use the right interpreter, not
              // the demo fallback (system python3 in a packaged build
              // has no GA deps — silent crash).
              void (async () => {
                await saveExternalGAConfigIfChanged(gaPath, pythonAlias);
                if (!healthCheckRevisit && activeRuntimeKind !== "external") {
                  await setActiveRuntimeKind("external");
                }
                if (healthCheckRevisit) {
                  // Settings → "跑一次 Health Check" round-trip: return
                  // the user to the screen they came from + re-open the
                  // Settings dialog where they clicked.
                  returnToSettings();
                } else {
                  returnToMainAfterSetup();
                }
              })();
            }}
            onManagedComplete={() => {
              void (async () => {
                if (activeRuntimeKind !== "managed") {
                  await setActiveRuntimeKind("managed");
                }
                returnToMainAfterSetup();
              })();
            }}
            onCancel={() => {
              // Revisit-only escape hatch. setGAConfig is intentionally
              // skipped — the user bailed without committing to a new
              // probe result, so we keep whatever was saved before.
              returnToSettings();
            }}
          />
        </ThemeProvider>
      </CopyProvider>
    );
  }

  return (
    <CopyProvider language={resolvedLanguage}>
      <AppShell
        sidebar={
          <Sidebar
            runtimeIndicator={sidebarRuntimeIndicator}
            onOpenRuntimeSettings={() => openSettings("runtime")}
            onOpenModelsSettings={() => openSettings("models")}
            onOpenAgentSettings={() => openSettings("integration")}
            sessions={visibleSessions}
            activeId={effectiveActiveId}
            onNewChat={() => {
              // Lazy: New Chat just clears the active selection and
              // shows the empty composer. No session row is created
              // until the user actually submits — otherwise every
              // click on this button piles up another "新对话"
              // placeholder in the sidebar. submitOnEmpty does the
              // createSession + activateSession when the user
              // commits to a first message.
              //
              // 注意:这里不再清 activeProjectFilter。项目视图是一个
              // 连贯工作区——New Chat 落在"最后展开/最后进入的项目"
              // 里(由 expand 或 select-session 设置),文案自动变成
              // "新对话 · XXX"。没有 filter 时仍是普通新对话。
              setActiveSession(undefined);
              setScreen("empty");
              setEmptyComposerFocusTick((tick) => tick + 1);
            }}
            onSelectSession={(id) => {
              // Activate (re-spawns the bridge if this session has
              // been idle / closed / errored) and switch to main.
              // Other sessions' bridges keep running in background.
              //
              // 项目上下文跟着 session 走:点哪个项目的对话,New Chat
              // 就落在那个项目;不属于任何项目的对话则回到普通新对话。
              // 这让"当前项目上下文"在 expand / select / New Chat 三个
              // 入口下保持一致。
              const sessionProjectId = visibleSessions.find(
                (s) => s.id === id,
              )?.projectId;
              setActiveProjectFilter(sessionProjectId);
              void activateSession(id);
              setScreen("main");
            }}
            onArchiveSession={(id) => archiveSession(id)}
            onRenameSession={(id, newTitle) => renameSession(id, newTitle)}
            onTogglePinSession={(id) => togglePinSession(id)}
            onOpenArchived={() => setArchivedOpen(true)}
            onOpenEarlier={() => setEarlierOpen(true)}
            archivedCount={archivedCount}
            onSearch={() => setPaletteOpen(true)}
            projects={projects}
            activeProjectFilter={activeProjectFilter}
            projectViewOpen={projectViewOpen}
            expandedProjectIds={expandedProjectIds}
            activeGoalProjectIds={activeGoalProjectIds}
            projectReviewNowMs={projectReviewNowMs || undefined}
            onNewProject={() => setCreateProjectOpen(true)}
            onToggleProjectView={toggleProjectView}
            onToggleProjectExpanded={toggleProjectExpanded}
            onStartProjectConversation={startProjectConversation}
            onAssignSessionToProject={assignSessionToProjectWithToast}
            onTogglePinProject={(id) => {
              const p = projects.find((x) => x.id === id);
              if (p) void updateProject(id, { pinned: !p.pinned });
            }}
            onEditProject={(id) => setEditingProjectId(id)}
            onDeleteProject={(id) => setDeletingProjectId(id)}
            petAttachedSessionId={petAttachedSessionId}
            goalMasterStatus={goalMasterStatus}
          />
        }
        main={
          <ThemeProvider theme={resolvedTheme}>
            <MainHeader
              sessionTitle={activeSession?.title}
              yoloMode={yoloMode}
              onDisableYolo={() => {
                void setYoloMode(false);
              }}
              browserControlStatus={
                activeRuntimeKind === "managed" ? browserControlStatus : null
              }
              onOpenBrowserControl={() => openSettings("browser")}
              channelsState={
                activeRuntimeKind === "managed"
                  ? aggregateChannelsState([
                      wechatChannelsStatus.status?.state,
                      feishuChannelsStatus.status?.state,
                    ])
                  : null
              }
              channelsLoadError={
                activeRuntimeKind === "managed"
                  ? (wechatChannelsStatus.loadError ??
                    feishuChannelsStatus.loadError)
                  : null
              }
              onOpenChannelsSettings={
                activeRuntimeKind === "managed"
                  ? () => openSettings("im")
                  : undefined
              }
              activeGoals={activeGoals}
              onOpenGoalProject={openGoalProject}
              onOpenGoal={(goalId) => {
                void openGoal(goalId);
              }}
              onStopGoal={(goalId) => {
                void stopGoalFromTopbar(goalId);
              }}
              conversationWidth={conversationWidth}
              onToggleConversationWidth={() => {
                void setConversationWidth(
                  conversationWidth === "wide" ? "compact" : "wide",
                );
              }}
              conversationFontSize={conversationFontSize}
              onChangeConversationFontSize={(size) => {
                void setConversationFontSize(size);
              }}
              themePreference={themePreference}
              resolvedTheme={resolvedTheme}
              onChangeThemePreference={(preference) => {
                void setThemePreference(preference);
              }}
              onReinjectTools={() => {
                // Reinject targets the currently active session — that's
                // the conversation the user is reading when they notice
                // tool drift. No-op if no active session (button is
                // available but does nothing rather than throwing).
                if (!activeSessionId) return;
                if (bridgeStatus !== "connected") return;
                void sendIPCCommand(activeSessionId, {
                  kind: "reinject_tools",
                });
              }}
              onTogglePet={() => {
                // Three cases (see devlog 2026-05-14 pet UX overhaul):
                //   1. Active session HOLDS the pet → detach (close).
                //   2. Pet on another session → implicit migrate:
                //      detach old + stash target; the pet_detached IPC
                //      handler fires the follow-up attach once the
                //      port is released.
                //   3. No pet anywhere → attach to active.
                // The sidebar Cat badge tells the user where the pet
                // currently lives, so the menu's "桌面宠物" always
                // reads as "I want it here" without surprise.
                if (!activeSessionId) return;
                if (petAttachedSessionId === activeSessionId) {
                  void sendIPCCommand(activeSessionId, {
                    kind: "detach_pet",
                  });
                  return;
                }
                if (bridgeStatus !== "connected") return;
                if (petAttachedSessionId) {
                  setPendingPetMigration(activeSessionId);
                  void sendIPCCommand(petAttachedSessionId, {
                    kind: "detach_pet",
                  });
                  return;
                }
                void sendIPCCommand(activeSessionId, {
                  kind: "attach_pet",
                  port: 41983,
                });
              }}
              currentSessionHasPet={
                !!activeSessionId && petAttachedSessionId === activeSessionId
              }
              onRenameSession={(newTitle) => {
                if (!activeSessionId) return;
                renameSession(activeSessionId, newTitle);
              }}
              onOpenSettings={() => setSettingsOpen(true)}
              onOpenApprovalSettings={() => openSettings("approval")}
            />
            <BrowserControlAttentionSurface
              show={showBrowserControlAttention}
              onOpen={() => openSettings("browser")}
            >
              {screen === "empty" ? (
                <EmptyState
                  llmDisplayName={llmDisplayName}
                  conversationWidth={conversationWidth}
                  conversationFontSize={conversationFontSize}
                  projectName={activeProject?.name}
                  focusTick={emptyComposerFocusTick}
                  epigraphCondition={epigraphCondition}
                  llms={llms}
                  llmConfigHint={llmConfigHint}
                  onConfigureModels={openModelConfigFromSwitcher}
                  requiresModelConfig={requiresManagedModelConfig}
                  onSelectLLM={(idx) => {
                    // EmptyState always configures the *next* new
                    // session: stash pendingLLMIndex + flip the
                    // top-level llms projection so the Composer pill
                    // reflects the pick. activateSession consumes
                    // pendingLLMIndex when submitOnEmpty creates and
                    // spawns the fresh session.
                    selectLLMForNewSession(idx);
                  }}
                  onOpenLLMSwitcher={openLLMSwitcherFallback}
                  onGoalSubmit={startGoalFromComposer}
                  imagesEnabled={activeRuntimeKind === "managed"}
                  onImageBlocked={handleImageBlocked}
                  onSubmit={(t, images) => {
                    if (requiresManagedModelConfig) {
                      openModelsForMissingConfig();
                      return;
                    }
                    if (images.length > 0 && activeRuntimeKind !== "managed") {
                      showImageBlockedToast(copy.toasts.imageBlockedExternal);
                      return false;
                    }
                    void submitOnEmpty(
                      t,
                      images,
                      activeSessionId,
                      createSessionPersisted,
                      activateSession,
                      appendUserTurn,
                      sendIPCCommand,
                      setScreen,
                      reportUserSendFailure,
                      copy.errors.sendFailed,
                      copy.app.restoreTimeout,
                      activeProjectFilter,
                    ).then(() => {
                      if (activeProjectFilter)
                        setActiveProjectFilter(undefined);
                    });
                  }}
                />
              ) : (
                <MainView
                  turns={turns}
                  llmDisplayName={llmDisplayName}
                  projectName={
                    activeSession?.projectId
                      ? projects.find((p) => p.id === activeSession.projectId)
                          ?.name
                      : undefined
                  }
                  llms={llms}
                  llmConfigHint={llmConfigHint}
                  onConfigureModels={openModelConfigFromSwitcher}
                  requiresModelConfig={requiresManagedModelConfig}
                  onSelectLLM={(idx) => {
                    if (!activeSessionId) return;
                    // Flip local + persisted state immediately so the
                    // picker never depends on a bridge round-trip for
                    // visible feedback. The live bridge, when available,
                    // still receives set_llm and will confirm via
                    // llm_changed.
                    selectLLMForSession(activeSessionId, idx);
                    if (
                      bridgeStatus === "connected" ||
                      bridgeStatus === "spawning"
                    ) {
                      void sendIPCCommand(activeSessionId, {
                        kind: "set_llm",
                        llmIndex: idx,
                      });
                    }
                  }}
                  onOpenLLMSwitcher={openLLMSwitcherFallback}
                  goal={activeSessionGoal}
                  sessionGoals={sessionGoals}
                  onGoalSubmit={startGoalFromComposer}
                  imagesEnabled={activeSession?.gaRuntimeKind === "managed"}
                  onImageBlocked={handleImageBlocked}
                  pendingApprovals={pendingApprovals}
                  approvalDecisions={approvalDecisions}
                  onSubmit={(t, images) => {
                    if (requiresManagedModelConfig) {
                      openModelsForMissingConfig();
                      return;
                    }
                    // Main screen always has an active session — Sidebar
                    // / EmptyState set it before transitioning here.
                    if (!activeSessionId) return;
                    const sid = activeSessionId;
                    const ensureBridgeThenSend = async (
                      cmd:
                        | {
                            kind: "user_message";
                            text: string;
                            images: string[];
                            absoluteTurnIndex?: number | null;
                          }
                        | {
                            kind: "ask_user_response";
                            text: string;
                            absoluteTurnIndex?: number | null;
                          },
                      options: { showPhase?: boolean } = {},
                    ) => {
                      const sendStartedAt = perfNow();
                      const showPhase = options.showPhase ?? true;
                      const setSendPhase = (
                        phase:
                          | "starting"
                          | "restoring"
                          | "waiting_agent"
                          | "sent",
                      ) => {
                        if (showPhase) {
                          useMessagesStore.getState().setSendPhase(sid, phase);
                        }
                      };
                      const runtime = useRuntimeStore.getState();
                      const latestStatus =
                        runtime.byId[sid]?.bridgeStatus ?? "idle";
                      if (
                        latestStatus !== "spawning" &&
                        (latestStatus !== "connected" ||
                          !runtime.hasBridgeClient(sid))
                      ) {
                        setSendPhase("starting");
                        await activateSession(sid);
                      }
                      if (cmd.kind === "user_message") {
                        setSendPhase("restoring");
                        let historyReady =
                          await ensureHistoryReplayComplete(sid);
                        if (!historyReady) {
                          console.warn(
                            "[main] history replay did not confirm; restarting bridge.",
                            { sid },
                          );
                          await shutdownBridge(sid);
                          setSendPhase("starting");
                          await activateSession(sid);
                          setSendPhase("restoring");
                          historyReady = await ensureHistoryReplayComplete(sid);
                          if (!historyReady) {
                            throw new Error(copy.app.restoreTimeout);
                          }
                        }
                      }
                      setSendPhase("waiting_agent");
                      await sendIPCCommand(sid, cmd);
                      setSendPhase("sent");
                      logPerf("app.ensureBridgeThenSend", sendStartedAt, {
                        sessionId: sid,
                        command: cmd.kind,
                        phaseVisible: showPhase,
                      });
                    };
                    const reportSendFailure = (e: unknown) =>
                      reportUserSendFailure(sid, "send_user_message", e);
                    // `/btw` is a side question (interruption-free,
                    // not a main-agent turn). Route to the transient
                    // user-turn path so it doesn't disturb the main
                    // agent's running state — bridge intercepts the
                    // user_message command and runs the btw worker
                    // independently of the task queue.
                    const trimmed = t.trimStart();
                    if (images.length > 0) {
                      if (activeSession?.gaRuntimeKind !== "managed") {
                        showImageBlockedToast(copy.toasts.imageBlockedExternal);
                        return false;
                      }
                      if (
                        trimmed === "/btw" ||
                        trimmed.startsWith("/btw ") ||
                        pendingAskUser !== null
                      ) {
                        showImageBlockedToast(copy.toasts.imageBlockedGoal);
                        return false;
                      }
                    }
                    if (trimmed === "/btw" || trimmed.startsWith("/btw ")) {
                      appendSideQuestionUserTurn(sid, t);
                      void ensureBridgeThenSend(
                        {
                          kind: "user_message",
                          text: t,
                          images: [],
                        },
                        { showPhase: false },
                      ).catch(reportSendFailure);
                      return;
                    }
                    // Snapshot pendingAskUser **before** appendUserTurn
                    // clears it — we need to know which IPC command to
                    // send. ask_user_response and user_message both
                    // ultimately call agent.put_task on the bridge side
                    // (same agent_runner_loop kickoff), but keeping
                    // them distinct preserves audit-trail clarity:
                    // "this user message was a reply to a specific
                    // question" vs "this was a fresh prompt".
                    const wasAskUser = pendingAskUser !== null;
                    void (async () => {
                      const persisted = await appendUserTurn(sid, t, images);
                      const absoluteTurnIndex = persisted.turnIndex;
                      if (wasAskUser) {
                        await ensureBridgeThenSend({
                          kind: "ask_user_response",
                          text: t,
                          absoluteTurnIndex,
                        });
                      } else {
                        await ensureBridgeThenSend({
                          kind: "user_message",
                          text: t,
                          images: persisted.attachments.map(
                            (attachment) => attachment.path,
                          ),
                          absoluteTurnIndex,
                        });
                      }
                    })().catch(reportSendFailure);
                  }}
                  onApprove={handleApprove}
                  onStop={() => {
                    console.info("[main] stop");
                    if (!activeSessionId) return;
                    if (bridgeStatus === "connected") {
                      sendIPCCommand(activeSessionId, { kind: "abort" });
                      useMessagesStore
                        .getState()
                        .setStopping(activeSessionId, true);
                    }
                  }}
                  isRunning={isRunning}
                  isStopping={isStopping}
                  pendingAskUser={pendingAskUser}
                  conversationWidth={conversationWidth}
                  conversationFontSize={conversationFontSize}
                  activeSessionId={activeSessionId}
                />
              )}
            </BrowserControlAttentionSurface>
          </ThemeProvider>
        }
      />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        sessions={visibleSessions}
        runtimeKind={activeRuntimeKind}
        llms={llms}
        onNewChat={() => {
          setActiveProjectFilter(undefined);
          setActiveSession(undefined);
          setScreen("empty");
          setEmptyComposerFocusTick((tick) => tick + 1);
        }}
        onNewProject={() => setCreateProjectOpen(true)}
        onOpenSession={(id) => {
          setActiveProjectFilter(undefined);
          void activateSession(id);
          setScreen("main");
        }}
        onSwitchLLM={(idx) => {
          // Route to the active session's bridge. The palette is a
          // global affordance but `set_llm` is per-bridge; the user
          // intuitively expects "the LLM I see in the Composer" to
          // be the one switched, which matches activeSessionId.
          if (!activeSessionId) {
            console.info("[palette] switch llm: no active session, idx=", idx);
            return;
          }
          selectLLMForSession(activeSessionId, idx);
          // Same relaxed gate as MainView's onSelectLLM — allow during
          // spawning so users don't get silent drops in the cold-start
          // window. set_llm remains best-effort if no live bridge appears.
          if (bridgeStatus === "connected" || bridgeStatus === "spawning") {
            void sendIPCCommand(activeSessionId, {
              kind: "set_llm",
              llmIndex: idx,
            });
          } else {
            console.info(
              "[palette] switch llm: bridge not ready, idx=",
              idx,
              "status=",
              bridgeStatus,
            );
          }
        }}
        onReRunHealthCheck={() => console.info("[palette] re-run health check")}
        onOpenSettings={() => setSettingsOpen(true)}
        onAttachGAFolder={() =>
          console.info("[palette] attach GA folder — wired in #10")
        }
        onSubmitFreeText={(text) => {
          console.info("[palette] free-text submit:", text);
          setScreen("main");
        }}
      />

      <Settings
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        tab={settingsTab}
        onTabChange={setSettingsTab}
        runtimeInfo={runtimeInfo}
        approval={approvalConfig}
        projectCount={projects.length}
        hasRunningSessions={hasRunningSessions}
        activeRuntimeKind={activeRuntimeKind}
        hasManagedRuntimeConfigured={hasConfiguredManagedModel}
        hasExternalRuntimeConfigured={gaConfig.gaPath.trim() !== ""}
        yoloMode={yoloMode}
        useExternalPython={gaConfig.useExternalPython}
        onChangeYoloMode={(enabled) => {
          // Fire-and-forget: setYoloMode persists + notifies bridge,
          // but the UI updates synchronously from the store action.
          void setYoloMode(enabled);
        }}
        onChangeRequiredTools={setApprovalRequiredTools}
        onRemoveAlwaysAllow={removeAlwaysAllow}
        onChangeGAPath={() => {
          void pickGAPath(setGAConfig, copy.app.chooseGAFolderTitle);
        }}
        onCommitGAPath={async (path) => {
          // Manual-typed GA path from Settings → Runtime. The
          // SettingsRuntime field has already validated and refuses to
          // call this on `not-found`; we trust it here. setGAConfig
          // shows the same "重启 Galley 才能生效" toast as the picker
          // flow, keeping both entry points symmetric.
          await setGAConfig({ gaPath: path });
        }}
        onToggleExternalPython={(useExternal) => {
          // v0.1.1: persist the bundled-vs-external choice. Like
          // gaPath, takes effect on next bridge spawn (existing live
          // sessions keep their current Python). setGAConfig shows
          // the same "重启 Galley" toast.
          void setGAConfig({ useExternalPython: useExternal });
        }}
        onChangeRuntimeKind={(kind) => {
          if (kind === activeRuntimeKind) return;
          void (async () => {
            await setActiveRuntimeKind(kind);
            useRuntimeStore.setState({ pendingLLMIndex: undefined });
            setActiveProjectFilter(undefined);
            setActiveSession(undefined);
            setScreen("empty");
            await useSessionsStore.getState().hydrate();
            pushToast(
              makeAppError({
                category: "business",
                severity: "info",
                title: copy.toasts.switchedRuntime(kind),
                message: copy.toasts.runtimeSwitchKept,
                hint: null,
                retryable: false,
                context: null,
                traceback: null,
                autoDismissMs: 4200,
              }),
            );
          })();
        }}
        // Bridge Python picker intentionally not wired — V0.1 relies
        // on the python probe to pick the interpreter; advanced users
        // edit prefs / capabilities by hand. Settings just shows the
        // resolved path.
        //
        // "跑一次 Health Check" routes back through Onboarding's
        // StepHealth in revisit mode (skips Welcome / Attach). One
        // canonical health-check UX instead of a divergent inline
        // copy in Settings — see Settings-Health-Check devlog
        // 2026-05-15.
        onReRunHealthCheck={() => {
          setRevisitReturnScreen(screen);
          setSettingsOpen(false);
          setHealthCheckRevisit(true);
          setSetupAssistantFromSettings(false);
          setScreen("onboarding");
        }}
        onOpenSetupAssistant={() => {
          setRevisitReturnScreen(screen);
          setSettingsOpen(false);
          setHealthCheckRevisit(false);
          setSetupAssistantFromSettings(true);
          setScreen("onboarding");
        }}
        onRunBrowserControlDemo={() => {
          setSettingsOpen(false);
          void runBrowserControlDemo();
        }}
        languagePreference={languagePreference}
        resolvedLanguage={resolvedLanguage}
        onChangeLanguagePreference={(preference) => {
          void setLanguagePreference(preference);
        }}
        themePreference={themePreference}
        resolvedTheme={resolvedTheme}
        onChangeThemePreference={(preference) => {
          void setThemePreference(preference);
        }}
      />

      <ArchivedDialog
        open={archivedOpen}
        onOpenChange={setArchivedOpen}
        sessions={sessions}
        onRestore={(id) => unarchiveSession(id)}
        onDeletePermanently={(id) => deleteSessionPermanently(id)}
        onEmptyAll={() => emptyArchive()}
        onRestoreBulk={(ids) => unarchiveSessionsBulk(ids)}
        onDeletePermanentlyBulk={(ids) => deleteSessionsPermanentlyBulk(ids)}
      />

      <EarlierDialog
        open={earlierOpen}
        onOpenChange={setEarlierOpen}
        sessions={earlierSessions}
        onSelectSession={(id) => {
          setActiveProjectFilter(undefined);
          void activateSession(id);
          setScreen("main");
        }}
        onArchiveSession={(id) => archiveSession(id)}
        onTogglePinSession={(id) => togglePinSession(id)}
        onArchiveSessionsBulk={(ids) => archiveSessionsBulk(ids)}
      />

      <CreateProjectDialog
        open={createProjectOpen}
        onOpenChange={setCreateProjectOpen}
        onCreate={async (input) => {
          // Create + immediately open the new project in Project
          // View. Creation is organization, not conversation
          // creation; the row's inline + is the explicit "start a
          // project conversation" action.
          const created = await createProject(input);
          openProjectInSidebar(created.id);
        }}
      />

      <EditProjectDialog
        project={editingProject}
        onClose={() => setEditingProjectId(null)}
        onSave={async (id, partial) => {
          await updateProject(id, partial);
        }}
        onRequestDelete={(p) => {
          // Hand off to ConfirmDeleteProjectDialog while keeping
          // the Edit dialog state — when the user cancels the
          // confirm, they're back in Edit naturally. On confirm,
          // both close together.
          setDeletingProjectId(p.id);
        }}
      />

      <ConfirmDeleteProjectDialog
        project={deletingProject}
        onCancel={() => setDeletingProjectId(null)}
        onConfirm={async () => {
          if (!deletingProject) return;
          await deleteProject(deletingProject.id);
          setDeletingProjectId(null);
          setEditingProjectId(null);
        }}
      />

      <ToastHost
        toasts={toasts}
        onDismiss={dismissToast}
        onViewProject={openProjectInSidebar}
        onViewGoal={openGoal}
        onRestartChannels={() => {
          void restartChannelsFromToast();
        }}
        onRestartAppUpdate={() => {
          void restartAppUpdate();
        }}
      />

      <YoloIntroDialog
        open={!yoloIntroSeen}
        onAcknowledge={(revertToApproval) => {
          void acknowledgeYoloIntro(revertToApproval);
        }}
      />
    </CopyProvider>
  );
}

export default App;

// ---------------- Lazy session creation ----------------

/**
 * Empty-screen submit handler. The session is created lazily — the
 * first user-initiated action (typing a message or clicking a quick
 * prompt) is what bumps us from "no chat yet" to "real chat".
 *
 * Flow:
 *   1. If there's already an active session id, reuse it.
 *   2. Otherwise create a persisted session row first so the user
 *      message write cannot race the async session create.
 *   3. Transition to main view + append the user turn before bridge
 *      startup, so cold runner spawn doesn't look like a frozen UI.
 *   4. Activate the session, replay history, then send the IPC message.
 *
 * sendIPCCommand waits for the bridge `ready` event before writing
 * user-visible commands. This keeps first-run Windows startup stalls from
 * turning into a silent, indefinite "thinking" state.
 */
async function submitOnEmpty(
  text: string,
  attachments: PendingImageAttachment[],
  existingId: string | undefined,
  createSessionPersisted: (projectId?: string) => Promise<string>,
  activateSession: (id: string) => Promise<void>,
  appendUserTurn: (
    sessionId: string,
    text: string,
    attachments?: PendingImageAttachment[],
  ) => Promise<{
    turnIndex: number;
    attachments: { path: string }[];
  }>,
  sendIPCCommand: (
    sessionId: string,
    cmd: {
      kind: "user_message";
      text: string;
      images?: string[];
      absoluteTurnIndex?: number | null;
    },
  ) => Promise<void>,
  setScreen: (s: import("@/stores/ui").Screen) => void,
  reportSendFailure: (
    sessionId: string,
    context: string,
    error: unknown,
  ) => void,
  sendFailedTitle: string,
  restoreTimeoutMessage: string,
  inheritProjectId?: string,
): Promise<void> {
  const submitStartedAt = perfNow();
  let id = existingId;
  try {
    if (!id) {
      // Inherit project assignment when the EmptyState composer was
      // opened from a project's inline +. The context is one-shot:
      // after the first message creates the session, App clears the
      // pending project id.
      id = await createSessionPersisted(inheritProjectId);
    }
    setScreen("main");
    const persisted = await appendUserTurn(id, text, attachments);
    const absoluteTurnIndex = persisted.turnIndex;
    const messages = useMessagesStore.getState();
    const runtime = useRuntimeStore.getState();
    const status = runtime.byId[id]?.bridgeStatus ?? "idle";
    if (
      status !== "spawning" &&
      (status !== "connected" || !runtime.hasBridgeClient(id))
    ) {
      messages.setSendPhase(id, "starting");
      await activateSession(id);
    }
    messages.setSendPhase(id, "restoring");
    const historyReady = await ensureHistoryReplayComplete(id);
    if (!historyReady) {
      throw new Error(restoreTimeoutMessage);
    }
    messages.setSendPhase(id, "waiting_agent");
    await sendIPCCommand(id, {
      kind: "user_message",
      text,
      images: persisted.attachments.map((attachment) => attachment.path),
      absoluteTurnIndex,
    });
    messages.setSendPhase(id, "sent");
    logPerf("app.submitOnEmpty", submitStartedAt, {
      sessionId: id,
      createdSession: existingId === undefined,
    });
  } catch (e) {
    if (id) {
      reportSendFailure(id, "send_user_message", e);
    } else {
      console.warn("[main] empty submit failed before session creation", e);
      useUiStore.getState().pushToast(
        makeAppError({
          category: "business",
          severity: "error",
          title: sendFailedTitle,
          message: e instanceof Error ? e.message : String(e),
          hint: null,
          retryable: true,
          context: "create_session_for_send",
          traceback: null,
        }),
      );
    }
  }
}

// ---------------- Settings path pickers ----------------
//
// Lazy-import the Tauri dialog plugin so a Vite-only dev build doesn't
// fail to load App.tsx. In Tauri the dialog returns a string (single
// selection), null on cancel, or string[] when multiple=true.

async function pickGAPath(
  setGAConfig: (
    p: Partial<{ python: string; gaPath: string; bridgeCwd: string }>,
  ) => Promise<void>,
  title: string,
): Promise<void> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      directory: true,
      multiple: false,
      title,
    });
    if (typeof selected === "string" && selected.length > 0) {
      await setGAConfig({ gaPath: selected });
    }
  } catch (e) {
    console.warn("[settings] pickGAPath failed.", e);
  }
}
