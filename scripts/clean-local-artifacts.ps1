[CmdletBinding()]
param(
  [switch]$IncludeBuildOutputs,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir ".."))
$RepoPrefix = $RepoRoot.TrimEnd(
  [System.IO.Path]::DirectorySeparatorChar,
  [System.IO.Path]::AltDirectorySeparatorChar
) + [System.IO.Path]::DirectorySeparatorChar

function Assert-UnderRepo {
  param([string]$Path)

  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $isRepoRoot = $fullPath.Equals($RepoRoot, [System.StringComparison]::OrdinalIgnoreCase)
  $isUnderRepo = $fullPath.StartsWith($RepoPrefix, [System.StringComparison]::OrdinalIgnoreCase)

  if (-not ($isRepoRoot -or $isUnderRepo)) {
    throw "Refusing to touch path outside repo: $fullPath"
  }

  return $fullPath
}

function Resolve-RepoPath {
  param([string]$RelativePath)

  return Assert-UnderRepo (Join-Path $RepoRoot $RelativePath)
}

function Remove-GeneratedPath {
  param(
    [string]$Path,
    [string]$Label = $Path
  )

  $fullPath = Assert-UnderRepo $Path

  if (-not (Test-Path -LiteralPath $fullPath)) {
    Write-Host "skip    $Label"
    return
  }

  if ($DryRun) {
    Write-Host "would   $Label"
    return
  }

  # Keep deletion scoped to known generated artifacts; this script is the repo-local
  # cleanup surface before committing or packaging, not a replacement for git clean.
  Remove-Item -LiteralPath $fullPath -Recurse -Force
  Write-Host "removed $Label"
}

function Remove-EmptyDirectory {
  param([string]$RelativePath)

  $fullPath = Resolve-RepoPath $RelativePath

  if (-not (Test-Path -LiteralPath $fullPath -PathType Container)) {
    return
  }

  $hasChildren = @(Get-ChildItem -LiteralPath $fullPath -Force -ErrorAction SilentlyContinue).Count -gt 0
  if ($hasChildren) {
    return
  }

  if ($DryRun) {
    Write-Host "would   empty $RelativePath"
    return
  }

  Remove-Item -LiteralPath $fullPath -Force
  Write-Host "removed empty $RelativePath"
}

$defaultGeneratedPaths = @(
  ".superloopy/evidence",
  ".superloopy/sessions",
  "src-tauri/python/build"
)

$optionalBuildOutputs = @(
  "dist",
  "src-tauri/target",
  "src-tauri/gen"
)

foreach ($relativePath in $defaultGeneratedPaths) {
  Remove-GeneratedPath -Path (Resolve-RepoPath $relativePath) -Label $relativePath
}

$pythonRoot = Resolve-RepoPath "src-tauri/python"
if (Test-Path -LiteralPath $pythonRoot -PathType Container) {
  Get-ChildItem -LiteralPath $pythonRoot -Directory -Recurse -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq "__pycache__" } |
    ForEach-Object {
      Remove-GeneratedPath -Path $_.FullName -Label $_.FullName.Substring($RepoPrefix.Length)
    }
}

if ($IncludeBuildOutputs) {
  foreach ($relativePath in $optionalBuildOutputs) {
    Remove-GeneratedPath -Path (Resolve-RepoPath $relativePath) -Label $relativePath
  }
}

foreach ($relativePath in @(".superloopy/evidence/frontend", ".superloopy/evidence", ".superloopy")) {
  Remove-EmptyDirectory -RelativePath $relativePath
}
