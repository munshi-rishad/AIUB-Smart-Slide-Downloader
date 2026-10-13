# Registers the AIUB helper with Chrome (current user only, no admin rights needed).
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
