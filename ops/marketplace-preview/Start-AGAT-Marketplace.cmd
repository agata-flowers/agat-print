@echo off
setlocal
title AGAT PRINT Marketplace Prototype
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-AGAT-Marketplace.ps1"
if errorlevel 1 pause
