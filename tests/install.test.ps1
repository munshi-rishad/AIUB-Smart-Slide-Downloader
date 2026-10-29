# Run on Windows:  powershell -NoProfile -File tests\install.test.ps1
# 1. every .ps1 file parses  2. the Chrome profile e-mails are read from "Local State" (also the file Windows PowerShell's
#    ConvertFrom-Json cannot read: keys that differ only in capital letters)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
foreach ($f in Get-ChildItem (Join-Path $repo 'helper') -Filter *.ps1) {
  $errs = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$null, [ref]$errs)
  if ($errs.Count) { throw ($f.Name + ': ' + ($errs | ForEach-Object { $_.Message }) -join '; ') }
}
Write-Host 'ok  helper scripts parse'
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $repo 'helper\install.ps1'), [ref]$null, [ref]$null)
$fn = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-ProfileInfo' }, $true) | Select-Object -First 1
Invoke-Expression $fn.Extent.Text
$tmp = Join-Path $env:TEMP ('ls-' + [guid]::NewGuid().ToString('N')); New-Item -ItemType Directory $tmp | Out-Null
Set-Content (Join-Path $tmp 'Local State') -Encoding UTF8 -Value '{"os":{"a":1},"profile":{"info_cache":{"Default":{"name":"Personal","user_name":"me@gmail.com"},"Profile 3":{"name":"AIUB","gaia_name":"Najiat","user_name":"23-1-1@student.aiub.edu"}}}}'
$m = Get-ProfileInfo $tmp
if ($m['Default'].Mail -ne 'me@gmail.com' -or $m['Profile 3'].Mail -ne '23-1-1@student.aiub.edu' -or $m['Profile 3'].Name -ne 'AIUB') { throw 'profile e-mails not read' }
Write-Host 'ok  profile names and e-mails are read'
Set-Content (Join-Path $tmp 'Local State') -Encoding UTF8 -Value '{"x":{"Key":1,"key":2},"profile":{"info_cache":{"Default":{"name":"P","user_name":"dup@gmail.com"}}}}'
$m = Get-ProfileInfo $tmp
if ($m['Default'].Mail -ne 'dup@gmail.com') { throw 'fallback reader failed' }
Write-Host 'ok  also works when ConvertFrom-Json fails (keys that differ only in capital letters)'
Remove-Item $tmp -Recurse -Force
Write-Host ''
Write-Host '3 checks passed'
