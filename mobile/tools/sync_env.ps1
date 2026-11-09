# Builds the --dart-define file from the existing PWA's .env.local.
#
# The two values this app needs (the Supabase URL and anon key) already exist in
# the web repo's .env.local under their NEXT_PUBLIC_* names. Rather than asking
# for credentials that are already on disk, this script reads them and writes
# dart_defines.json — which is gitignored — without ever printing a value.
#
# Usage:
#   pwsh -File tools/sync_env.ps1
#   flutter run --dart-define-from-file=dart_defines.json

param(
    [string]$EnvFile,
    [string]$OutFile
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
if (-not $EnvFile) {
    # The mobile app lives beside the Next.js app in the same repository.
    $EnvFile = Join-Path (Split-Path -Parent $root) '.env.local'
}
if (-not $OutFile) { $OutFile = Join-Path $root 'dart_defines.json' }

if (-not (Test-Path $EnvFile)) {
    Write-Error "No env file found at $EnvFile. Pass -EnvFile or create dart_defines.json by hand from dart_defines.example.json."
    exit 1
}

$wanted = @{
    'NEXT_PUBLIC_SUPABASE_URL'      = 'NOBO_SUPABASE_URL'
    'NEXT_PUBLIC_SUPABASE_ANON_KEY' = 'NOBO_SUPABASE_ANON_KEY'
    'NEXT_PUBLIC_APP_URL'           = 'NOBO_API_BASE_URL'
}

$found = @{}
foreach ($line in Get-Content $EnvFile) {
    $trimmed = $line.Trim()
    if ($trimmed -eq '' -or $trimmed.StartsWith('#')) { continue }
    $idx = $trimmed.IndexOf('=')
    if ($idx -lt 1) { continue }
    $key = $trimmed.Substring(0, $idx).Trim()
    $value = $trimmed.Substring($idx + 1).Trim().Trim('"').Trim("'")
    if ($wanted.ContainsKey($key) -and $value -ne '') {
        $found[$wanted[$key]] = $value
    }
}

if (-not $found.ContainsKey('NOBO_SUPABASE_URL') -or -not $found.ContainsKey('NOBO_SUPABASE_ANON_KEY')) {
    Write-Error "Could not find NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in $EnvFile."
    exit 1
}

if (-not $found.ContainsKey('NOBO_API_BASE_URL')) {
    $found['NOBO_API_BASE_URL'] = 'https://app.nobogent.com'
}

$found | ConvertTo-Json | Set-Content -Path $OutFile -Encoding utf8

# Report only which keys were written — never the values.
Write-Output "Wrote $OutFile"
foreach ($k in $found.Keys) {
    $hint = if ($found[$k].Length -gt 12) { 'set (' + $found[$k].Length + ' chars)' } else { 'set' }
    Write-Output ("  {0,-26} {1}" -f $k, $hint)
}
