# Runs the Bluesquare dialer in short chunks until 20:00 IST.
#
# WHY CHUNKS: the node process was observed dying around 15-30 calls with
# Windows status 0xC0000409 (stack buffer overrun). A crash mid-batch loses the
# rest of the queue, so each chunk is a fresh process and a crash costs at most
# one chunk. The dialer itself is idempotent - already-dialled leads are excluded
# by voice_call_status, so restarting never re-calls anyone.

$ErrorActionPreference = 'Continue'
Set-Location 'C:\Users\Adrolls\Desktop\nobogent-app\nobogent'

# Answering-machine detection stays OFF: it could not be validated while the
# bridge was crashing, and hanging up on a live prospect costs a lead.
$env:VOBIZ_MACHINE_DETECTION = 'off'

$deadline = (Get-Date).Date.AddHours(20)
$chunk = 0

while ((Get-Date) -lt $deadline) {
    $chunk++
    $before = if (Test-Path .tmp-bs-batch-loop.out) { (Select-String -Path .tmp-bs-batch-loop.out -Pattern '^\s+ok').Count } else { 0 }

    cmd /c "node .tmp-bs-batch.cjs --max=25 --pace=40 1>> .tmp-bs-batch-loop.out 2>> .tmp-bs-batch-loop.err"
    $code = $LASTEXITCODE

    $after = (Select-String -Path .tmp-bs-batch-loop.out -Pattern '^\s+ok').Count
    $thisChunk = $after - $before
    Write-Host ("{0}  chunk {1}: +{2} calls (exit {3})  total {4}" -f (Get-Date).ToString('HH:mm:ss'), $chunk, $thisChunk, $code, $after)

    if ($thisChunk -eq 0) {
        Write-Host "No calls dispatched this chunk - queue is empty or everything is failing. Stopping."
        break
    }

    Start-Sleep -Seconds 3
}

Write-Host "Runner finished at $((Get-Date).ToString('HH:mm:ss')) after $chunk chunk(s)."
