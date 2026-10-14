@echo off
setlocal
title AIUB Smart Slide Downloader - Setup
cd /d "%~dp0"
echo.
echo  AIUB Smart Slide Downloader - one-time setup
echo  ---------------------------------------------
pushd "%~dp0"
powershell -NoProfile -ExecutionPolicy RemoteSigned -Command "Get-ChildItem helper,extension -Recurse -File | Unblock-File; & .\helper\install.ps1"
set "RC=%errorlevel%"
popd
if not "%RC%"=="0" (
  echo.
  echo  Setup failed. Please send a screenshot of this window.
  pause
  exit /b 1
)
<nul set /p="%~dp0extension"| clip
echo.
echo  Last step (only the first time):
echo    1. Chrome is opening the Extensions page.
echo    2. Turn ON "Developer mode" (top right).
echo    3. Click "Load unpacked", press Ctrl+V in the address bar of the
echo       folder window, press Enter, then "Select Folder".
echo       (The extension folder path is already copied for you.)
echo    4. Already added before? Just click the reload icon on the extension.
echo.
start "" chrome "chrome://extensions"
pause
