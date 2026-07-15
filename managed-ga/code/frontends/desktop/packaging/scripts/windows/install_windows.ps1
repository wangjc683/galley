<#
GenericAgent Desktop Windows setup script

Usage examples:
  powershell -ExecutionPolicy Bypass -File .\install_windows.ps1
  powershell -ExecutionPolicy Bypass -File .\install_windows.ps1 -ProjectDir D:\GenericAgent_Desktop -Mode PrepareOnly
  powershell -ExecutionPolicy Bypass -File .\install_windows.ps1 -Mode BridgeOnly
  powershell -ExecutionPolicy Bypass -File .\install_windows.ps1 -Mode NpmInstallOnly
  powershell -ExecutionPolicy Bypass -File .\install_windows.ps1 -Mode DesktopBuildOnly
  powershell -ExecutionPolicy Bypass -File .\install_windows.ps1 -Mode DesktopDevOnly

Mirror examples (default to China mirrors for faster downloads):
  # use the built-in defaults (Tsinghua PyPI + npmmirror)
  powershell -ExecutionPolicy Bypass -File .\install_windows.ps1
  # use a different pip mirror
  powershell -ExecutionPolicy Bypass -File .\install_windows.ps1 -PipIndexUrl https://mirrors.aliyun.com/pypi/simple/
  # disable mirrors, fall back to official PyPI / npm registry
  powershell -ExecutionPolicy Bypass -File .\install_windows.ps1 -PipIndexUrl "" -NpmRegistry ""

What this script does:
  1. Locate GenericAgent project dir, which must contain agentmain.py.
  2. Locate a supported Python, or create/use .venv.
  3. Install minimal Python dependencies for desktop bridge.
  4. Copy mykey_template.py to mykey.py if mykey.py is missing.
  5. Write %USERPROFILE%\.ga_desktop_settings.json for the Tauri shell.
  6. Optionally install npm/Tauri dependencies, build debug desktop exe, or start bridge/exe.

Important:
  - This script lives under test_workspace and is still a draft, but these modes have been smoke-tested here:
    PrepareOnly, BridgeOnly/manual bridge smoke, NpmInstallOnly, DesktopBuildOnly, and debug exe GUI autostart.
  - Development install and packaged-user install are not exactly the same.
    Shared part: Python/env/deps/config preparation.
    Different part: where files live, whether exe exists, whether Python is bundled.
#>

param(
    [string]$ProjectDir = "",
    [string]$PythonPath = "",
    [ValidateSet("Auto", "PrepareOnly", "BridgeOnly", "ExeOnly", "NpmInstallOnly", "DesktopDevOnly", "DesktopBuildOnly")]
    [string]$Mode = "Auto",
    [switch]$NoVenv,
    [switch]$SkipPipInstall,
    [switch]$SkipNpmInstall,
    [switch]$SkipWebView2Check,
    # Package mirrors. Default to China mirrors for speed; pass "" to use the official source.
    [string]$PipIndexUrl = "https://pypi.tuna.tsinghua.edu.cn/simple",
    [string]$NpmRegistry = "https://registry.npmmirror.com",
    # Offline install: when set, pip installs from local wheels only (no network). Used by the portable bundle.
    [string]$WheelDir = "",
    # Extra packages to install beyond the core deps (e.g. "fastapi uvicorn websockets" for the conductor service).
    [string]$ExtraPipPackages = ""
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg) { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Warn([string]$msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Fail([string]$msg) { throw "[ERROR] $msg" }

function Resolve-ScriptRoot {
    if ($PSScriptRoot) { return (Resolve-Path $PSScriptRoot).Path }
    return (Get-Location).Path
}

function Find-ProjectRoot([string]$startDir) {
    if ($ProjectDir) {
        $p = Resolve-Path $ProjectDir -ErrorAction Stop
        if (Test-Path (Join-Path $p "agentmain.py")) { return $p.Path }
        Fail "ProjectDir does not contain agentmain.py: $ProjectDir"
    }

    $candidates = @(
        (Get-Location).Path,
        $startDir,
        (Join-Path $startDir ".."),
        (Join-Path $startDir "..\.."),
        (Join-Path $startDir "..\..\.."),
        "D:\GenericAgent_Desktop"
    )

    foreach ($c in $candidates) {
        try { $rp = Resolve-Path $c -ErrorAction Stop } catch { continue }
        if (Test-Path (Join-Path $rp.Path "agentmain.py")) { return $rp.Path }
    }
    Fail "Cannot locate GenericAgent project root. Pass -ProjectDir <path>."
}

function Get-PythonVersionObject([string]$py) {
    try {
        $out = & $py -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')" 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $out) { return $null }
        return [version]($out.Trim())
    } catch { return $null }
}

function Test-SupportedPython([string]$py) {
    $v = Get-PythonVersionObject $py
    if (-not $v) { return $false }
    return ($v.Major -eq 3 -and $v.Minor -ge 10 -and $v.Minor -lt 14)
}

function Find-Python([string]$root) {
    if ($PythonPath) {
        if (Test-SupportedPython $PythonPath) { return (Resolve-Path $PythonPath).Path }
        Fail "Specified Python is not supported. Need Python >=3.10,<3.14: $PythonPath"
    }

    $portableCandidates = @(
        (Join-Path $root ".portable\uv-python\python.exe"),
        (Join-Path $root ".portable\python\python.exe"),
        (Join-Path $root "python\python.exe")
    )
    foreach ($p in $portableCandidates) {
        if ((Test-Path $p) -and (Test-SupportedPython $p)) { return (Resolve-Path $p).Path }
    }

    $cmds = @("python", "py")
    foreach ($cmd in $cmds) {
        try {
            if ($cmd -eq "py") {
                $probe = & py -3.12 -c "import sys; print(sys.executable)" 2>$null
                if ($LASTEXITCODE -eq 0 -and $probe -and (Test-SupportedPython $probe.Trim())) { return $probe.Trim() }
                $probe = & py -3.11 -c "import sys; print(sys.executable)" 2>$null
                if ($LASTEXITCODE -eq 0 -and $probe -and (Test-SupportedPython $probe.Trim())) { return $probe.Trim() }
                $probe = & py -3.10 -c "import sys; print(sys.executable)" 2>$null
                if ($LASTEXITCODE -eq 0 -and $probe -and (Test-SupportedPython $probe.Trim())) { return $probe.Trim() }
            } else {
                $probe = & python -c "import sys; print(sys.executable)" 2>$null
                if ($LASTEXITCODE -eq 0 -and $probe -and (Test-SupportedPython $probe.Trim())) { return $probe.Trim() }
            }
        } catch { }
    }

    Fail "No supported Python found. Install Python 3.10-3.13, or pass -PythonPath."
}

function Ensure-Venv([string]$root, [string]$basePython) {
    if ($NoVenv) { return $basePython }
    $venvDir = Join-Path $root ".venv"
    $venvPy = Join-Path $venvDir "Scripts\python.exe"
    if (-not (Test-Path $venvPy)) {
        Write-Host "GAPROGRESS|venv"
        Write-Step "Create virtual environment: $venvDir"
        & $basePython -m venv $venvDir
        if ($LASTEXITCODE -ne 0) { Fail "Failed to create venv." }
    }
    if (-not (Test-SupportedPython $venvPy)) { Fail "Venv Python is invalid: $venvPy" }
    return (Resolve-Path $venvPy).Path
}

function Install-Dependencies([string]$root, [string]$py) {
    if ($SkipPipInstall) { Write-Warn "SkipPipInstall is set; dependencies are not installed."; return }

    # Extra packages (e.g. conductor service deps) appended to the core install.
    $extra = @()
    if ($ExtraPipPackages) { $extra = $ExtraPipPackages.Split(" ", [StringSplitOptions]::RemoveEmptyEntries) }

    # Offline mode (portable bundle): install from local wheels only, no network, no pip self-upgrade.
    if ($WheelDir) {
        $wd = (Resolve-Path $WheelDir -ErrorAction Stop).Path
        Write-Ok "offline wheels: $wd"
        if ($extra.Count) { Write-Ok "extra packages: $($extra -join ', ')" }
        Write-Host "GAPROGRESS|deps"
        Write-Step "Install GenericAgent dependencies and desktop bridge extras (offline)"
        # Install deps directly (NOT an editable -e of the source): an editable install bakes the
        # project's absolute path into a .pth. With -NoVenv (deps go into the relocatable embedded
        # python) this keeps the portable bundle movable. The bridge adds the source to sys.path
        # itself (ensure_ga_import_path), so the project itself need not be installed.
        & $py -m pip install --no-index --find-links $wd "requests>=2.28" "beautifulsoup4>=4.12" "bottle>=0.12" "simple-websocket-server>=0.4" "aiohttp>=3.9" psutil @extra
        if ($LASTEXITCODE -ne 0) { Fail "offline pip install failed (check wheels dir)." }
        Write-Host "GAPROGRESS|done"
        return
    }

    # Online mode: use a pip index mirror when -PipIndexUrl is set (default: Tsinghua). Pass -PipIndexUrl "" for official PyPI.
    $pipIndexArgs = @()
    if ($PipIndexUrl) {
        $pipIndexArgs = @("-i", $PipIndexUrl)
        Write-Ok "pip index mirror: $PipIndexUrl"
    } else {
        Write-Warn "No pip mirror set; using official PyPI."
    }
    Write-Step "Upgrade pip"
    & $py -m pip install @pipIndexArgs --upgrade pip
    if ($LASTEXITCODE -ne 0) { Fail "pip upgrade failed." }

    Write-Step "Install GenericAgent minimal package and desktop bridge extras"
    # pyproject.toml already includes: requests, beautifulsoup4, bottle, simple-websocket-server, aiohttp.
    # desktop_bridge.py additionally imports psutil.
    & $py -m pip install @pipIndexArgs -e $root psutil @extra
    if ($LASTEXITCODE -ne 0) { Fail "pip install failed." }
}

function Ensure-MyKey([string]$root) {
    $mykey = Join-Path $root "mykey.py"
    $tpl = Join-Path $root "mykey_template.py"
    if (Test-Path $mykey) {
        Write-Ok "mykey.py exists"
        return
    }
    if (Test-Path $tpl) {
        Copy-Item $tpl $mykey
        Write-Warn "Created mykey.py from mykey_template.py. User still needs to fill API keys."
    } else {
        Write-Warn "mykey.py and mykey_template.py are missing. Model config may not work."
    }
}

function Write-DesktopSettings([string]$root, [string]$py) {
    $settingsPath = Join-Path $env:USERPROFILE ".ga_desktop_settings.json"
    $obj = [ordered]@{
        python_path = $py
        project_dir = $root
        bridge_script = (Join-Path $root "frontends\desktop_bridge.py")
    }
    $json = $obj | ConvertTo-Json -Depth 5
    # PowerShell 5.1 `Set-Content -Encoding UTF8` writes a UTF-8 BOM.
    # Rust serde_json does not accept BOM at the beginning, causing the Tauri shell
    # to ignore this settings file and auto-discover the wrong project directory.
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($settingsPath, $json, $utf8NoBom)
    Write-Ok "Wrote desktop settings: $settingsPath"
}

function Test-WebView2Installed {
    if ($SkipWebView2Check) { return }
    Write-Step "Check Microsoft Edge WebView2 Runtime"
    $keys = @(
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
    )
    foreach ($k in $keys) {
        if (Test-Path $k) { Write-Ok "WebView2 Runtime detected"; return }
    }
    Write-Warn "WebView2 Runtime not detected. Tauri desktop window may fail on clean Windows."
    Write-Warn "Download: https://developer.microsoft.com/microsoft-edge/webview2/"
}

function Find-DesktopDir([string]$root) {
    $desktop = Join-Path $root "frontends\desktop"
    if (-not (Test-Path (Join-Path $desktop "src-tauri\tauri.conf.json"))) {
        Fail "Tauri desktop dir not found: $desktop"
    }
    return (Resolve-Path $desktop).Path
}

function Ensure-NodeAndNpm {
    $node = Get-Command node -ErrorAction SilentlyContinue
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $node) { Fail "node is not available in PATH. Install Node.js 20+ for desktop dev/build." }
    if (-not $npm) { Fail "npm is not available in PATH. Install Node.js/npm for desktop dev/build." }
    $nodeVer = & node --version
    $npmVer = & cmd /c npm --version
    Write-Ok "Node: $nodeVer; npm: $npmVer"
}

function Install-DesktopNpm([string]$root) {
    if ($SkipNpmInstall) { Write-Warn "SkipNpmInstall is set; desktop npm dependencies are not installed."; return }
    $desktop = Find-DesktopDir $root
    Ensure-NodeAndNpm
    # Use an npm registry mirror when -NpmRegistry is set (default: npmmirror). Pass -NpmRegistry "" for official registry.
    $npmRegArgs = @()
    if ($NpmRegistry) {
        $npmRegArgs = @("--registry", $NpmRegistry)
        Write-Ok "npm registry mirror: $NpmRegistry"
    }
    Write-Step "Install Tauri desktop npm dependencies: $desktop"
    Push-Location $desktop
    try {
        & cmd /c npm install @npmRegArgs
        if ($LASTEXITCODE -ne 0) { Fail "npm install failed in $desktop" }
        & cmd /c npx tauri --version
        if ($LASTEXITCODE -ne 0) { Fail "npx tauri --version failed after npm install" }
    } finally {
        Pop-Location
    }
}

function Build-DesktopDebug([string]$root) {
    $desktop = Find-DesktopDir $root
    Install-DesktopNpm $root
    Write-Step "Build Tauri debug desktop exe"
    Push-Location $desktop
    try {
        & cmd /c npx tauri build --debug
        if ($LASTEXITCODE -ne 0) { Fail "Tauri debug build failed." }
    } finally {
        Pop-Location
    }
    $debugExe = Join-Path $desktop "src-tauri\target\debug\ga-desktop.exe"
    if (Test-Path $debugExe) { Write-Ok "Debug exe: $debugExe" } else { Write-Warn "Debug exe not found at expected path: $debugExe" }
}

function Start-DesktopDev([string]$root) {
    $desktop = Find-DesktopDir $root
    Install-DesktopNpm $root
    Write-Step "Start Tauri desktop dev shell"
    Write-Warn "This keeps running in current console. If status checks fail, bypass proxy for http://127.0.0.1:14168/status."
    Push-Location $desktop
    try {
        & cmd /c npx tauri dev -- --dev
    } finally {
        Pop-Location
    }
}

function Find-PackagedExe([string]$root) {
    $candidates = @(
        (Join-Path $root "frontends\GenericAgent.exe"),
        (Join-Path $root "frontends\desktop\src-tauri\target\release\GenericAgent.exe"),
        (Join-Path $root "frontends\desktop\src-tauri\target\release\ga-desktop.exe"),
        (Join-Path $root "frontends\desktop\src-tauri\target\debug\ga-desktop.exe")
    )
    foreach ($p in $candidates) { if (Test-Path $p) { return (Resolve-Path $p).Path } }
    return ""
}

function Start-Bridge([string]$root, [string]$py) {
    $bridge = Join-Path $root "frontends\desktop_bridge.py"
    if (-not (Test-Path $bridge)) { Fail "desktop_bridge.py not found: $bridge" }
    Write-Step "Start bridge: $bridge"
    Write-Warn "This keeps running in current console. Browse http://127.0.0.1:14168/status to check."
    $env:PYTHONPATH = "$root;$(Join-Path $root 'frontends');$env:PYTHONPATH"
    & $py $bridge
}

function Start-Exe([string]$root) {
    $exe = Find-PackagedExe $root
    if (-not $exe) { Fail "Packaged GenericAgent.exe not found. Use -Mode BridgeOnly or build Tauri first." }
    Write-Step "Start packaged desktop exe"
    Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe -Parent)
    Write-Ok "Started: $exe"
}

Write-Step "Resolve project root"
$scriptRoot = Resolve-ScriptRoot
$root = Find-ProjectRoot $scriptRoot
Write-Ok "Project root: $root"

Write-Step "Resolve Python"
$basePy = Find-Python $root
Write-Ok "Base Python: $basePy"

$py = Ensure-Venv $root $basePy
Write-Ok "Runtime Python: $py"

Install-Dependencies $root $py
Ensure-MyKey $root
Write-DesktopSettings $root $py
Test-WebView2Installed

if ($Mode -eq "PrepareOnly") {
    Write-Ok "Preparation finished. No app started because -Mode PrepareOnly was used."
    exit 0
}

if ($Mode -eq "BridgeOnly") {
    Start-Bridge $root $py
    exit 0
}

if ($Mode -eq "NpmInstallOnly") {
    Install-DesktopNpm $root
    Write-Ok "Desktop npm setup finished."
    exit 0
}

if ($Mode -eq "DesktopBuildOnly") {
    Build-DesktopDebug $root
    Write-Ok "Desktop debug build finished."
    exit 0
}

if ($Mode -eq "DesktopDevOnly") {
    Start-DesktopDev $root
    exit 0
}

if ($Mode -eq "ExeOnly") {
    Start-Exe $root
    exit 0
}

# Auto mode: prefer packaged exe if present, otherwise start bridge for source/dev tree.
$exe = Find-PackagedExe $root
if ($exe) { Start-Exe $root } else { Start-Bridge $root $py }
