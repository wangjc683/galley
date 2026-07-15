@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo  GenericAgent Desktop - Uninstall
echo ============================================================
echo.
echo This will completely remove GenericAgent from this computer:
echo   - stop its background services (ports 14168 / 8900)
echo   - delete the desktop shortcut
echo   - delete settings (%%USERPROFILE%%\.ga_desktop_settings.json)
echo   - delete THIS folder and everything in it:
echo       "%~dp0"
echo.
echo This cannot be undone.
echo.
set /p CONFIRM="Type Y to uninstall, anything else to cancel: "
if /i not "%CONFIRM%"=="Y" (
  echo.
  echo Cancelled. Nothing was changed.
  pause
  exit /b 0
)

echo.
rem %~dp0 ends with a backslash; passing "...\dir\" makes the trailing \" escape the closing
rem quote, so PowerShell receives a path with a literal quote ("Illegal characters in path").
rem Strip the trailing backslash before passing the bundle dir.
set "BUNDLE=%~dp0"
if "%BUNDLE:~-1%"=="\" set "BUNDLE=%BUNDLE:~0,-1%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0runtime\uninstall_windows.ps1" -BundleDir "%BUNDLE%"

echo.
echo You can close this window now.
timeout /t 3 >nul
exit /b 0
