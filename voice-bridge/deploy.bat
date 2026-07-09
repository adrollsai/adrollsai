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
gcloud.cmd builds submit --tag gcr.io/%GCP_PROJECT%/gemini-voice-bridge

if errorlevel 1 (
    echo [ERROR] Container build failed.
    pause
    exit /b 1
)

echo.
echo [STEP 2/2] Deploying to Google Cloud Run (US-Central1)...
gcloud.cmd run deploy gemini-voice-bridge ^
  --image gcr.io/%GCP_PROJECT%/gemini-voice-bridge ^
  --platform managed ^
  --region us-central1 ^
  --allow-unauthenticated ^
  --port 5050

if errorlevel 1 (
    echo [ERROR] Cloud Run deployment failed.
    pause
    exit /b 1
)

echo.
echo ===================================================
echo   Gemini Voice Bridge Deployed Successfully!
echo ===================================================
pause
