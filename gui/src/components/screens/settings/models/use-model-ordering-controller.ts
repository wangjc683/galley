import { useMemo, useState } from "react";

import type { ManagedModelsStore } from "@/stores/managed-models";
import type { ManagedModelRecord } from "@/types/managed-models";

import { applyModelOrder } from "./model-settings-utils";
import type { ModelMoveDirection, ModelMoveFeedbackState } from "./types";

export function useModelOrderingController({
  models,
  saving,
  saveModel,
  reorderModels,
  showModelConfigSavedToast,
}: {
  models: ManagedModelRecord[];
  saving: boolean;
  saveModel: ManagedModelsStore["saveModel"];
  reorderModels: ManagedModelsStore["reorderModels"];
  showModelConfigSavedToast: (message?: string) => void;
}) {
  const [optimisticModelIds, setOptimisticModelIds] = useState<string[] | null>(
    null,
  );
  const [modelMoveFeedback, setModelMoveFeedback] =
    useState<ModelMoveFeedbackState | null>(null);

  const orderedModels = useMemo(
    () => applyModelOrder(models, optimisticModelIds),
    [models, optimisticModelIds],
  );

  const clearMoveFeedback = (nonce: number) => {
    window.setTimeout(() => {
      setModelMoveFeedback((current) =>
        current?.nonce === nonce ? null : current,
      );
    }, 320);
  };

  const handleSetDefaultModel = async (model: ManagedModelRecord) => {
    if (orderedModels[0]?.id === model.id) return;
    const currentIndex = orderedModels.findIndex(
      (item) => item.id === model.id,
    );
    const next =
      currentIndex > 0
        ? [model, ...orderedModels.filter((item) => item.id !== model.id)]
        : orderedModels;
    const nonce = Date.now();
    if (currentIndex > 0) {
      setOptimisticModelIds(next.map((item) => item.id));
      setModelMoveFeedback({
        movedId: model.id,
        swappedId: orderedModels[0]?.id ?? model.id,
        direction: "up",
        nonce,
      });
      clearMoveFeedback(nonce);
    }
    try {
      await saveModel({
        id: model.id,
        providerId: model.providerId,
        model: model.model,
        displayName: model.displayName,
        advancedOptions: model.advancedOptions,
        makeDefault: true,
      });
      setOptimisticModelIds(null);
      showModelConfigSavedToast();
    } catch {
      setOptimisticModelIds(null);
    }
  };

  const handleMoveConfiguredModel = async (
    modelId: string,
    direction: ModelMoveDirection,
  ) => {
    if (saving || orderedModels.length <= 1) return;
    const sourceIndex = orderedModels.findIndex((item) => item.id === modelId);
    const targetIndex = direction === "up" ? sourceIndex - 1 : sourceIndex + 1;
    if (
      sourceIndex < 0 ||
      targetIndex < 0 ||
      targetIndex >= orderedModels.length
    ) {
      return;
    }
    const next = [...orderedModels];
    const swapped = next[targetIndex];
    [next[sourceIndex], next[targetIndex]] = [
      next[targetIndex],
      next[sourceIndex],
    ];
    const nonce = Date.now();
    setOptimisticModelIds(next.map((item) => item.id));
    setModelMoveFeedback({
      movedId: modelId,
      swappedId: swapped.id,
      direction,
      nonce,
    });
    clearMoveFeedback(nonce);
    try {
      await reorderModels(next.map((item) => item.id));
      setOptimisticModelIds(null);
      showModelConfigSavedToast();
    } catch {
      setOptimisticModelIds(null);
    }
  };

  // Drag-and-drop path: the panel hands back the full id list already
  // in its final order. No swap animation — dnd-kit already animated
  // the rows into place, a second flash would double the motion.
  const handleReorderConfiguredModels = async (orderedIds: string[]) => {
    if (saving || orderedIds.length <= 1) return;
    const currentIds = orderedModels.map((item) => item.id);
    if (currentIds.every((id, index) => id === orderedIds[index])) return;
    setOptimisticModelIds(orderedIds);
    try {
      await reorderModels(orderedIds);
      setOptimisticModelIds(null);
      showModelConfigSavedToast();
    } catch {
      setOptimisticModelIds(null);
    }
  };

  return {
    orderedModels,
    modelMoveFeedback,
    handleMoveConfiguredModel,
    handleReorderConfiguredModels,
    handleSetDefaultModel,
  };
}
