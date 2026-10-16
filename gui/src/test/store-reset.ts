import { useManagedModelsStore } from "@/stores/managed-models";
import { useMessageDeleteStore } from "@/stores/message-delete";
import { useMessagesStore } from "@/stores/messages";
import { usePrefsStore } from "@/stores/prefs";
import { useRuntimeStore } from "@/stores/runtime";
import { useSavedPromptsStore } from "@/stores/saved-prompts";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";

type ResettableStore<T> = {
  getInitialState: () => T;
  setState: (state: T, replace: true) => void;
};

function resetStore<T>(store: ResettableStore<T>): void {
  store.setState(store.getInitialState(), true);
}

export function resetStores(): void {
  resetStore(useMessageDeleteStore);
  resetStore(useMessagesStore);
  resetStore(useSessionsStore);
  resetStore(useRuntimeStore);
  resetStore(usePrefsStore);
  resetStore(useSavedPromptsStore);
  resetStore(useUiStore);
  resetStore(useManagedModelsStore);
}
