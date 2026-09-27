@echo off
rem Preview the website on this PC and your phone. Close this window (or press Ctrl+C) to stop.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\preview.ps1" %*
pause
