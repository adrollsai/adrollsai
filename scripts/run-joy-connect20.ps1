# Dial the Joy Grand audience (Option B: untouched + Contacted + Requirement Taken
# + Plan Postponed) until 20 calls have actually CONNECTED, not merely dispatched.
#
# Each chunk is a fresh node process because the dialer has been observed dying
# around 15-30 dispatches with Windows status 0xC0000409. The dialer is idempotent:
# already-dialled leads are excluded by voice_call_status, so a chunk boundary never
# re-calls anyone.
#
# Connected != dispatched: a huge share of this list is USER_BUSY / unreachable /
# voicemail, so the loop keeps going until the TARGET is met or the clock runs out.

$ErrorActionPreference = 'Continue'
Set-Location 'C:\Users\Adrolls\Desktop\nobogent-app\nobogent'

$env:VOBIZ_MACHINE_DETECTION = 'off'   # never validated on this trunk; off is safer

$TARGET     = if ($args.Count -ge 1) { [int]$args[0] } else { 999 }
$LOG        = '.tmp-joyB-run.out'
$ERRLOG     = '.tmp-joyB-run.err'
$deadline   = (Get-Date).Date.AddHours(20)
$chunk      = 0
$connected  = 0

while ((Get-Date) -lt $deadline) {
    $chunk++

    $before = if (Test-Path $LOG) { (Select-String -Path $LOG -Pattern '^\s+ok').Count } else { 0 }

    cmd /c "node .tmp-bs-batch.cjs --group=Joy --include-worked --max=15 --pace=40 1>> $LOG 2>> $ERRLOG"
    $code = $LASTEXITCODE

    $after = (Select-String -Path $LOG -Pattern '^\s+ok').Count
    $thisChunk = $after - $before

    $status = cmd /c "node scripts/count-joy-connected.mjs $LOG 2>nul"
    if ($status -match 'CONNECTED=(\d+)') { $connected = [int]$Matches[1] }

    Write-Host ("{0}  chunk {1}: +{2} dialled (exit {3}) | {4}" -f (Get-Date).ToString('HH:mm:ss'), $chunk, $thisChunk, $code, $status)

    if ($connected -ge $TARGET) {
        Write-Host "TARGET REACHED: $connected connected calls."
        break
    }
    if ($thisChunk -eq 0) {
        Write-Host "No new calls dispatched - audience exhausted or everything failing. Stopping at $connected connected."
        break
    }

    Start-Sleep -Seconds 3
}

Write-Host "FINISHED at $((Get-Date).ToString('HH:mm:ss')): $connected connected calls."


