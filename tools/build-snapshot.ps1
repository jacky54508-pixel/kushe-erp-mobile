$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$outputsRoot = Split-Path $projectRoot -Parent
$source = Get-ChildItem -LiteralPath $outputsRoot -Filter '*.json' |
  Where-Object { $_.Name -like '*ERP*' } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1 -ExpandProperty FullName
$target = Join-Path $projectRoot 'assets\js\backup-snapshot.js'
if (-not $source -or -not (Test-Path -LiteralPath $source)) { throw 'Backup JSON not found.' }
$raw = [System.IO.File]::ReadAllText($source, [System.Text.Encoding]::UTF8)
[void](ConvertFrom-Json -InputObject $raw)
$content = "/* Read-only snapshot generated from the existing KuShe ERP backup. */`r`nwindow.KUSHE_PHASE1_BACKUP = $raw;`r`n"
[System.IO.File]::WriteAllText($target, $content, [System.Text.UTF8Encoding]::new($false))
Write-Output "Snapshot created: $target"
