$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$id  = 'nilibfinpegehgnhbnikacfijddjjbmc'
$desk = [Environment]::GetFolderPath('Desktop')
$null = New-Item -ItemType Directory -Force -Path (Join-Path $desk 'AIUB')
$man = @{ name = 'com.aiub.downloader'; description = 'AIUB Downloader helper'; path = (Join-Path $dir 'host.bat'); type = 'stdio'; allowed_origins = @("chrome-extension://$id/") }
$file = Join-Path $dir 'com.aiub.downloader.json'
[IO.File]::WriteAllText($file, (ConvertTo-Json -InputObject $man), (New-Object Text.UTF8Encoding $false))
$null = New-Item -Path 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.aiub.downloader' -Value $file -Force
Write-Host ''
Write-Host 'Done! Folder created: ' (Join-Path $desk 'AIUB') -ForegroundColor Green
Write-Host 'Now reload the extension in chrome://extensions and open your AIUB dashboard.'
