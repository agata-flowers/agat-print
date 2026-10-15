@echo off
setlocal
cd /d "%~dp0\..\.."
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-AGAT-Functional-Web.ps1"
if errorlevel 1 (
  echo.
  echo AGAT PRINT could not start. See the message above.
  pause
  exit /b 1
)
endlocal
