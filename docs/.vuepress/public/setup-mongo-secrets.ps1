[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$InstallRoot = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function New-SecureHex {
  $bytes = [byte[]]::new(32)
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  }
  finally {
    $generator.Dispose()
  }
  return ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}

function Test-ReparsePoint([string]$LiteralPath) {
  if (-not (Test-Path -LiteralPath $LiteralPath)) {
    return $false
  }
  $item = Get-Item -LiteralPath $LiteralPath -Force
  return [bool]($item.Attributes -band [IO.FileAttributes]::ReparsePoint)
}

function Protect-Secret([string]$LiteralPath, [bool]$IsDirectory = $false) {
  try {
    $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $rights = if ($IsDirectory) { '(OI)(CI)F' } else { '(F)' }
    $icacls = Join-Path $env:SystemRoot 'System32\icacls.exe'
    $arguments = @(
      $LiteralPath,
      '/inheritance:r',
      '/grant:r',
      "*${currentSid}:$rights",
      '*S-1-5-18:(F)',
      '*S-1-5-32-544:(F)'
    )
    $result = & $icacls @arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw ($result -join [Environment]::NewLine)
    }
  }
  catch {
    Write-Warning "Could not tighten the ACL for '$LiteralPath': $($_.Exception.Message)"
    Write-Warning 'Keep the secrets directory on an NTFS volume protected by your Windows account.'
  }
}

$resolvedRoot = [IO.Path]::GetFullPath($InstallRoot)
$pathRoot = [IO.Path]::GetPathRoot($resolvedRoot)
if (-not $resolvedRoot -or $resolvedRoot -eq $pathRoot) {
  throw "Refusing unsafe installation root: $resolvedRoot"
}

if (-not (Test-Path -LiteralPath $resolvedRoot)) {
  [void](New-Item -ItemType Directory -Path $resolvedRoot)
}
if (Test-ReparsePoint $resolvedRoot) {
  throw "Refusing reparse-point installation root: $resolvedRoot"
}

$secretDirectory = Join-Path $resolvedRoot 'secrets'
$mongoDataDirectory = Join-Path (Join-Path $resolvedRoot 'data') 'mongo'
$rootPasswordFile = Join-Path $secretDirectory 'mongo-root-password'
$appPasswordFile = Join-Path $secretDirectory 'mongo-app-password'
$appUriFile = Join-Path $secretDirectory 'mongo-app-uri'
$secretFiles = @($rootPasswordFile, $appPasswordFile, $appUriFile)

foreach ($file in $secretFiles) {
  if (Test-ReparsePoint $file) {
    throw "Refusing reparse-point secret path: $file"
  }
}

$existingFiles = @($secretFiles | Where-Object { Test-Path -LiteralPath $_ })
if ($existingFiles.Count -ne 0 -and $existingFiles.Count -ne $secretFiles.Count) {
  throw 'MongoDB secret set is incomplete; refusing to replace or regenerate it.'
}

$hasMongoData = (Test-Path -LiteralPath $mongoDataDirectory) -and
  $null -ne (Get-ChildItem -LiteralPath $mongoDataDirectory -Force | Select-Object -First 1)
if ($existingFiles.Count -eq 0 -and $hasMongoData) {
  throw "Existing MongoDB data detected at '$mongoDataDirectory'. Run the migration before adding authentication."
}

$utf8WithoutBom = [Text.UTF8Encoding]::new($false)
if ($existingFiles.Count -eq 0) {
  if (-not (Test-Path -LiteralPath $secretDirectory)) {
    [void](New-Item -ItemType Directory -Path $secretDirectory)
  }
  Protect-Secret $secretDirectory $true

  $rootPassword = New-SecureHex
  $appPassword = New-SecureHex
  $encodedPassword = [Uri]::EscapeDataString($appPassword)
  $appUri = "mongodb://zweiblog:${encodedPassword}@mongo:27017/zweiBlog?authSource=admin"

  [IO.File]::WriteAllText($rootPasswordFile, $rootPassword, $utf8WithoutBom)
  [IO.File]::WriteAllText($appPasswordFile, $appPassword, $utf8WithoutBom)
  [IO.File]::WriteAllText($appUriFile, $appUri, $utf8WithoutBom)
}

$rootPassword = [IO.File]::ReadAllText($rootPasswordFile, $utf8WithoutBom)
$appPassword = [IO.File]::ReadAllText($appPasswordFile, $utf8WithoutBom)
$appUri = [IO.File]::ReadAllText($appUriFile, $utf8WithoutBom)
if ($rootPassword -cnotmatch '^[0-9a-f]{64}$' -or $appPassword -cnotmatch '^[0-9a-f]{64}$') {
  throw 'MongoDB password files have an invalid format.'
}

$expectedUri = "mongodb://zweiblog:$([Uri]::EscapeDataString($appPassword))@mongo:27017/zweiBlog?authSource=admin"
if ($appUri -cne $expectedUri) {
  throw 'MongoDB application URI does not match the application password.'
}

foreach ($file in $secretFiles) {
  Protect-Secret $file
}

Write-Host "MongoDB credentials are ready in '$secretDirectory' (existing values were not rotated)."
