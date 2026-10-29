@echo off
setlocal
title AIUB Smart Slide Downloader - Setup / Update
cd /d "%~dp0"
echo.
echo  AIUB Smart Slide Downloader - setup / update
echo  ---------------------------------------------
echo  Run this again after every change: it replaces the installed
echo  copy, so there is always exactly one version.
powershell -NoProfile -ExecutionPolicy RemoteSigned -Command "Get-ChildItem helper,extension -Recurse -File | Unblock-File; & .\helper\install.ps1 -Source '%~dp0'"
set "RC=%errorlevel%"
if "%RC%"=="0" goto done
echo.
echo  Setup failed. Please send a screenshot of this window.
pause
exit /b 1
:done
echo.
pause
