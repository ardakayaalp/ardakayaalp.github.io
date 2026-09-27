@echo off
rem Check the website and publish it to ardakayaalp.com.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\publish.ps1" %*
pause
