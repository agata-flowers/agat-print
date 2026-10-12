@echo off
setlocal
cd /d "%~dp0"
echo Starting AGAT PRINT Stage 16.1 visual preview...
rem Process-scoped policy only: no Windows policy or registry setting is changed.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-AGAT-Web-Preview.ps1"
if errorlevel 1 (
  echo.
  echo The preview could not start. See README_RU.txt for help.
  pause
)
