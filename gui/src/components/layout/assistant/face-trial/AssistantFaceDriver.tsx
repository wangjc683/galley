import { useEffect } from "react";

import { useAssistantFaceDriver } from "@/hooks/useAssistantFaceDriver";
import { REAL_CLOCK } from "@/lib/assistant-face-director";
import { useAssistantFaceStore } from "@/stores/assistant-face";
import type { Session } from "@/types/session";

import { FaceDemo } from "./face-demo";
import { useAssistantFaceTrial } from "./face-trial";

/*
 * TEMPORARY — 票 66 临时切换器，定档后由拆除票删掉 (see face-trial.ts).
 * The face's one driver, mounted by App in a dev build, alive at rest
 * (丙, ruling 119 point 1), and the demo on top of it. When the trial
 * ends, the driver's mount stays (without the demo) and this file goes.
 */
export function AssistantFaceDriver({
  mainChat,
  subtasks,
  open,
}: {
  mainChat: Session;
  subtasks: Session[];
  open: boolean;
}) {
  const trial = useAssistantFaceTrial();
  const director = useAssistantFaceDriver({
    mainChat,
    subtasks,
    open,
    alive: true,
    demo: trial.demo,
  });

  useEffect(() => {
    const current = director.current;
    if (!trial.demo || !current) return;
    const demo = new FaceDemo(current, REAL_CLOCK, (item) =>
      useAssistantFaceStore.getState().setDemoLabel(item?.label ?? null),
    );
    demo.start(trial.pinned);
    return () => demo.stop();
  }, [trial.demo, trial.pinned, director]);

  return null;
}
