import { describe, expect, it } from "vitest";

import { applyManagedRuntimeDiagnostics } from "@/lib/managed-runtime-diagnostics";
import { useRuntimeStore } from "@/stores/runtime";
import { resetStores } from "@/test/store-reset";
import type { ManagedRuntimeDiagnostics } from "@/types/inspector";

describe("applyManagedRuntimeDiagnostics", () => {
  it("uses the managed manifest commit as the external GA comparison baseline", () => {
    resetStores();

    const diagnostics: ManagedRuntimeDiagnostics = {
      manifestSchemaVersion: 1,
      upstreamSource: "lsdefine/GenericAgent",
      upstreamBranch: "main",
      upstreamCommit: "1e89c3eece5a54938c06156a0e49de76ca926e07",
      upstreamAuditedAt: "2026-07-15",
      patchStackId: "galley-managed-ga-patches-v1",
      patchCount: 10,
      stateSchemaVersion: 1,
      promptProfileId: "galley-managed-v1",
      promptHash: "12345678",
      paths: {
        resourceRoot: "/resources/managed-ga",
        codeRoot: "/resources/managed-ga/code",
        memorySeedDir: "/resources/managed-ga/state-seed/memory",
        manifestPath: "/resources/managed-ga/manifest.json",
        patchManifestPath: "/resources/managed-ga/patches/manifest.md",
        stateRoot: "/app/managed-ga-state",
        memoryDir: "/app/managed-ga-state/memory",
        sopDir: "/app/managed-ga-state/sop",
        skillsDir: "/app/managed-ga-state/skills",
        tempDir: "/app/managed-ga-state/temp",
        modelResponsesDir: "/app/managed-ga-state/model_responses",
        modelConfigDir: "/app/managed-model-config",
        modelConfigPath: "/app/managed-model-config/mykey.py",
      },
      code: {
        resourceRootExists: true,
        codeRootExists: true,
        agentmainExists: true,
        manifestExists: true,
        patchManifestExists: true,
      },
      state: {
        initialized: true,
        createdDirs: [],
        modelConfigExists: true,
        memorySeed: {
          sourceExists: true,
          criticalFilesPresent: true,
          criticalFilesMissing: [],
          copiedFiles: [],
        },
      },
    };

    applyManagedRuntimeDiagnostics(diagnostics);

    expect(useRuntimeStore.getState().runtimeInfo).toMatchObject({
      gaBaseline: "1e89c3eece5a54938c06156a0e49de76ca926e07",
      managedRuntime: diagnostics,
    });
  });
});
