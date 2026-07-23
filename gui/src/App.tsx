import { useMemo, useState } from "react";

import { ToastHost } from "@/components/error-card/ToastHost";
import { AppShell } from "@/components/layout/AppShell";
import { MainHeaderHost } from "@/components/layout/MainHeaderHost";
import { Sidebar } from "@/components/layout/Sidebar";
import { CommandPalette } from "@/components/overlay/CommandPalette";
import { ThemeProvider } from "@/components/theme/ThemeContext";
import { BrowserControlAttentionSurface } from "@/components/screens/BrowserControlAttentionBanner";
import { EmptyState } from "@/components/screens/EmptyState";
import { MainView } from "@/components/screens/MainView";
import { OnboardingScreen } from "@/components/screens/onboarding/OnboardingScreen";
import { SettingsHost } from "@/components/screens/settings/SettingsHost";
import type { SettingsTab } from "@/components/screens/settings/settings-types";
import { YoloIntroDialog } from "@/components/screens/YoloIntroDialog";
import { FirstCloseDialog } from "@/components/screens/FirstCloseDialog";
import { useFirstCloseRequest } from "@/hooks/useFirstCloseRequest";
import { resolveFirstClose } from "@/lib/db";
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
import { useChannelsStatus } from "@/hooks/useChannelsStatus";
import { useExternalCoreEvents } from "@/hooks/useExternalCoreEvents";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { useGoalActions } from "@/hooks/useGoalActions";
import { useGoalEffects } from "@/hooks/useGoalEffects";
import { useImageBlockedToast } from "@/hooks/useImageBlockedToast";
import { useLLMDisplay } from "@/hooks/useLLMDisplay";
import { useMessageSend } from "@/hooks/useMessageSend";
import { useOnboardingFlow } from "@/hooks/useOnboardingFlow";
import { useProjectNavigation } from "@/hooks/useProjectNavigation";
import { useThemeEffects } from "@/hooks/useThemeEffects";
import {
  useActiveMessages,
  useActiveRuntime,
} from "@/hooks/useActiveSession";
import { resolveLanguagePreference } from "@/lib/language";
import { effectiveApprovalMode } from "@/lib/approval-mode";
import { backfillRecentSessions, groupSessions } from "@/lib/sessions";
import type { EpigraphCondition } from "@/lib/epigraphs";
import { useAppUpdateStore } from "@/stores/app-update";
import { useBrowserControlStore } from "@/stores/browser-control";
import {
  EMPTY_APPROVALS,
  EMPTY_DECISIONS,
  EMPTY_TURNS,
  useMessagesStore,
} from "@/stores/messages";
import { usePrefsStore } from "@/stores/prefs";
import { useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";
import type { GoalBrief } from "@/types/goal";

/**
 * V0.1 Stage 2 #8 — App entry.
 *
 * State lives in the Zustand slices under `stores/`. App is now
 * mostly wiring: pull screen / approval / runtime out of the stores,
 * feed them down to the four screens (Onboarding, Empty State, Main
 * View, plus the modal-y Settings + Command Palette + ToastHost),
 * route component callbacks back to store actions. Header and
 * Settings wiring self-subscribe in `MainHeaderHost` / `SettingsHost`;
 * the LLM projection and channel aggregates live in `useLLMDisplay` /
 * `useChannelsStatus`.
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

  // `sessions` carries only durable row state now; each sidebar row
  // derives its live status at read time via `useSessionStatusView`.
  // A plain selector with default strict-equality stays stable through
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
  const setSessionApprovalMode = useSessionsStore(
    (s) => s.setSessionApprovalMode,
  );
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
  const pendingApprovalMode = useRuntimeStore((s) => s.pendingApprovalMode);
  const selectLLMForNewSession = useRuntimeStore(
    (s) => s.selectLLMForNewSession,
  );
  const selectLLMForSession = useRuntimeStore((s) => s.selectLLMForSession);

  // Per-session conversation reads — activeSessionId comes from
  // sessionsStore (declared above), used by every selector below to
  // index into messagesStore.byId. EMPTY_* singletons keep React 19
  // strict-mode getSnapshot stable across renders.
  const approvalDecisions = useActiveMessages(
    (m) => m.approvalDecisions,
    EMPTY_DECISIONS,
  );
  const recordApprovalDecision = useMessagesStore(
    (s) => s.recordApprovalDecision,
  );
  const yoloMode = usePrefsStore((s) => s.yoloMode);
  const yoloIntroSeen = usePrefsStore((s) => s.yoloIntroSeen);
  const acknowledgeYoloIntro = usePrefsStore((s) => s.acknowledgeYoloIntro);
  const conversationWidth = usePrefsStore((s) => s.conversationWidth);
  const conversationFontSize = usePrefsStore((s) => s.conversationFontSize);
  const languagePreference = usePrefsStore((s) => s.languagePreference);
  const setLanguagePreference = usePrefsStore((s) => s.setLanguagePreference);
  const themePreference = usePrefsStore((s) => s.themePreference);
  const setKeepInBackgroundOnClose = usePrefsStore(
    (s) => s.setKeepInBackgroundOnClose,
  );
  const petAttachedSessionId = useRuntimeStore((s) => s.petAttachedSessionId);

  const toasts = useUiStore((s) => s.toasts);
  const pushToast = useUiStore((s) => s.pushToast);
  const dismissToast = useUiStore((s) => s.dismissToast);
  const restartAppUpdate = useAppUpdateStore((s) => s.restart);
  const [emptyComposerFocusTick, setEmptyComposerFocusTick] = useState(0);

  const bridgeStatus = useActiveRuntime((r) => r.bridgeStatus, "idle");
  const sendIPCCommand = useRuntimeStore((s) => s.sendIPCCommand);
  const shutdownBridge = useRuntimeStore((s) => s.shutdownBridge);
  const setGAConfig = usePrefsStore((s) => s.setGAConfig);
  const setActiveRuntimeKind = usePrefsStore((s) => s.setActiveRuntimeKind);
  const gaConfig = usePrefsStore((s) => s.gaConfig);
  const activeRuntimeKind = usePrefsStore((s) => s.activeRuntimeKind);
  const resolvedLanguage = useMemo(
    () => resolveLanguagePreference(languagePreference),
    [languagePreference],
  );
  const resolvedTheme = useThemeEffects({ themePreference });
  const firstClose = useFirstCloseRequest();
  const copy = useMemo(
    () => copyForLanguage(resolvedLanguage),
    [resolvedLanguage],
  );
  const { channelsState, channelsLoadError, restartChannels } =
    useChannelsStatus({
      enabled: activeRuntimeKind === "managed",
      copy,
      pushToast,
    });
  const {
    llms,
    llmDisplayName,
    llmConfigHint,
    hasConfiguredManagedModel,
    requiresManagedModelConfig,
    sidebarRuntimeIndicator,
  } = useLLMDisplay({ screen, copy });
  const openSettings = (tab: SettingsTab = "runtime") => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  };
  const openModelsForMissingConfig = () => openSettings("models");
  const { showImageBlockedToast, handleImageBlocked } = useImageBlockedToast({
    copy,
    pushToast,
  });
  const openModelConfigFromSwitcher =
    activeRuntimeKind === "managed" ? () => openSettings("models") : undefined;
  const openLLMSwitcherFallback = () => {
    if (activeRuntimeKind === "managed") {
      openSettings("models");
      return;
    }
    setPaletteOpen(true);
  };

  const storeTurns = useActiveMessages((m) => m.turns, EMPTY_TURNS);
  const storePending = useActiveMessages(
    (m) => m.pendingApprovals,
    EMPTY_APPROVALS,
  );
  const agentRunning = useActiveMessages((m) => m.agentRunning, false);
  const isStopping = useActiveMessages((m) => m.isStopping, false);
  const hasRunningSessions = useMessagesStore((s) =>
    Object.values(s.byId).some((messages) => messages.agentRunning),
  );
  const pendingAskUser = useActiveMessages((m) => m.pendingAskUser, null);
  const appendUserTurn = useMessagesStore((s) => s.appendUserTurn);
  const appendSideQuestionUserTurn = useMessagesStore(
    (s) => s.appendSideQuestionUserTurn,
  );
  const removePendingApproval = useMessagesStore(
    (s) => s.removePendingApproval,
  );

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
  // Approval-mode state for the merged conversation-config pill
  // (conversation.md §4.4). MainView acts on the active session's
  // persisted override; EmptyState configures the NEXT session via
  // pendingApprovalMode (same lifecycle as the LLM pre-pick — consumed
  // by createSession, always cleared). Override = deviation from the
  // default: picking the default-equal mode clears it (the sessions
  // store normalizes; the pending path normalizes here). The app-wide
  // default is edited only in Settings → 审批.
  const mainApprovalModeState = activeSessionId
    ? {
        mode: effectiveApprovalMode(activeSession?.approvalMode, yoloMode),
        onSelectMode: (mode: "auto" | "approval") =>
          setSessionApprovalMode(activeSessionId, mode),
      }
    : undefined;
  const emptyApprovalModeState = {
    mode: effectiveApprovalMode(pendingApprovalMode, yoloMode),
    onSelectMode: (mode: "auto" | "approval") =>
      useRuntimeStore.setState({
        pendingApprovalMode:
          mode === (yoloMode ? "auto" : "approval") ? undefined : mode,
      }),
  };
  const activeSessionGoal = activeSession
    ? (activeGoals.find((goal) => goal.masterSessionId === activeSession.id) ??
      (activeSession.projectId
        ? activeGoals.find((goal) => goal.projectId === activeSession.projectId)
        : undefined))
    : undefined;
  // Gate for launching a NEW Goal. `activeGoals` also carries terminal
  // goals whose result hasn't been seen (they keep the pill's "view
  // result" entry alive), but only running/wrapping actually occupies the
  // single-active-Goal slot (the DB's goals_single_active index) — a
  // finished-but-unseen goal must not dead-button the Composer.
  const goalSlotOccupied = activeGoals.some(
    (goal) => goal.status === "running" || goal.status === "wrapping",
  );
  const activeSessionBusy =
    screen === "main" &&
    (isRunning || pendingApprovals.length > 0 || pendingAskUser !== null);
  const {
    handleApprove,
    sendUserMessage,
    submitFromEmpty,
    stopRun,
    runBrowserControlDemo,
  } = useMessageSend({
    activeSessionId,
    activeSession,
    pendingAskUser,
    requiresManagedModelConfig,
    activeRuntimeKind,
    activeProjectFilter,
    copy,
    recordApprovalDecision,
    removePendingApproval,
    sendIPCCommand,
    shutdownBridge,
    activateSession,
    appendUserTurn,
    appendSideQuestionUserTurn,
    createSession,
    createSessionPersisted,
    setScreen,
    setActiveProjectFilter,
    pushToast,
    showImageBlockedToast,
    openModelsForMissingConfig,
  });
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
  const { startGoalFromComposer, openGoal, stopGoalFromTopbar } =
    useGoalActions({
      activeGoals,
      activeSession,
      activeProjectFilter,
      activeRuntimeKind,
      llmDisplayName,
      resolvedLanguage,
      requiresManagedModelConfig,
      copy,
      createSessionPersisted,
      setScreen,
      setActiveProjectFilter,
      activateSession,
      appendUserTurnExternal,
      appendSystemTurn,
      assignSessionToProject,
      setActiveGoals,
      openGoalProject,
      pushToast,
      openModelsForMissingConfig,
    });

  // Archived dialog open state — local UI state, no need to live in
  // the global store. Persisting across reloads would be confusing
  // (user expects modals to be closed on app re-open).
  const [archivedOpen, setArchivedOpen] = useState(false);
  // EarlierDialog: opens when the user clicks the collapsed
  // "Earlier (N)" row in the sidebar. Same local-state rationale as
  // archivedOpen.
  const [earlierOpen, setEarlierOpen] = useState(false);
  // Uses the same grouping+backfill as the sidebar timeline so the
  // dialog holds exactly what the "更早 N" row counts — sessions
  // promoted into 最近 by backfillRecentSessions are excluded here too.
  const earlierSessions = useMemo(
    () => backfillRecentSessions(groupSessions(visibleSessions)).earlier,
    [visibleSessions],
  );
  // Settings-driven Onboarding re-entry (Re-run Health Check / Setup
  // Assistant) + the return flows out of the takeover. State + logic
  // live in the hook; both Settings and OnboardingScreen consume it.
  const onboarding = useOnboardingFlow({
    screen,
    setScreen,
    setSettingsOpen,
    setEmptyComposerFocusTick,
    gaConfig,
    setGAConfig,
    activeRuntimeKind,
    setActiveRuntimeKind,
  });

  const showBrowserControlAttention =
    activeRuntimeKind === "managed" &&
    (browserControlStatus === "not_connected" ||
      browserControlStatus === "error");

  // Onboarding takeover: no AppShell, no overlays besides the dev
  // toggle.
  if (screen === "onboarding") {
    return (
      <OnboardingScreen
        resolvedLanguage={resolvedLanguage}
        resolvedTheme={resolvedTheme}
        mode={onboarding.mode}
        gaPath={gaConfig.gaPath}
        canContinueWithCurrentModel={
          activeRuntimeKind === "managed" && hasConfiguredManagedModel
        }
        languagePreference={languagePreference}
        onChangeLanguagePreference={(preference) => {
          void setLanguagePreference(preference);
        }}
        onComplete={onboarding.handleComplete}
        onManagedComplete={onboarding.handleManagedComplete}
        onCancel={onboarding.returnToSettings}
      />
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
            <MainHeaderHost
              sessionTitle={activeSession?.title}
              activeGoals={activeGoals}
              channelsState={channelsState}
              channelsLoadError={channelsLoadError}
              onOpenGoalProject={openGoalProject}
              onOpenGoal={(goalId) => {
                void openGoal(goalId);
              }}
              onStopGoal={(goalId) => {
                void stopGoalFromTopbar(goalId);
              }}
              openSettings={openSettings}
              onOpenSettings={() => setSettingsOpen(true)}
              resolvedTheme={resolvedTheme}
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
                  onClearProjectContext={() =>
                    setActiveProjectFilter(undefined)
                  }
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
                  approvalMode={emptyApprovalModeState}
                  onGoalSubmit={startGoalFromComposer}
                  hasActiveGoal={goalSlotOccupied}
                  imagesEnabled={activeRuntimeKind === "managed"}
                  onImageBlocked={handleImageBlocked}
                  onSubmit={submitFromEmpty}
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
                  approvalMode={mainApprovalModeState}
                  goal={activeSessionGoal}
                  hasActiveGoal={goalSlotOccupied}
                  sessionGoals={sessionGoals}
                  onOpenSession={(sid) => void activateSession(sid)}
                  onStopGoal={(goalId) => void stopGoalFromTopbar(goalId)}
                  onGoalSubmit={startGoalFromComposer}
                  imagesEnabled={activeSession?.gaRuntimeKind === "managed"}
                  onImageBlocked={handleImageBlocked}
                  pendingApprovals={pendingApprovals}
                  approvalDecisions={approvalDecisions}
                  onSubmit={sendUserMessage}
                  onApprove={handleApprove}
                  onStop={stopRun}
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

      <SettingsHost
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        tab={settingsTab}
        onTabChange={setSettingsTab}
        resolvedTheme={resolvedTheme}
        onReRunHealthCheck={onboarding.enterHealthCheckRevisit}
        onOpenSetupAssistant={onboarding.enterSetupAssistant}
        onRunBrowserControlDemo={() => {
          setSettingsOpen(false);
          void runBrowserControlDemo();
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
          void restartChannels();
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

      <FirstCloseDialog
        open={firstClose.open}
        onOpenChange={firstClose.setOpen}
        onChoose={(keepInBackground) => {
          firstClose.setOpen(false);
          // The store setter persists the pref (and pushes the atomic);
          // resolveFirstClose records the choice and hides or quits.
          void setKeepInBackgroundOnClose(keepInBackground);
          void resolveFirstClose(keepInBackground);
        }}
      />
    </CopyProvider>
  );
}

export default App;
