#!/usr/bin/env python3
"""GenericAgent core contract probe (design 三: bundle bridge/frontend + external核).

Given a target ga_root, verify the external核 satisfies the symbol/signature contract that
the desktop bridge + conductor + cost_tracker rely on — WITHOUT instantiating GenericAgent
(that would read mykey and build LLM clients). We only:
  - import the核 modules against `ga_root` (this doubles as a dependency check: if the bundle
    python can't import the核's deps, the import fails and we report incompatible), and
  - introspect the GenericAgent class + module-level functions via `inspect`.

Note: importing agentmain/llmcore can still run module top-level create-if-missing
initializers in the target核 (for example seeding default memory/config files). The probe
does not intentionally overwrite existing files and never constructs a GenericAgent instance.

Runtime-only surface (instance attrs like llmclient.backend.history, llmclients, task_queue,
handler.working, backend.current_name) cannot be checked statically and is intentionally not
probed here; it is covered by the "核 ≈ upstream" compatibility and graceful degrade.

Usage:  python ga_contract_probe.py <ga_root>
Output: a single JSON line on stdout, e.g. {"ok": true, "missing": []}
        or {"ok": false, "missing": ["GenericAgent.put_task(source=)"], "error": "..."}
Exit code: 0 when ok, 1 otherwise (stdout JSON is authoritative either way).
"""
import sys, os, json, inspect


def _probe(ga_root: str) -> dict:
    missing = []
    ga_root = os.path.abspath(os.path.expanduser(ga_root))
    if not os.path.exists(os.path.join(ga_root, "agentmain.py")):
        return {"ok": False, "missing": [], "error": f"agentmain.py not found under {ga_root}"}

    if ga_root not in sys.path:
        sys.path.insert(0, ga_root)

    # Import the核 (also a dependency check for the running python).
    try:
        import agentmain
    except Exception as e:
        return {"ok": False, "missing": [], "error": f"import agentmain failed: {e!r}"}
    try:
        import llmcore
    except Exception as e:
        return {"ok": False, "missing": [], "error": f"import llmcore failed: {e!r}"}

    GA = getattr(agentmain, "GenericAgent", None)
    if GA is None:
        return {"ok": False, "missing": ["agentmain.GenericAgent"], "error": ""}

    # GenericAgent methods the bridge/conductor call.
    for m in ("run", "put_task", "next_llm", "load_llm_sessions", "get_llm_name", "abort"):
        if not callable(getattr(GA, m, None)):
            missing.append(f"GenericAgent.{m}()")

    # Signature-level checks (not just names).
    put_task = getattr(GA, "put_task", None)
    if callable(put_task):
        try:
            params = inspect.signature(put_task).parameters
            # bridge calls put_task(prompt, images=[]); conductor calls put_task(msg, source=...)
            if "source" not in params:
                missing.append("GenericAgent.put_task(source=)")
            if "images" not in params:
                missing.append("GenericAgent.put_task(images=)")
        except (ValueError, TypeError):
            pass  # builtins/opaque signatures: skip rather than false-fail

    get_llm_name = getattr(GA, "get_llm_name", None)
    if callable(get_llm_name):
        try:
            if "model" not in inspect.signature(get_llm_name).parameters:
                missing.append("GenericAgent.get_llm_name(model=)")
        except (ValueError, TypeError):
            pass

    # llmcore module-level functions the bridge + cost_tracker depend on.
    if not callable(getattr(llmcore, "reload_mykeys", None)):
        missing.append("llmcore.reload_mykeys()")
    rec = getattr(llmcore, "_record_usage", None)
    if not callable(rec):
        missing.append("llmcore._record_usage()")
    else:
        try:
            # cost_tracker wraps _record_usage(usage, api_mode)
            if len(inspect.signature(rec).parameters) < 2:
                missing.append("llmcore._record_usage(usage, api_mode)")
        except (ValueError, TypeError):
            pass

    return {"ok": not missing, "missing": missing, "error": ""}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "missing": [], "error": "usage: ga_contract_probe.py <ga_root>"}))
        sys.exit(1)
    try:
        result = _probe(sys.argv[1])
    except Exception as e:
        result = {"ok": False, "missing": [], "error": f"probe crashed: {e!r}"}
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
