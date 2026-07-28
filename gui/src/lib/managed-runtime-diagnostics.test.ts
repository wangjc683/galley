import { describe, expect, it } from "vitest";

import { applyManagedRuntimeDiagnostics } from "@/lib/managed-runtime-diagnostics";
import { useRuntimeStore } from "@/stores/runtime";
import { resetStores } from "@/test/store-reset";
import type { ManagedRuntimeDiagnostics } from "@/types/inspector";

// Fixture values are deliberately synthetic: the adapter under test is
// baseline-agnostic (it forwards whatever the diagnostics carry), so a
// real SHA here would only create a fake sync obligation on every GA
// baseline upgrade — which is exactly what happened before 2026-07-28,
// when this fixture drifted freely without failing anything. The real
// baseline lives in managed-ga/manifest.json.
const SYNTHETIC_COMMIT = "feedc0defeedc0defeedc0defeedc0defeedc0de";

describe("applyManagedRuntimeDiagnostics", () => {
  it("uses the managed manifest commit as the external GA comparison baseline", () => {
    resetStores();

    const diagnostics: ManagedRuntimeDiagnostics = {
      manifestSchemaVersion: 1,
      upstreamSource: "example/SyntheticAgent",
      upstreamBranch: "main",
      upstreamCommit: SYNTHETIC_COMMIT,
      upstreamAuditedAt: "2099-01-01",
      patchStackId: "synthetic-patch-stack",
      patchCount: 3,
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
      gaBaseline: SYNTHETIC_COMMIT,
      managedRuntime: diagnostics,
    });
  });
});
