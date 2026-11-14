@echo off
echo ===================================================
echo   Deploying Gemini Voice WebSocket Bridge to GCP
echo ===================================================
echo.

:: 1. Verify Authentication
gcloud.cmd auth list | findstr /i "@" >nul
if errorlevel 1 (
    echo [ERROR] No active gcloud login detected.
    echo Please run: gcloud auth login
    echo.
    pause
    exit /b 1
)

:: 2. Resolve active project ID
for /f "tokens=*" %%p in ('gcloud.cmd config get-value project 2^>nul') do set GCP_PROJECT=%%p

if "%GCP_PROJECT%"=="" (
    echo [ERROR] No default gcloud project set.
    echo Please set your active GCP project first:
    echo gcloud config set project [YOUR_PROJECT_ID]
    echo.
    pause
    exit /b 1
)

if "%GCP_PROJECT%"=="(unset)" (
    echo [ERROR] No default gcloud project set.
    echo Please set your active GCP project first:
    echo gcloud config set project [YOUR_PROJECT_ID]
    echo.
    pause
    exit /b 1
)

echo [INFO] Active GCP Project detected: %GCP_PROJECT%
echo.

:: 3. Build & Deploy to Google Cloud Run
echo [STEP 1/2] Building Container Image via Cloud Builds...
call gcloud.cmd builds submit --tag gcr.io/%GCP_PROJECT%/gemini-voice-bridge

if errorlevel 1 (
    echo [ERROR] Container build failed.
    pause
    exit /b 1
)

echo.
echo [STEP 2/2] Deploying to Google Cloud Run (US-Central1)...
echo.
echo   WebSocket settings that are NOT optional on Cloud Run:
echo     --timeout 3600        A WebSocket is one long HTTP request, and the default
echo                           request timeout is 300s - so every call was severed at
echo                           five minutes no matter what the bridge asked for.
echo     --concurrency 4       Each live call holds a client socket AND an upstream
echo                           model socket. The default of 80 per instance packs that
echo                           many into one vCPU and everyone shares the damage.
echo                           Scale with instances, not with concurrency.
echo     --min-instances 1     A live call must never wait for a cold start.
echo     --max-instances 20    Cost ceiling, and the hard limit this project can ask for:
echo                           Cloud Run's CPU quota for the region is 20 vCPU, and each
echo                           instance takes 1, so 20 instances is the most that will
echo                           pass validation (40 is rejected with CpuAllocPerProjectRegion).
echo     --memory 1Gi --cpu 1  Node plus per-call audio buffers; 512Mi gets tight.
echo     --cpu-boost           Shortens the cold start for the first caller.
echo     --session-affinity    Session state lives in this process, so a reconnect has
echo                           to reach the same instance to resume.
echo     --no-cpu-throttling   Audio is continuous, not request-shaped; throttled CPU
echo                           shows up as choppy speech.
echo.
call gcloud.cmd run deploy gemini-voice-bridge ^
  --image gcr.io/%GCP_PROJECT%/gemini-voice-bridge ^
  --platform managed ^
  --region us-central1 ^
  --allow-unauthenticated ^
  --port 8080 ^
  --timeout 3600 ^
  --concurrency 4 ^
  --min-instances 1 ^
  --max-instances 20 ^
  --memory 1Gi ^
  --cpu 1 ^
  --cpu-boost ^
  --session-affinity ^
  --no-cpu-throttling

if errorlevel 1 (
    echo [ERROR] Cloud Run deployment failed.
    pause
    exit /b 1
)

echo.
echo ===================================================
echo   Gemini Voice Bridge Deployed Successfully!
echo ===================================================
echo.
echo   To move the phone agent onto the current live model:
echo     gcloud run services update gemini-voice-bridge --region us-central1 ^
echo       --update-env-vars GEMINI_LIVE_MODEL=models/gemini-3.8-live
echo.
pause
