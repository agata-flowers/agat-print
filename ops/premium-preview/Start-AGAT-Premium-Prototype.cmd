@echo off
setlocal
title AGAT PRINT Premium Prototype
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-AGAT-Premium-Prototype.ps1"
if errorlevel 1 pause
