use std::process::Command;

fn git_text(args: &[&str]) -> Option<String> {
    Command::new("git")
        .args(args)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|value| !value.is_empty())
}

fn main() {
    // Build identity used to decide whether a bridge already holding :14168 belongs to THIS
    // build. commit hash + build timestamp → distinct on every build, even when the human
    // version in tauri.conf.json is unchanged (so same-version re-publishes still take over
    // a stale bridge). The bridge reports this back via GET /services/identity.
    let source_revision = git_text(&["rev-parse", "HEAD"]).unwrap_or_else(|| "nogit".to_string());
    let short_revision: String = source_revision.chars().take(12).collect();
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    println!("cargo:rustc-env=GA_BUILD_ID={}-{}", short_revision, stamp);
    println!("cargo:rustc-env=GA_SOURCE_REVISION={source_revision}");
    // Watch both HEAD and its resolved branch ref. This works in ordinary
    // checkouts, detached CI checkouts, and linked worktrees; watching only
    // `<root>/.git/HEAD` misses branch advances and is invalid in a worktree.
    if let Some(head_path) = git_text(&["rev-parse", "--git-path", "HEAD"]) {
        println!("cargo:rerun-if-changed={head_path}");
    }
    if let Some(head_ref) = git_text(&["symbolic-ref", "-q", "HEAD"]) {
        if let Some(ref_path) = git_text(&["rev-parse", "--git-path", &head_ref]) {
            println!("cargo:rerun-if-changed={ref_path}");
        }
    }

    tauri_build::build()
}
