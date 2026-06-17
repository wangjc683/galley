use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::args::NativeParityReportModeArg;
use crate::common::{emit_json, SCHEMA_VERSION};
use galley_core_lib::error::GalleyError;
use serde::Serialize;
use tokio::process::Command as TokioCommand;
use tokio::time;

const REPORT_VERSION: u8 = 1;
const FIXTURE_HARNESS: &str = "managed_native_fixture_comparison";
const COMMAND_HARNESS: &str = "managed_native_command_comparison";
const FIRST_BATCH_IDS: [&str; 7] = ["P01", "P03", "P04", "P08", "P14", "P18", "P19"];
const COMMAND_MODE_IDS: [&str; 7] = ["P01", "P03", "P04", "P08", "P14", "P18", "P19"];
const COMMAND_PREVIEW_CHAR_LIMIT: usize = 4096;

pub(crate) async fn native_parity_report(
    scenarios: Vec<String>,
    mode: NativeParityReportModeArg,
    managed_command: Option<String>,
    native_command: Option<String>,
    timeout_seconds: u64,
    workspace: Option<PathBuf>,
    keep_workspace: bool,
    output: Option<PathBuf>,
    pretty: bool,
) -> Result<(), GalleyError> {
    let generated_at = now_iso();
    let galley_commit = galley_commit();
    let (reports, scenario_ids, harness) = match mode {
        NativeParityReportModeArg::Fixture => {
            reject_command_mode_args(
                managed_command,
                native_command,
                timeout_seconds,
                workspace,
                keep_workspace,
            )?;
            let scenario_ids = normalize_scenario_ids(scenarios)?;
            let reports = scenario_ids
                .iter()
                .map(|id| fixture_report(id, &generated_at, &galley_commit))
                .collect::<Result<Vec<_>, _>>()?;
            (reports, scenario_ids, FIXTURE_HARNESS)
        }
        NativeParityReportModeArg::Command => {
            let scenario_id = normalize_command_scenario_id(scenarios)?;
            let request = CommandModeRequest {
                scenario_id: scenario_id.clone(),
                managed_command: required_command(managed_command, "--managed-command")?,
                native_command: required_command(native_command, "--native-command")?,
                timeout_seconds,
                workspace,
                keep_workspace,
            };
            let report = command_report(request, &generated_at, &galley_commit).await?;
            (vec![report], vec![scenario_id], COMMAND_HARNESS)
        }
    };

    let body = if pretty {
        serde_json::to_string_pretty(&reports)
    } else {
        serde_json::to_string(&reports)
    }
    .map_err(|e| GalleyError::Internal {
        message: format!("serialize native parity reports: {e}"),
    })?;

    if let Some(path) = output {
        if let Some(parent) = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            fs::create_dir_all(parent).map_err(|e| GalleyError::Internal {
                message: format!(
                    "create native parity report directory {}: {e}",
                    parent.display()
                ),
            })?;
        }
        fs::write(&path, format!("{body}\n")).map_err(|e| GalleyError::Internal {
            message: format!("write native parity report {}: {e}", path.display()),
        })?;
        let summary = NativeParityWriteSummary {
            schema_version: SCHEMA_VERSION,
            report_version: REPORT_VERSION,
            harness,
            output: path.display().to_string(),
            report_count: reports.len(),
            scenarios: scenario_ids,
        };
        emit_json(&summary)
    } else {
        println!("{body}");
        Ok(())
    }
}

fn normalize_scenario_ids(input: Vec<String>) -> Result<Vec<String>, GalleyError> {
    let requested = if input.is_empty() {
        FIRST_BATCH_IDS.iter().map(|id| (*id).to_string()).collect()
    } else {
        input
    };
    let allowed = FIRST_BATCH_IDS.iter().copied().collect::<HashSet<_>>();
    let mut seen = HashSet::new();
    let mut scenario_ids = Vec::new();

    for raw in requested {
        let id = raw.trim().to_ascii_uppercase();
        if id.is_empty() {
            return Err(GalleyError::InvalidArgs {
                message: "native-parity report: --scenario must not be empty".into(),
            });
        }
        if !allowed.contains(id.as_str()) {
            return Err(GalleyError::InvalidArgs {
                message: format!(
                    "native-parity report: unknown scenario `{id}`. Allowed: {}",
                    FIRST_BATCH_IDS.join(", ")
                ),
            });
        }
        if seen.insert(id.clone()) {
            scenario_ids.push(id);
        }
    }

    Ok(scenario_ids)
}

fn normalize_command_scenario_id(input: Vec<String>) -> Result<String, GalleyError> {
    let scenario_ids = normalize_scenario_ids(input)?;
    if scenario_ids.len() != 1 {
        return Err(GalleyError::InvalidArgs {
            message: "native-parity report --mode command requires exactly one --scenario".into(),
        });
    }
    let id = scenario_ids[0].clone();
    if !COMMAND_MODE_IDS.contains(&id.as_str()) {
        return Err(GalleyError::InvalidArgs {
            message: format!(
                "native-parity report --mode command does not support `{id}` yet. Allowed: {}",
                COMMAND_MODE_IDS.join(", ")
            ),
        });
    }
    Ok(id)
}

fn required_command(command: Option<String>, flag: &str) -> Result<String, GalleyError> {
    let Some(command) = command else {
        return Err(GalleyError::InvalidArgs {
            message: format!("native-parity report --mode command requires {flag}"),
        });
    };
    let command = command.trim();
    if command.is_empty() {
        return Err(GalleyError::InvalidArgs {
            message: format!("native-parity report --mode command requires non-empty {flag}"),
        });
    }
    Ok(command.to_string())
}

fn reject_command_mode_args(
    managed_command: Option<String>,
    native_command: Option<String>,
    timeout_seconds: u64,
    workspace: Option<PathBuf>,
    keep_workspace: bool,
) -> Result<(), GalleyError> {
    if managed_command.is_some()
        || native_command.is_some()
        || workspace.is_some()
        || keep_workspace
        || timeout_seconds != 120
    {
        return Err(GalleyError::InvalidArgs {
            message: "native-parity report command-runner options require --mode command".into(),
        });
    }
    Ok(())
}

fn fixture_report(
    scenario_id: &str,
    generated_at: &str,
    galley_commit: &str,
) -> Result<ParityReport, GalleyError> {
    match scenario_id {
        "P01" => Ok(p01_no_tool_answer(generated_at, galley_commit)),
        "P03" => Ok(p03_code_run(generated_at, galley_commit)),
        "P04" => Ok(p04_file_edit(generated_at, galley_commit)),
        "P08" => Ok(p08_browser_control(generated_at, galley_commit)),
        "P14" => Ok(p14_copy_to_native(generated_at, galley_commit)),
        "P18" => Ok(p18_failure_recovery(generated_at, galley_commit)),
        "P19" => Ok(p19_managed_fallback(generated_at, galley_commit)),
        other => Err(GalleyError::InvalidArgs {
            message: format!("native-parity report: unknown scenario `{other}`"),
        }),
    }
}

async fn command_report(
    request: CommandModeRequest,
    generated_at: &str,
    galley_commit: &str,
) -> Result<ParityReport, GalleyError> {
    if request.timeout_seconds == 0 {
        return Err(GalleyError::InvalidArgs {
            message: "native-parity report --mode command requires --timeout-seconds > 0".into(),
        });
    }

    let workspace = CommandWorkspace::prepare(request.workspace, request.keep_workspace)?;
    let managed_workspace = workspace.side_dir("managed");
    let native_workspace = workspace.side_dir("native");

    let managed_run = run_shell_command(
        "managed",
        &request.managed_command,
        managed_workspace,
        request.timeout_seconds,
    )
    .await?;
    let native_run = run_shell_command(
        "galley_native",
        &request.native_command,
        native_workspace,
        request.timeout_seconds,
    )
    .await?;

    let mut report = fixture_report(&request.scenario_id, generated_at, galley_commit)?;
    let (comparison, accepted_gaps, blockers, notes) = command_mode_verdict_inputs(
        &request.scenario_id,
        &report.comparison,
        &report.accepted_gaps,
        managed_run.success(),
        native_run.success(),
    );

    report.harness = COMMAND_HARNESS.to_string();
    report.managed = runtime_from_command_run("managed", request.managed_command, managed_run);
    report.native = runtime_from_command_run("galley_native", request.native_command, native_run);
    report.comparison = comparison;
    report.accepted_gaps = accepted_gaps;
    report.blockers = blockers;
    report.notes = format!(
        "{} Command mode runs operator-supplied commands in isolated managed/native workspaces; exact stdout text is captured as preview evidence but not used as the parity judge.",
        notes
    );
    report.verdict = derive_verdict(&report.comparison, &report.accepted_gaps, &report.blockers);

    Ok(report)
}

fn command_mode_verdict_inputs(
    scenario_id: &str,
    base: &Comparison,
    base_accepted_gaps: &[AcceptedGap],
    managed_success: bool,
    native_success: bool,
) -> (Comparison, Vec<AcceptedGap>, Vec<Blocker>, String) {
    if managed_success && native_success {
        return command_mode_success_inputs(scenario_id, base, base_accepted_gaps);
    }

    if !managed_success {
        return (
            Comparison {
                outcome: DimensionResult::Blocked,
                tool_action: DimensionResult::Blocked,
                event_rhythm: DimensionResult::Blocked,
                approval: DimensionResult::NotApplicable,
                side_effects: DimensionResult::Blocked,
                memory_policy: DimensionResult::Match,
                workspace_policy: DimensionResult::Match,
                recovery: DimensionResult::Blocked,
                persisted_state: DimensionResult::Match,
            },
            vec![],
            vec![blocker(
                "managedCommand",
                "Managed command did not complete successfully, so the baseline cannot be trusted.",
                "Fix the managed command or environment, then rerun the same scenario.",
            )],
            "Managed baseline command failed or timed out.".to_string(),
        );
    }

    (
        Comparison {
            outcome: DimensionResult::Regression,
            tool_action: DimensionResult::Regression,
            event_rhythm: DimensionResult::AcceptedGap,
            approval: base.approval,
            side_effects: DimensionResult::Regression,
            memory_policy: DimensionResult::Match,
            workspace_policy: DimensionResult::Match,
            recovery: DimensionResult::Regression,
            persisted_state: DimensionResult::Match,
        },
        vec![accepted_gap(
            "eventRhythm",
            "Command mode captures shell command_start/command_exit events rather than live runner NDJSON.",
            "Allowed only for hidden 9D-C/D command evidence.",
            "Replace with live runner event collection before beta rollout decisions.",
        )],
        vec![],
        "Native command failed while managed command succeeded.".to_string(),
    )
}

fn command_mode_success_inputs(
    scenario_id: &str,
    base: &Comparison,
    base_accepted_gaps: &[AcceptedGap],
) -> (Comparison, Vec<AcceptedGap>, Vec<Blocker>, String) {
    match scenario_id {
        "P08" => (
            Comparison {
                outcome: DimensionResult::Match,
                tool_action: DimensionResult::Match,
                event_rhythm: DimensionResult::AcceptedGap,
                approval: DimensionResult::NotApplicable,
                side_effects: DimensionResult::Match,
                memory_policy: DimensionResult::Match,
                workspace_policy: DimensionResult::Match,
                recovery: DimensionResult::Match,
                persisted_state: DimensionResult::Match,
            },
            vec![
                accepted_gap(
                    "browserControl",
                    "Command mode proves operator-supplied Browser Control readiness commands can complete on both runtimes, but it does not yet launch or compare an automatic safe-page browser run.",
                    "Allowed only for hidden 9D-D evidence collection.",
                    "Replace with automatic CDP readiness and safe-page comparison before Settings opt-in.",
                ),
                command_mode_event_gap("9D-D browser/fallback command evidence"),
            ],
            vec![],
            "Both Browser Control readiness commands exited successfully.".to_string(),
        ),
        _ => {
            let mut gaps = base_accepted_gaps.to_vec();
            gaps.extend(command_mode_accepted_gaps(base));
            (
                base.clone(),
                gaps,
                vec![],
                "Both command sides exited successfully.".to_string(),
            )
        }
    }
}

fn command_mode_accepted_gaps(base: &Comparison) -> Vec<AcceptedGap> {
    let mut gaps = Vec::new();
    if base
        .values()
        .iter()
        .any(|value| *value == DimensionResult::AcceptedGap)
    {
        gaps.push(command_mode_event_gap("hidden command evidence"));
    }
    gaps
}

fn command_mode_event_gap(phase_limit: &str) -> AcceptedGap {
    accepted_gap(
        "eventRhythm",
        "Command mode captures shell command_start/command_exit events rather than live runner NDJSON.",
        phase_limit,
        "Replace with live runner event collection before beta rollout decisions.",
    )
}

async fn run_shell_command(
    runtime_kind: &str,
    command_line: &str,
    workspace: PathBuf,
    timeout_seconds: u64,
) -> Result<CommandRun, GalleyError> {
    let started = Instant::now();
    let mut command = shell_command(command_line);
    command
        .current_dir(&workspace)
        .env("GALLEY_PARITY_RUNTIME", runtime_kind)
        .env("GALLEY_PARITY_WORKSPACE", &workspace)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let output = time::timeout(Duration::from_secs(timeout_seconds), command.output()).await;
    match output {
        Ok(Ok(output)) => {
            let duration_ms = started.elapsed().as_millis() as u64;
            let (stdout_preview, stdout_truncated) = preview_bytes(&output.stdout);
            let (stderr_preview, stderr_truncated) = preview_bytes(&output.stderr);
            Ok(CommandRun {
                exit_code: output.status.code(),
                timed_out: false,
                stdout_preview,
                stdout_truncated,
                stderr_preview,
                stderr_truncated,
                duration_ms,
                workspace: workspace.display().to_string(),
            })
        }
        Ok(Err(e)) => Err(GalleyError::Internal {
            message: format!("run native parity {runtime_kind} command: {e}"),
        }),
        Err(_) => {
            let duration_ms = started.elapsed().as_millis() as u64;
            Ok(CommandRun {
                exit_code: None,
                timed_out: true,
                stdout_preview: String::new(),
                stdout_truncated: false,
                stderr_preview: format!("command timed out after {timeout_seconds}s"),
                stderr_truncated: false,
                duration_ms,
                workspace: workspace.display().to_string(),
            })
        }
    }
}

#[cfg(windows)]
fn shell_command(command_line: &str) -> TokioCommand {
    let mut command = TokioCommand::new("cmd");
    command.arg("/C").arg(command_line);
    command
}

#[cfg(not(windows))]
fn shell_command(command_line: &str) -> TokioCommand {
    let mut command = TokioCommand::new("sh");
    command.arg("-lc").arg(command_line);
    command
}

fn preview_bytes(bytes: &[u8]) -> (String, bool) {
    let text = String::from_utf8_lossy(bytes);
    let mut preview = String::new();
    let mut truncated = false;
    for (idx, ch) in text.chars().enumerate() {
        if idx >= COMMAND_PREVIEW_CHAR_LIMIT {
            truncated = true;
            break;
        }
        preview.push(ch);
    }
    (preview, truncated)
}

fn runtime_from_command_run(
    runtime_kind: &str,
    command: String,
    command_run: CommandRun,
) -> RuntimeEvidence {
    let status = if command_run.success() {
        "success"
    } else if command_run.timed_out {
        "timeout"
    } else {
        "error"
    };
    let exit = command_run
        .exit_code
        .map(|code| code.to_string())
        .unwrap_or_else(|| "none".to_string());

    RuntimeEvidence {
        runtime_kind: runtime_kind.to_string(),
        model: "operator_supplied_command".to_string(),
        command,
        events: if command_run.timed_out {
            vec!["command_start".to_string(), "command_timeout".to_string()]
        } else {
            vec!["command_start".to_string(), "command_exit".to_string()]
        },
        tools: vec![tool("command_runner", status, "explicit_cli", true)],
        final_outcome: format!(
            "Command {status}; exitCode={exit}; durationMs={}",
            command_run.duration_ms
        ),
        persisted_state: vec!["local parity report evidence".to_string()],
        command_status: Some(CommandStatus {
            exit_code: command_run.exit_code,
            timed_out: command_run.timed_out,
            stdout_preview: command_run.stdout_preview,
            stdout_truncated: command_run.stdout_truncated,
            stderr_preview: command_run.stderr_preview,
            stderr_truncated: command_run.stderr_truncated,
            duration_ms: command_run.duration_ms,
            workspace: command_run.workspace,
        }),
    }
}

fn p01_no_tool_answer(generated_at: &str, galley_commit: &str) -> ParityReport {
    report(
        generated_at,
        galley_commit,
        "P01",
        "Basic no-tool answer",
        "opt-in-beta",
        runtime(
            "managed",
            "galley session new --runtime managed \"Summarize the release note in one sentence.\"",
            &["turn_start", "assistant_delta", "turn_end"],
            &[],
            "Answered directly without invoking tools.",
            &["visible user turn", "visible assistant turn"],
        ),
        runtime(
            "galley_native",
            "galley session new --runtime galley-native \"Summarize the release note in one sentence.\"",
            &[
                "runtime_ready",
                "turn_start",
                "assistant_delta",
                "turn_end",
                "run_complete",
            ],
            &[],
            "Answered directly without invoking tools.",
            &["visible user turn", "visible assistant turn"],
        ),
        Comparison {
            outcome: DimensionResult::Match,
            tool_action: DimensionResult::NotApplicable,
            event_rhythm: DimensionResult::AcceptedGap,
            approval: DimensionResult::NotApplicable,
            side_effects: DimensionResult::NotApplicable,
            memory_policy: DimensionResult::Match,
            workspace_policy: DimensionResult::Match,
            recovery: DimensionResult::NotApplicable,
            persisted_state: DimensionResult::Match,
        },
        vec![accepted_gap(
            "eventRhythm",
            "Native emits runtime_ready/run_complete around the same direct-answer workflow.",
            "Allowed for opt-in beta because stream fields are additive.",
            "Keep Supervisor parser dogfood focused on stable stream/kind/sessionId fields.",
        )],
        vec![],
        "Fixture baseline for the smallest user-visible managed replacement proof.",
    )
}

fn p03_code_run(generated_at: &str, galley_commit: &str) -> ParityReport {
    report(
        generated_at,
        galley_commit,
        "P03",
        "code_run",
        "beta-blocker",
        runtime(
            "managed",
            "galley session new --runtime managed \"Use code to count rows in fixture.csv.\"",
            &[
                "turn_start",
                "tool_pending",
                "approval_pending",
                "tool_progress",
                "tool_end",
                "turn_end",
            ],
            &[tool("code_run", "success", "risk_based", false)],
            "Ran a bounded command, used the output, and answered with the count.",
            &["visible user turn", "visible assistant turn", "tool audit"],
        ),
        runtime(
            "galley_native",
            "galley session new --runtime galley-native \"Use code to count rows in fixture.csv.\"",
            &[
                "runtime_ready",
                "turn_start",
                "tool_pending",
                "approval_pending",
                "tool_progress",
                "tool_end",
                "turn_end",
                "run_complete",
            ],
            &[tool("code_run", "success", "risk_based", false)],
            "Ran a bounded command, used the output, and answered with the count.",
            &["visible user turn", "visible assistant turn", "tool audit"],
        ),
        Comparison {
            outcome: DimensionResult::Match,
            tool_action: DimensionResult::Match,
            event_rhythm: DimensionResult::AcceptedGap,
            approval: DimensionResult::Match,
            side_effects: DimensionResult::Match,
            memory_policy: DimensionResult::Match,
            workspace_policy: DimensionResult::Match,
            recovery: DimensionResult::NotApplicable,
            persisted_state: DimensionResult::Match,
        },
        vec![accepted_gap(
            "eventRhythm",
            "Native wraps the same approval-gated command lifecycle with runtime_ready/run_complete.",
            "Allowed while native is hidden because the command, approval, and tool audit surfaces match.",
            "Real runner should confirm ordered progress frames against a temp workspace.",
        )],
        vec![],
        "Fixture comparison checks the approval-sensitive command path before live LLM variance is introduced.",
    )
}

fn p04_file_edit(generated_at: &str, galley_commit: &str) -> ParityReport {
    report(
        generated_at,
        galley_commit,
        "P04",
        "File edit",
        "beta-blocker",
        runtime(
            "managed",
            "galley session new --runtime managed \"Patch notes.txt in the temp workspace.\"",
            &[
                "turn_start",
                "tool_pending",
                "approval_pending",
                "tool_end",
                "turn_end",
            ],
            &[tool("file_patch", "success", "risk_based", true)],
            "Previewed and applied a targeted patch, then named the changed file.",
            &["visible user turn", "visible assistant turn", "tool audit"],
        ),
        runtime(
            "galley_native",
            "galley session new --runtime galley-native \"Patch notes.txt in the temp workspace.\"",
            &[
                "runtime_ready",
                "turn_start",
                "tool_pending",
                "approval_pending",
                "tool_end",
                "turn_end",
                "run_complete",
            ],
            &[tool("file_patch", "success", "risk_based", true)],
            "Previewed and applied a targeted patch, then named the changed file.",
            &["visible user turn", "visible assistant turn", "tool audit"],
        ),
        Comparison {
            outcome: DimensionResult::Match,
            tool_action: DimensionResult::Match,
            event_rhythm: DimensionResult::AcceptedGap,
            approval: DimensionResult::Match,
            side_effects: DimensionResult::Match,
            memory_policy: DimensionResult::Match,
            workspace_policy: DimensionResult::Match,
            recovery: DimensionResult::NotApplicable,
            persisted_state: DimensionResult::Match,
        },
        vec![accepted_gap(
            "eventRhythm",
            "Native emits additional runtime boundary events around the same preview-first file edit flow.",
            "Allowed for beta only if file preview, approval, and audit remain visible.",
            "Promote to pass after real runner proves temp-workspace patch parity.",
        )],
        vec![],
        "File editing stays beta-blocker because the side effect is user-visible and must keep preview-first semantics.",
    )
}

fn p08_browser_control(generated_at: &str, galley_commit: &str) -> ParityReport {
    report(
        generated_at,
        galley_commit,
        "P08",
        "Browser Control",
        "beta-blocker",
        runtime(
            "managed",
            "galley session new --runtime managed \"Inspect the safe browser fixture page.\"",
            &["turn_start", "tool_pending", "tool_end", "turn_end"],
            &[tool("web_scan", "not_run", "none", false)],
            "Fixture report does not start managed Browser Control.",
            &["visible user turn", "visible assistant turn"],
        ),
        runtime(
            "galley_native",
            "galley session new --runtime galley-native \"Inspect the safe browser fixture page.\"",
            &["runtime_ready", "turn_start", "tool_pending", "tool_end", "run_complete"],
            &[tool("web_scan", "blocked", "none", false)],
            "Fixture report does not launch CDP or a safe browser page.",
            &["visible user turn", "visible assistant turn", "tool audit"],
        ),
        Comparison {
            outcome: DimensionResult::Blocked,
            tool_action: DimensionResult::Blocked,
            event_rhythm: DimensionResult::Blocked,
            approval: DimensionResult::NotApplicable,
            side_effects: DimensionResult::NotApplicable,
            memory_policy: DimensionResult::Match,
            workspace_policy: DimensionResult::Match,
            recovery: DimensionResult::Blocked,
            persisted_state: DimensionResult::Match,
        },
        vec![],
        vec![blocker(
            "browserControl",
            "The fixture comparator does not launch a browser, attach CDP, or serve a safe test page.",
            "Add a real Browser Control readiness probe before native beta.",
        )],
        "Browser remains the heaviest 9D path and is intentionally called out as blocked by fixture-only evidence.",
    )
}

fn p14_copy_to_native(generated_at: &str, galley_commit: &str) -> ParityReport {
    report(
        generated_at,
        galley_commit,
        "P14",
        "Copy-to-native migration",
        "opt-in-beta",
        runtime(
            "managed",
            "galley session show <managed-session>",
            &["session_snapshot"],
            &[],
            "Source managed session remains readable and unmodified.",
            &["source visible user turn", "source visible assistant turn"],
        ),
        runtime(
            "galley_native",
            "galley session copy-to-native <managed-session>",
            &["copy_started", "copy_committed"],
            &[],
            "Created a new native session with visible transcript context and the same Project association.",
            &[
                "copied visible user turn",
                "copied visible assistant turn",
                "copied project association",
            ],
        ),
        Comparison {
            outcome: DimensionResult::Match,
            tool_action: DimensionResult::Match,
            event_rhythm: DimensionResult::Match,
            approval: DimensionResult::NotApplicable,
            side_effects: DimensionResult::Match,
            memory_policy: DimensionResult::Match,
            workspace_policy: DimensionResult::Match,
            recovery: DimensionResult::NotApplicable,
            persisted_state: DimensionResult::Match,
        },
        vec![],
        vec![],
        "Copy-to-native is the safest migration path because it creates new native state without mutating the source session.",
    )
}

fn p18_failure_recovery(generated_at: &str, galley_commit: &str) -> ParityReport {
    report(
        generated_at,
        galley_commit,
        "P18",
        "Failure recovery",
        "opt-in-beta",
        runtime(
            "managed",
            "galley session new --runtime managed \"Use unavailable browser state.\"",
            &["turn_start", "tool_pending", "tool_error", "turn_end"],
            &[tool("web_scan", "error", "none", false)],
            "Explained the missing prerequisite and named the next action.",
            &["visible user turn", "visible assistant recovery turn", "tool audit"],
        ),
        runtime(
            "galley_native",
            "galley session new --runtime galley-native \"Use unavailable browser state.\"",
            &[
                "runtime_ready",
                "turn_start",
                "tool_pending",
                "tool_error",
                "turn_end",
                "run_complete",
            ],
            &[tool("web_scan", "error", "none", false)],
            "Explained the missing prerequisite and named the next action.",
            &["visible user turn", "visible assistant recovery turn", "tool audit"],
        ),
        Comparison {
            outcome: DimensionResult::Match,
            tool_action: DimensionResult::Match,
            event_rhythm: DimensionResult::AcceptedGap,
            approval: DimensionResult::NotApplicable,
            side_effects: DimensionResult::Match,
            memory_policy: DimensionResult::Match,
            workspace_policy: DimensionResult::Match,
            recovery: DimensionResult::Match,
            persisted_state: DimensionResult::Match,
        },
        vec![accepted_gap(
            "eventRhythm",
            "Native records the same recoverable error inside a longer runtime event envelope.",
            "Allowed while hidden because the user-facing recovery instruction is the comparison target.",
            "Real runner should compare specific recovery categories for model, workspace, and browser prerequisites.",
        )],
        vec![],
        "Recovery parity matters because users need the next action, not just a failed native experiment.",
    )
}

fn p19_managed_fallback(generated_at: &str, galley_commit: &str) -> ParityReport {
    report(
        generated_at,
        galley_commit,
        "P19",
        "Managed fallback",
        "opt-in-beta",
        runtime(
            "managed",
            "galley session new --runtime managed \"Continue after native gap.\"",
            &["turn_start", "assistant_delta", "turn_end"],
            &[],
            "Managed remains usable for the same operator task.",
            &["visible user turn", "visible assistant turn"],
        ),
        runtime(
            "galley_native",
            "galley session new --runtime galley-native \"Continue after native gap.\"",
            &["runtime_ready", "turn_start", "tool_error", "turn_end", "run_complete"],
            &[],
            "Native data remains readable after the gap; fallback is operator-selected, not automatic.",
            &["visible native user turn", "visible native assistant recovery turn"],
        ),
        Comparison {
            outcome: DimensionResult::AcceptedGap,
            tool_action: DimensionResult::NotApplicable,
            event_rhythm: DimensionResult::AcceptedGap,
            approval: DimensionResult::NotApplicable,
            side_effects: DimensionResult::Match,
            memory_policy: DimensionResult::Match,
            workspace_policy: DimensionResult::Match,
            recovery: DimensionResult::AcceptedGap,
            persisted_state: DimensionResult::Match,
        },
        vec![
            accepted_gap(
                "outcome",
                "Fallback is manual: the operator can keep using managed while native data remains readable.",
                "Allowed during v0.3 dogfood because Settings exposes an explicit legacy managed fallback.",
                "Before public release, fallback must be clear in product surfaces and troubleshooting.",
            ),
            accepted_gap(
                "recovery",
                "Native can explain the gap but does not automatically reroute the turn to managed.",
                "Allowed for hidden beta because automatic reroute could create surprising state movement.",
                "Design an explicit user-controlled fallback action before broader rollout.",
            ),
        ],
        vec![],
        "Fallback parity is a rollout-safety report, not a claim that native and managed produce identical execution.",
    )
}

fn report(
    generated_at: &str,
    galley_commit: &str,
    scenario_id: &str,
    scenario_title: &str,
    phase_gate: &str,
    managed: RuntimeEvidence,
    native: RuntimeEvidence,
    comparison: Comparison,
    accepted_gaps: Vec<AcceptedGap>,
    blockers: Vec<Blocker>,
    notes: &str,
) -> ParityReport {
    let verdict = derive_verdict(&comparison, &accepted_gaps, &blockers);
    ParityReport {
        report_version: REPORT_VERSION,
        generated_at: generated_at.to_string(),
        galley_commit: galley_commit.to_string(),
        scenario_id: scenario_id.to_string(),
        scenario_title: scenario_title.to_string(),
        verdict,
        phase_gate: phase_gate.to_string(),
        harness: FIXTURE_HARNESS.to_string(),
        managed,
        native,
        comparison,
        accepted_gaps,
        blockers,
        notes: notes.to_string(),
    }
}

fn runtime(
    runtime_kind: &str,
    command: &str,
    events: &[&str],
    tools: &[ToolEvidence],
    final_outcome: &str,
    persisted_state: &[&str],
) -> RuntimeEvidence {
    RuntimeEvidence {
        runtime_kind: runtime_kind.to_string(),
        model: "fixture".to_string(),
        command: command.to_string(),
        events: events.iter().map(|event| (*event).to_string()).collect(),
        tools: tools.to_vec(),
        final_outcome: final_outcome.to_string(),
        persisted_state: persisted_state
            .iter()
            .map(|state| (*state).to_string())
            .collect(),
        command_status: None,
    }
}

fn tool(name: &str, status: &str, approval: &str, side_effects_performed: bool) -> ToolEvidence {
    ToolEvidence {
        name: name.to_string(),
        status: status.to_string(),
        approval: approval.to_string(),
        side_effects_performed,
    }
}

fn accepted_gap(dimension: &str, reason: &str, phase_limit: &str, follow_up: &str) -> AcceptedGap {
    AcceptedGap {
        dimension: dimension.to_string(),
        reason: reason.to_string(),
        phase_limit: phase_limit.to_string(),
        follow_up: follow_up.to_string(),
    }
}

fn blocker(dimension: &str, reason: &str, next_action: &str) -> Blocker {
    Blocker {
        dimension: dimension.to_string(),
        reason: reason.to_string(),
        next_action: next_action.to_string(),
    }
}

fn derive_verdict(
    comparison: &Comparison,
    accepted_gaps: &[AcceptedGap],
    blockers: &[Blocker],
) -> Verdict {
    if !blockers.is_empty() {
        return Verdict::Blocked;
    }

    let values = comparison.values();
    if values.iter().all(|value| *value == DimensionResult::NotRun) {
        return Verdict::NotRun;
    }
    if values
        .iter()
        .any(|value| *value == DimensionResult::Blocked)
    {
        return Verdict::Blocked;
    }
    if values.iter().any(|value| {
        matches!(
            value,
            DimensionResult::Mismatch | DimensionResult::Regression
        )
    }) {
        return Verdict::Fail;
    }
    if !accepted_gaps.is_empty()
        || values
            .iter()
            .any(|value| *value == DimensionResult::AcceptedGap)
    {
        return Verdict::AcceptedGap;
    }

    Verdict::Pass
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn galley_commit() -> String {
    std::env::var("GALLEY_COMMIT")
        .ok()
        .or_else(|| option_env!("GALLEY_GIT_SHA").map(ToString::to_string))
        .or_else(|| option_env!("VERGEN_GIT_SHA").map(ToString::to_string))
        .unwrap_or_else(|| "unknown".to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeParityWriteSummary {
    schema_version: u32,
    report_version: u8,
    harness: &'static str,
    output: String,
    report_count: usize,
    scenarios: Vec<String>,
}

struct CommandModeRequest {
    scenario_id: String,
    managed_command: String,
    native_command: String,
    timeout_seconds: u64,
    workspace: Option<PathBuf>,
    keep_workspace: bool,
}

struct CommandWorkspace {
    root: PathBuf,
    cleanup_on_drop: bool,
}

impl CommandWorkspace {
    fn prepare(root: Option<PathBuf>, keep_workspace: bool) -> Result<Self, GalleyError> {
        let (root, auto_created) = match root {
            Some(root) => (root, false),
            None => (default_command_workspace_root()?, true),
        };
        fs::create_dir_all(root.join("managed")).map_err(|e| GalleyError::Internal {
            message: format!("create managed parity workspace {}: {e}", root.display()),
        })?;
        fs::create_dir_all(root.join("native")).map_err(|e| GalleyError::Internal {
            message: format!("create native parity workspace {}: {e}", root.display()),
        })?;
        Ok(Self {
            root,
            cleanup_on_drop: auto_created && !keep_workspace,
        })
    }

    fn side_dir(&self, side: &str) -> PathBuf {
        self.root.join(side)
    }
}

impl Drop for CommandWorkspace {
    fn drop(&mut self) {
        if self.cleanup_on_drop {
            let _ = fs::remove_dir_all(&self.root);
        }
    }
}

fn default_command_workspace_root() -> Result<PathBuf, GalleyError> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| GalleyError::Internal {
            message: format!("system clock before unix epoch: {e}"),
        })?
        .as_millis();
    Ok(std::env::temp_dir().join(format!(
        "galley-native-parity-{}-{millis}",
        std::process::id()
    )))
}

struct CommandRun {
    exit_code: Option<i32>,
    timed_out: bool,
    stdout_preview: String,
    stdout_truncated: bool,
    stderr_preview: String,
    stderr_truncated: bool,
    duration_ms: u64,
    workspace: String,
}

impl CommandRun {
    fn success(&self) -> bool {
        self.exit_code == Some(0) && !self.timed_out
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ParityReport {
    report_version: u8,
    generated_at: String,
    galley_commit: String,
    scenario_id: String,
    scenario_title: String,
    verdict: Verdict,
    phase_gate: String,
    harness: String,
    managed: RuntimeEvidence,
    native: RuntimeEvidence,
    comparison: Comparison,
    accepted_gaps: Vec<AcceptedGap>,
    blockers: Vec<Blocker>,
    notes: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Verdict {
    Pass,
    Fail,
    AcceptedGap,
    Blocked,
    NotRun,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeEvidence {
    runtime_kind: String,
    model: String,
    command: String,
    events: Vec<String>,
    tools: Vec<ToolEvidence>,
    final_outcome: String,
    persisted_state: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    command_status: Option<CommandStatus>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandStatus {
    exit_code: Option<i32>,
    timed_out: bool,
    stdout_preview: String,
    stdout_truncated: bool,
    stderr_preview: String,
    stderr_truncated: bool,
    duration_ms: u64,
    workspace: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolEvidence {
    name: String,
    status: String,
    approval: String,
    side_effects_performed: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Comparison {
    outcome: DimensionResult,
    tool_action: DimensionResult,
    event_rhythm: DimensionResult,
    approval: DimensionResult,
    side_effects: DimensionResult,
    memory_policy: DimensionResult,
    workspace_policy: DimensionResult,
    recovery: DimensionResult,
    persisted_state: DimensionResult,
}

impl Comparison {
    fn values(&self) -> [DimensionResult; 9] {
        [
            self.outcome,
            self.tool_action,
            self.event_rhythm,
            self.approval,
            self.side_effects,
            self.memory_policy,
            self.workspace_policy,
            self.recovery,
            self.persisted_state,
        ]
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
enum DimensionResult {
    Match,
    AcceptedGap,
    NotApplicable,
    Blocked,
    NotRun,
    Mismatch,
    Regression,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AcceptedGap {
    dimension: String,
    reason: String,
    phase_limit: String,
    follow_up: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Blocker {
    dimension: String,
    reason: String,
    next_action: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_scenarios_are_slice_9d_first_batch() {
        let ids = normalize_scenario_ids(Vec::new()).expect("scenario ids");
        assert_eq!(ids, FIRST_BATCH_IDS);
    }

    #[test]
    fn scenario_selection_normalizes_and_deduplicates() {
        let ids = normalize_scenario_ids(vec!["p04".into(), "P04".into(), " p19 ".into()])
            .expect("scenario ids");
        assert_eq!(ids, vec!["P04", "P19"]);
    }

    #[test]
    fn unknown_scenario_is_invalid_args() {
        let err = normalize_scenario_ids(vec!["P99".into()]).expect_err("invalid scenario");
        match err {
            GalleyError::InvalidArgs { message } => {
                assert!(message.contains("unknown scenario `P99`"));
                assert!(message.contains("P01"));
            }
            other => panic!("expected invalid args, got {other:?}"),
        }
    }

    #[test]
    fn verdict_derivation_prefers_blockers_then_failures_then_gaps() {
        let comparison = Comparison {
            outcome: DimensionResult::Match,
            tool_action: DimensionResult::Match,
            event_rhythm: DimensionResult::AcceptedGap,
            approval: DimensionResult::NotApplicable,
            side_effects: DimensionResult::Match,
            memory_policy: DimensionResult::Match,
            workspace_policy: DimensionResult::Match,
            recovery: DimensionResult::NotApplicable,
            persisted_state: DimensionResult::Match,
        };
        assert_eq!(derive_verdict(&comparison, &[], &[]), Verdict::AcceptedGap);

        let blocker = blocker(
            "browserControl",
            "missing browser",
            "open a safe fixture page",
        );
        assert_eq!(
            derive_verdict(&comparison, &[], &[blocker]),
            Verdict::Blocked
        );

        let mut failing = comparison.clone();
        failing.side_effects = DimensionResult::Regression;
        assert_eq!(derive_verdict(&failing, &[], &[]), Verdict::Fail);

        let mut blocked = comparison;
        blocked.outcome = DimensionResult::Blocked;
        assert_eq!(derive_verdict(&blocked, &[], &[]), Verdict::Blocked);
    }

    #[test]
    fn fixture_reports_emit_required_contract_fields() {
        let report = fixture_report("P04", "2026-06-17T00:00:00Z", "abc").expect("report");
        let json = serde_json::to_value(report).expect("json");
        assert_eq!(json["reportVersion"], 1);
        assert_eq!(json["generatedAt"], "2026-06-17T00:00:00Z");
        assert_eq!(json["galleyCommit"], "abc");
        assert_eq!(json["scenarioId"], "P04");
        assert_eq!(json["verdict"], "accepted_gap");
        assert_eq!(json["managed"]["runtimeKind"], "managed");
        assert_eq!(json["native"]["runtimeKind"], "galley_native");
        assert!(json["managed"]["events"].as_array().expect("events").len() >= 3);
        assert!(json["native"]["events"].as_array().expect("events").len() >= 3);
        assert_eq!(json["comparison"]["toolAction"], "match");
        assert!(!json["acceptedGaps"]
            .as_array()
            .expect("accepted gaps")
            .is_empty());
        assert!(json["blockers"].as_array().expect("blockers").is_empty());
    }

    #[test]
    fn all_first_batch_fixture_reports_construct() {
        let reports = FIRST_BATCH_IDS
            .iter()
            .map(|id| fixture_report(id, "2026-06-17T00:00:00Z", "abc").expect("report"))
            .collect::<Vec<_>>();

        assert_eq!(reports.len(), 7);
        assert_eq!(reports[3].scenario_id, "P08");
        assert_eq!(reports[3].verdict, Verdict::Blocked);
        assert_eq!(reports[4].scenario_id, "P14");
        assert_eq!(reports[4].verdict, Verdict::Pass);
    }
}
