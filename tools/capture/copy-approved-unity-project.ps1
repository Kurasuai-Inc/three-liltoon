param(
  [Parameter(Mandatory = $true)][string]$SourceProject,
  [Parameter(Mandatory = $true)][string]$DestinationProject,
  [Parameter(Mandatory = $true)][string]$ResultPath,
  [Parameter(Mandatory = $true)][string]$RobocopyLog
)

$ErrorActionPreference = 'Stop'
$source = [IO.Path]::GetFullPath($SourceProject)
$destination = [IO.Path]::GetFullPath($DestinationProject)
$result = [IO.Path]::GetFullPath($ResultPath)
$copyLog = [IO.Path]::GetFullPath($RobocopyLog)
$null = New-Item -ItemType Directory -Path (Split-Path -Parent $result) -Force
$null = New-Item -ItemType Directory -Path (Split-Path -Parent $copyLog) -Force

function Write-Result([hashtable]$Value) {
  $Value | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $result -Encoding utf8
}

function Resolve-ProjectToken([string]$CommandLine) {
  $match = [regex]::Match($CommandLine, '(?i)(?:^|\s)-projectPath\s+(?:"([^"]+)"|(\S+))')
  if (-not $match.Success) { return $null }
  if ($match.Groups[1].Success) { return [IO.Path]::GetFullPath($match.Groups[1].Value) }
  return [IO.Path]::GetFullPath($match.Groups[2].Value)
}

try {
  if (-not (Test-Path -LiteralPath $source -PathType Container)) { throw "Source project is missing: $source" }
  if (Test-Path -LiteralPath $destination) { throw "Destination already exists; refusing overwrite: $destination" }

  $matchingUnity = @(Get-CimInstance Win32_Process -Filter "Name='Unity.exe'" | Where-Object {
    $_.CommandLine -and (Resolve-ProjectToken $_.CommandLine) -ieq $source
  })
  if ($matchingUnity.Count -ne 0) {
    throw "Unity is using the source project; refusing to copy. PIDs: $($matchingUnity.ProcessId -join ',')"
  }

  $robocopy = Join-Path $env:SystemRoot 'System32\robocopy.exe'
  & $robocopy $source $destination /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NP "/LOG:$copyLog"
  $copyExit = $LASTEXITCODE
  if ($copyExit -gt 7) { throw "Robocopy failed with exit code $copyExit" }

  $sourceAssets = Join-Path $source 'Assets'
  $destinationAssets = Join-Path $destination 'Assets'
  $sourceFiles = @(Get-ChildItem -LiteralPath $sourceAssets -Recurse -File -Force)
  $destinationFiles = @(Get-ChildItem -LiteralPath $destinationAssets -Recurse -File -Force)
  $sourceDirs = @(Get-ChildItem -LiteralPath $sourceAssets -Recurse -Directory -Force)
  $destinationDirs = @(Get-ChildItem -LiteralPath $destinationAssets -Recurse -Directory -Force)
  if ($sourceFiles.Count -ne $destinationFiles.Count -or $sourceDirs.Count -ne $destinationDirs.Count) {
    throw "Assets count mismatch: files $($sourceFiles.Count)/$($destinationFiles.Count), dirs $($sourceDirs.Count)/$($destinationDirs.Count)"
  }

  $keyFiles = @('ProjectSettings/ProjectVersion.txt', 'Packages/manifest.json')
  $hashes = @()
  foreach ($relative in $keyFiles) {
    $sourcePath = Join-Path $source ($relative -replace '/', '\')
    $destinationPath = Join-Path $destination ($relative -replace '/', '\')
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf) -or -not (Test-Path -LiteralPath $destinationPath -PathType Leaf)) {
      throw "Required project file missing after copy: $relative"
    }
    $sourceHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
    $destinationHash = (Get-FileHash -LiteralPath $destinationPath -Algorithm SHA256).Hash
    if ($sourceHash -ne $destinationHash) { throw "Key file hash mismatch: $relative" }
    $hashes += [pscustomobject]@{ path = $relative; sha256 = $sourceHash }
  }

  $assetHashes = @()
  foreach ($file in $sourceFiles | Where-Object { $_.Extension -in '.prefab', '.mat' } | Sort-Object FullName) {
    $relative = $file.FullName.Substring($sourceAssets.Length).TrimStart('\')
    $target = Join-Path $destinationAssets $relative
    $sourceHash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
    $targetHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
    if ($sourceHash -ne $targetHash) { throw "Asset hash mismatch: $relative" }
    $assetHashes += [pscustomobject]@{ path = $relative; sha256 = $sourceHash }
  }

  Write-Result @{
    status = 'verified'
    source = $source
    destination = $destination
    robocopyExitCode = $copyExit
    assetsFileCount = $sourceFiles.Count
    assetsDirectoryCount = $sourceDirs.Count
    keyFileHashes = $hashes
    prefabMaterialHashCount = $assetHashes.Count
    prefabMaterialHashes = $assetHashes
    completedAt = [DateTimeOffset]::Now.ToString('o')
  }
} catch {
  Write-Result @{
    status = 'failed'
    source = $source
    destination = $destination
    error = $_.Exception.Message
    completedAt = [DateTimeOffset]::Now.ToString('o')
  }
  exit 1
}
