# AIUB Smart Slide Downloader - helper for Chrome "native messaging".
# Reads messages from the extension (stdin) and saves the course files it sends into Desktop\AIUB\<Course>.
# It only writes inside Desktop\AIUB (and, for updates, the extension\ and update\ folders next to this helper).
# It makes no network connections, downloads nothing, starts no other programs and shows no window.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$in   = [Console]::OpenStandardInput()
$out  = [Console]::OpenStandardOutput()
$utf8 = New-Object Text.UTF8Encoding $false
$root = Join-Path ([Environment]::GetFolderPath('Desktop')) 'AIUB'
[void][IO.Directory]::CreateDirectory($root)
$streams = @{}   # fid -> @{ fs; tmp; final }
$base  = Split-Path $PSScriptRoot -Parent            # %LOCALAPPDATA%\AIUB-Smart-Slide-Downloader
$edir  = Join-Path $base 'extension'
$stage = Join-Path $base 'update'                    # a new version is collected here first, then swapped in all at once
$xname = '^[A-Za-z0-9._-]{1,64}\.(js|json|png|html|css)$'

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
  # "Course" or "Course/Sub/Folder": every part is cleaned on its own, so nothing can leave Desktop\AIUB
  $d = $root
  foreach ($seg in ([string]$folder -split '/')) { if ($seg.Trim()) { $d = Join-Path $d (Safe $seg) } }
  if ($d -eq $root) { $d = Join-Path $root 'file' }
  [void][IO.Directory]::CreateDirectory($d)
  return $d
}
function Rel-Path([string]$rel) {
  # "Course/Sub/File.pdf" -> full path inside Desktop\AIUB (every part cleaned on its own, so nothing can leave the folder)
  $segs = @(([string]$rel -split '/') | Where-Object { $_.Trim() })
  if ($segs.Count -lt 2) { return $null }
  $d = $root
  for ($j = 0; $j -lt $segs.Count - 1; $j++) { $d = Join-Path $d (Safe $segs[$j]) }
  $f = Join-Path $d (Safe $segs[$segs.Count - 1])
  if ($f.Length -gt 250) { return $null }
  return $f
}
function List-NoCreate([string]$folder) {
  # like Course-Dir + Have-Names, but a folder that does not exist is NOT created (it is an old folder name)
  $d = $root
  foreach ($seg in ([string]$folder -split '/')) { if ($seg.Trim()) { $d = Join-Path $d (Safe $seg) } }
  if ($d -eq $root -or -not [IO.Directory]::Exists($d)) { return ,@() }
  return (Have-Names $d)
}
function Prune-Empty([string]$d) {
  # removes a folder that became empty after moving files out of it (and its empty parents), never Desktop\AIUB itself
  $r = [IO.Path]::GetFullPath($root).TrimEnd('\')
  try {
    while ($d) {
      $full = [IO.Path]::GetFullPath($d).TrimEnd('\')
      if (-not $full.StartsWith($r + '\', [StringComparison]::OrdinalIgnoreCase)) { break }
      if (-not [IO.Directory]::Exists($full)) { break }
      if (@([IO.Directory]::GetFileSystemEntries($full)).Count -gt 0) { break }
      [IO.Directory]::Delete($full)
      $d = Split-Path $full -Parent
    }
  } catch { }
}
function Close-Stream([string]$k) {
  if (-not $streams.ContainsKey($k)) { return }
  $s = $streams[$k]
  try { $s.fs.Close() } catch {}
  try { if ([IO.File]::Exists($s.tmp)) { [IO.File]::Delete($s.tmp) } } catch {}
  $streams.Remove($k)
}
function Clean-Stale([string]$d) {   # leftovers of an interrupted download (older than 6 hours)
  try { foreach ($f in (New-Object IO.DirectoryInfo $d).GetFiles('*.part')) { if ($f.LastWriteTime -lt (Get-Date).AddHours(-6)) { try { $f.Delete() } catch { } } } } catch { }
}
function Have-Names([string]$d) {
  $names = New-Object System.Collections.ArrayList
  foreach ($f in (New-Object IO.DirectoryInfo $d).GetFiles()) {
    if ($f.Length -gt 0 -and $f.Extension -ne '.part' -and -not ($f.Name -like '~r*.tmp')) { [void]$names.Add($f.Name) }
  }
  return ,@($names)
}

while ($true) {
  $id = $null
  try {
    $lb = Read-Exact 4; if ($null -eq $lb) { break }
    $mb = Read-Exact ([BitConverter]::ToInt32($lb, 0)); if ($null -eq $mb) { break }
    $raw = $utf8.GetString($mb)

    # fast path for big file chunks (no JSON parsing, no regex over megabytes)
    if ($raw.Length -gt 40 -and $raw.EndsWith('"}') -and $raw.StartsWith('{"id":')) {
      $cm = [regex]::Match($raw.Substring(0, [Math]::Min(80, $raw.Length)), '^\{"id":(\d+),"op":"chunk","fid":(\d+),"data":"')   # a small last piece is shorter than 80
      if ($cm.Success) {
        $id = [int]$cm.Groups[1].Value
        $s = $streams[$cm.Groups[2].Value]
        if (-not $s) { throw 'unknown stream' }
        $bytes = [Convert]::FromBase64String($raw.Substring($cm.Length, $raw.Length - $cm.Length - 2))
        $s.fs.Write($bytes, 0, $bytes.Length)
        Send @{ id = $id; ok = $true }
        continue
      }
    }

    $m = $raw | ConvertFrom-Json
    $id = $m.id
    switch ($m.op) {
      'ping' { Send @{ id = $id; ok = $true; path = $root; ver = 3 } }
      'list' { Send @{ id = $id; ok = $true; names = (Have-Names (Course-Dir $m.folder)) } }
      'listall' {
        $map = [ordered]@{}
        foreach ($f in @($m.folders)) { $dd = Course-Dir $f; Clean-Stale $dd; $map[[string]$f] = (Have-Names $dd) }
        Send @{ id = $id; ok = $true; map = $map; ver = 3 }
      }
      'listx' {
        $map = [ordered]@{}
        foreach ($f in @($m.folders)) { $map[[string]$f] = (List-NoCreate ([string]$f)) }
        Send @{ id = $id; ok = $true; map = $map }
      }
      'moveall' {
        # rename / move saved files, also into other folders (a new version may use other names or folders).
        # Step 1 moves every file to a temp name (so swaps cannot collide), step 2 to its new place.
        # Never overwrites another file; a file that is open in another program is left alone until next time.
        $moved = New-Object System.Collections.ArrayList
        $done = New-Object System.Collections.ArrayList
        $from_dirs = @{}
        $pairs = @($m.pairs)
        for ($k = 0; $k -lt $pairs.Count; $k++) {
          $from = Rel-Path ([string]$pairs[$k].f); $to = Rel-Path ([string]$pairs[$k].t)
          if ($null -eq $from -or $null -eq $to) { continue }
          if ($from -ceq $to -or -not [IO.File]::Exists($from)) { continue }   # -ceq: a change of capital letters only is a real rename
          $tmp = Join-Path (Split-Path $from -Parent) ('~r' + $k + '-' + [guid]::NewGuid().ToString('N').Substring(0, 6) + '.tmp')
          try { [IO.File]::Move($from, $tmp); [void]$moved.Add(@{ k = $k; tmp = $tmp; from = $from; to = $to }) } catch { }
        }
        foreach ($x in $moved) {
          try {
            if ([IO.File]::Exists($x.to)) { [IO.File]::Move($x.tmp, $x.from) }   # the new name is taken by another file: put it back
            else {
              [void][IO.Directory]::CreateDirectory((Split-Path $x.to -Parent))
              [IO.File]::Move($x.tmp, $x.to); [void]$done.Add([int]$x.k); $from_dirs[(Split-Path $x.from -Parent)] = 1
            }
          } catch { try { [IO.File]::Move($x.tmp, $x.from) } catch { } }
        }
        if ($m.prune) { foreach ($dd in @($from_dirs.Keys)) { Prune-Empty $dd } }
        Send @{ id = $id; ok = $true; done = @($done) }
      }
      'begin' {
        $k = [string]$m.fid
        Close-Stream $k
        $final = Join-Path (Course-Dir $m.folder) (Safe $m.name)
        if ($final.Length -gt 250) { throw 'the path is too long for Windows (shorten the course or folder name)' }
        $tmp = $final + '.part'
        $streams[$k] = @{ fs = (New-Object IO.FileStream($tmp, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None, 1048576)); tmp = $tmp; final = $final }
        Send @{ id = $id; ok = $true }
      }
      'end' {
        $k = [string]$m.fid
        $s = $streams[$k]
        if (-not $s) { throw 'unknown stream' }
        $s.fs.Close()
        for ($try = 0; $try -lt 4; $try++) {   # antivirus or a preview pane may hold the file for a moment
          try {
            if ([IO.File]::Exists($s.final)) { [IO.File]::Delete($s.final) }
            [IO.File]::Move($s.tmp, $s.final)
            break
          } catch { if ($try -eq 3) { throw }; Start-Sleep -Milliseconds 500 }
        }
        $streams.Remove($k)
        Send @{ id = $id; ok = $true }
      }
      'renameall' {
        # renumbering: move every file to a temp name first (so swaps cannot collide), then to its final name.
        # A file that is open in another program (e.g. PowerPoint) is simply left alone until next time.
        $d = Course-Dir $m.folder
        $moved = New-Object System.Collections.ArrayList
        $i = 0
        foreach ($p in @($m.pairs)) {
          $from = Join-Path $d (Safe $p.f); $to = Join-Path $d (Safe $p.t)
          if ($from -ceq $to -or -not [IO.File]::Exists($from)) { continue }   # -ceq: a change of capital letters only is a real rename
          $tmp = Join-Path $d ('~r' + $i + '.tmp'); $i++
          try { [IO.File]::Move($from, $tmp); [void]$moved.Add(@{ tmp = $tmp; from = $from; to = $to }) } catch { }
        }
        $n = 0
        foreach ($x in $moved) {
          try {
            if ([IO.File]::Exists($x.to)) { [IO.File]::Move($x.tmp, $x.from) }   # never overwrite another file: put it back
            else { [IO.File]::Move($x.tmp, $x.to); $n++ }
          } catch { try { [IO.File]::Move($x.tmp, $x.from) } catch { } }
        }
        Send @{ id = $id; ok = $true; n = $n }
      }
      'xstart' {
        # a new version of the EXTENSION (sent by the extension itself, downloaded from its GitHub repository):
        # start with an empty staging folder
        if ([IO.Directory]::Exists($stage)) { [IO.Directory]::Delete($stage, $true) }
        [void][IO.Directory]::CreateDirectory($stage)
        Send @{ id = $id; ok = $true }
      }
      'xstage' {
        # one file of the new version -> update\<name> (same 'chunk' / 'end' steps as a download). Plain names only.
        $nm = [string]$m.name
        if ($nm -notmatch $xname) { throw 'file name not allowed' }
        if (-not [IO.Directory]::Exists($stage)) { throw 'update not started' }
        $k = [string]$m.fid
        Close-Stream $k
        $final = Join-Path $stage $nm
        $streams[$k] = @{ fs = (New-Object IO.FileStream(($final + '.part'), [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None, 65536)); tmp = ($final + '.part'); final = $final }
        Send @{ id = $id; ok = $true }
      }
      'xcommit' {
        # swap the whole new version in at once. If anything fails, the old files are put back (rollback).
        $names = @(@($m.names) | ForEach-Object { [string]$_ })
        foreach ($nm in $names) { if ($nm -notmatch $xname) { throw 'file name not allowed' }; if (-not [IO.File]::Exists((Join-Path $stage $nm))) { throw ('missing in update: ' + $nm) } }
        if (-not ($names -contains 'manifest.json') -or -not ($names -contains 'background.js')) { throw 'the update is not complete' }
        if (-not [IO.Directory]::Exists($edir)) { throw 'extension folder not found' }
        $bak = Join-Path $base 'update-backup'
        if ([IO.Directory]::Exists($bak)) { [IO.Directory]::Delete($bak, $true) }
        [void][IO.Directory]::CreateDirectory($bak)
        $old = @((New-Object IO.DirectoryInfo $edir).GetFiles() | Where-Object { $_.Name -match $xname })
        foreach ($f in $old) { [IO.File]::Copy($f.FullName, (Join-Path $bak $f.Name), $true) }
        try {
          foreach ($nm in ($names | Where-Object { $_ -ne 'manifest.json' })) { [IO.File]::Copy((Join-Path $stage $nm), (Join-Path $edir $nm), $true) }
          [IO.File]::Copy((Join-Path $stage 'manifest.json'), (Join-Path $edir 'manifest.json'), $true)   # last: this change makes Chrome see the new version
          foreach ($f in $old) { if (-not ($names -contains $f.Name)) { [IO.File]::Delete($f.FullName) } }   # files the new version no longer has
        } catch {
          $err = $_.Exception.Message
          foreach ($f in @((New-Object IO.DirectoryInfo $bak).GetFiles())) { try { [IO.File]::Copy($f.FullName, (Join-Path $edir $f.Name), $true) } catch { } }
          foreach ($nm in $names) { if (-not (@($old | ForEach-Object { $_.Name }) -contains $nm)) { try { [IO.File]::Delete((Join-Path $edir $nm)) } catch { } } }
          throw ('update rolled back: ' + $err)
        }
        try { [IO.Directory]::Delete($stage, $true) } catch { }
        try { [IO.Directory]::Delete($bak, $true) } catch { }
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
