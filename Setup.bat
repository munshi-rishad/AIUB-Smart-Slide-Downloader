@echo off
setlocal
title AIUB Smart Slide Downloader - Setup
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy RemoteSigned -Command "Get-ChildItem helper,extension -Recurse -File | Unblock-File; & .\helper\install.ps1 -Source '%~dp0'"
if errorlevel 1 goto failed
echo.
echo   Press any key to close this window.
pause >nul
exit /b 0
:failed
echo.
echo   Setup could not finish. Please take a screenshot of this window and send it.
pause >nul
exit /b 1
