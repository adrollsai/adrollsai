# Verifies the live Nobogent backend is reachable and that this app's
# authentication path works, using the local test account.
#
# Prints only non-sensitive results: the account's user id, its role, and row
# counts. It never echoes the password, the access token, or any key.
#
# Usage: pwsh -File tools/verify_live.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $root

$envFile = Join-Path $repoRoot '.env.local'
$acctFile = Join-Path $root '.local\test-account.json'

if (-not (Test-Path $envFile)) { Write-Error "Missing $envFile"; exit 1 }
if (-not (Test-Path $acctFile)) { Write-Error "Missing $acctFile"; exit 1 }

# --- Read the public Supabase config the PWA already ships -------------------
$cfg = @{}
foreach ($line in Get-Content $envFile) {
    $t = $line.Trim()
    if ($t -eq '' -or $t.StartsWith('#')) { continue }
    $i = $t.IndexOf('=')
    if ($i -lt 1) { continue }
    $k = $t.Substring(0, $i).Trim()
    $v = $t.Substring($i + 1).Trim().Trim('"').Trim("'")
    $cfg[$k] = $v
}
$supaUrl = $cfg['NEXT_PUBLIC_SUPABASE_URL']
$anonKey = $cfg['NEXT_PUBLIC_SUPABASE_ANON_KEY']
if (-not $supaUrl -or -not $anonKey) { Write-Error 'Supabase URL / anon key not found in .env.local'; exit 1 }

$acct = Get-Content $acctFile -Raw | ConvertFrom-Json

$headers = @{
    'apikey'       = $anonKey
    'Content-Type' = 'application/json'
}

# --- 1. Password grant (this is exactly what the app does) -------------------
Write-Output '1) Password sign-in against Supabase GoTrue'
$body = @{ email = $acct.email; password = $acct.password } | ConvertTo-Json
try {
    $auth = Invoke-RestMethod -Method Post -Uri "$supaUrl/auth/v1/token?grant_type=password" `
        -Headers $headers -Body $body -TimeoutSec 30
} catch {
    Write-Output "   FAILED: $($_.Exception.Message)"
    exit 1
}
if (-not $auth.access_token) { Write-Output '   FAILED: no access token returned'; exit 1 }
Write-Output ("   OK  user id = " + $auth.user.id)
Write-Output ("   OK  email   = " + $auth.user.email)
Write-Output ("   OK  token expires in " + $auth.expires_in + "s")

$authed = @{
    'apikey'        = $anonKey
    'Authorization' = "Bearer $($auth.access_token)"
    'Content-Type'  = 'application/json'
}

# --- 2. Profile row (drives every role gate in the app) ---------------------
Write-Output ''
Write-Output '2) Profile row (role gates the AI agent)'
try {
    $profile = Invoke-RestMethod -Method Get `
        -Uri "$supaUrl/rest/v1/profiles?select=id,role,business_name,credits,onboarding_completed&id=eq.$($auth.user.id)" `
        -Headers $authed -TimeoutSec 30
    if ($profile.Count -gt 0) {
        $p = $profile[0]
        Write-Output ("   OK  role = " + $p.role)
        Write-Output ("   OK  business = " + $p.business_name)
        Write-Output ("   OK  credits = " + $p.credits)
        Write-Output ("   OK  onboarding_completed = " + $p.onboarding_completed)
        if ($p.role -ne 'super_admin') {
            Write-Output '   NOTE: this account is NOT super_admin, so /api/agent/v2/chat will return 403.'
        }
    } else {
        Write-Output '   WARNING: no profiles row for this user'
    }
} catch {
    Write-Output "   FAILED: $($_.Exception.Message)"
}

# --- 3. Workspace data counts ----------------------------------------------
Write-Output ''
Write-Output '3) Workspace data visible to this account'
foreach ($t in @('properties', 'assets', 'leads', 'notifications')) {
    try {
        $rows = Invoke-RestMethod -Method Get `
            -Uri "$supaUrl/rest/v1/$t`?select=id&user_id=eq.$($auth.user.id)" `
            -Headers $authed -TimeoutSec 30
        Write-Output ("   {0,-14} {1} rows" -f $t, $rows.Count)
    } catch {
        Write-Output ("   {0,-14} ERROR: {1}" -f $t, $_.Exception.Message)
    }
}

Write-Output ''
Write-Output 'Done. No credentials or tokens were printed.'
