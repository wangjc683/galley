import { describe, expect, it } from "vitest";

import {
  buildFeedbackPayload,
  type FeedbackEnv,
  formatHealthLine,
  type HealthCheckDto,
} from "./feedback-payload";

/** What `health_report` returns for a typical bundled-engine user. */
const MANAGED_CHECKS: HealthCheckDto[] = [
  { id: "db_readable", status: "ok", detail: "/Users/me/Library/x.db" },
  { id: "ga_path", status: "ok", detail: "not set — managed runtime" },
  { id: "mykey_py", status: "deferred_b4", detail: "gated on ga_path" },
  { id: "agentmain_import", status: "deferred_b4", detail: "not probed" },
  { id: "llm_session_init", status: "deferred_b4", detail: "not probed" },
];

const MANAGED_RUNTIME = {
  upstreamCommit: "f308ee7eb079cc402edf5a934fa65f6d71a4c7ad",
  patchStackId: "galley-managed-ga-patches-v1",
  patchCount: 27,
};

function env(patch: Partial<FeedbackEnv> = {}): FeedbackEnv {
  return {
    workbenchVersion: "0.6.1",
    os: "macOS",
    activeRuntimeKind: "managed",
    managedRuntime: MANAGED_RUNTIME,
    healthLine: formatHealthLine(MANAGED_CHECKS),
    ...patch,
  };
}

describe("formatHealthLine", () => {
  it("drops unprobed (deferred_b4) checks and every detail", () => {
    const line = formatHealthLine(MANAGED_CHECKS);
    expect(line).toBe("db_readable=ok; ga_path=ok");
    expect(line).not.toContain("/Users");
  });

  it("keeps real statuses, including failures", () => {
    expect(
      formatHealthLine([
        { id: "db_readable", status: "ok" },
        { id: "ga_path", status: "ok" },
        { id: "mykey_py", status: "fail", detail: "missing: /x/mykey.py" },
        { id: "agentmain_import", status: "deferred_b4" },
      ]),
    ).toBe("db_readable=ok; ga_path=ok; mykey_py=fail");
  });

  it("is null when nothing probed is left", () => {
    expect(
      formatHealthLine([
        { id: "agentmain_import", status: "deferred_b4" },
        { id: "llm_session_init", status: "deferred_b4" },
      ]),
    ).toBeNull();
    expect(formatHealthLine([])).toBeNull();
  });
});

describe("buildFeedbackPayload", () => {
  it("bundled engine: kernel line, filtered health, same text in the form", () => {
    const payload = buildFeedbackPayload(env());
    expect(payload.text).toBe(
      [
        "galley_version: 0.6.1",
        "os: macOS",
        "engine: managed",
        "kernel: f308ee7 (galley-managed-ga-patches-v1, 27 patches)",
        "health: db_readable=ok; ga_path=ok",
      ].join("\n"),
    );
    expect(payload.healthField).toBe(
      [
        "kernel: f308ee7 (galley-managed-ga-patches-v1, 27 patches)",
        "db_readable=ok; ga_path=ok",
      ].join("\n"),
    );
  });

  it("bundled engine ignores an external commit", () => {
    const payload = buildFeedbackPayload(
      env({ externalGaCommit: "abc1234ff" }),
    );
    expect(payload.text).not.toContain("ga_commit");
    expect(payload.healthField).not.toContain("ga_commit");
  });

  it("no health line at all when every check is unprobed", () => {
    const payload = buildFeedbackPayload(
      env({
        healthLine: formatHealthLine([
          { id: "agentmain_import", status: "deferred_b4" },
        ]),
      }),
    );
    expect(payload.text).not.toContain("health:");
    expect(payload.text).toMatch(/\nkernel: [^\n]+$/);
    expect(payload.healthField).toBe(
      "kernel: f308ee7 (galley-managed-ga-patches-v1, 27 patches)",
    );
  });

  it("external engine: short GA commit after engine, also in the form", () => {
    const payload = buildFeedbackPayload(
      env({
        activeRuntimeKind: "external",
        managedRuntime: MANAGED_RUNTIME,
        externalGaCommit: "9a1b2c3d4e5f60718293a4b5c6d7e8f901234567",
        healthLine: "db_readable=ok; ga_path=ok; mykey_py=ok",
      }),
    );
    expect(payload.text).toBe(
      [
        "galley_version: 0.6.1",
        "os: macOS",
        "engine: external",
        "ga_commit: 9a1b2c3",
        "health: db_readable=ok; ga_path=ok; mykey_py=ok",
      ].join("\n"),
    );
    expect(payload.healthField).toBe(
      ["ga_commit: 9a1b2c3", "db_readable=ok; ga_path=ok; mykey_py=ok"].join(
        "\n",
      ),
    );
  });

  it("external engine without a known commit adds no ga_commit line", () => {
    for (const externalGaCommit of [undefined, "", "unknown"]) {
      const payload = buildFeedbackPayload(
        env({
          activeRuntimeKind: "external",
          externalGaCommit,
          healthLine: null,
        }),
      );
      expect(payload.text).toBe(
        ["galley_version: 0.6.1", "os: macOS", "engine: external"].join("\n"),
      );
      expect(payload.healthField).toBeNull();
    }
  });

  it("unknown OS reads as unknown", () => {
    expect(buildFeedbackPayload(env({ os: null })).text).toContain(
      "os: unknown",
    );
  });
});
