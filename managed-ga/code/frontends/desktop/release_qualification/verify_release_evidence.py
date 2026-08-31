#!/usr/bin/env python3
"""Combine three package reports and enforce the automated release evidence gate."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


COMMON_CHECKS = (
    "packageShape",
    "deterministicChat",
    "uploadUnderExternalRoot",
    "isolatedConductorOwnership",
    "memoryImport",
    "warmRestart",
    "foreignListenerSurvived",
    "portRecovery",
    "relocation",
    "staleOverrideFallback",
    "optionalP2PDoesNotBlockReady",
    "settingsRestored",
    "finalPortFree",
    "finalConductorPortFree",
    "defaultConductorPortPreserved",
    "ownedProcessStops",
    "finalOwnedProcessesExited",
)

SUCCESSFUL_APPLICATION_SCENARIOS = {
    "first-launch",
    "warm-restart",
    "after-port-release",
    "relocated",
    "stale-override",
}


def load(path: str) -> dict[str, Any]:
    target = Path(path).expanduser().resolve()
    try:
        value = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"cannot read {target}: {error}") from error
    if not isinstance(value, dict):
        raise ValueError(f"report is not an object: {target}")
    value["_path"] = str(target)
    return value


def assert_report(name: str, report: dict[str, Any], expected_commit: str) -> list[str]:
    failures: list[str] = []
    actual_commit = str(report.get("expectedCommit", "")).lower()
    if actual_commit != expected_commit.lower():
        failures.append(f"{name}: commit {actual_commit!r} != {expected_commit!r}")
    if report.get("releaseVersion") != "0.2.1":
        failures.append(f"{name}: release version is not 0.2.1")
    if report.get("success") is not True:
        failures.append(f"{name}: automated qualification did not pass")
    if not str(report.get("artifact", {}).get("sha256", "")):
        failures.append(f"{name}: artifact SHA-256 is missing")
    checks = report.get("checks", {})
    for check in COMMON_CHECKS:
        if not checks.get(check):
            failures.append(f"{name}: required check {check} did not pass")
    environment = report.get("environment")
    isolated_port = (
        environment.get("isolatedConductorPort") if isinstance(environment, dict) else None
    )
    if (
        not isinstance(isolated_port, int)
        or isinstance(isolated_port, bool)
        or not 1 <= isolated_port <= 65535
        or isolated_port in {8900, 14168}
    ):
        failures.append(f"{name}: isolated conductor port is missing or invalid")
    ownership = checks.get("isolatedConductorOwnership")
    if not isinstance(ownership, dict) or set(ownership) != SUCCESSFUL_APPLICATION_SCENARIOS:
        failures.append(f"{name}: conductor ownership does not cover every successful launch")
    elif isinstance(isolated_port, int):
        for scenario, state in ownership.items():
            pid = state.get("pid") if isinstance(state, dict) else None
            if (
                not isinstance(state, dict)
                or state.get("status") != "running"
                or state.get("running") is not True
                or state.get("owned") is not True
                or state.get("external") is not False
                or state.get("port") != isolated_port
                or not isinstance(pid, int)
                or isinstance(pid, bool)
                or pid <= 0
            ):
                failures.append(f"{name}: invalid conductor ownership evidence for {scenario}")
    stops = checks.get("ownedProcessStops")
    if not isinstance(stops, dict) or set(stops) != SUCCESSFUL_APPLICATION_SCENARIOS:
        failures.append(f"{name}: owned process stops do not cover every successful launch")
    else:
        for scenario, pids in stops.items():
            expected_conductor_pid = (
                ownership.get(scenario, {}).get("pid") if isinstance(ownership, dict) else None
            )
            if (
                not isinstance(pids, dict)
                or set(pids) != {"app", "bridge", "conductor"}
                or any(
                    not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0
                    for pid in pids.values()
                )
                or len(set(pids.values())) != 3
                or pids.get("conductor") != expected_conductor_pid
            ):
                failures.append(f"{name}: invalid owned process stop evidence for {scenario}")
    if name == "macos" and checks.get("macAppImmutable") is not True:
        failures.append("macos: signed .app immutability did not pass")
    required_bootstrap = SUCCESSFUL_APPLICATION_SCENARIOS | {"foreign-port"}
    missing_bootstrap = sorted(required_bootstrap - set(report.get("bootstrap", {})))
    if missing_bootstrap:
        failures.append(f"{name}: missing bootstrap evidence {missing_bootstrap}")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected-commit", required=True)
    parser.add_argument("--windows", required=True)
    parser.add_argument("--linux", required=True)
    parser.add_argument("--macos", required=True)
    parser.add_argument("--windows-native-report", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    reports = {
        "windows": load(args.windows),
        "linux": load(args.linux),
        "macos": load(args.macos),
    }
    failures: list[str] = []
    for name, report in reports.items():
        failures.extend(assert_report(name, report, args.expected_commit))

    windows_native = load(args.windows_native_report)
    if windows_native.get("success") is not True:
        failures.append("windows native wrapper did not pass")
    if windows_native.get("checks", {}).get("portConflictRecovery") is not True:
        failures.append("windows native retry path did not pass")
    if windows_native.get("checks", {}).get("settingsRestored") is not True:
        failures.append("windows native wrapper did not restore the original settings file")
    manifest = {
        "schemaVersion": 1,
        "candidateCommit": args.expected_commit,
        "releaseVersion": "0.2.1",
        "platforms": {
            name: {
                "report": report["_path"],
                "artifactSha256": report.get("artifact", {}).get("sha256"),
                "environment": report.get("environment"),
                "success": report.get("success"),
            }
            for name, report in reports.items()
        },
        "windowsNativeReport": windows_native["_path"],
        "gate": "pass" if not failures else "fail",
        "failures": failures,
    }
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if failures:
        for failure in failures:
            print(f"FAIL: {failure}", file=sys.stderr)
        return 1
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
