# Registers the AIUB helper with Chrome (current user only, no admin rights needed).
# What it does, nothing else:
#   1. creates the folder Desktop\AIUB
#   2. writes com.aiub.downloader.json (points Chrome to helper\host.bat)
#   3. adds ONE registry value under HKCU\Software\Google\Chrome\NativeMessagingHosts\com.aiub.downloader
#   4. starts the helper once to check that it can run
$ErrorActionPreference = 'Stop'
$dir  = $PSScriptRoot
$id   = 'nilibfinpegehgnhbnikacfijddjjbmc'   # fixed extension ID (set by the "key" in extension/manifest.json)
$desk = [Environment]::GetFolderPath('Desktop')
[void][IO.Directory]::CreateDirectory((Join-Path $desk 'AIUB'))
$man = @{
  name            = 'com.aiub.downloader'
  description     = 'AIUB Smart Slide Downloader helper'
  path            = (Join-Path $dir 'host.bat')
  type            = 'stdio'
  allowed_origins = @("chrome-extension://$id/")
}
$file = Join-Path $dir 'com.aiub.downloader.json'
[IO.File]::WriteAllText($file, (ConvertTo-Json -InputObject $man), (New-Object Text.UTF8Encoding $false))
[void](New-Item -Path 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.aiub.downloader' -Value $file -Force)
Write-Host ''
Write-Host ('  Helper installed. Your folder: ' + (Join-Path $desk 'AIUB')) -ForegroundColor Green

# Self-test: start the helper with empty input; it must exit cleanly (code 0).
try {
  $bat = Join-Path $dir 'host.bat'
  $e = [IO.Path]::GetTempFileName(); $o = [IO.Path]::GetTempFileName(); $er = [IO.Path]::GetTempFileName()
  $p = Start-Process -FilePath $bat -NoNewWindow -Wait -PassThru -RedirectStandardInput $e -RedirectStandardOutput $o -RedirectStandardError $er
  if ($p.ExitCode -ne 0) { Write-Host ('  Warning: the helper test failed (exit code ' + $p.ExitCode + '): ' + ((Get-Content -Raw $er) -join ' ')) -ForegroundColor Yellow }
  else { Write-Host '  Helper test passed.' -ForegroundColor Green }
  Remove-Item $e, $o, $er -ErrorAction SilentlyContinue
} catch { Write-Host ('  Warning: could not test the helper: ' + $_.Exception.Message) -ForegroundColor Yellow }
