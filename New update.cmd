@echo off
rem Create a folder for a new update (update.md + figures\) and open it.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools
ew-update.ps1" %*
pause
