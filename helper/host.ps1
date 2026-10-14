# AIUB Smart Slide Downloader - helper for Chrome "native messaging".
# Reads messages from the extension (stdin) and saves the course files it sends into Desktop\AIUB\<Course>.
# It only writes inside Desktop\AIUB. It makes no network connections and starts no other programs.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$in   = [Console]::OpenStandardInput()
$out  = [Console]::OpenStandardOutput()
$utf8 = New-Object Text.UTF8Encoding $false
$root = Join-Path ([Environment]::GetFolderPath('Desktop')) 'AIUB'
[void][IO.Directory]::CreateDirectory($root)
$streams = @{}   # fid -> @{ fs; tmp; final }

function Read-Exact([int]$n) {
  $buf = New-Object byte[] $n; $off = 0
  while ($off -lt $n) { $r = $in.Read($buf, $off, $n - $off); if ($r -le 0) { return $null }; $off += $r }
  return ,$buf
}
function Send($obj) {
  $b = $utf8.GetBytes((ConvertTo-Json -InputObject $obj -Compress -Depth 6))
  $out.Write([BitConverter]::GetBytes([int]$b.Length), 0, 4); $out.Write($b, 0, $b.Length); $out.Flush()
}
function Safe([string]$s) {
  $t = ($s -replace '[<>:"/\\|?*\x00-\x1f]', '').Trim().TrimEnd('.', ' ')
  if (-not $t) { $t = 'file' }
  return $t
}
function Course-Dir([string]$folder) {
  $d = Join-Path $root (Safe $folder)
  [void][IO.Directory]::CreateDirectory($d)
  return $d
}
function Close-Stream([string]$k) {
  if (-not $streams.ContainsKey($k)) { return }
  $s = $streams[$k]
  try { $s.fs.Close() } catch {}
  try { if ([IO.File]::Exists($s.tmp)) { [IO.File]::Delete($s.tmp) } } catch {}
  $streams.Remove($k)
}
function Have-Names([string]$d) {
  $names = New-Object System.Collections.ArrayList
  foreach ($f in (New-Object IO.DirectoryInfo $d).GetFiles()) {
    if ($f.Length -gt 0 -and $f.Extension -ne '.part') { [void]$names.Add($f.Name) }
  }
  return ,@($names)
}

while ($true) {
  $id = $null
  try {
    $lb = Read-Exact 4; if ($null -eq $lb) { break }
    $mb = Read-Exact ([BitConverter]::ToInt32($lb, 0)); if ($null -eq $mb) { break }
    $raw = $utf8.GetString($mb)

    # fast path for big file chunks (skips JSON parsing)
    $cm = [regex]::Match($raw, '^\{"id":(\d+),"op":"chunk","fid":(\d+),"data":"([^"]*)"\}$')
    if ($cm.Success) {
      $id = [int]$cm.Groups[1].Value
      $s = $streams[$cm.Groups[2].Value]
      if (-not $s) { throw 'unknown stream' }
      $bytes = [Convert]::FromBase64String($cm.Groups[3].Value)
      $s.fs.Write($bytes, 0, $bytes.Length)
      Send @{ id = $id; ok = $true }
      continue
    }

    $m = $raw | ConvertFrom-Json
    $id = $m.id
    switch ($m.op) {
      'ping' { Send @{ id = $id; ok = $true; path = $root } }
      'list' { Send @{ id = $id; ok = $true; names = (Have-Names (Course-Dir $m.folder)) } }
      'listall' {
        $map = [ordered]@{}
        foreach ($f in @($m.folders)) { $map[[string]$f] = (Have-Names (Course-Dir $f)) }
        Send @{ id = $id; ok = $true; map = $map }
      }
      'begin' {
        $k = [string]$m.fid
        Close-Stream $k
        $final = Join-Path (Course-Dir $m.folder) (Safe $m.name)
        $tmp = $final + '.part'
        $streams[$k] = @{ fs = [IO.File]::Create($tmp); tmp = $tmp; final = $final }
        Send @{ id = $id; ok = $true }
      }
      'end' {
        $k = [string]$m.fid
        $s = $streams[$k]
        if (-not $s) { throw 'unknown stream' }
        $s.fs.Close()
        if ([IO.File]::Exists($s.final)) { [IO.File]::Delete($s.final) }
        [IO.File]::Move($s.tmp, $s.final)
        $streams.Remove($k)
        Send @{ id = $id; ok = $true }
      }
      'abort' { Close-Stream ([string]$m.fid); Send @{ id = $id; ok = $true } }
      default { Send @{ id = $id; ok = $false; err = 'unknown op' } }
    }
  } catch {
    try { Send @{ id = $id; ok = $false; err = $_.Exception.Message } } catch {}
  }
}
foreach ($k in @($streams.Keys)) { Close-Stream $k }
