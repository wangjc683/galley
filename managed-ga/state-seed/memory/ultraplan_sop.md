# GA UltraPlan SOP
## 1. Protocol: start and continue
### What this is
UltraPlan is Python-scripted multi-agent orchestration. The main agent designs phases, prompts, fan-out/fan-in, and stop/continue decisions; subagents do task-facing work.
### Opt-in only
Start UltraPlan only when the user explicitly says `ultraplan`, `UltraPlan`, or `ultraplan mode`. If not opted in, do not start it; at most mention it is available.
### First move
Once opted in, the next substantive action is writing and running the first script.
Before the first `plan(...)`, do not inspect source, tests, logs, imports, file listings, pages, or APIs for the task itself.
Allowed pre-launch work: record objective/constraints, confirm cwd is GA `temp/`, write the minimal script.
### File and cwd contract
Scripts are plain Python files under GA `temp/`; run them with cwd = `temp/`.
Reference repo files from `temp/`, e.g. `../assets/...`; never place UltraPlan scripts in the repo code tree.
Every script starts with the real API contract and a shared artifact directory:
```python
import os, sys
sys.path.append("..")
from assets.ga_ultraplan import plan, phase, parallel, mapchain
RUN_DIR = os.path.abspath("ultraplan_<stable_slug>")
plan(RUN_DIR)
ARTIFACT_DIR = RUN_DIR
```
`plan(...)` must be the first UltraPlan statement; defining `RUN_DIR` before it is allowed. If import/plan fails, diagnose only cwd/path/import/daemon startup, not the user task.
### Same-plan continuation
For one user objective, every later script reuses the exact same `RUN_DIR` and `plan(RUN_DIR)`.
Round 2/3/etc. are new scripts under the same plan/work directory, not new plans. Continuation changes only phases/prompts/archetype.
A finished script is not proof the task is finished: read reducer/report paths, then answer, ask, apply a completed result, or launch the next same-plan script.
### Delegation boundary
Do not solve the task outside UltraPlan. Do not perform task discovery, implementation, review, or verification in main chat.
The main agent may read outputs only to supervise and decide the next script.
Exactly one agent is the UltraPlan orchestrator for one objective. The orchestrator may read this SOP; ordinary workers must not be told to read UltraPlan SOP, start UltraPlan, design phases, or delegate.
If the orchestrator itself is a subagent, give only objective, constraints, output budget, and permission to use UltraPlan; do not paste SOP, prescribe phases, or tell it which SOP files to read. It chooses context reads.
Worker prompts are job tickets, not mini-SOPs: role, exact scope, inputs, allowed/forbidden actions, evidence, short output shape, stop condition.
Every worker prompt must include the boundary when relevant: `Do not start UltraPlan. Do not delegate. If decomposition is needed, report blocker only.`

## 2. Core mental model
### Why orchestrate
Assume a strong single executor can handle long documents, complex code, and coherent multi-file edits. Do not orchestrate merely because work looks large.
Orchestration is mainly omission control: missing items, angles, hypotheses, evidence, checks, or residual improvements. Hunt is the special hard-search case: one direct attempt may hit many dead ends before a viable proof/root cause/solution appears.
### Three decisions
1. Problem class: Explore, Sweep, Hunt, or Improve.
2. Omission risk: unknown-list discovery or known-list ownership.
3. Topology: one executor, parallel width, phase/loop depth, pipeline, barrier, reducer.
### Parallel is only for omission control
Use parallel in exactly two cases:
- Unknown-list discovery: the item list is not known; split by meaningful search lenses, paths, evidence sources, representations, failure modes, or counterexamples. Evidence sources may include local code, logs/tests, live reproduction, user artifacts, and web/Google research when external ecosystem knowledge may reveal known issues, API limits, prior incidents, or platform constraints.
- Known-list ownership: the item list is known, independent, and AI-sized; assign ownership so no item is skipped.
Do not parallelize coherent execution. If the task is clear, bounded, coherent, and in one capable agent's comfort zone, use one executor.
### Width vs depth
Parallel width: independent angles/items may surface different omissions.
Phase/loop depth: later search depends on earlier findings, reduction, verification, or dead ends. Use phases/loops for find -> dedupe/rank -> verify/refute -> search residuals until dry.
### Choose by main risk
Explore: space unknown; risk is missing angles/items.
Sweep: known independent list; risk is missing items/status.
Hunt: cause/solution/proof unknown or hard; risk is wrong path/dead ends.
Improve: existing artifact; risk is residual defects/opportunities after execution.
Design/Integrator are support moves: design contracts prevent divergent parallel output; integrators restore global coherence after parallel work.

## 3. Tool semantics and output discipline
`phase(name, desc="")` is visible structure. Name the current archetype and reducer boundary.
`parallel(tasks, max_workers=None, **data)` runs independent tasks and returns result paths in input order. Default concurrency is engine-chosen; omit `max_workers` in examples unless there is a real reason.
Task forms: tuple/list `(desc, prompt)` or dict with `desc`, `prompt`, `data`, `llm_no`, `timeout`.
Subagent calls return `.out.txt` paths. Later prompts should reference paths and tell workers to read/tail only what they need.
`mapchain(items, step1, step2, ...)` runs steps sequentially per item and items concurrently. `{item}` is original item; `{previous}` is the prior step result path.
A `parallel(...)` between stages is a barrier. Use it only when the next stage needs cross-result dedupe, ranking, shared context, or early-exit. If each item can continue independently, use `mapchain`.
Workers return plain text, not JSON by default, but it must be reducer-readable: stable IDs, evidence paths/quotes, verdict/status, risk, next action.
Brevity rule: be as short as practical. Main chat reports only status, blocker, next action. Workers/reducers/verifiers include necessary evidence but no padding.
Forbid filler: no background essay, copied prompt, SOP recap, chain-of-thought prose, unsupported impression, or vague `done`.
Reducers compare rather than concatenate: accept, reject, dedupe, rank, expose contradictions, state coverage bounds, and recommend stop/continue/next archetype.

## 4. Prompt contract
A worker prompt must be executable without follow-up.
State: role, exact scope, input paths/items, artifact directory, allowed sources/tools, evidence standard, concise output shape, stop condition, and exclusions. If web/Google search is allowed, say so explicitly; require URLs/source names, distinguish sourced facts vs local evidence vs hypotheses, and map every external finding to a task hypothesis, discriminator, mitigation, or verification step.
Tell workers what not to do when overlap is harmful. Tell verifiers whether to confirm, refute, reproduce, compare, or inspect local formatting.
Prefer file paths over pasted long context. Give only the state needed for that worker.
If a worker creates or edits files, require saving them under `ARTIFACT_DIR` and returning paths.
If an operation is risky or irreversible, the prompt must stop before doing it unless the user already approved it.

## 5. Archetypes
### Explore
Use Explore when the space is unknown and choosing one path too early would bias the task.
Fan out by lenses, not by fake dependencies: architecture, failure modes, data/evidence sources, constraints, user intent, external web/official/forum evidence, reproduction route, counterexample route, test surface, style risk. Use web search only when outside knowledge may change the map; forbid generic background research.
Each explorer returns lens, covered area, findings/frontiers, evidence, unknowns, and dead ends.
Reducer builds the map: accepted facts, rejected claims, promising frontiers, missing lenses, contradictions, and next archetype.
Stop Explore when the reducer can name a bounded Execute, Hunt, Improve, or Sweep.
Research/report tasks often start with material collection plus Explore of different research paths; save gathered material as files, then synthesize a report and Improve it. In engineering/debugging tasks, web research is a collector lens feeding a reducer, not the final artifact unless the user asked for a research report.
### Hunt
Use Hunt for uncertain root cause, high-stakes claim validation, or hard solution/proof search.
Typical flow: collect evidence surface -> synthesize facts/timeline/contradictions -> generate diverse hypotheses/approaches -> rank by evidence/value/cost/verifiability -> verify selected candidates.
Fan out by non-overlapping blades or evidence sources: local code/static path, logs/errors/tests, reproduction behavior, recent changes, dependency edges, external web/official/forum evidence, constraints, weird angles, alternate representation, counterexamples. Use web research when known ecosystem/platform failures may be missing from local evidence; it must return cited mechanisms and discriminators, not a background essay.
Each hunter returns candidate/approach ID, evidence, confidence, why distinct, why plausible, how to verify, and dead ends.
Verification becomes Sweep only after there is a known independent hypothesis list.
If all attempts fail, record rejected paths, exclude repeats, change blades/representation, and Hunt again. Dead ends are progress.
### Improve
Use Improve when there is an existing artifact to fix, simplify, optimize, rewrite, polish, or decide among alternatives.
Improve is an outer loop, not one edit: find opportunities/residual risks -> reduce/prioritize -> execute selected change -> verify/test -> search residuals -> repeat.
Do not start Improve with mechanical fixed lenses. Ask what omissions matter for this artifact, then choose search lenses only when each lens can uniquely find something.
Default execution is one AI executor for small/coupled/coherent work. Sweep only when there is a known independent item list; Hunt if cause/option is unknown.
Example: for a single-file/coherent rewrite, use one executor, then run real tests (see Verification shapes: discover existing tests/demos/CLI usage or build minimal real ones, not import-only smoke), then optionally use unknown-list discovery to find remaining regressions, style issues, or missed simplifications.
After execution, verify. If coverage is uncertain, use phase/loop depth: find plausible untested failures -> dedupe/rank -> verify/refute -> search residuals until dry. Use parallel width only for distinct discovery lenses.
For important changes, use adversarial verify: ask workers to refute the result, not merely agree.
Stop only when no material improvement remains or remaining items are tiny/unsafe.
### Sweep
Use Sweep when the item list is known, items are truly independent, and coverage/status matters.
Classic case: download games A/B/C/D. Each item has its own search/download/verify route; parallel ownership prevents forgetting D and isolates blockers.
Use `mapchain` for per-item inspect -> act -> verify when each item can progress without global waiting.
Each item report includes item ID, action/result, evidence, status, unresolved risk, skipped condition, and blocker.
Reducer reports total, covered, omitted, failed, accepted findings, rejected findings, and coverage bounds.
Do not call every large dataset a Sweep. 12,000 correlated rows for analysis usually need one data-analysis executor/script, not 12,000 AI workers. Sweep is for AI-sized independent items, often few-to-dozens; for huge independent batches, sample/pilot then script/shard with explicit bounds.
If several items fail similarly, reduce failures and switch to Hunt for common cause; if one item is hard, make that item a Hunt.

## 6. Composition rules and edge cases
### Design before parallel construction
If independent artifacts require shared style/terminology/format, first Explore/Design a compact contract, then Sweep construction, then one integrator pass.
Example: add Troubleshooting sections to 12 independent docs pages. Contract first; page workers then write under contract; integrator unifies style and catches hallucinations.
But high-coherence artifacts with small per-unit edits usually stay single-executor. Example: add one conclusion sentence to each non-title slide in a 40-slide PPT; narrative continuity is global, so one executor writes. Sweep is suitable only for local checks such as missing sentence, overflow, or layout errors.
### Verification shapes
Verify is not always Sweep. For single coherent artifacts, verification often uses unknown-list discovery: find possible problems, reduce them, verify/refute, then search residuals until no material issue remains.
Use parallel verification only when distinct lenses can find different omissions. Otherwise use one verifier plus real tests.
Decouple verification lenses by evidence source, not by sub-checklists of one method. Splitting one static read into "check API", "check parity", "check side effects" is fake parallelism: same method, same files, overlapping output. Real independent sources are usually: static analysis (read code, no run), real execution (run actual tests), and quality-vs-intent (does it meet the task's goal, e.g. simpler/cleaner). Open a parallel lens only when its evidence source is genuinely different.
Real execution must be genuine, not import-only smoke. Optimize for finding real breakage, not for finishing cheap. The runner first discovers existing entry points (test suites, example/demo scripts, README/CLI usage, callable public APIs) and runs the relevant ones; if none cover the change, it builds minimal but real tests that exercise the changed behavior. Record exact commands and stdout/stderr/stack. Never report pass for behavior that was not actually run; mark it blocked with the concrete reason (e.g. needs live window/GPU/network) and what would unblock it.
Sweep verification fits known local independent checks: each file has required logging format, each slide has no overflow, each downloaded game opens.
High-stakes claims use Hunt-style validation: collect evidence, generate alternatives, verify/refute, and block confident answers if coverage is weak.
### Research/report shape
Research is usually not a primitive archetype. Use collection/exploration to gather materials, parallel paths for distinct search strategies, a reducer/synthesizer for the report, then Improve to remove synthesis scars, gaps, weak evidence, and style problems.
Final chat should summarize what was produced and where files/materials are, not paste huge gathered content.
### Multi-round continuation
Do not write one giant script when the next phase depends on reduced results.
After each script, read only reducer/report outputs needed to decide: answer, ask, apply completed result, or launch the next same-plan script.
The next script's archetype comes from the reducer: Explore if the map is still unknown, Hunt for candidates, Improve for chosen artifact, Sweep for known items, Verify for high-stakes claims.
Never restart outside UltraPlan or rename the plan because the first script finished; rename only for a different user objective.

## 7. Scale, failure, and bounds
Scale to the request. Quick check uses small fan-out; comprehensive audit uses broader blades, stronger verification, and explicit coverage bounds.
Prefer engine-chosen concurrency. More agents are worse when prompts overlap; improve decomposition before tuning execution knobs.
Use `timeout` for risky or slow probes and require workers to report partial progress.
If you sample, top-N, time-box, skip retries, exclude a subsystem, or hit a tool failure, make the bound visible in reducer output and final answer.
If a worker fails, inspect its `.out.txt` or error path, then retry with narrower scope, longer timeout, different tool, or different archetype. Do not repeat a failed prompt unchanged.
If reducers expose contradictions, launch targeted verification to resolve conflicts with evidence.
If coverage is too weak, do not answer confidently; run another same-plan script or ask the user to choose cost/coverage.

## 8. Classic patterns
Use these as recognition anchors, not rigid templates:
1. Improve existing artifact/code: Improve loop. If execution is coherent, one executor changes it; real tests follow (discover existing tests/demos/CLI usage or build minimal real ones, not import-only smoke); use unknown-list discovery only to find residual regressions, missed simplifications, style issues, or weak tests; repeat until dry.
2. Root cause / unsafe conclusion: Hunt. Collect evidence first (single collector if narrow; parallel collectors only for distinct evidence sources) -> synthesize -> find hypotheses/counterexamples -> verify/refute -> record dead ends and continue if unresolved.
3. Many known independent deliverables: Sweep. Example: download A/B/C/D games. Each item gets ownership because sequential work often forgets items; methods may differ per item. Reducer tracks status/blockers.
4. Large correlated data: not Sweep per row. 12000 rows needing analysis is one coherent data-analysis execution; Sweep only independent AI-sized subsets or residual problem cases.
5. Research/report: parallel only for distinct search paths/sources because materials may be missed; synthesize with one writer/integrator; Improve then searches evidence gaps, synthesis scars, style problems, and missing perspectives.
6. Simple coherent code change across modest files: one executor may do it; add Sweep only for known local checks such as per-file log format, then optional residual discovery for style/tests.
7. Single file or high-coherence artifact verification: not Sweep. Use tests and unknown-list problem discovery; use parallel only if distinct lenses can find different omissions.
8. Design-then-Sweep construction: when items are independent but style must match, first Explore/Design a contract, then Sweep item work, then one integrator pass.
9. PPT/narrative conclusion edits: usually one executor for coherence; Sweep may check local layout/format only, not write each page when cross-page flow matters.

## 9. Minimal shapes
```python
BOUNDARY = "Do not start UltraPlan. Do not delegate. If decomposition is needed, report blocker only."
ART = f"Save any artifacts under {ARTIFACT_DIR}; return paths."

with phase("Improve coherent artifact", "single executor -> real tests -> residual search"):
    result = parallel([("Executor", f"Apply the focused change. Keep coherence. Run real tests: find existing tests/demos/CLI usage and run them, or build minimal real ones; record commands and output; do not claim pass for unrun behavior. {ART} Return evidence/blockers. Be concise. {BOUNDARY}")])[0]

with phase("Find residuals", "only if coverage is uncertain"):
    # Fill only meaningful lenses; leave empty for one verifier.
    residual_lenses = []
    residuals = parallel(residual_lenses) if residual_lenses else parallel([
        ("Verifier", f"Inspect {result}. Find blockers/residuals only. {ART} Return evidence and stop/continue. Be concise. {BOUNDARY}")])

with phase("Reduce/decide", "dedupe, verify/refute, continue/stop"):
    next_move = parallel([("Reducer", f"Use {result} and {residuals}. Return accepted/rejected, artifact paths, evidence, next action. Be concise. {BOUNDARY}")])[0]

with phase("Hunt", "evidence -> hypotheses -> verification plan"):
    evidence = parallel(evidence_collectors)  # each collector prompt includes ART and BOUNDARY
    hypotheses = parallel(hypothesis_blades) # each hunter prompt includes ART and BOUNDARY
    ranked = parallel([("Reducer", f"Use {evidence} and {hypotheses}. Rank candidates and verification steps. Return artifact paths. Be concise. {BOUNDARY}")])[0]

with phase("Sweep known independent items", "per-item ownership and status"):
    reports = mapchain(items,
        ("Inspect {item}", "Inspect only {item}. Save artifacts under {artifact_dir}; return paths, ID, evidence, action, risk. Be concise. " + BOUNDARY),
        ("Act/verify {previous}", "Use {previous}. Save artifacts under {artifact_dir}; return paths, ID, status, evidence, blocker. Be concise. " + BOUNDARY),
        artifact_dir=ARTIFACT_DIR)
```
