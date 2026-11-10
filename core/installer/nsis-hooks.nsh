!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Closing running Galley processes before installing..."
  nsExec::ExecToLog `powershell -NoProfile -ExecutionPolicy Bypass -Command "$$installDir = '$INSTDIR'; if (Test-Path -LiteralPath $$installDir) { $$pythonDir = Join-Path $$installDir 'python'; Get-CimInstance Win32_Process | Where-Object { (($$_.Name -eq 'galley-core.exe' -or $$_.Name -eq 'galley.exe') -and $$_.ExecutablePath -like ($$installDir + '*')) -or ($$_.Name -eq 'python.exe' -and $$_.ExecutablePath -like ($$pythonDir + '*')) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue } }"`
  Sleep 2000
!macroend
