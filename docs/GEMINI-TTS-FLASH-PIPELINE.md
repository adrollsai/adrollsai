# Gemini 3.8 Flash TTS — Live Call Pipeline

A second, completely independent voice-calling pipeline for Nobogent: **it never
opens a Gemini Live (`bidiGenerateContent`) session.** Every hop is a plain REST
call, stitched together over the Vobiz media stream:

```
prospect's phone
      │  (Vobiz bidirectional stream · audio/x-l16 · 16 kHz mono · JSON base64 frames)
      ▼
voice-bridge  /tts-flash-stream
      │
      ├─ 1. VAD + endpointing      energy-based, 20 ms frames, 420 ms trailing silence
      ├─ 2. STT   gemini-3.1-flash-lite            generateContent  (audio → text)
      ├─ 3. LLM   gemini-3.1-flash-lite            streamGenerateContent (text tokens)
      └─ 4. TTS   gemini-3.8-flash-tts             streamGenerateContent (designed voice → PCM)
      │
      ▼
  playAudio frames back to Vobiz  (24 kHz → 16 kHz resampled on the fly)
```

Demo page: **`/dashboard/gemini-tts-flash-demo`** (super-admin). Enter prospect
name, company and phone number → their phone rings.

---

## Files

| File | Role |
| --- | --- |
| `voice-bridge/tts-flash-pipeline.js` | The whole pipeline (VAD, STT, LLM, streaming TTS, barge-in, transcript, summary). Self-contained. |
| `voice-bridge/server.js` | Two small additions: dispatch `/tts-flash-stream` and register the `/tts-flash-*` HTTP routes. |
| `app/api/voice/vobiz/tts-flash-xml/route.ts` | Vobiz answer webhook → returns `<Stream>` XML pointing at `/tts-flash-stream`. Separate from the Live XML route so production cannot be affected. |
| `app/api/voice/tts-flash/call/route.ts` | Creates the lead, pre-warms the bridge, then dials. |
| `app/api/voice/tts-flash/status/route.ts` | Live status, transcript, latency profile, recent calls, bridge health. |
| `app/api/voice/tts-flash/voice/route.ts` | Voice design (`POST /v1beta/voices`) + list stored voices. |
| `app/api/voice/tts-flash/preview/route.ts` | Renders a line with the designed voice for browser audition. |
| `app/dashboard/gemini-tts-flash-demo/page.tsx` | The demo UI. |
| `utils/tts-flash-config.ts` | Shared models, languages, voice presets, greeting templates, script stages. |
| `utils/vobiz-helper.ts` | Added `answerPath` / `answerParams` / `skipBridgeWarmup` so a call can be answered by a different pipeline. |

---

## The designed (polyglot) voice

`gemini-3.8-flash-tts` supports **Voice design**: `POST /v1beta/voices` with
`type: "prompted"` creates a persistent persona and returns a `voice_...` id
(stored on the project, 1-year TTL, 200 per project). That id is then passed to
every synthesis request as `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`.

This is what makes the voice polyglot: permanence lives in the design prompt
(age, timbre, accent, language range), **not** in per-turn styling. The persona
created for this demo is stored as `TTS_FLASH_VOICE_ID` (`voice_rfag7y46pcq0`),
and the page can design new ones on the fly.

Two things worth knowing from probing the API:

* Style instructions placed in the request body are **read out loud** — the TTS
  model speaks whatever text it receives. Never put direction in the content.
* `systemInstruction` is rejected for the TTS model (`Developer instruction is
  not enabled for this model`). Direction has to live in the designed voice, or
  in `<short pause>` / `<laugh>` style tags inside the spoken text.

### Gender agreement

Hindi, Punjabi, Marathi and Urdu conjugate the first-person verb by the
speaker's gender, so a male persona saying "main … bol rahi hoon" is an
immediate tell. The agent's gender is therefore a first-class field:

* the demo passes `gender` (`female` | `male`) into the lead's `custom_fields`,
  the prewarm call and the WebSocket URL;
* the opener templates have gendered variants per language
  (`bol raha hoon` / `bol rahi hoon`, `बोल रहा हूँ` / `बोल रही हूँ`,
  `ਬੋਲ ਰਿਹਾ ਹਾਂ` / `ਬੋਲ ਰਹੀ ਹਾਂ`, `बोलतोय` / `बोलतेय`); Tamil, Telugu, Bengali,
  Kannada and English are gender-neutral;
* the LLM system prompt states the persona's gender and enumerates the
  masculine/feminine first-person forms it must use, because the model
  otherwise drifts to the feminine default.

`node scratch/gender-test.js` checks both halves — the templates *and* what the
model actually generates on a later turn.

---

## How the industry builds this pipeline (and where we stand)

Researched against [LiveKit Agents turn-handling docs](https://docs.livekit.io/agents/logic/turns/tuning/),
[LiveKit's turn-detection writeup](https://livekit.com/blog/turn-detection-voice-agents-vad-endpointing-model-based-detection),
[Retell's pipeline explainer](https://www.retellai.com/blog/how-real-time-voice-ai-works-stt-llm-tts)
and [Bolna's latency docs](https://www.bolna.ai/docs/concepts/latency).

Headline numbers the top platforms work to:

* **Retell: ~600ms end-to-end**, and "above ~700ms it stops feeling human".
* **Bolna: sub-600ms target**, broken down as endpointing 50-300 + STT 50-150 +
  LLM TTFT 100-400 + TTS first chunk 80-200.
* Retell is explicit that the latency **is not in STT or TTS — it is in
  turn-taking and LLM time-to-first-token.**

| Stage | Industry practice | Ours | Status |
| --- | --- | --- | --- |
| Streaming | every stage streams into the next; nothing waits for "finished" | STT partials → LLM tokens → TTS chunks, all streamed | ✅ |
| STT | streaming/WebSocket ASR, partials every ~50-150ms, final 50-150ms after endpoint | `gemini-3.5-transcribe-live`, interim complete **+67ms** after speech | ✅ |
| Endpointing | layered: VAD → transcript-level endpointing → optional **model-based** turn detector; LiveKit default 500ms silence, overridden semantically | energy VAD, fixed 280ms | ⚠️ no semantic/model layer |
| Preemptive generation | **on by default** in LiveKit — LLM (optionally TTS) starts before the turn is confirmed | LLM starts on the streaming interim, verified against accurate STT before audio | ✅ equivalent |
| Interruption | adaptive: ~500ms of user speech (LiveKit), VAD hangover not a raw energy spike | 13 accumulated voiced frames (~260ms) with 250ms hangover | ✅ now aligned |
| History on barge-in | truncate the assistant's message to what was actually played | only fully-played clauses are committed | ✅ fixed |
| Noise handling | dedicated VAD + noise suppression / voice isolation (Silero, ai-coustics) before detection | crude RMS gate | ❌ gap |
| TTS transport | persistent WebSocket, 80-200ms first chunk (ElevenLabs Turbo / Cartesia) | Gemini REST SSE, ~700ms first chunk | ❌ floor |
| LLM | small fast model, short prompt, no reasoning tokens, Groq/Cerebras where possible | `gemini-2.5-flash`, thinkingBudget 0, one-sentence turns | ✅ |

### The two remaining gaps, honestly

1. **TTS transport (~700ms vs 80-200ms).** Gemini 3.8 Flash TTS is a generative
   REST model, not a real-time TTS socket — and the Live models reject the
   designed voice outright (`1007 Replicated voice is not supported`). This is
   the single biggest remaining cost and it is a property of the chosen voice.
2. **Model-based turn detection.** LiveKit/AI-Coustics/Silero run a small
   classifier over the partial transcript to end turns semantically instead of
   waiting for silence. We approximate it with (a) the streaming interim that is
   already complete at the endpoint and (b) a length/digit comparison that
   regenerates the reply if the accurate pass disagrees. A real turn-detector
   model (or `onnxruntime` + Silero VAD) is the next structural upgrade, and it
   would also let the endpoint drop from 280ms toward 150ms safely.

## How the latency is kept near-minimum

**Measured on real calls** (caller stops talking → agent audio starts):

```
endpoint 280ms  →  STT ~0ms  →  LLM 320-430ms  →  TTS ~700ms   ≈ 1.33-1.40s
```

| Technique | What it saves |
| --- | --- |
| **`gemini-3.5-transcribe-live` streaming STT** — one WebSocket per call, listening continuously. Measured: last speech frame → interim containing the **complete sentence at +67ms** (the *final* is slow at +1788ms, so the turn consumes the interim the moment our VAD endpoints) | removes the entire 600-900ms batch-STT hop |
| **Pre-warmed greeting AND context** — opener synthesized and call context loaded before the phone is answered | greeting speaks **0.18-0.28s** after pickup (was 1.08s) |
| **Prime-then-pace outbound audio** — ~150ms pushed instantly, then realtime 20ms frames | no carrier backlog; `speakUntil` matches what the caller hears, which is what makes barge-in arm correctly |
| **Streaming TTS** (`streamGenerateContent`, headerless `audio/l16`) with the **first clause cut at 4-5 words** | TTS TTFB scales a little with text length; smaller first chunk, earlier sound |
| **`gemini-2.5-flash`** (thinkingBudget 0) | measured ~500ms faster to first token than 3.1-flash-lite; `gemini-3.5-flash-lite` measured identical (956 vs 960ms) |
| **Barge-in** — sustained caller voice flushes our queue + carrier buffer and bumps a generation token | interruption at any point |
| **Idle nudge** (11s) + **turn watchdog** (6.5s) | the line can never sit mute |
| **Google Cloud STT `telephony`** and **Gemini ASR** | fallbacks when the streaming session is not ready |

The backchannel masker ("haan ji"/"hmm") exists but is **off by default**
(`TTS_FLASH_FILLER=1` re-enables): at ~1.3s turns it read as a repetitive tic.

### Model choices, measured (not assumed)

| Candidate | Result |
| --- | --- |
| `gemini-3.8-flash-lite-tts` instead of `gemini-3.8-flash-tts` | no gain: 1140-1505ms vs 1406-1426ms TTFB — within noise |
| `gemini-3.5-flash-lite` instead of `gemini-2.5-flash` | no gain: 956ms vs 960ms TTFT (and it rejects `thinkingBudget: 0`) |
| `gemini-3.5-transcribe` (batch) instead of the live one | 1.3-2.3s — the live model is the whole point |
| Google Cloud STT sync `recognize` | 1.3-1.4s vs 2.0-2.3s for Gemini ASR (still far slower than streaming) |

### Audio cleanliness (this was a real bug)

The caller heard "network noise". It was not the network — it was two things in
this file, both now fixed and measured on captured outbound PCM:

1. **Clause stitching dumped dead air mid-sentence.** Every `gemini-3.8-flash-tts`
   render arrives with **220-260ms of lead silence** and **300-340ms of tail
   silence**. Because replies are split into clauses for latency, concatenating
   them raw injected ~0.5s of silence at *every seam* — a 3-clause reply carried
   **1,640ms of silence inside one sentence**, heard as a drop-out. A streaming
   `createSilenceGate()` now strips lead silence (keeping 40ms) and trims tails to
   60ms while passing real interior pauses through.

2. **24k→16k conversion aliased.** Plain linear interpolation folded everything
   above 8kHz back into the audible band. Now a 15-tap windowed-sinc low-pass runs
   before decimation.

Measured on the same capture path (`scratch/audio-quality.js`):

```
                      before      after
silence inside speech  4.42s (29%)  2.72s (23%)
pauses >=100ms         13           8
HF hash (aliasing)     0.1007       0.0833
clipping               0 samples    0 samples
```

### Why not the Live API

Measured against this pipeline's biggest selling point — the **designed voice**:

```
gemini-3.8-live          + voice_rfag7y46pcq0 → 1007 "Replicated voice is not supported for this model"
gemini-3.8-live          + Kore               → setup accepted
gemini-2.5-native-audio  + voice_rfag7y46pcq0 → 1007 same rejection
gemini-2.5-native-audio  + Kore               → setup accepted
```

The Live models accept **only prebuilt voices**. Moving to Live would trade the
prompted polyglot persona (age, timbre, accent, language range) for a fixed
prebuilt voice — which is exactly what made this pipeline sound human. That is
the concrete reason this pipeline does not use Live, independent of latency.

### What is on the critical path (measured, this project)

```
caller stops ──280 ms──▶ transcript already in hand (streaming interim)
            ──~350 ms──▶ first LLM token ──~700 ms──▶ first agent audio
```

Per-turn numbers are persisted with the call (`metrics.turns[]`: `asr_ms`,
`stt`, `llm_ttfb_ms`, `first_audio_ms`, `total_ms`) and shown on the demo page.

The remaining cost is **Gemini TTS time-to-first-audio (~700ms)**, which is a
property of the model, not of this code. Only a low-TTFB streaming TTS
(ElevenLabs Turbo / Cartesia, 80-200ms) would go lower — at the cost of the
designed voice.

### Industry references these choices follow

* Netguru — *[Real-time voice AI low-latency techniques that work](https://www.netguru.com/blog/voice-ai-low-latency-techniques)* (streaming ASR, chunked TTS, masking).
* *[Toward Low-Latency End-to-End Voice Agents for Telecommunications Using Streaming ASR, Quantized LLMs, and Real-Time TTS](https://browse-export.arxiv.org/pdf/2508.04721)* (arXiv 2508.04721).
* Google — *[Speech generation (Gemini TTS)](https://ai.google.dev/gemini-api/docs/speech-generation)* and *[Voice design](https://ai.google.dev/gemini-api/docs/voice-design)*.
* *[Realtime voice agents — ai-system-design-guide](https://github.com/ombharatiya/ai-system-design-guide/blob/main/18-voice-and-audio-agents/01-realtime-voice-agents.md)* (turn detection, interruption handling, perceived-latency budgets).

### What is on the critical path (measured, this project)

```
caller stops ──280 ms──▶ STT request ──~0.6-0.9 s──▶ transcript
            ──~0.4-0.6 s──▶ first LLM token ──~0.7-0.9 s──▶ first agent audio
```

Per-turn numbers are persisted with the call (`metrics.turns[]`:
`asr_ms`, `llm_ttfb_ms`, `first_audio_ms`, `total_ms`) and shown on the demo
page, so any change here is measurable rather than anecdotal.

---

## Environment

```
TTS_FLASH_VOICE_ID=voice_rfag7y46pcq0     # designed voice (auto-designed if unset)
TTS_FLASH_TTS_MODEL=gemini-3.8-flash-tts
TTS_FLASH_ASR_MODEL=gemini-3.1-flash-lite
TTS_FLASH_LLM_MODEL=gemini-3.1-flash-lite
TTS_FLASH_ENDPOINT_SILENCE_MS=420         # trailing silence that ends a turn
TTS_FLASH_FILLER=1                        # backchannel latency masker
TTS_FLASH_MAX_CALL_SEC=480
TTS_FLASH_BRIDGE_URL=                     # optional: point the demo at a separate bridge
TTS_FLASH_XML_ON=bridge                   # "bridge" (default) or "app" for the Next answer route
```

## Testing, in order of effort

**1. Audition the voice (no deploy, works on a local dev server).**
Open `/dashboard/gemini-tts-flash-demo` and press *Audition*. That route calls
Gemini straight from Next.js, so the voice, the greeting preview and the voice
designer work before the bridge is deployed. The bridge badge will be red —
expected.

**2. Prove the full loop without a phone.**
```bash
node scratch/bridge-e2e-test2.js
```
Fakes the carrier's media stream: prints the STT transcript, the agent's reply
and caller-stop → first-audio latency.

**3. Place a real call.**
Only the bridge needs to be deployed — it serves its own answer webhook
(`/tts-flash-xml`), so the web app does *not* have to ship to production first.

```cmd
cd voice-bridge
deploy.bat
```

Verify, then dial your own number from the page:

```bash
curl https://<bridge-host>/tts-flash-health
# {"ok":true,"pipeline":"gemini-tts-flash", ...}
```

To test against a separate bridge without touching the one production calling
uses, deploy a second service from the same image. This is what the demo is
currently wired to (`TTS_FLASH_BRIDGE_URL_FALLBACK` in `utils/app-url.ts`):

```cmd
cd voice-bridge
gcloud builds submit --tag gcr.io/<project>/gemini-voice-bridge-tts
gcloud run deploy gemini-voice-bridge-tts ^
  --image gcr.io/<project>/gemini-voice-bridge-tts ^
  --platform managed --region us-central1 --allow-unauthenticated ^
  --port 8080 --timeout 3600 --concurrency 4 ^
  --min-instances 0 --max-instances 3 ^
  --memory 1Gi --cpu 1 --cpu-boost ^
  --session-affinity --no-cpu-throttling ^
  --env-vars-file <env.yaml>
```

Live service: `https://gemini-voice-bridge-tts-ikqeb7h3zq-uc.a.run.app`.
It runs with `--min-instances 0` to keep cost near zero; the first call after a
long idle pays a ~2–4 s cold start (the greeting then falls back to live
generation instead of the pre-rendered take). Make it always hot with:

```bash
gcloud run services update gemini-voice-bridge-tts --region us-central1 --min-instances 1
```

`voice-bridge/Dockerfile` must copy `tts-flash-pipeline.js` — it did not before
this pipeline existed, and the service would have booted without it.

## Deploying

The pipeline runs inside the **voice bridge**, which is a separate Cloud Run
service. The Next.js routes work immediately, but the demo will show
`Bridge unreachable` until the bridge is redeployed:

```cmd
cd voice-bridge
deploy.bat
```

Confirm with:

```bash
curl https://<bridge-host>/tts-flash-health
# {"ok":true,"pipeline":"gemini-tts-flash","models":{...},"voiceId":"voice_...","hasApiKey":true}
```

## Testing without a phone call

Both scripts fake the carrier's media stream, so the full chain runs offline:

```bash
node scratch/bridge-e2e-test.js    # prewarm → greeting → caller speech → reply → barge-in
node scratch/bridge-e2e-test2.js   # one clean turn, prints caller-stop → first-audio latency
```

They cover exactly what a real call does: audio frames in, `playAudio` frames
out, `clearAudio` on interruption, transcript + summary persisted at the end.
