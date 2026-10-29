@echo off
rem Chrome starts this hidden (no window appears). Nothing is shown, nothing is downloaded.
powershell -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "%~dp0host.ps1"
