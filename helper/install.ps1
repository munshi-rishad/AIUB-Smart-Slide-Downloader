# AIUB Smart Slide Downloader - installer AND updater (current user only, no admin rights).
# Run it through Setup.bat: first time, and again after every change you make to the files.
# What it does, nothing else:
#   1. copies  extension\ and helper\  to  %LOCALAPPDATA%\AIUB-Smart-Slide-Downloader  (the one permanent place;
#      files that no longer exist in your source folder are removed there, so an update never leaves old files behind)
#   2. creates the folder Desktop\AIUB
#   3. writes com.aiub.downloader.json and adds ONE registry value under HKCU\Software\Google\Chrome\NativeMessagingHosts
#   4. starts the helper once to check that it can run
#   5. opens Chrome in the profile you choose with the AIUB portal and Teams (first time: also chrome://extensions).
#      It does NOT read any Chrome data (no cookies, no sign-in or profile files).
param([string]$Source = '')
$ErrorActionPreference = 'Stop'
$id = 'nilibfinpegehgnhbnikacfijddjjbmc'   # fixed extension ID (set by the "key" in extension/manifest.json)
if (-not $Source) { $Source = Split-Path $PSScriptRoot -Parent }
$Source = $Source.TrimEnd('\')
$dest = Join-Path $env:LOCALAPPDATA 'AIUB-Smart-Slide-Downloader'
$ext  = Join-Path $dest 'extension'
$hlp  = Join-Path $dest 'helper'
$desk = [Environment]::GetFolderPath('Desktop')
[void][IO.Directory]::CreateDirectory((Join-Path $desk 'AIUB'))
[void][IO.Directory]::CreateDirectory($dest)

# ---- 1. copy the newest files to the permanent place ----
if ($Source -ne $dest.TrimEnd('\')) {
  foreach ($part in 'extension', 'helper') {
    $from = Join-Path $Source $part
    if (-not (Test-Path $from)) { throw ('Folder not found: ' + $from) }
    & robocopy $from (Join-Path $dest $part) /MIR /XD .git node_modules /XF com.aiub.downloader.json *.part /NFL /NDL /NJH /NJS /NP /R:2 /W:1 | Out-Null
    if ($LASTEXITCODE -ge 8) { throw ('Copying ' + $part + ' failed (robocopy code ' + $LASTEXITCODE + ')') }
  }
  Get-ChildItem $dest -Recurse -File | Unblock-File
}
Write-Host ''
Write-Host ('  Files updated in: ' + $dest) -ForegroundColor Green

# ---- 2 + 3. helper registration ----
$man = @{
  name            = 'com.aiub.downloader'
  description     = 'AIUB Smart Slide Downloader helper'
  path            = (Join-Path $hlp 'host.bat')
  type            = 'stdio'
  allowed_origins = @("chrome-extension://$id/")
}
$file = Join-Path $hlp 'com.aiub.downloader.json'
[IO.File]::WriteAllText($file, (ConvertTo-Json -InputObject $man), (New-Object Text.UTF8Encoding $false))
[void](New-Item -Path 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.aiub.downloader' -Value $file -Force)
Write-Host ('  Helper installed. Your folder: ' + (Join-Path $desk 'AIUB')) -ForegroundColor Green

# ---- 4. self-test: start the helper with empty input; it must exit cleanly (code 0) ----
try {
  $bat = Join-Path $hlp 'host.bat'
  $e = [IO.Path]::GetTempFileName(); $o = [IO.Path]::GetTempFileName(); $er = [IO.Path]::GetTempFileName()
  $p = Start-Process -FilePath $bat -NoNewWindow -Wait -PassThru -RedirectStandardInput $e -RedirectStandardOutput $o -RedirectStandardError $er
  if ($p.ExitCode -ne 0) { Write-Host ('  Warning: the helper test failed (exit code ' + $p.ExitCode + '): ' + ((Get-Content -Raw $er) -join ' ')) -ForegroundColor Yellow }
  else { Write-Host '  Helper test passed.' -ForegroundColor Green }
  Remove-Item $e, $o, $er -ErrorAction SilentlyContinue
} catch { Write-Host ('  Warning: could not test the helper: ' + $_.Exception.Message) -ForegroundColor Yellow }

# ---- 5. open Chrome: portal + Teams (+ the extensions page the first time) ----
# This script never reads Chrome's profile, cookie or sign-in files (only the NAMES of the profile folders are listed).
function Get-Profiles {
  $list = @()
  $ud = Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'
  if (Test-Path $ud) {
    foreach ($d in @(Get-ChildItem $ud -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'Default' -or $_.Name -like 'Profile *' } | Sort-Object Name)) { $list += [pscustomobject]@{ Dir = $d.Name } }
  }
  return $list
}
function Choose-Profile($profiles) {
  if ($profiles.Count -eq 0) { return 'Default' }
  if ($profiles.Count -eq 1) { return $profiles[0].Dir }
  $memo = Join-Path $dest 'profile.txt'
  $def = ''
  if (Test-Path $memo) { $def = (Get-Content $memo -Raw).Trim() }
  if (-not ($profiles | Where-Object { $_.Dir -eq $def })) { $def = '' }
  Write-Host '  Which Chrome profile do you use for the AIUB portal AND Microsoft Teams?'
  Write-Host '  (An extension belongs to ONE profile. "Default" is your first profile, "Profile 1" the second, and so on.'
  Write-Host '   If Chrome opens the wrong one, close it and run Setup again.)'
  for ($i = 0; $i -lt $profiles.Count; $i++) {
    $p = $profiles[$i]
    Write-Host ('    ' + ($i + 1) + ')  ' + $p.Dir + $(if ($p.Dir -eq $def) { '   <- last time' } else { '' }))
  }
  $a = Read-Host '  Enter the number (just Enter = last time / first)'
  $pick = $def
  $n = 0
  if ([int]::TryParse($a, [ref]$n) -and $n -ge 1 -and $n -le $profiles.Count) { $pick = $profiles[$n - 1].Dir }
  if (-not $pick) { $pick = $profiles[0].Dir }
  try { [IO.File]::WriteAllText($memo, $pick) } catch { }
  return $pick
}
function Find-Chrome {
  foreach ($k in 'HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe') {
    try { $v = (Get-ItemProperty $k -ErrorAction Stop).'(default)'; if ($v -and (Test-Path $v)) { return $v } } catch { }
  }
  foreach ($p in ($env:ProgramFiles + '\Google\Chrome\Application\chrome.exe'), (${env:ProgramFiles(x86)} + '\Google\Chrome\Application\chrome.exe'), ($env:LOCALAPPDATA + '\Google\Chrome\Application\chrome.exe')) { if (Test-Path $p) { return $p } }
  return $null
}
function Open-Chrome([string]$dir, [bool]$withExtPage) {
  $chrome = Find-Chrome
  $urls = @('https://portal.aiub.edu/Student', 'https://teams.cloud.microsoft/')
  if ($withExtPage) { $urls = @('chrome://extensions') + $urls }
  if ($chrome) { Start-Process -FilePath $chrome -ArgumentList ('--profile-directory="' + $dir + '" ' + ($urls -join ' ')) }
  else { Write-Host '  Could not find Chrome. Open chrome://extensions, the portal and Teams yourself.' -ForegroundColor Yellow }
}

$profiles = @(Get-Profiles)
$first = -not (Test-Path (Join-Path $dest 'installed.txt'))
Write-Host ''
if ($first) {
  Write-Host '  Last step (only the first time):'
  Write-Host '    1. On the Extensions page turn ON "Developer mode" (top right).'
  Write-Host '    2. Click "Load unpacked", press Ctrl+V in the address bar and select the folder:'
  Write-Host ('         ' + $ext) -ForegroundColor Cyan
  Write-Host '       (the path is already copied for you)'
  Write-Host '    If you loaded the extension from another folder before: remove that one first, so only this copy exists.'
  Write-Host ''
  Set-Clipboard -Value $ext
} else {
  Write-Host '  The installed copy was replaced. The extension reloads itself within about a minute; then refresh the portal page (F5).'
  Write-Host ''
}
$prof = Choose-Profile $profiles
Write-Host ('  Opening Chrome (profile folder: ' + $prof + ')') -ForegroundColor Cyan
Open-Chrome $prof $first
try { [IO.File]::WriteAllText((Join-Path $dest 'installed.txt'), (Get-Date -Format s)) } catch { }
exit 0
