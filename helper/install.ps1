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

# ---- screen helpers (plain ASCII, so it looks right in every Windows console) ----
$line = '  ' + ('=' * 62)
$thin = '  ' + ('-' * 62)
function Step([int]$n, [string]$text) {
  Write-Host ('   [' + $n + '/4] ') -NoNewline -ForegroundColor Cyan
  Write-Host (($text + ' ').PadRight(46, '.')) -NoNewline
}
function Ok([string]$detail) {
  Write-Host ' OK' -ForegroundColor Green
  if ($detail) { Write-Host ('         ' + $detail) -ForegroundColor DarkGray }
}
function Warn([string]$text) {
  Write-Host ' PROBLEM' -ForegroundColor Yellow
  Write-Host ('         ' + $text) -ForegroundColor Yellow
}

$ver = ''
try { $ver = 'v' + (Get-Content (Join-Path $Source 'extension\manifest.json') -Raw | ConvertFrom-Json).version } catch { }
Clear-Host
Write-Host ''
Write-Host $line -ForegroundColor DarkCyan
Write-Host ('     AIUB SMART SLIDE DOWNLOADER' + ('Setup  ' + $ver).PadLeft(30)) -ForegroundColor White
Write-Host '     Your course slides from the AIUB portal and Teams, saved on your Desktop' -ForegroundColor DarkGray
Write-Host $line -ForegroundColor DarkCyan
Write-Host ''

# ---- 1. copy the newest files to the permanent place ----
Step 1 'Installing the files'
[void][IO.Directory]::CreateDirectory((Join-Path $desk 'AIUB'))
[void][IO.Directory]::CreateDirectory($dest)
if ($Source -ne $dest.TrimEnd('\')) {
  foreach ($part in 'extension', 'helper') {
    $from = Join-Path $Source $part
    if (-not (Test-Path $from)) { throw ('Folder not found: ' + $from) }
    & robocopy $from (Join-Path $dest $part) /MIR /XD .git node_modules /XF com.aiub.downloader.json *.part /NFL /NDL /NJH /NJS /NP /R:2 /W:1 | Out-Null
    if ($LASTEXITCODE -ge 8) { throw ('Copying ' + $part + ' failed (robocopy code ' + $LASTEXITCODE + ')') }
  }
  Get-ChildItem $dest -Recurse -File | Unblock-File
}
Ok ('Installed in: ' + $dest)

# ---- 2 + 3. helper registration ----
Step 2 'Connecting to Chrome'
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
Ok ('Your slides will be saved in: ' + (Join-Path $desk 'AIUB'))

# ---- 4. self-test: start the helper with empty input; it must exit cleanly (code 0) ----
Step 3 'Checking that everything works'
try {
  $bat = Join-Path $hlp 'host.bat'
  $e = [IO.Path]::GetTempFileName(); $o = [IO.Path]::GetTempFileName(); $er = [IO.Path]::GetTempFileName()
  $p = Start-Process -FilePath $bat -NoNewWindow -Wait -PassThru -RedirectStandardInput $e -RedirectStandardOutput $o -RedirectStandardError $er
  if ($p.ExitCode -ne 0) { Warn ('The helper did not start (code ' + $p.ExitCode + '). Run Setup again; if it repeats, send a screenshot. ' + ((Get-Content -Raw $er) -join ' ')) }
  else { Ok '' }
  Remove-Item $e, $o, $er -ErrorAction SilentlyContinue
} catch { Warn ('Could not check the helper: ' + $_.Exception.Message) }

# ---- 5. open Chrome: portal + Teams (+ the extensions page the first time) ----
# This script never reads Chrome's profile, cookie or sign-in files (only the NAMES of the profile folders are listed).
function Get-Profiles {
  $list = @()
  $ud = Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'
  if (Test-Path $ud) {
    foreach ($d in @(Get-ChildItem $ud -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'Default' -or $_.Name -like 'Profile *' } | Sort-Object { if ($_.Name -eq 'Default') { -1 } else { [int]('0' + ($_.Name -replace '\D', '')) } })) { $list += [pscustomobject]@{ Dir = $d.Name } }
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
  if (-not $def) { $def = $profiles[0].Dir }
  Write-Host ''
  Write-Host '   CHOOSE YOUR CHROME PROFILE' -ForegroundColor White
  Write-Host '   Pick the profile where you are logged in to the AIUB portal and Teams.'
  Write-Host '   ("Default" is your first Chrome profile, "Profile 1" the second, and so on.)' -ForegroundColor DarkGray
  Write-Host $thin -ForegroundColor DarkGray
  for ($i = 0; $i -lt $profiles.Count; $i++) {
    $p = $profiles[$i]
    $num = '{0,4}' -f ($i + 1)
    if ($p.Dir -eq $def) {
      Write-Host ($num + '   ' + $p.Dir.PadRight(16)) -NoNewline -ForegroundColor Cyan
      Write-Host '<- used last time' -ForegroundColor DarkCyan
    } else { Write-Host ($num + '   ' + $p.Dir) }
  }
  Write-Host $thin -ForegroundColor DarkGray
  Write-Host ('   Type a number and press Enter (just Enter = ' + $def + '): ') -NoNewline -ForegroundColor White
  $a = Read-Host
  $pick = $def
  $n = 0
  if ([int]::TryParse($a, [ref]$n) -and $n -ge 1 -and $n -le $profiles.Count) { $pick = $profiles[$n - 1].Dir }
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

$profiles = @(Get-Profiles)
$first = -not (Test-Path (Join-Path $dest 'installed.txt'))
$prof = Choose-Profile $profiles
Write-Host ''
Step 4 ('Opening Chrome (' + $prof + ')')
$chrome = Find-Chrome
$urls = @('https://portal.aiub.edu/Student', 'https://teams.cloud.microsoft/')
if ($first) { $urls = @('chrome://extensions') + $urls }
if ($chrome) { Start-Process -FilePath $chrome -ArgumentList ('--profile-directory="' + $prof + '" ' + ($urls -join ' ')); Ok '' }
else { Warn 'Chrome was not found. Please open Chrome yourself.' }
try { [IO.File]::WriteAllText((Join-Path $dest 'installed.txt'), (Get-Date -Format s)) } catch { }

Write-Host ''
Write-Host $line -ForegroundColor DarkCyan
if ($first) {
  Write-Host '   ONE LAST STEP (only this first time)' -ForegroundColor White
  Write-Host '   In the Chrome window that just opened:'
  Write-Host '     1. Turn on "Developer mode" (the switch at the top right).'
  Write-Host '     2. Click "Load unpacked".'
  Write-Host '     3. Press Ctrl+V, then Enter, then click "Select Folder".'
  Write-Host '        (The folder path is already copied for you:)' -ForegroundColor DarkGray
  Write-Host ('        ' + $ext) -ForegroundColor Cyan
  Write-Host '     4. Open your AIUB portal dashboard. Your slides start downloading.'
  Write-Host ''
  Write-Host '   Tip: if an older copy of this extension is in the list, remove it first.' -ForegroundColor DarkGray
  Set-Clipboard -Value $ext
} else {
  Write-Host '   ALL DONE!' -ForegroundColor Green
  Write-Host '   The extension updates itself in about a minute.'
  Write-Host '   Then open the AIUB portal and press F5 to refresh the page.'
}
Write-Host $line -ForegroundColor DarkCyan
exit 0
