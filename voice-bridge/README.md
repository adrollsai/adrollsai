# Gemini Voice WebSocket Bridge

A standalone WebSocket bridge server that connects Twilio Media Streams (G.711 mu-law, 8kHz) to the Gemini Multimodal Live API WebSocket (16-bit PCM, 16kHz/24kHz) for real-time low-latency voice calls.

## How it works
1. **Twilio Connection**: Twilio calls connect and trigger a `<Stream>` instruction pointing to this bridge server's `/gemini-live-stream` WebSocket endpoint.
2. **Gemini Connection**: The bridge server receives the connection, queries Supabase for caller and profile context, and initiates a stateful WebSocket connection to the Gemini Live API (`wss://generativelanguage.googleapis.com/...`).
3. **Bi-directional Transcoding**:
   - **Twilio -> Gemini**: Audio chunks are decoded from 8kHz mu-law to 16-bit PCM, upsampled to 16kHz via linear interpolation, and forwarded to Gemini.
   - **Gemini -> Twilio**: Audio chunks are received from Gemini at 24kHz PCM, downsampled to 8kHz (every 3rd sample), encoded to mu-law, and sent back to Twilio.
4. **Call Termination**: Gemini uses function-calling to trigger `end_call()` when the objective is met, which hangs up the Twilio call. The bridge server compiles a transcript of both turns, uses Gemini to summarize it, and saves a `🎙️ CALL_JSON` record in `lead_history`.

## Local Development
1. Navigate to this directory:
   ```bash
   cd voice-bridge
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the bridge server:
   ```bash
   npm start
   ```
4. Expose port `5050` using `cloudflared` or `ngrok`. Set your webhook in Twilio settings to point to the bridge.

## Production Deployment (Google Cloud Run)
Run the provided deployment script to build and deploy to Google Cloud Run:
```cmd
deploy.bat
```
Make sure you run `gcloud auth login` and set your active project beforehand.
