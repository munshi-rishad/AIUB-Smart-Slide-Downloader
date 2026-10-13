$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$in  = [Console]::OpenStandardInput()
$out = [Console]::OpenStandardOutput()
$root = Join-Path ([Environment]::GetFolderPath('Desktop')) 'AIUB'
$null = New-Item -ItemType Directory -Force -Path $root
$fs = $null; $tmp = $null; $final = $null

function Read-Exact([int]$n) {
  $buf = New-Object byte[] $n; $off = 0
  while ($off -lt $n) { $r = $in.Read($buf, $off, $n - $off); if ($r -le 0) { return $null }; $off += $r }
  return ,$buf
}
function Send($obj) {
  $json = ConvertTo-Json -InputObject $obj -Compress -Depth 5
  $b = [Text.Encoding]::UTF8.GetBytes($json)
  $out.Write([BitConverter]::GetBytes([int]$b.Length), 0, 4); $out.Write($b, 0, $b.Length); $out.Flush()
}
function Safe([string]$s) {
  $t = ($s -replace '[<>:"/\\|?*\x00-\x1f]', '').Trim().TrimEnd('.', ' ')
  if (-not $t) { $t = 'file' }
  return $t
}
function CloseTmp { if ($script:fs) { $script:fs.Close(); $script:fs = $null }; if ($script:tmp -and (Test-Path -LiteralPath $script:tmp)) { Remove-Item -LiteralPath $script:tmp -Force } }

while ($true) {
  $lb = Read-Exact 4; if ($null -eq $lb) { break }
  $mb = Read-Exact ([BitConverter]::ToInt32($lb, 0)); if ($null -eq $mb) { break }
  $m = [Text.Encoding]::UTF8.GetString($mb) | ConvertFrom-Json
  try {
    switch ($m.op) {
      'ping' { Send @{ id = $m.id; ok = $true; path = $root } }
      'list' {
        $d = Join-Path $root (Safe $m.folder)
        $null = New-Item -ItemType Directory -Force -Path $d
        $names = @(Get-ChildItem -LiteralPath $d -File | Where-Object { $_.Length -gt 0 -and $_.Extension -ne '.part' } | ForEach-Object { $_.Name })
        Send @{ id = $m.id; ok = $true; names = $names }
      }
      'begin' {
        CloseTmp
        $d = Join-Path $root (Safe $m.folder)
        $null = New-Item -ItemType Directory -Force -Path $d
        $final = Join-Path $d (Safe $m.name); $tmp = $final + '.part'
        $fs = [IO.File]::Create($tmp)
        Send @{ id = $m.id; ok = $true }
      }
      'chunk' {
        $bytes = [Convert]::FromBase64String($m.data)
        $fs.Write($bytes, 0, $bytes.Length)
        Send @{ id = $m.id; ok = $true }
      }
      'end' {
        $fs.Close(); $fs = $null
        if (Test-Path -LiteralPath $final) { Remove-Item -LiteralPath $final -Force }
        Move-Item -LiteralPath $tmp -Destination $final -Force; $tmp = $null
        Send @{ id = $m.id; ok = $true }
      }
      'abort' { CloseTmp; Send @{ id = $m.id; ok = $true } }
      default { Send @{ id = $m.id; ok = $false; err = 'unknown op' } }
    }
  } catch {
    try { CloseTmp } catch {}
    Send @{ id = $m.id; ok = $false; err = $_.Exception.Message }
  }
}
CloseTmp
