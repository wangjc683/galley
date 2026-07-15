<#
GenericAgent Desktop — portable uninstall (Windows).

Removes everything THIS portable bundle put on the machine, then deletes the
bundle folder itself:
  1. Stop the bundle's backend processes (bridge 14168 / conductor 8900 / scheduler)
     — only processes whose executable lives inside this bundle, so other bundles
     on the same machine are left alone.
  2. Remove the desktop shortcut (GenericAgent.lnk) — only when it points into
     this bundle.
  3. Remove ~/.ga_desktop_settings.json (shared settings; other bundles rebuild it
     automatically on next launch).
  4. Schedule deletion of the bundle folder after this script exits (a folder
     cannot delete itself while code runs inside it).

Invoked by uninstall.bat (which confirms with the user first). Not meant to be
run directly without -BundleDir.
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$BundleDir
)

$ErrorActionPreference = "SilentlyContinue"

function Write-Step([string]$m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Ok([string]$m)   { Write-Host "[OK] $m" -ForegroundColor Green }
function Write-Info([string]$m) { Write-Host "     $m" -ForegroundColor Gray }

# Normalize the bundle dir to an absolute path with a trailing separator for prefix checks.
# Defensive: strip stray quotes / trailing separators a caller may have leaked in (e.g. the
# classic "%~dp0" trailing-backslash-before-quote bug).
$BundleDir = $BundleDir.Trim().Trim('"').TrimEnd('\', '/')
try { $bundle = (Resolve-Path -LiteralPath $BundleDir).Path } catch { $bundle = $BundleDir }
$bundlePrefix = ($bundle.TrimEnd('\') + '\').ToLowerInvariant()

function Path-IsInsideBundle([string]$p) {
    if (-not $p) { return $false }
    try { $rp = (Resolve-Path -LiteralPath $p -ErrorAction Stop).Path } catch { $rp = $p }
    return $rp.ToLowerInvariant().StartsWith($bundlePrefix)
}

# ── 1. Graceful backend shutdown, then force-kill bundle-owned processes ──────
Write-Step "Stopping GenericAgent backend services"

# Best-effort graceful exit: tell the bridge to stop its managed extras and quit.
try {
    Invoke-WebRequest -Uri "http://127.0.0.1:14168/services/bridge/exit" -Method Post `
        -TimeoutSec 3 -UseBasicParsing | Out-Null
    Start-Sleep -Milliseconds 800
} catch { }

# Force-kill anything still listening on our ports, but ONLY if the owning process
# executable lives inside this bundle (don't disturb a second installed copy).
foreach ($port in 14168, 8900) {
    foreach ($conn in (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) {
        $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
        if ($proc -and (Path-IsInsideBundle $proc.Path)) {
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
            Write-Info "killed PID $($proc.Id) ($($proc.ProcessName)) on port $port"
        } elseif ($proc) {
            Write-Info "port $port held by a process outside this bundle (PID $($proc.Id)); left running"
        }
    }
}

# Kill ANY process whose executable image lives inside this bundle, regardless of name
# (GenericAgent.exe, python.exe, or any child tool it spawned). Limiting to the bundle path
# means we never touch a second installed copy.
foreach ($p in (Get-Process -ErrorAction SilentlyContinue)) {
    if (Path-IsInsideBundle $p.Path) {
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
        Write-Info "killed PID $($p.Id) ($($p.ProcessName))"
    }
}
Write-Ok "backend stopped"

# ── 2. Desktop shortcut (only if it targets this bundle) ─────────────────────
Write-Step "Removing desktop shortcut"
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop 'GenericAgent.lnk'
if (Test-Path -LiteralPath $lnk) {
    $target = $null
    try {
        $ws = New-Object -ComObject WScript.Shell
        $target = $ws.CreateShortcut($lnk).TargetPath
    } catch { }
    if ((-not $target) -or (Path-IsInsideBundle $target)) {
        Remove-Item -LiteralPath $lnk -Force -ErrorAction SilentlyContinue
        Write-Ok "removed $lnk"
    } else {
        Write-Info "desktop shortcut points to another bundle; left in place"
    }
} else {
    Write-Info "no desktop shortcut found"
}

# ── 3. Shared settings file ──────────────────────────────────────────────────
Write-Step "Removing settings file"
$settings = Join-Path $env:USERPROFILE '.ga_desktop_settings.json'
if (Test-Path -LiteralPath $settings) {
    Remove-Item -LiteralPath $settings -Force -ErrorAction SilentlyContinue
    Write-Ok "removed $settings"
} else {
    Write-Info "no settings file found"
}

# ── 3b. WebView2 data dir (cache + localStorage) ─────────────────────────────
# Tauri creates %LOCALAPPDATA%\com.genericagent.app\ (EBWebView: HTTP cache + localStorage)
# outside the bundle, keyed by the app identifier. Only the Tauri desktop shell uses it (the
# project's other frontends — qt/tui/conductor — do not), so removing it is safe. Other
# GenericAgent bundles share the same identifier and would just rebuild it on next launch.
Write-Step "Removing WebView2 data"
$wv = Join-Path $env:LOCALAPPDATA 'com.genericagent.app'
if (Test-Path -LiteralPath $wv) {
    Remove-Item -LiteralPath $wv -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $wv) { Write-Info "WebView2 data partially locked; some files remain" }
    else { Write-Ok "removed $wv" }
} else {
    Write-Info "no WebView2 data found"
}

# ── 4. Schedule deletion of the bundle folder ────────────────────────────────
# The folder cannot remove itself while this script (and the uninstall.bat that
# launched it) run from inside it. Spawn a detached cmd that waits for our process
# tree to fully exit, then retries the delete a few times in case a handle lingers.
Write-Step "Scheduling removal of the bundle folder"
$deleter = @"
cd /d "%TEMP%"
for /l %%i in (1,1,20) do (
  rd /s /q "$bundle" 2>nul
  if not exist "$bundle" goto done
  ping 127.0.0.1 -n 2 >nul
)
:done
"@
$deleterPath = Join-Path $env:TEMP ("ga_uninstall_{0}.bat" -f ([guid]::NewGuid().ToString('N')))
Set-Content -LiteralPath $deleterPath -Value $deleter -Encoding ASCII
# Start detached so it survives this script + uninstall.bat exiting. The retry loop
# (20 tries x ~1s) covers the brief window where the parent processes release handles.
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "`"$deleterPath`"" -WindowStyle Hidden | Out-Null
Write-Ok "bundle folder will be deleted after exit: $bundle"

Write-Host ""
Write-Host "GenericAgent has been uninstalled." -ForegroundColor Green
