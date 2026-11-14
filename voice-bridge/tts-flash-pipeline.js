'use strict'

/**
 * ============================================================================
 *  GEMINI TTS-FLASH VOICE PIPELINE  (no Gemini Live API anywhere)
 * ============================================================================
 *
 *  Telephony (Vobiz)  <-->  THIS BRIDGE  <-->  Gemini REST APIs
 *
 *      Vobiz media stream        STT        LLM (text)        TTS (flash)
 *      ──────────────────        ───        ──────────        ───────────
 *      audio/x-l16 @16k    →  Gemini      → Gemini         → Gemini
 *      base64 in JSON         flash-lite    flash-lite       3.8-flash-tts
 *                             generateContent streamGenerate  streamGenerate
 *                                                                 (designed voice)
 *
 *  Why this beats a naive "record → transcribe → answer → synthesize" loop,
 *  and where each millisecond goes:
 *
 *   1. PRE-WARM WHILE THE PHONE IS RINGING
 *      The greeting is fully synthesized before the callee picks up, and the
 *      first-turn context + model connections are warmed. The callee therefore
 *      hears the opener ~50ms after "hello" instead of ~1.3s.
 *
 *   2. CONTINUOUS STREAMING TTS, NOT BATCH TTS
 *      `streamGenerateContent` on gemini-3.8-flash-tts returns headerless
 *      audio/l16 24kHz chunks (TTFB ≈ 1.0-1.2s, then ~2.5x realtime). We
 *      resample 24k→16k and forward each chunk to the carrier the moment it
 *      arrives. No WAV to wait for, no file to download.
 *
 *   3. CLAUSE-LEVEL PIPELINING
 *      The LLM token stream is split into clauses; clause N+1 starts
 *      synthesizing while clause N is still playing. Only the FIRST clause
 *      TTFB is on the critical path, so a 3-clause answer costs one TTFB, not
 *      three.
 *
 *   4. SPECULATIVE ENDPOINTING WITH ROLLBACK
 *      A short silence (default 420ms) is treated as "probably done" and the
 *      ASR request is fired immediately, while the VAD keeps listening. If the
 *      caller carries on, the in-flight speculation is discarded and the
 *      transcript window extended. This hides ~400ms of the ASR window.
 *
 *   5. LATENCY MASKING
 *      If no agent audio has been sent within 500ms of the caller finishing,
 *      a pre-rendered backchannel ("hmm", "haan ji") is played. Callers
 *      perceive responsiveness, not silence.
 *
 *   6. THINKING DISABLED ON THE LIVE PATH
 *      thinkingBudget:0 on both the ASR and LLM calls. Reasoning tokens are
 *      pure latency on a phone call.
 *
 *   7. BARGE-IN
 *      Caller speech above a barge-in threshold during agent playout clears
 *      the carrier buffer (`clearAudio`), bumps a generation token so every
 *      in-flight TTS stream is discarded, and starts the next turn at once.
 *
 *  Audio contract (identical to the existing Live bridge, so carrier settings
 *  do not change):
 *    in  : { event:'media',     media:{ payload: base64(l16 16k mono) } }
 *    out : { event:'playAudio', streamId, media:{ contentType:'audio/x-l16',
 *                                                sampleRate:16000, payload } }
 *    stop: { event:'clearAudio', streamId }
 */

const fs = require('fs')
const path = require('path')
const ws = require('ws')
const { createClient } = require('@supabase/supabase-js')

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'

const CFG = {
    ttsModel: process.env.TTS_FLASH_TTS_MODEL || 'gemini-3.8-flash-tts',
    asrModel: process.env.TTS_FLASH_ASR_MODEL || 'gemini-3.1-flash-lite',
    // 2.5-flash measured ~500ms faster to first token than 3.1-flash-lite on
    // the same prompt (926ms vs 1423ms median) with cleaner output — on a phone
    // call that is a real chunk of the turn.
    llmModel: process.env.TTS_FLASH_LLM_MODEL || 'gemini-2.5-flash',
    voiceId: process.env.TTS_FLASH_VOICE_ID || '',
    // Endpointing: how much trailing silence ends a caller turn. 320ms keeps
    // turns snappy; raise it if callers who pause mid-sentence get cut off.
    endpointSilenceMs: Number(process.env.TTS_FLASH_ENDPOINT_SILENCE_MS || 280),
    minSpeechMs: Number(process.env.TTS_FLASH_MIN_SPEECH_MS || 280),
    // VAD thresholds on 16-bit PCM RMS. Ambient telephony hiss sits at 40-180,
    // speech at 1500+, so the voice gate is 260.
    voiceThreshold: Number(process.env.TTS_FLASH_VOICE_RMS || 260),
    // Interruption confirmation. LiveKit ships ~500ms of adaptive interruption by
    // default; 160ms of raw energy was twitchy enough to be cut off by line noise
    // and our own echo. 250ms still feels instant to the caller.
    bargeInRms: Number(process.env.TTS_FLASH_BARGEIN_RMS || 900),
    bargeInFrames: Number(process.env.TTS_FLASH_BARGEIN_FRAMES || 13),
    // Backchannel masker ("haan ji" / "hmm"). OFF by default: once first-audio
    // latency was cut to ~300ms the masker was pure noise, and callers found the
    // repeated "haan ji / samajh gaya" worse than a short silence.
    fillerEnabled: process.env.TTS_FLASH_FILLER === '1',
    fillerDelayMs: Number(process.env.TTS_FLASH_FILLER_DELAY_MS || 280),
    // How much audio to push the instant we have any, so the carrier starts
    // playing immediately instead of waiting for our pacing clock to buffer.
    primeMs: Number(process.env.TTS_FLASH_PRIME_MS || 150),
    // Re-engage the caller after this much total silence, and give up after N.
    idleNudgeMs: Number(process.env.TTS_FLASH_IDLE_NUDGE_MS || 11000),
    maxNudges: Number(process.env.TTS_FLASH_MAX_NUDGES || 2),
    // Live streaming transcription (gemini-3.5-transcribe-live). This is what
    // removes the STT hop from the turn; disable only for debugging.
    streamingStt: process.env.TTS_FLASH_STREAMING_STT !== '0',
    // How long to wait at the endpoint for an interim that covers the END of the
    // utterance. Consuming an earlier one truncates the sentence.
    sttSettleMs: Number(process.env.TTS_FLASH_STT_SETTLE_MS || 360),
    // Window in which an identical transcript is treated as a repeat rather than
    // a new turn.
    sttRepeatWindowMs: Number(process.env.TTS_FLASH_STT_REPEAT_MS || 9000),
    // Hedged TTS: if the first clause produces no audio in this long, fire a
    // duplicate request and keep whichever answers first. Kills the 2.5-3s tail
    // seen on real calls without changing the median.
    ttsHedgeMs: Number(process.env.TTS_FLASH_TTS_HEDGE_MS || 650),
    maxCallSec: Number(process.env.TTS_FLASH_MAX_CALL_SEC || 480),
    maxClausesInFlight: 3,
}

const apiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || ''

let supabaseAdmin = null
function supabase() {
    if (!supabaseAdmin) {
        supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://hpssqssdewmkmafxlfud.supabase.co',
            process.env.SUPABASE_SERVICE_ROLE_KEY || '',
            { auth: { persistSession: false }, realtime: { transport: ws } }
        )
    }
    return supabaseAdmin
}

const log = (...a) => console.log('[TTS-FLASH]', ...a)
const warn = (...a) => console.warn('[TTS-FLASH]', ...a)

// ---------------------------------------------------------------------------
// Audio helpers  (all telephony audio is Int16 PCM)
// ---------------------------------------------------------------------------

function rms(int16) {
    if (!int16 || !int16.length) return 0
    let sum = 0
    // Stride sampling keeps this cheap per 20ms frame.
    const step = int16.length > 480 ? 4 : 1
    let n = 0
    for (let i = 0; i < int16.length; i += step) {
        const v = int16[i]
        sum += v * v
        n++
    }
    return Math.sqrt(sum / n)
}

function base64ToInt16(b64) {
    const buf = Buffer.from(b64, 'base64')
    return new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2))
}

function int16ToBuffer(int16) {
    return Buffer.from(int16.buffer, int16.byteOffset, int16.byteLength)
}

/**
 * Gemini TTS emits 24kHz; the carrier stream is 16kHz mono l16.
 *
 * Low-pass BEFORE decimating: 24k→16k by plain interpolation leaves everything
 * above 8kHz folded back into the audible band, which is measurable as extra
 * high-frequency hash (3-19% more) and audible as roughness on a phone line.
 * A 15-tap windowed-sinc FIR at ~7.2kHz costs nothing (360k MAC/s) and removes it.
 */
const AA_TAPS = 15
const AA_KERNEL = (() => {
    const fc = 7200 / 24000
    const h = new Float64Array(AA_TAPS)
    let sum = 0
    for (let i = 0; i < AA_TAPS; i++) {
        const n = i - (AA_TAPS - 1) / 2
        const sinc = n === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * n) / (Math.PI * n)
        const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (AA_TAPS - 1)) // Hamming
        h[i] = sinc * w
        sum += h[i]
    }
    for (let i = 0; i < AA_TAPS; i++) h[i] /= sum
    return h
})()

function downsample24kTo16k(pcm24) {
    const out = new Int16Array(Math.floor(pcm24.length * 2 / 3))
    const half = (AA_TAPS - 1) / 2
    for (let i = 0; i < out.length; i++) {
        const src = i * 1.5
        const i0 = Math.round(src)
        let acc = 0
        for (let k = 0; k < AA_TAPS; k++) {
            const idx = i0 + k - half
            const v = idx >= 0 && idx < pcm24.length ? pcm24[idx] : 0
            acc += AA_KERNEL[k] * v
        }
        out[i] = acc > 32767 ? 32767 : acc < -32768 ? -32768 : acc | 0
    }
    return out
}

/** Carrier stream is 16kHz; ASR only needs 8kHz. */
function downsample16kTo8k(pcm16) {
    const out = new Int16Array(Math.floor(pcm16.length / 2))
    for (let i = 0; i < out.length; i++) {
        const a = pcm16[i * 2] || 0
        const b = pcm16[i * 2 + 1] || a
        out[i] = (a + b) >> 1
    }
    return out
}

function concatInt16(chunks) {
    let total = 0
    for (const c of chunks) total += c.length
    const out = new Int16Array(total)
    let off = 0
    for (const c of chunks) { out.set(c, off); off += c.length }
    return out
}

/**
 * Streaming silence gate for one TTS clause.
 *
 * Every TTS render arrives with 220-260ms of LEAD silence and 300-340ms of TAIL
 * silence. Concatenating clauses raw therefore dumped ~0.5s of dead air at every
 * seam — a 3-clause reply measured 1640ms of silence inside a single sentence,
 * which on a phone line is heard as a drop-out / "static".
 *
 * This re-frames the stream to 20ms and:
 *   • drops leading silence (keeping ~40ms so the first phoneme isn't clipped),
 *   • trims trailing silence to ~60ms,
 *   • passes interior pauses through (those are real prosody).
 */
function createSilenceGate(opts = {}) {
    const FRAME = 320 // 20ms @ 16k
    const silenceRms = opts.silenceRms || 200
    const leadPad = Math.ceil((opts.leadPadMs ?? 40) / 20)
    const tailPadMs = opts.tailPadMs ?? 60

    let pending = new Int16Array(0)
    let started = false
    let leadRing = []
    let tailHold = []

    const frameRms = (f) => {
        let s = 0
        for (let i = 0; i < f.length; i++) s += f[i] * f[i]
        return Math.sqrt(s / f.length)
    }

    return {
        push(pcm16) {
            const out = []
            const buf = new Int16Array(pending.length + pcm16.length)
            buf.set(pending, 0)
            buf.set(pcm16, pending.length)

            let off = 0
            while (off + FRAME <= buf.length) {
                const frame = buf.subarray(off, off + FRAME)
                off += FRAME
                const loud = frameRms(frame) >= silenceRms

                if (!started) {
                    if (!loud) {
                        leadRing.push(Int16Array.from(frame))
                        if (leadRing.length > leadPad + 1) leadRing.shift()
                        continue
                    }
                    started = true
                    for (const f of leadRing) out.push(f)
                    leadRing = []
                    out.push(Int16Array.from(frame))
                    continue
                }

                if (loud) {
                    for (const f of tailHold) out.push(f)
                    tailHold = []
                    out.push(Int16Array.from(frame))
                } else {
                    tailHold.push(Int16Array.from(frame))
                    if (tailHold.length * 20 > 240) out.push(tailHold.shift())
                }
            }
            pending = Int16Array.from(buf.subarray(off))
            return out
        },

        /** End of clause: keep only a short tail so the next clause joins cleanly. */
        flush() {
            const out = []
            if (!started) { pending = new Int16Array(0); return out }
            const keep = Math.ceil(tailPadMs / 20)
            for (const f of tailHold.slice(0, keep)) out.push(f)
            tailHold = []
            pending = new Int16Array(0)
            return out
        },
    }
}

/** Trim leading/trailing low-energy audio so the ASR payload stays minimal. */
function trimSilence(pcm16, threshold = 140, padMs = 120) {
    const frame = 320 // 20ms
    const pad = Math.floor(padMs / 20)
    const frames = Math.ceil(pcm16.length / frame)
    let first = -1
    let last = -1
    for (let f = 0; f < frames; f++) {
        const slice = pcm16.subarray(f * frame, Math.min((f + 1) * frame, pcm16.length))
        if (rms(slice) >= threshold) {
            if (first < 0) first = f
            last = f
        }
    }
    if (first < 0) return pcm16
    const from = Math.max(0, first - pad) * frame
    const to = Math.min(pcm16.length, (last + 1 + pad) * frame)
    return pcm16.subarray(from, to)
}

// ---------------------------------------------------------------------------
// Prepared telephony clips (latency maskers) — reused from audio-assets/
// ---------------------------------------------------------------------------

const clipCache = new Map()

function loadClip(name, rate) {
    const key = `${name}_${rate}`
    if (clipCache.has(key)) return clipCache.get(key)
    // Files on disk are named *_24k.pcm (see audio-assets/), not *_24000.pcm —
    // getting this wrong made every masker lookup return null, which is why the
    // line felt dead for ~2.5s after the caller stopped speaking.
    const rateTag = rate === 24000 ? '24k' : String(rate)
    const candidates = [
        path.join(__dirname, 'audio-assets', `${name}_${rateTag}.pcm`),
        path.join(__dirname, 'audio-assets', `${name}_${rate}.pcm`),
        path.join(__dirname, 'audio-assets', `${name}.pcm`),
    ]
    for (const file of candidates) {
        try {
            const buf = fs.readFileSync(file)
            const raw = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2))
            const pcm16 = rate === 24000 ? downsample24kTo16k(raw) : raw
            clipCache.set(key, pcm16)
            log(`Clip loaded: ${path.basename(file)} (${(pcm16.length / 16000).toFixed(2)}s @16k)`)
            return pcm16
        } catch { /* try next */ }
    }
    warn(`Clip missing: ${name} (looked for ${name}_${rateTag}.pcm)`)
    clipCache.set(key, null)
    return null
}

// ---------------------------------------------------------------------------
// Gemini streaming plumbing
// ---------------------------------------------------------------------------

/**
 * SSE reader over a Gemini streaming endpoint.
 *
 * A stalled upstream must never wedge a live call, so the stream is aborted if
 * no chunk arrives for `stallMs` (and optionally when an external signal fires).
 */
async function* streamSSE(url, body, { signal, stallMs = 15000 } = {}) {
    const controller = new AbortController()
    let stallTimer = null
    const abort = (reason) => {
        try { controller.abort(reason) } catch { }
    }
    const bumpStall = () => {
        if (!stallMs) return
        if (stallTimer) clearTimeout(stallTimer)
        stallTimer = setTimeout(() => abort(new Error(`upstream stalled > ${stallMs}ms`)), stallMs)
    }
    const onExternalAbort = () => abort(new Error('aborted'))
    if (signal) {
        if (signal.aborted) abort(new Error('aborted'))
        else signal.addEventListener('abort', onExternalAbort)
    }

    try {
        bumpStall()
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'x-goog-api-key': apiKey(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        })
        if (!res.ok) {
            const text = await res.text().catch(() => '')
            throw new Error(`Gemini ${res.status}: ${text.replace(/\s+/g, ' ').slice(0, 300)}`)
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            bumpStall()
            buffer += decoder.decode(value, { stream: true })
            let idx
            while ((idx = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, idx).trim()
                buffer = buffer.slice(idx + 1)
                if (!line.startsWith('data:')) continue
                const payload = line.slice(5).trim()
                if (!payload || payload === '[DONE]') continue
                try { yield JSON.parse(payload) } catch { /* partial frame */ }
            }
        }
    } finally {
        if (stallTimer) clearTimeout(stallTimer)
        if (signal) signal.removeEventListener('abort', onExternalAbort)
    }
}

/** Non-streaming Gemini call with a hard timeout. */
async function geminiJson(path, body, timeoutMs = 20000) {
    const res = await fetch(`${GEMINI_BASE}${path}`, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`Gemini ${res.status}: ${text.replace(/\s+/g, ' ').slice(0, 300)}`)
    }
    return res.json()
}

function audioPartOf(event) {
    const parts = event?.candidates?.[0]?.content?.parts
    if (!parts) return null
    for (const p of parts) if (p.inlineData?.data) return p.inlineData
    return null
}

function textPartOf(event) {
    const parts = event?.candidates?.[0]?.content?.parts
    if (!parts) return ''
    let out = ''
    for (const p of parts) if (typeof p.text === 'string') out += p.text
    return out
}

// ---------------------------------------------------------------------------
// Voice design  (POST /v1beta/voices — prompted, stored, reusable voice_... id)
// ---------------------------------------------------------------------------

/** Permanent vocal traits belong here, not in per-turn styling. */
const DEFAULT_VOICE_DESIGN =
    'A warm, confident Indian woman in her late twenties, a senior real estate consultant. ' +
    'Natural conversational pace, a friendly smile in the voice, crisp articulation, subtle ' +
    'north-Indian English accent, never announcer-like or robotic. Fully polyglot and equally ' +
    'fluent in Hindi, Hinglish, Punjabi, Tamil, Telugu, Marathi, Bengali, Kannada and English, ' +
    'switching between them mid-sentence without any accent break.'

let designedVoicePromise = null

async function createDesignedVoice(description = DEFAULT_VOICE_DESIGN, displayName = 'Nobo Real Estate Advisor') {
    const res = await fetch(`${GEMINI_BASE}/voices`, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
            store: true,
            voice: {
                model: CFG.ttsModel,
                type: 'prompted',
                display_name: displayName,
                gender: 'female',
                language_code: 'en-IN',
                prompted: { input: description },
            },
        }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.id) {
        throw new Error(`Voice design failed (${res.status}): ${JSON.stringify(json).slice(0, 250)}`)
    }
    log(`Designed voice ready: ${json.id} (${json.display_name})`)
    return { id: json.id, sampleAudio: json.sample_audio?.data || null, raw: json }
}

async function resolveVoiceId(preferred) {
    const explicit = preferred || CFG.voiceId
    if (explicit) return explicit
    if (!designedVoicePromise) {
        designedVoicePromise = createDesignedVoice().then(v => v.id).catch(err => {
            designedVoicePromise = null
            warn('Voice design failed, falling back to prebuilt Kore:', err.message)
            return 'Kore'
        })
    }
    return designedVoicePromise
}

// ---------------------------------------------------------------------------
// Speech text hygiene
// ---------------------------------------------------------------------------

/**
 * Pronunciation fixes applied only to the text handed to TTS.
 * "Nobogent" came out as "Novojent" on a real call, so brand names are respelled
 * phonetically for the synthesizer. Extend with TTS_FLASH_PRONOUNCE="Word=Re-spell,Other=..." .
 */
const PRONOUNCE = (() => {
    const map = [
        [/\bNobogent\b/gi, 'No bo gent'],
        [/\bBioque\b/gi, 'Bee oke'],
        [/\bGNR\b/g, 'G N R'],
    ]
    const extra = process.env.TTS_FLASH_PRONOUNCE || ''
    for (const pair of extra.split(',')) {
        const [from, to] = pair.split('=').map(s => (s || '').trim())
        if (from && to) map.push([new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), to])
    }
    return map
})()

const SPEAKABLE_SUBS = [
    [/[*_`#>|~^]+/g, ' '],
    [/₹\s?/g, ' rupees '],
    [/\bRs\.?\s?/gi, ' rupees '],
    [/\bAM\b/g, 'A M'],
    [/\bPM\b/g, 'P M'],
    [/\bBHK\b/gi, ' B H K '],
    [/&/g, ' and '],
    [/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ''],
    [/\s{2,}/g, ' '],
]

function speakable(text) {
    let out = String(text || '')
    for (const [re, rep] of PRONOUNCE) out = out.replace(re, rep)
    for (const [re, rep] of SPEAKABLE_SUBS) out = out.replace(re, rep)
    return out.trim()
}

/** Split an incrementally streamed LLM answer into speakable clauses. */
function splitClauses(text, flush) {
    const clauses = []
    let rest = String(text || '')
    const sentence = /[^.?!।؟…]+[.?!।؟…]+["')\]]?\s*/g
    let match
    let consumed = 0
    while ((match = sentence.exec(rest))) {
        const piece = match[0].trim()
        if (piece) clauses.push(piece)
        consumed = sentence.lastIndex
    }
    rest = rest.slice(consumed)

    // A long unfinished fragment still deserves an early TTS fire: cut at the
    // last comma before ~90 chars so the caller hears speech sooner.
    if (rest.length > 90) {
        const cut = rest.lastIndexOf(',', 90)
        if (cut > 25) {
            clauses.push(rest.slice(0, cut + 1).trim())
            rest = rest.slice(cut + 1)
        }
    }
    if (flush && rest.trim()) {
        clauses.push(rest.trim())
        rest = ''
    }
    return { clauses, rest }
}

const GOODBYE_HINT = /\b(bye|goodbye|good bye|see you|take care|have a (great|nice|good) day|thank you for your time|dhanyavaad|shukriya|alvida|rakh lenge|baat karte hain)\b/i

// ---------------------------------------------------------------------------
// Language + script
// ---------------------------------------------------------------------------

/**
 * Opening lines. Hindi/Punjabi/Marathi conjugate the verb by the speaker's
 * gender, so the agent persona must agree: "bol rahi hoon" for a female voice,
 * "bol raha hoon" for a male one. Tamil, Telugu, Bengali, Kannada and English
 * verb forms are gender-neutral.
 */
const GREETINGS = {
    hinglish: (p) =>
        `Hi ${p.name}, main ${p.agent} ${p.gender === 'male' ? 'bol raha hoon' : 'bol rahi hoon'} ${p.company} se. Aapne ${p.interest} ke liye enquiry ki thi na?`,
    english: (p) =>
        `Hello ${p.name}, this is ${p.agent} from ${p.company}. You had enquired about ${p.interest} — is now a good time?`,
    hindi: (p) =>
        `नमस्ते ${p.name}, मैं ${p.agent} ${p.gender === 'male' ? 'बोल रहा हूँ' : 'बोल रही हूँ'} ${p.company} से। आपने ${p.interest} के लिए पूछा था ना?`,
    punjabi: (p) =>
        `ਸਤ ਸ੍ਰੀ ਅਕਾਲ ${p.name}, ਮੈਂ ${p.agent} ${p.gender === 'male' ? 'ਬੋਲ ਰਿਹਾ ਹਾਂ' : 'ਬੋਲ ਰਹੀ ਹਾਂ'} ${p.company} ਤੋਂ। ਤੁਸੀਂ ${p.interest} ਲਈ ਪੁੱਛਿਆ ਸੀ?`,
    tamil: (p) =>
        `வணக்கம் ${p.name}, நான் ${p.company} இல் இருந்து ${p.agent} பேசுகிறேன். ${p.interest} பற்றி நீங்கள் விசாரித்தீர்களே?`,
    telugu: (p) =>
        `నమస్తే ${p.name}, నేను ${p.company} నుండి ${p.agent} మాట్లాడుతున్నాను. మీరు ${p.interest} గురించి అడిగారు కదా?`,
    marathi: (p) =>
        `नमस्कार ${p.name}, मी ${p.agent} ${p.gender === 'male' ? 'बोलतोय' : 'बोलतेय'} ${p.company} मधून. तुम्ही ${p.interest} साठी विचारणा केली होती ना?`,
    bengali: (p) =>
        `নমস্কার ${p.name}, আমি ${p.company} থেকে ${p.agent} বলছি। আপনি ${p.interest} সম্পর্কে জিজ্ঞাসা করেছিলেন?`,
    kannada: (p) =>
        `ನಮಸ್ಕಾರ ${p.name}, ನಾನು ${p.company} ನಿಂದ ${p.agent} ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ. ನೀವು ${p.interest} ಬಗ್ಗೆ ವಿಚಾರಿಸಿದ್ದೀರಿ?`,
}

/** "Rahul Sharma" -> "Rahul ji"; missing name -> a neutral respectful address. */
function respectfulName(name) {
    const clean = String(name || '').trim()
    if (!clean || clean === 'ji') return 'ji'
    // Use the first name on a phone call — full names sound like a form letter.
    const first = clean.split(/\s+/)[0]
    return `${first} ji`
}

const LANGUAGES = Object.keys(GREETINGS)

const LANGUAGE_LABELS = {
    hinglish: 'Hinglish (Hindi + English mixed, Roman script)',
    english: 'English',
    hindi: 'Hindi',
    punjabi: 'Punjabi',
    tamil: 'Tamil',
    telugu: 'Telugu',
    marathi: 'Marathi',
    bengali: 'Bengali',
    kannada: 'Kannada',
}

function buildGreeting(ctx) {
    const lang = LANGUAGES.includes(ctx.language) ? ctx.language : 'hinglish'
    const template = GREETINGS[lang] || GREETINGS.hinglish
    return template({
        name: respectfulName(ctx.prospectName),
        agent: ctx.agentName,
        company: ctx.company,
        interest: ctx.reason,
        gender: ctx.gender,
    })
}

/** Gender agreement rules for the LLM, per language group. */
function genderRule(gender, prospectName) {
    const who = String(prospectName || 'the caller').split(/\s+/)[0]
    const self = gender === 'male'
        ? `You are a MAN. In gendered languages always use MASCULINE first-person forms for yourself:
   Hindi/Hinglish — "main bol raha hoon", "main kar sakta hoon", "main batata hoon", "main aa gaya"
   Punjabi — "main bol riha haan", "kar sakda haan"
   Marathi — "mi boltoy", "karu shakto"
   Urdu — "main bol raha hoon", "kar sakta hoon"
   Never use feminine self-reference (rahi hoon / sakti hoon / batati hoon / gayi).`
        : `You are a WOMAN. In gendered languages always use FEMININE first-person forms for yourself:
   Hindi/Hinglish — "main bol rahi hoon", "main kar sakti hoon", "main batati hoon", "main aa gayi"
   Punjabi — "main bol rahi haan", "kar sakdi haan"
   Marathi — "mi boltey", "karu shakte"
   Urdu — "main bol rahi hoon", "kar sakti hoon"
   Never use masculine self-reference (raha hoon / sakta hoon / batata hoon / gaya).`

    return `${self}
   IMPORTANT — the person you are calling is ${who}, most likely a MAN: address them with neutral polite-plural forms ("aap bataiye", "aap chahte hain", "aap kar sakte hain"). Never attach YOUR gender to the caller ("aap chahti hain" is wrong when you are female). Gendered forms apply to yourself only.`
}

function buildSystemPrompt(ctx) {
    const inventory = (ctx.inventory || []).length
        ? ctx.inventory
            .map((p, i) => `${i + 1}. ${p.title}${p.location ? ` — ${p.location}` : ''}${p.property_type ? ` (${p.property_type})` : ''}${p.price ? ` — ${p.price}` : ''}${p.configurations ? ` — ${p.configurations}` : ''}`)
            .join('\n')
        : 'No exact inventory match loaded — speak in terms of "a few options in that range" and offer to send details on WhatsApp.'

    return `You are ${ctx.agentName}, a warm senior real-estate consultant at ${ctx.company} (a ${ctx.gender === 'male' ? 'man in his mid-thirties' : 'woman in her late twenties'}), SPEAKING on a live outbound call to ${ctx.prospectName}.

WHY YOU CALLED: ${ctx.reason}. ${ctx.campaignNote ? `CONTEXT: ${ctx.campaignNote}` : ''}

RULES
- Speaking, not writing. ONE sentence, max 18 words, at most one question. One idea per turn.
- NEVER open with a filler acknowledgement ("Haan ji", "Bilkul", "Samajh gaya", "Theek hai", "Achha"). Go straight to substance.
- POLYGLOT: reply in exactly the language/mix the caller just used (English, Hindi, Hinglish, Punjabi, Tamil, Telugu, Marathi, Bengali, Kannada…). Never ask them to switch.
- LOCK ONTO THE CALLER, NOT THE OPENER: your greeting may have been in a different language (e.g. Punjabi) than the caller actually speaks. From your second turn onward you MUST mirror the caller's latest message — if they answer in Hindi or Hinglish, switch to Hindi/Hinglish at once and stay there. Replying to a Hindi caller in Punjabi is a failure.
- GENDER: ${genderRule(ctx.gender, ctx.prospectName)}
- Money in words ("sixty lakh", "one point nine crore"), never digits or "₹".
- Never re-ask what the caller already told you. Never claim to be human.
- If they ask if you are an AI, say warmly that you are ${ctx.company}'s AI assistant and a human advisor can call right after.

OBJECTIVE — move one step per turn, only when natural:
1 confirm the person → 2 qualify (config, location, budget, timeline, loan) → 3 pitch ONE matching option with one benefit → 4 handle objections in one line → 5 book a site visit with two concrete slots → 6 confirm name, number, slot, then thank them.
If they are not interested, accept it gracefully in one line.

INVENTORY (never invent prices):
${inventory}

END: when the call is done, say one warm goodbye line beginning with [END]. Use [END] only on your final line.
Language if they have not spoken yet: ${LANGUAGE_LABELS[ctx.language] || 'Hinglish'}. ${ctx.instruction ? `SALES TEAM NOTE: ${ctx.instruction}` : ''}`
}

// ---------------------------------------------------------------------------
// Gemini operations
// ---------------------------------------------------------------------------

async function streamTts(text, voiceId, onAudio, isCancelled) {
    const body = {
        contents: [{ role: 'user', parts: [{ text: speakable(text) }] }],
        generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceId } } },
        },
    }
    const url = `${GEMINI_BASE}/models/${CFG.ttsModel}:streamGenerateContent?alt=sse`
    for await (const event of streamSSE(url, body, { stallMs: 15000 })) {
        if (isCancelled && isCancelled()) return
        const inline = audioPartOf(event)
        if (!inline) continue
        const raw = Buffer.from(inline.data, 'base64')
        const pcm24 = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2))
        const pcm16 = downsample24kTo16k(pcm24)
        if (pcm16.length) onAudio(pcm16)
    }
}

// ---------------------------------------------------------------------------
// Speech-to-text
//
// Two transcribers, same interface:
//   • Google Cloud Speech-to-Text (REST, service-account JWT) — purpose-built
//     ASR, measured ~40% faster than an LLM on the same short utterance, and
//     its `telephony` model is tuned for 8 kHz phone audio.
//   • Gemini flash-lite — fallback, and what runs if no service account is set.
// ---------------------------------------------------------------------------

let gcpSa = null
let gcpToken = null
let gcpTokenExp = 0

function serviceAccount() {
    if (gcpSa !== null) return gcpSa
    try {
        const raw = String(process.env.GCP_SERVICE_ACCOUNT_JSON || '').trim().replace(/^'|'$/g, '')
        gcpSa = raw ? JSON.parse(raw) : false
        if (gcpSa) log(`Cloud STT enabled (${gcpSa.client_email})`)
    } catch (e) {
        warn('GCP_SERVICE_ACCOUNT_JSON unparseable — using Gemini for STT:', e.message)
        gcpSa = false
    }
    return gcpSa
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

async function sttAccessToken() {
    if (gcpToken && Date.now() < gcpTokenExp) return gcpToken
    const sa = serviceAccount()
    if (!sa) return null
    const now = Math.floor(Date.now() / 1000)
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const claim = b64url(JSON.stringify({
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
    }))
    const signer = require('crypto').createSign('RSA-SHA256')
    signer.update(`${header}.${claim}`)
    const assertion = `${header}.${claim}.${b64url(signer.sign(sa.private_key))}`
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion,
        }),
        signal: AbortSignal.timeout(12000),
    })
    const json = await res.json().catch(() => ({}))
    if (!json.access_token) throw new Error(`oauth ${res.status}: ${JSON.stringify(json).slice(0, 160)}`)
    gcpToken = json.access_token
    gcpTokenExp = Date.now() + 55 * 60 * 1000
    return gcpToken
}

async function transcribeWithCloud(pcm16) {
    const token = await sttAccessToken()
    if (!token) throw new Error('no service account')
    const res = await fetch('https://speech.googleapis.com/v1/speech:recognize', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            config: {
                encoding: 'LINEAR16',
                sampleRateHertz: 16000,
                languageCode: 'hi-IN',
                alternativeLanguageCodes: ['en-IN'],
                enableAutomaticPunctuation: true,
                model: 'telephony',
                useEnhanced: true,
            },
            audio: { content: int16ToBuffer(pcm16).toString('base64') },
        }),
        signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) throw new Error(`cloud stt ${res.status}: ${(await res.text()).slice(0, 160)}`)
    const json = await res.json()
    return (json.results || []).map(r => r.alternatives?.[0]?.transcript || '').join(' ').trim()
}

async function transcribeWithGemini(pcm16) {
    // Send 8 kHz: half the samples means half the audio tokens, which measured
    // ~10% faster with an identical transcript.
    const pcm8 = downsample16kTo8k(pcm16)
    const body = {
        contents: [{
            role: 'user',
            parts: [
                { text: 'Transcribe this phone-call audio verbatim in the exact language and script spoken. Output only the spoken words — no quotes, no commentary, no translation, no speaker labels. If there is no intelligible speech, output nothing.' },
                { inlineData: { mimeType: 'audio/l16; rate=8000; channels=1', data: int16ToBuffer(pcm8).toString('base64') } },
            ],
        }],
        generationConfig: { temperature: 0, maxOutputTokens: 200, thinkingConfig: { thinkingBudget: 0 } },
    }
    const json = await geminiJson(`/models/${CFG.asrModel}:generateContent`, body, 20000)
    return (json.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join(' ').replace(/^["'\s]+|["'\s]+$/g, '').trim()
}

// ---------------------------------------------------------------------------
// STREAMING STT — gemini-3.5-transcribe-live (bidiGenerateContent)
//
// This is the latency fix. A batch transcriber costs 600-900ms *after* the
// caller stops. This model listens continuously over one WebSocket and, measured
// on real Hinglish speech:
//
//   last speech frame            → interim with the FULL sentence at  +67ms
//                                → final transcript at              +1788ms
//
// The final is slow, but the interim is already everything the caller said, so
// the turn consumes the interim the moment our own VAD endpoints. Batch STT
// stays as the fallback when the stream is not ready.
// ---------------------------------------------------------------------------

const STT_LIVE_MODEL = process.env.TTS_FLASH_STT_LIVE_MODEL || 'models/gemini-3.5-transcribe-live'

class StreamingTranscriber {
    constructor() {
        this.sock = null
        this.ready = false
        this.closed = false
        this.latestInterim = ''
        this.latestInterimAt = 0
        this.latestFinal = ''
        this.latestFinalAt = 0
        this.consumedAt = 0
        this.frames = 0
        this.reconnects = 0
        this.lastActivityAt = 0
    }

    connect() {
        if (this.closed || !apiKey()) return
        const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey()}`
        let sock
        try {
            sock = new ws(url)
        } catch (e) {
            warn('Streaming STT connect failed:', e.message)
            return
        }
        this.sock = sock

        sock.on('open', () => {
            sock.send(JSON.stringify({ setup: { model: STT_LIVE_MODEL } }))
        })

        sock.on('message', (raw) => {
            let msg
            try { msg = JSON.parse(raw.toString()) } catch { return }

            if (msg.setupComplete) {
                this.ready = true
                log(`Streaming STT ready (${STT_LIVE_MODEL})`)
                return
            }
            const sc = msg.serverContent || {}
            const interim = sc.interimInputTranscription?.text
            if (interim) {
                this.latestInterim = interim
                this.latestInterimAt = Date.now()
            }
            const final = sc.inputTranscription?.text
            if (final) {
                this.latestFinal = final
                this.latestFinalAt = Date.now()
                // the model is done with that utterance; never re-consume it
                this.consumedAt = this.latestInterimAt
                this.latestInterim = ''
            }
        })

        const revive = (why) => {
            this.ready = false
            if (this.closed) return
            if (this.reconnects >= 3) { warn(`Streaming STT gave up (${why})`); return }
            this.reconnects++
            setTimeout(() => { if (!this.closed) this.connect() }, 400 * this.reconnects)
        }
        sock.on('error', (e) => { warn('Streaming STT socket error:', e.message); revive('error') })
        sock.on('close', (code) => { if (code !== 1000) revive(`close ${code}`) })
    }

    push(pcm16) {
        if (!this.ready || !this.sock || this.sock.readyState !== ws.OPEN) return
        try {
            this.frames++
            this.lastActivityAt = Date.now()
            this.sock.send(JSON.stringify({
                realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: int16ToBuffer(pcm16).toString('base64') } },
            }))
        } catch { /* transient */ }
    }

    /**
     * The transcript for the utterance that just ended.
     *
     * An interim is only trustworthy when it was emitted AFTER the caller's last
     * voice frame — otherwise it is a mid-sentence partial (that is how "athasi"
     * turned into "khansi" on a real call). `sinceTs` is that end-of-speech
     * timestamp. Repeated identical text is rejected so one sentence cannot be
     * answered twice (the voicemail incident).
     */
    take(sinceTs) {
        if (!this.ready) return null
        const text = (this.latestInterim || this.latestFinal || '').trim()
        if (!text) return null
        const at = Math.max(this.latestInterimAt, this.latestFinalAt)
        if (sinceTs && at < sinceTs) return null       // stale partial from mid-speech
        if (at <= this.consumedAt + 80) return null    // already used
        if (this.isRepeat(text)) return null           // same sentence again

        this.consumedAt = at
        this.lastConsumedText = normalizeForCompare(text)
        this.lastConsumedAt = Date.now()
        return text
    }

    isRepeat(text) {
        if (!this.lastConsumedText) return false
        if (Date.now() - this.lastConsumedAt > CFG.sttRepeatWindowMs) return false
        return normalizeForCompare(text) === this.lastConsumedText
    }

    close() {
        this.closed = true
        this.ready = false
        try { this.sock?.close() } catch { }
    }
}

function normalizeForCompare(s) {
    return String(s || '').toLowerCase().replace(/[\s,.;:!?।؟'"“”‘’₹]/g, '')
}

/**
 * Are two transcripts the same utterance?
 *
 * Script-agnostic on purpose: the streaming model often answers in Devanagari
 * while a second engine answers in Roman, and comparing words across scripts
 * yields nothing useful. What actually goes wrong with a streaming interim is
 * that it is a TRUNCATED partial, so the signals that matter are:
 *   • the accurate pass found materially more words  → the interim was cut off
 *   • the two disagree on digits                      → a misheard number
 * Anything else is treated as agreement, because a false "retry" costs latency.
 */
function similarTranscript(accurate, interim) {
    const A = String(accurate || '').trim()
    const I = String(interim || '').trim()
    if (!A || !I) return true

    // \p{M} keeps Devanagari/Tamil vowel signs attached — without it "सेक्टर"
    // splits into three "words" and every Hindi transcript looks inflated.
    const words = s => s.split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean)
    const wa = words(A)
    const wi = words(I)

    const digits = s => (String(s).match(/[0-9०-९]+/g) || []).join(',')
    const da = digits(A)
    const di = digits(I)
    if (da && di && da !== di) return false

    // ONLY the truncation case is worth re-asking: the accurate pass found
    // materially more words than the interim. The reverse (the interim heard
    // MORE than the batch pass) is normal — the live session was listening to
    // the whole utterance while the batch pass only got the clipped buffer — so
    // it must not trigger a regeneration.
    if (wa.length - wi.length >= 2) return false

    const set = new Set(wa.map(w => w.toLowerCase()))
    const common = wi.filter(w => set.has(w.toLowerCase())).length
    if (wi.length >= 3 && common === 0 && wa.length === wi.length) {
        // Same word count, zero shared tokens, different scripts aside: two
        // different readings of the same audio.
        return A === I
    }
    return true
}

async function transcribe(pcm16) {
    const audio = trimSilence(pcm16, 140, 80)
    if (audio.length < 3200) return '' // < 100ms of audio is noise

    let text = ''
    let engine = 'gemini'
    if (serviceAccount()) {
        try {
            text = await transcribeWithCloud(audio)
            engine = 'cloud-stt'
        } catch (e) {
            warn('Cloud STT failed, falling back to Gemini:', e.message)
        }
    }
    if (engine === 'gemini') text = await transcribeWithGemini(audio)

    text = text.replace(/^["'\s]+|["'\s]+$/g, '')
    if (/^(silence|no speech|inaudible|\[.*\])$/i.test(text)) return ''
    CFG.lastAsrEngine = engine
    return text
}

async function streamLlm(ctx, history, userText, onDelta) {
    const contents = history
        .filter(t => t.role && t.text)
        .slice(-16)
        .map(t => ({ role: t.role === 'agent' ? 'model' : 'user', parts: [{ text: t.text }] }))
    contents.push({ role: 'user', parts: [{ text: userText }] })

    const body = {
        systemInstruction: { parts: [{ text: buildSystemPrompt(ctx) }] },
        contents,
        generationConfig: {
            temperature: 0.85,
            topP: 0.95,
            // Short turns: a phone reply that fits one breath keeps the
            // conversation moving and hides the fact that we are not instant.
            maxOutputTokens: 130,
            thinkingConfig: { thinkingBudget: 0 },
        },
    }
    const url = `${GEMINI_BASE}/models/${CFG.llmModel}:streamGenerateContent?alt=sse`
    let full = ''
    for await (const event of streamSSE(url, body, { stallMs: 12000 })) {
        const delta = textPartOf(event)
        if (!delta) continue
        full += delta
        onDelta(delta, full)
    }
    return full
}

async function summarizeCall(ctx, transcript) {
    try {
        const lines = transcript
            .filter(t => t.text)
            .map(t => `${t.role === 'agent' ? 'Agent' : 'Prospect'}: ${t.text}`)
            .join('\n')
        const body = {
            contents: [{
                role: 'user',
                parts: [{
                    text: `Summarise this real-estate sales call in JSON with keys: outcome ("site_visit_booked" | "interested" | "follow_up" | "not_interested" | "no_contact"), summary (one sentence, max 30 words), budget, requirement, location, timeline, site_visit (day/time or null), sentiment ("Positive" | "Neutral" | "Negative"), next_action.\n\n${lines}`,
                }],
            }],
            generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 400,
                responseMimeType: 'application/json',
                thinkingConfig: { thinkingBudget: 0 },
            },
        }
        const json = await geminiJson(`/models/${CFG.llmModel}:generateContent`, body, 25000)
        const text = (json.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('')
        return JSON.parse(text.replace(/^```json\s*|\s*```$/g, ''))
    } catch (e) {
        warn('Summary failed:', e.message)
        return null
    }
}

// ---------------------------------------------------------------------------
// Call context
// ---------------------------------------------------------------------------

async function loadCallContext(leadId, profileId, hints = {}) {
    const db = supabase()
    const ctx = {
        leadId,
        profileId,
        prospectName: hints.prospectName || 'ji',
        company: hints.company || 'Nobo Realty',
        agentName: hints.agentName || 'Aanya',
        gender: hints.gender === 'male' ? 'male' : 'female',
        reason: hints.reason || 'a property enquiry you had made',
        language: hints.language || 'hinglish',
        instruction: hints.instruction || '',
        campaignNote: '',
        inventory: [],
    }

    try {
        if (leadId) {
            const { data: lead } = await db
                .from('leads')
                .select('id, name, phone, source, user_id, custom_fields, notes, voice_campaign_id')
                .eq('id', leadId)
                .maybeSingle()
            if (lead) {
                const cf = lead.custom_fields || {}
                ctx.prospectName = cf.prospect_name || lead.name || ctx.prospectName
                ctx.company = cf.company_name || ctx.company
                ctx.agentName = cf.agent_name || ctx.agentName
                ctx.gender = cf.agent_gender === 'male' ? 'male' : (cf.agent_gender === 'female' ? 'female' : ctx.gender)
                ctx.language = cf.language || ctx.language
                ctx.instruction = cf.instruction || ctx.instruction
                ctx.reason = cf.reason || ctx.reason
                ctx.profileId = ctx.profileId || lead.user_id
                if (cf.campaign_note) ctx.campaignNote = cf.campaign_note
            }
        }

        if (ctx.profileId) {
            const { data: profile } = await db
                .from('profiles')
                .select('business_name, full_name, business_info')
                .eq('id', ctx.profileId)
                .maybeSingle()
            // Only fall back to the account's registered business name when the
            // operator did not type a company for this call — the demo form wins.
            const companyWasChosen = !!(hints.company || (ctx.company && ctx.company !== 'Nobo Realty'))
            if (profile?.business_name && !companyWasChosen) {
                ctx.company = profile.business_name
            }

            const { data: properties } = await db
                .from('properties')
                .select('title, location, price, property_type, configurations')
                .eq('user_id', ctx.profileId)
                .limit(5)
            if (Array.isArray(properties) && properties.length) ctx.inventory = properties
        }
    } catch (e) {
        warn('Context load warning:', e.message)
    }

    return ctx
}

// ---------------------------------------------------------------------------
// Pre-warm pool: greeting PCM rendered while the phone is still ringing
// ---------------------------------------------------------------------------

const prewarmPool = new Map()

async function prewarm(leadId, profileId, hints = {}) {
    if (!leadId) return { ok: false, error: 'leadId required' }
    const startedAt = Date.now()
    try {
        const voiceId = await resolveVoiceId(hints.voiceId)
        const ctx = await loadCallContext(leadId, profileId, hints)
        const greetingText = hints.greeting || buildGreeting(ctx)

        // Render the whole opener to PCM now, so answering the call plays it
        // almost instantly instead of waiting on a TTS round trip.
        const greetGate = createSilenceGate()
        const chunks = []
        await streamTts(greetingText, voiceId, (pcm) => {
            for (const piece of greetGate.push(pcm)) chunks.push(piece)
        })
        for (const piece of greetGate.flush()) chunks.push(piece)
        const greetingPcm = concatInt16(chunks)

        prewarmPool.set(leadId, {
            voiceId, ctx, greetingText, greetingPcm,
            at: Date.now(),
            readyMs: Date.now() - startedAt,
        })
        log(`Prewarm ready for lead ${leadId} in ${Date.now() - startedAt}ms (${(greetingPcm.length / 16000).toFixed(1)}s greeting)`)

        // Warm the LLM + ASR paths too (cheap fire-and-forget).
        Promise.all([
            streamLlm(ctx, [], 'Hello?', () => { }).catch(() => { }),
            transcribe(new Int16Array(3200)).catch(() => { }),
        ]).catch(() => { })

        return { ok: true, greetingSec: +(greetingPcm.length / 16000).toFixed(2), readyMs: Date.now() - startedAt }
    } catch (e) {
        warn(`Prewarm failed for lead ${leadId}:`, e.message)
        return { ok: false, error: e.message }
    }
}

// Expire stale pre-warms so a long-lived instance does not leak.
setInterval(() => {
    const cutoff = Date.now() - 15 * 60 * 1000
    for (const [k, v] of prewarmPool) if (v.at < cutoff) prewarmPool.delete(k)
}, 5 * 60 * 1000).unref?.()

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

class TtsFlashSession {
    constructor(wsConnection, req, urlObj) {
        this.wsConn = wsConnection
        this.req = req
        this.q = urlObj?.searchParams || new URLSearchParams()

        this.streamId = null
        this.callId = null
        this.startedAt = 0
        this.closed = false
        this.finalized = false

        this.leadId = this.q.get('leadId') || null
        this.profileId = this.q.get('profileId') || null
        this.vobizAuthId = this.q.get('vobizAuthId') || process.env.VOBIZ_AUTH_ID || ''
        this.vobizAuthToken = this.q.get('vobizAuthToken') || process.env.VOBIZ_AUTH_TOKEN || ''
        this.hints = {
            voiceId: this.q.get('voiceId') || '',
            language: this.q.get('language') || '',
            gender: this.q.get('gender') || '',
            company: this.q.get('company') || '',
            prospectName: this.q.get('prospectName') || '',
            greeting: this.q.get('greeting') || '',
            reason: this.q.get('reason') || '',
            instruction: this.q.get('instruction') || '',
        }

        this.voiceId = null
        this.ctx = null

        this.history = []
        this.transcript = []
        this.turnMetrics = []
        this.callMetrics = { greetingReadyMs: 0, turns: [] }

        // Outbound audio state.
        // Audio is PACED to realtime (20ms frames on a 20ms clock) instead of
        // being pushed at TTS generation speed (~2.5x realtime). Pushing faster
        // than realtime builds a multi-second backlog inside the carrier, which
        // makes `speakUntil` wrong: we think we stopped talking seconds before
        // the caller stops HEARING us, so barge-in never arms and the caller's
        // interruptions get dropped on the floor.
        this.generation = 0          // bumped on barge-in; cancels in-flight TTS
        this.speakUntil = 0          // realtime-accurate playout end
        this.audioSent = false
        this.outQueue = []           // queued Int16 chunks awaiting paced send
        this.outOffset = 0           // byte offset into outQueue[0]
        this.outQueuedSamples = 0
        this.outTimer = null

        // VAD state
        this.preRoll = []            // ~300ms ring buffer so first word isn't clipped
        this.utterance = []
        this.speechActive = false
        this.silenceFrames = 0
        this.speechFrames = 0
        this.bargeFrames = 0
        this.lastVoiceAt = 0
        this.turnInProgress = false
        this.turnAbort = null
        this.fillerTimer = null
        this.fillerActive = false

        this.endAfterTurn = false
        this.ended = false
        this.turnSeq = 0
        this.metricsLog = []
        this.streamingStt = null

        // Idle re-engagement: a real call must never go mute. If nothing has
        // happened for a while (VAD missed a quiet "hello", carrier paused the
        // media stream, a turn died), the agent checks in instead of sitting
        // there silently — that was the 31-second dead air on the first call.
        this.lastActivityAt = Date.now()
        this.nudgeTimer = null
        this.nudgeCount = 0
    }

    touchActivity() {
        this.lastActivityAt = Date.now()
    }

    startNudgeWatch() {
        if (this.nudgeTimer) return
        this.nudgeTimer = setInterval(() => {
            if (this.closed || this.ended) return
            if (this.turnInProgress || this.speechActive) return
            if (this.isSpeaking()) return
            const idleMs = Date.now() - this.lastActivityAt
            if (idleMs < CFG.idleNudgeMs) return

            this.nudgeCount++
            if (this.nudgeCount > CFG.maxNudges) {
                log('Caller unresponsive after nudges — ending')
                this.maybeEnd()
                return
            }
            const male = this.ctx?.gender === 'male'
            const line = this.ctx?.language === 'english'
                ? (this.nudgeCount === 1 ? 'Hello, are you still there?' : 'I will let you go then — call me back anytime.')
                : (this.nudgeCount === 1
                    ? 'Hello, aap sun rahe hain ji?'
                    : `Theek hai ji, main baad mein call kar ${male ? 'leta' : 'leti'} hoon.`)
            log(`Idle ${Math.round(idleMs / 1000)}s — nudging caller: "${line}"`)
            this.touchActivity()
            const gen = ++this.generation
            streamTts(line, this.voiceId, (pcm) => {
                if (gen === this.generation) this.play(pcm)
            }, () => gen !== this.generation || this.closed).catch(e => warn('Nudge TTS failed:', e.message))
        }, 2000)
        if (this.nudgeTimer.unref) this.nudgeTimer.unref()
    }

    // ---- audio out -------------------------------------------------------

    send(payload) {
        if (this.closed || this.wsConn.readyState !== ws.OPEN || !this.streamId) return
        this.wsConn.send(JSON.stringify({
            event: 'playAudio',
            streamId: this.streamId,
            media: { contentType: 'audio/x-l16', sampleRate: 16000, payload },
        }))
    }

    /**
     * Queue agent audio. It is NOT sent immediately — 20ms frames go out on a
     * 20ms clock, so the carrier's playout buffer stays shallow and our notion
     * of "still talking" matches what the caller actually hears. That is what
     * makes barge-in reliably arm.
     */
    play(pcm16) {
        if (!pcm16 || !pcm16.length) return
        // Real speech always wins: drop any in-flight backchannel first.
        if (this.fillerActive) this.stopFiller()
        this.outQueue.push(pcm16)
        this.outQueuedSamples += pcm16.length
        this.speakUntil = Date.now() + (this.outQueuedSamples / 16000) * 1000
        this.pumpOut()
    }

    /**
     * Play the backchannel masker the moment the caller stops talking.
     *
     * A real consultant says "haan ji" while they think. Two short prepared
     * clips chained cover the ~2s the STT+LLM+TTS stack needs, so the caller
     * never experiences the gap as silence or as a dropped line.
     */
    startFiller() {
        if (!CFG.fillerEnabled || this.closed) return
        const ack = loadClip('backchannel_haan', 24000) || loadClip('backchannel_hmm', 24000)
        if (!ack) { warn('Masker unavailable — caller will hear silence while we think'); return }
        log(`Masker: "haan ji" (${(ack.length / 16000).toFixed(2)}s)`)
        this.play(ack)
        this.fillerActive = true

        // If the real reply still has not arrived when the ack runs out, add a
        // second, shorter "hmm" so the line keeps sounding alive.
        if (this.fillerTimer) clearTimeout(this.fillerTimer)
        const ackMs = (ack.length / 16000) * 1000
        this.fillerTimer = setTimeout(() => {
            if (!this.fillerActive || this.closed) return
            const hmm = loadClip('backchannel_hmm', 24000)
            if (hmm) this.play(hmm)
        }, Math.max(400, ackMs - 80))
    }

    /** Drop whatever is left of the masker so the reply starts clean. */
    stopFiller() {
        if (this.fillerTimer) { clearTimeout(this.fillerTimer); this.fillerTimer = null }
        if (!this.fillerActive) return
        this.fillerActive = false
        log('Masker preempted by the reply')
        this.outQueue = []
        this.outOffset = 0
        this.outQueuedSamples = 0
        this.speakUntil = 0
        this.stopPump()
        if (this.wsConn.readyState === ws.OPEN && this.streamId) {
            this.wsConn.send(JSON.stringify({ event: 'clearAudio', streamId: this.streamId }))
        }
    }

    pumpOut() {
        if (this.outTimer) return
        // PRIME FIRST: push ~150ms immediately so the carrier can start playing
        // without waiting for our 20ms clock to fill its buffer. Everything
        // after that goes at realtime, which keeps our playout estimate honest.
        const primed = this.nextOutFrame(Math.floor(CFG.primeMs * 16))
        if (primed) this.sendFrame(primed)

        this.outTimer = setInterval(() => {
            if (this.closed) { this.stopPump(); return }
            const chunk = this.nextOutFrame(320) // 20ms @ 16kHz
            if (!chunk) { this.stopPump(); return }
            this.sendFrame(chunk)
        }, 20)
        if (this.outTimer.unref) this.outTimer.unref()
    }

    sendFrame(samples) {
        this.send(int16ToBuffer(samples).toString('base64'))
        if (!this.audioSent) {
            this.audioSent = true
            this.firstAudioAt = Date.now()
        }
        this.touchActivity()
        // This frame plays for its own duration, then everything queued behind it.
        this.speakUntil = Date.now() + (samples.length / 16) + (this.outQueuedSamples / 16000) * 1000
    }

    stopPump() {
        if (this.outTimer) { clearInterval(this.outTimer); this.outTimer = null }
    }

    /** Take up to `want` samples off the front of the outbound queue. */
    nextOutFrame(want) {
        if (this.outQueuedSamples === 0) return null
        const out = new Int16Array(Math.min(want, this.outQueuedSamples))
        let filled = 0
        while (filled < out.length && this.outQueue.length) {
            const head = this.outQueue[0]
            const available = head.length - this.outOffset
            const take = Math.min(available, out.length - filled)
            out.set(head.subarray(this.outOffset, this.outOffset + take), filled)
            filled += take
            this.outOffset += take
            this.outQueuedSamples -= take
            if (this.outOffset >= head.length) { this.outQueue.shift(); this.outOffset = 0 }
        }
        return filled ? out.subarray(0, filled) : null
    }

    /** Flush carrier playback and invalidate everything queued/in-flight. */
    flushSpeech() {
        this.generation++
        this.outQueue = []
        this.outOffset = 0
        this.outQueuedSamples = 0
        this.speakUntil = 0
        this.stopPump()
        if (this.wsConn.readyState === ws.OPEN && this.streamId) {
            this.wsConn.send(JSON.stringify({ event: 'clearAudio', streamId: this.streamId }))
        }
    }

    isSpeaking() {
        return Date.now() < this.speakUntil + 120
    }

    // ---- turn execution --------------------------------------------------

    async runTurn(userText, asrMs, sttEngine, verifyPromise) {
        const turnStart = Date.now()
        const gen = ++this.generation
        // A new turn supersedes any turn still unwinding from a rollback: only
        // the newest turn may commit to history / transcript / Supabase.
        const mySeq = ++this.turnSeq
        this.turnInProgress = true
        this.audioSent = false
        this.firstAudioAt = 0
        const cancelled = () => this.closed || gen !== this.generation
        const superseded = () => mySeq !== this.turnSeq

        this.history.push({ role: 'caller', text: userText })
        this.transcript.push({ role: 'user', text: userText, at: Date.now() })

        // Latency masker now fires at the endpoint (see handleUtterance), so
        // nothing to schedule here.

        const sinks = []
        let llmFirstTokenAt = 0
        let pending = ''
        let agentText = ''
        let emittedAny = false

        const pushClause = (raw) => {
            if (cancelled()) return
            let text = raw
            if (/\[\s*END\s*\]/i.test(text)) {
                text = text.replace(/\[\s*END\s*\]/gi, '').trim()
                this.endAfterTurn = true
            }
            text = speakable(text)
            if (!text || text.length < 2) return

            // TTS time-to-first-byte scales with how much text it is handed, so
            // the FIRST clause of a turn is split at its first comma: "Haan ji
            // Rahul ji," synthesizes in a few hundred ms and starts playing
            // while the rest of the sentence is still being generated.
            if (!emittedAny && text.length > 40) {
                const cut = text.indexOf(',')
                if (cut > 5 && cut < 32) {
                    const head = text.slice(0, cut + 1).trim()
                    const tail = text.slice(cut + 1).trim()
                    if (head.length >= 4 && tail.length >= 8) {
                        emittedAny = true
                        sinks.push(this.spawnSink(head, gen, { hedge: sinks.length === 0 }))
                        text = tail
                    }
                }
            }

            if (sinks.length >= CFG.maxClausesInFlight + 2) return // runaway guard
            const isFirst = sinks.length === 0
            emittedAny = true
            sinks.push(this.spawnSink(text, gen, { hedge: isFirst }))
        }

        // Kick the LLM immediately; clauses are synthesized as they appear.
        const llmPromise = streamLlm(this.ctx, this.history.slice(0, -1), userText, (delta, full) => {
            if (!llmFirstTokenAt) llmFirstTokenAt = Date.now()
            agentText = full
            pending += delta

            // EARLY FIRST CLAUSE — two triggers, whichever comes first:
            //   (a) a short opening fragment ending in punctuation
            //       ("Haan ji Rahul ji,") — clean prosody, starts TTS fast;
            //   (b) 4+ words with no punctuation after 220ms — TTS is handed
            //       something to say rather than waiting for a full sentence.
            // TTS time-to-first-byte scales with text length, so a 4-word first
            // chunk is a few hundred ms quicker than a 20-word sentence.
            if (!emittedAny) {
                const early = /^([^.!?।؟\n]{6,60})[,;:!?।؟]\s+/.exec(pending)
                if (early) {
                    const head = early[0].trim()
                    pending = pending.slice(early[0].length)
                    pushClause(head)
                } else if (llmFirstTokenAt && Date.now() - llmFirstTokenAt > 220) {
                    const words = pending.trim().split(/\s+/)
                    if (words.length >= 4) {
                        let head = words.slice(0, 5).join(' ')
                        // never cut mid-word or leave a dangling conjunction
                        head = head.replace(/[,;:]$/, '')
                        if (head.length >= 8 && !/\b(ki|ke|ka|aur|ya|toh|mein|hai|hoon|hain)$/i.test(head)) {
                            pending = pending.trim().slice(head.length).replace(/^[\s,]+/, '')
                            pushClause(head)
                        }
                    }
                }
            }

            const { clauses, rest } = splitClauses(pending, false)
            pending = rest
            for (const c of clauses) pushClause(c)
        }).catch(err => {
            warn('LLM stream failed:', err.message)
            return ''
        }).then(done => {
            if (cancelled()) return done
            if (pending) {
                const { clauses } = splitClauses(pending, true)
                pending = ''
                for (const c of clauses) pushClause(c)
            }
            return done || agentText
        })

        // Dead-air guard: if nothing has reached the caller after 6.5s (a wedged
        // upstream, a 429 retrying silently, …) speak a holding line so the call
        // never sits in silence.
        const watchdog = setTimeout(() => {
            if (this.audioSent || cancelled() || this.closed) return
            log('Turn watchdog fired — speaking holding line')
            const holding = this.ctx?.language === 'english'
                ? 'Sorry, one second — let me check that.'
                : `Ek second ji, main check kar ${this.ctx?.gender === 'male' ? 'leta' : 'leti'} hoon.`
            streamTts(holding, this.voiceId, (pcm) => {
                if (gen === this.generation) this.play(pcm)
            }, () => gen !== this.generation || this.closed).catch(() => { })
        }, 6500)

        // Playback worker: strictly ordered, streaming, barge-in aware.
        let idx = 0
        let llmDone = false
        llmPromise.then(() => { llmDone = true })

        // Verify the speculative transcript BEFORE anything is spoken. The
        // accurate pass has been running in parallel with the LLM, so by the time
        // the first clause has audio it is normally already back.
        let verified = !verifyPromise
        // Which clauses the caller actually HEARD. Industry practice: if the
        // caller barges in, the assistant's history must be truncated to what was
        // played, otherwise the LLM believes it said things the caller never heard.
        const playedClauseText = []

        while (true) {
            if (cancelled()) break

            if (!verified && verifyPromise) {
                const accurate = await Promise.race([
                    verifyPromise,
                    new Promise(r => setTimeout(() => r('__timeout__'), 1200)),
                ])
                verified = true
                if (accurate && accurate !== '__timeout__' && !similarTranscript(accurate, userText)) {
                    log(`Transcript mismatch — interim "${userText}" vs accurate "${accurate}"`)
                    this.flushSpeech()
                    return { retryWith: accurate }
                }
            }

            if (idx < sinks.length) {
                const sink = sinks[idx++]
                let completed = true
                while (true) {
                    const chunk = await sink.next()
                    if (chunk === null) break
                    if (cancelled()) { completed = false; idx = sinks.length; break }
                    this.play(chunk)
                }
                if (completed) playedClauseText.push(sink.text)
                continue
            }
            if (llmDone) break
            await new Promise(r => setTimeout(r, 12))
        }

        if (this.fillerTimer) { clearTimeout(this.fillerTimer); this.fillerTimer = null }
        clearTimeout(watchdog)

        // Rolled-back or superseded turn: nothing reached the caller, so it must
        // not enter the conversation history (it would poison the next prompt).
        if (superseded() || (cancelled() && !this.audioSent)) {
            log('Turn discarded (caller resumed before any audio was played)')
            return
        }

        // The model returned nothing usable — never leave the caller in silence.
        if (!sinks.length && !this.closed) {
            log('LLM produced no speakable clause — using a holding line')
            const holding = this.ctx.language === 'english'
                ? 'Sorry, one second — let me check that for you.'
                : `Ek second ji, main check kar ${this.ctx.gender === 'male' ? 'leta' : 'leti'} hoon.`
            const gen2 = ++this.generation
            try {
                await streamTts(holding, this.voiceId, (pcm) => {
                    if (gen2 === this.generation) this.play(pcm)
                }, () => gen2 !== this.generation || this.closed)
                this.history.push({ role: 'agent', text: holding })
                this.transcript.push({ role: 'agent', text: holding, at: Date.now() })
                this.persistLiveTranscript()
            } catch (e) {
                warn('Holding line TTS failed:', e.message)
            }
            return
        }

        const finalText = (await Promise.resolve(agentText || '')).trim()
        if (finalText) {
            const clean = finalText.replace(/\[\s*END\s*\]/gi, '').trim()
            // If the caller cut us off, only what they HEARD belongs in history.
            const wasInterrupted = cancelled() || playedClauseText.length < sinks.length
            const heard = playedClauseText.join(' ').trim()
            const committed = wasInterrupted && heard ? heard : clean
            if (committed) {
                log(`Agent (${sinks.length} clauses, ${Date.now() - turnStart}ms${wasInterrupted ? ', interrupted' : ''}): ${committed}`)
                this.history.push({ role: 'agent', text: committed })
                this.transcript.push({ role: 'agent', text: committed, at: Date.now(), latency_ms: Date.now() - turnStart })
                if (GOODBYE_HINT.test(committed) && committed.length < 160) this.maybeEnd()
            }
        }
        if (this.endAfterTurn) this.maybeEnd()

        this.turnMetrics.push({
            at: Date.now(),
            asr_ms: asrMs,
            stt: sttEngine || 'batch',
            llm_ttfb_ms: llmFirstTokenAt ? llmFirstTokenAt - turnStart : null,
            first_audio_ms: this.firstAudioAt ? this.firstAudioAt - turnStart : null,
            total_ms: Date.now() - turnStart,
            clauses: sinks.length,
        })
        this.turnInProgress = false
        // Live transcript for the demo dashboard (fire and forget).
        this.persistLiveTranscript()
    }

    persistLiveTranscript() {
        if (!this.leadId) return
        const rows = this.transcript
            .filter(t => t.text)
            .map(t => ({
                role: t.role === 'agent' ? 'agent' : 'user',
                message: t.text,
                latency_ms: t.latency_ms || null,
                at: t.at || null,
            }))
        supabase()
            .from('leads')
            .update({ voice_call_transcript: rows })
            .eq('id', this.leadId)
            .then(() => { }, e => warn('Transcript persist warning:', e.message))
    }

    /**
     * A sink is one clause's TTS stream. It starts synthesizing the moment the
     * clause exists (so clause 2 renders while clause 1 plays) and hands chunks
     * to the playback worker in order.
     */
    spawnSink(text, gen, opts = {}) {
        const queue = []
        let done = false
        let waiter = null
        const self = this

        const sink = {
            text,
            firstChunkAt: 0,
            push(chunk) {
                if (waiter) { const w = waiter; waiter = null; w(chunk) }
                else queue.push(chunk)
            },
            end() {
                done = true
                if (waiter) { const w = waiter; waiter = null; w(null) }
            },
            next() {
                if (queue.length) return Promise.resolve(queue.shift())
                if (done) return Promise.resolve(null)
                return new Promise(resolve => { waiter = resolve })
            },
        }

        // Silence gate. Every TTS render arrives with 220-260ms of lead silence
        // and 300-340ms of tail silence. Stitching clauses raw injected ~0.5s of
        // dead air per seam — a 3-clause reply measured 1640ms of silence inside
        // one sentence, which on a phone line sounds like a drop-out/"static".
        // Leading silence is stripped as it streams (keeping 40ms so the first
        // phoneme isn't clipped) and trailing silence is trimmed to 60ms.
        let winner = 0
        let running = 0

        const attempt = (id) => {
            const gate = createSilenceGate()
            running++
            streamTts(text, self.voiceId, (pcm) => {
                if (gen !== self.generation || self.closed) return
                if (winner && winner !== id) return // a faster attempt already won
                winner = id
                if (!sink.firstChunkAt) sink.firstChunkAt = Date.now()
                for (const piece of gate.push(pcm)) sink.push(piece)
            }, () => gen !== self.generation || self.closed || (winner !== 0 && winner !== id))
                .catch(err => {
                    if (!winner || winner === id) warn(`TTS clause failed: ${err.message}`)
                })
                .then(() => {
                    if ((!winner || winner === id) && gen === self.generation && !self.closed) {
                        for (const piece of gate.flush()) sink.push(piece)
                    }
                })
                .finally(() => {
                    running--
                    if (running === 0) sink.end()
                })
        }

        attempt(1)

        // HEDGED FIRST CLAUSE. Real calls showed the odd turn where TTS took
        // 2.5-3s to emit its first byte (vs ~700ms normally) — a long tail that
        // the caller hears as a stall. If nothing arrives quickly, a duplicate
        // request races the original and the first one to speak wins.
        if (opts.hedge) {
            setTimeout(() => {
                if (winner || gen !== self.generation || self.closed) return
                log(`TTS hedge fired (no audio in ${CFG.ttsHedgeMs}ms) — racing a second request`)
                attempt(2)
            }, CFG.ttsHedgeMs)
        }

        return sink
    }

    maybeEnd() {
        if (this.ended) return
        this.ended = true
        const waitMs = Math.max(0, this.speakUntil - Date.now()) + 1400
        log(`Ending call after playout drain (${waitMs}ms)`)
        setTimeout(() => {
            try { this.wsConn.close() } catch { }
        }, waitMs)
    }

    // ---- greeting ---------------------------------------------------------

    async playGreeting() {
        const warm = this.leadId ? prewarmPool.get(this.leadId) : null
        const gen = ++this.generation

        if (warm && Date.now() - warm.at < 10 * 60 * 1000) {
            prewarmPool.delete(this.leadId)
            this.voiceId = warm.voiceId
            this.ctx = this.ctx || warm.ctx
            this.callMetrics.greetingReadyMs = warm.readyMs || 0
            this.callMetrics.greetingSource = 'prewarm'
            this.play(warm.greetingPcm)
            this.history.push({ role: 'agent', text: warm.greetingText })
            this.transcript.push({ role: 'agent', text: warm.greetingText, at: Date.now() })
            log(`Playing pre-warmed greeting (${(warm.greetingPcm.length / 16000).toFixed(1)}s)`)
            return
        }

        const text = this.hints.greeting || buildGreeting(this.ctx)
        this.callMetrics.greetingSource = 'live'
        this.history.push({ role: 'agent', text })
        this.transcript.push({ role: 'agent', text, at: Date.now() })
        this.generation = gen
        const liveGate = createSilenceGate()
        try {
            await streamTts(text, this.voiceId, (pcm) => {
                if (gen !== this.generation) return
                for (const piece of liveGate.push(pcm)) this.play(piece)
            }, () => gen !== this.generation || this.closed)
            if (gen === this.generation) {
                for (const piece of liveGate.flush()) this.play(piece)
            }
        } catch (e) {
            warn('Greeting TTS failed:', e.message)
        }
    }

    // ---- incoming audio ---------------------------------------------------

    onMedia(payloadB64) {
        if (this.closed) return
        let pcm
        try { pcm = base64ToInt16(payloadB64) } catch { return }
        if (!pcm.length) return

        const level = rms(pcm)
        const now = Date.now()
        const isVoice = level >= CFG.voiceThreshold
        const agentTalking = this.isSpeaking()

        // Feed the live transcription session continuously — it listens while
        // the caller talks, which is what makes the transcript free at endpoint.
        if (CFG.streamingStt && this.streamingStt) this.streamingStt.push(pcm)

        // Ring buffer of recent audio so an utterance that begins while the
        // agent is still audible keeps its first word.
        this.preRoll.push(pcm)
        while (this.preRoll.length > 15) this.preRoll.shift() // ~300ms at 20ms frames
        if (isVoice) this.lastVoiceAt = now
        if (isVoice) this.touchActivity()

        // --- not currently capturing an utterance ---
        if (!this.speechActive) {
            if (!isVoice) { this.speechFrames = 0; this.bargeFrames = 0; return }

            // While the agent speaks, caller speech is an interruption, so it
            // needs a slightly longer sustain (160ms) and a higher floor than
            // ambient line noise before we cut the agent off. Everything else
            // is normal endpointer behaviour.
            if (agentTalking) {
                if (level >= CFG.bargeInRms) {
                    this.bargeFrames++
                    this.bargeSilent = 0
                } else {
                    // VAD-style hangover: speech dips between syllables, so only
                    // reset the interruption count after a real quiet gap.
                    this.bargeSilent = (this.bargeSilent || 0) + 1
                    if (this.bargeSilent * 20 >= 250) this.bargeFrames = 0
                }
                if (this.bargeFrames < CFG.bargeInFrames) return
                log(`Barge-in detected (rms ${Math.round(level)}, ${this.bargeFrames} voiced frames) — cutting the agent off`)
            } else {
                this.speechFrames++
                if (this.speechFrames < 3) return
            }

            this.speechActive = true
            this.utterance = [...this.preRoll]
            this.silenceFrames = 0
            this.speechFrames = 0
            this.bargeFrames = 0
            log(`Caller speech start${agentTalking ? ' (interrupting)' : ''}`)

            // Cut playback immediately — queued + carrier-buffered audio both go.
            if (agentTalking) this.flushSpeech()
            return
        }

        // --- active utterance ---
        this.utterance.push(pcm)
        if (isVoice) {
            this.silenceFrames = 0
        } else {
            this.silenceFrames++
            if (this.silenceFrames * 20 >= CFG.endpointSilenceMs) this.endUtterance()
        }
    }

    endUtterance() {
        const frames = this.utterance
        this.utterance = []
        this.speechActive = false
        this.silenceFrames = 0
        this.speechFrames = 0
        this.touchActivity()

        const pcm = concatInt16(frames)
        const ms = (pcm.length / 16000) * 1000
        if (ms < CFG.minSpeechMs) {
            log(`Utterance too short (${Math.round(ms)}ms) — ignored`)
            return
        }
        if (this.turnInProgress) {
            // Speculative rollback: the caller is still going, so whatever we
            // were generating is no longer the answer to their question.
            log('Caller kept talking — dropping the in-flight reply')
            this.flushSpeech()
        }
        this.handleUtterance(pcm)
    }

    async handleUtterance(pcm) {
        const t0 = Date.now()
        const speechEndedAt = this.lastVoiceAt || (Date.now() - 400)

        // Streaming STT gives a transcript almost instantly, but its interim can
        // miss the final word or two ("athasi" → "khansi"). So the interim is
        // used to START the LLM immediately, while an accurate batch pass runs in
        // parallel; before any audio is spoken the two are compared and, if they
        // disagree, the reply is regenerated from the accurate text. Agreement is
        // the normal case, so this costs nothing and never speaks a misheard turn.
        let streamed = this.streamingStt?.take(speechEndedAt)
        if (!streamed && this.streamingStt?.ready) {
            const deadline = Date.now() + CFG.sttSettleMs
            while (!streamed && Date.now() < deadline) {
                await new Promise(r => setTimeout(r, 45))
                streamed = this.streamingStt.take(speechEndedAt)
            }
        }

        let text = ''
        let engine = ''
        let verifyPromise = null

        if (streamed) {
            text = streamed
            engine = 'transcribe-live'
            // accurate second opinion, off the critical path
            verifyPromise = transcribe(pcm)
                .then(t => (t && t.trim()) ? t.trim() : null)
                .catch(() => null)
        } else {
            try {
                text = await transcribe(pcm)
                engine = CFG.lastAsrEngine || 'batch'
            } catch (e) {
                warn('ASR failed:', e.message)
                return
            }
        }

        const asrMs = Date.now() - t0
        if (!text) {
            log('Empty transcript — continuing to listen')
            return
        }
        log(`Caller (${asrMs}ms ${engine}): ${text}`)
        this.metricsLog.push({ stage: 'asr', ms: asrMs, engine, text })

        try {
            const result = await this.runTurn(text, asrMs, engine, verifyPromise)
            if (result && result.retryWith) {
                // The interim misheard something. Nothing was spoken yet, so the
                // conversation is simply rebuilt from the accurate transcript.
                log(`Regenerating reply from corrected transcript: "${result.retryWith}"`)
                this.replaceLastCallerTurn(text, result.retryWith)
                await this.runTurn(result.retryWith, asrMs, 'corrected')
            }
        } catch (e) {
            warn('Turn failed:', e.message)
        }
    }

    /** Swap the speculative caller line for the accurate one. */
    replaceLastCallerTurn(fromText, toText) {
        for (let i = this.history.length - 1; i >= 0; i--) {
            if (this.history[i].role === 'caller' && this.history[i].text === fromText) {
                this.history[i].text = toText
                break
            }
        }
        for (let i = this.transcript.length - 1; i >= 0; i--) {
            if (this.transcript[i].role === 'user' && this.transcript[i].text === fromText) {
                this.transcript[i].text = toText
                break
            }
        }
    }

    // ---- lifecycle --------------------------------------------------------

    async start() {
        this.startedAt = Date.now()
        const warm = this.leadId ? prewarmPool.get(this.leadId) : null

        // When a prewarm exists we already have the voice id AND the built
        // context. Re-querying Supabase here cost ~1s of dead air between the
        // call being answered and the greeting starting.
        if (warm) {
            this.voiceId = warm.voiceId
            this.ctx = warm.ctx
        } else {
            const hintVoice = this.hints.voiceId || ''
            this.voiceId = await resolveVoiceId(hintVoice)
            this.ctx = await loadCallContext(this.leadId, this.profileId, {
                ...this.hints,
                voiceId: this.voiceId,
            })
        }

        log(`Session start — lead=${this.leadId} voice=${this.voiceId} lang=${this.ctx.language} company=${this.ctx.company}${warm ? ' (prewarmed context)' : ''}`)

        // Signal "answered" to the demo dashboard.
        if (this.leadId) {
            supabase().from('leads')
                .update({ voice_call_status: 'in_progress' })
                .eq('id', this.leadId)
                .then(() => { }, e => warn('Status update warning:', e.message))
        }

        await this.playGreeting()
        this.touchActivity()
        this.startNudgeWatch()

        // Open the live transcription session now, so it is warm long before
        // the caller's first reply (setup takes ~0.8-1.2s).
        if (CFG.streamingStt) {
            try {
                this.streamingStt = new StreamingTranscriber()
                this.streamingStt.connect()
            } catch (e) {
                warn('Could not start streaming STT:', e.message)
                this.streamingStt = null
            }
        }

        setTimeout(() => {
            if (!this.closed && !this.ended) {
                log('Max call duration reached — closing')
                this.maybeEnd()
            }
        }, CFG.maxCallSec * 1000)
    }

    onStop() {
        this.closed = true
        if (this.fillerTimer) clearTimeout(this.fillerTimer)
        if (this.nudgeTimer) clearInterval(this.nudgeTimer)
        this.stopPump()
        try { this.streamingStt?.close() } catch { }
        this.finalize()
    }

    async finalize() {
        if (this.finalized) return
        this.finalized = true
        const durationSec = this.startedAt ? Math.round((Date.now() - this.startedAt) / 1000) : 0
        const withText = this.transcript.filter(t => t.text)
        log(`Finalizing call — ${withText.length} turns, ${durationSec}s`)

        let summary = null
        if (withText.length) summary = await summarizeCall(this.ctx || {}, withText)

        const avgTurn = this.turnMetrics.length
            ? Math.round(this.turnMetrics.reduce((s, t) => s + (t.total_ms || 0), 0) / this.turnMetrics.length)
            : null
        const metrics = {
            pipeline: 'gemini-tts-flash',
            models: { tts: CFG.ttsModel, asr: CFG.asrModel, llm: CFG.llmModel },
            voice_id: this.voiceId,
            duration_sec: durationSec,
            greeting_source: this.callMetrics.greetingSource || 'live',
            greeting_ready_ms: this.callMetrics.greetingReadyMs || null,
            turns: this.turnMetrics,
            avg_turn_ms: avgTurn,
        }

        try {
            if (this.leadId) {
                const db = supabase()
                await db.from('lead_history').insert({
                    lead_id: this.leadId,
                    action_type: 'REMARK',
                    description: `🎙️ CALL_JSON:${JSON.stringify({
                        summary: summary?.summary || `Call completed (${durationSec}s).`,
                        transcript: withText.map(t => ({ role: t.role === 'agent' ? 'agent' : 'user', message: t.text })),
                        outcome: summary?.outcome || 'follow_up',
                        sentiment: summary?.sentiment || 'Neutral',
                        call_type: 'Gemini 3.8 Flash TTS Pipeline',
                        pipeline: 'tts-flash',
                        metrics,
                    })}`,
                }).then(() => { }, e => warn('History insert warning:', e.message))

                const update = {
                    voice_call_status: 'completed',
                    voice_call_summary: summary?.summary || `Call completed (${durationSec}s).`,
                    voice_call_transcript: withText.map(t => ({ role: t.role === 'agent' ? 'agent' : 'user', message: t.text, latency_ms: null })),
                }
                if (summary?.budget) update.budget = summary.budget

                // The carrier's recording callback does not always carry the
                // URL, so ask Vobiz directly — otherwise every call ends up
                // with no recording even though the mp3 exists.
                const recUrl = await this.fetchRecordingUrl()
                if (recUrl) update.voice_recording_url = recUrl

                await db.from('leads').update(update).eq('id', this.leadId)
                    .then(() => { }, e => warn('Lead update warning:', e.message))
                if (recUrl) log(`Recording saved: ${recUrl}`)
            }
        } catch (e) {
            warn('Finalize persistence warning:', e.message)
        }
    }

    /** Look up the carrier-side recording for this call, if one exists. */
    async fetchRecordingUrl() {
        if (!this.callId || !this.vobizAuthId || !this.vobizAuthToken) return null
        try {
            const res = await fetch(
                `https://api.vobiz.ai/api/v1/Account/${this.vobizAuthId}/Recording/?call_uuid=${encodeURIComponent(this.callId)}&limit=5`,
                {
                    headers: { 'X-Auth-ID': this.vobizAuthId, 'X-Auth-Token': this.vobizAuthToken },
                    signal: AbortSignal.timeout(12000),
                }
            )
            if (!res.ok) return null
            const json = await res.json().catch(() => ({}))
            const rec = (json.objects || json.recordings || [])[0]
            return rec?.recording_url || rec?.url || rec?.mp3_url || null
        } catch (e) {
            warn('Recording lookup failed:', e.message)
            return null
        }
    }
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

function handleTtsFlashConnection(wsConnection, req, urlObj) {
    const session = new TtsFlashSession(wsConnection, req, urlObj)
    let started = false

    wsConnection.on('message', (message) => {
        let data
        try { data = JSON.parse(message.toString()) } catch { return }

        if (data.event === 'start' || data.event === 'connected') {
            session.streamId = data.streamId || data.start?.streamId || session.streamId
            session.callId = data.callId || data.callUuid || data.start?.callSid || session.q.get('callUuid') || null
            log(`Stream started: streamId=${session.streamId} callId=${session.callId}`)
            if (!started) {
                started = true
                session.start().catch(e => warn('Session start failed:', e.message))
            }
            return
        }

        if (data.event === 'media') {
            const payload = data.media?.payload || data.payload
            if (payload) session.onMedia(payload)
            return
        }

        if (data.event === 'stop') {
            log('Stream stop received')
            session.onStop()
            return
        }

        if (data.event === 'mark' || data.event === 'dtmf') return
    })

    wsConnection.on('close', () => {
        log('WebSocket closed')
        session.onStop()
    })

    wsConnection.on('error', (e) => {
        warn('WebSocket error:', e.message)
        session.onStop()
    })
}

/** Express route registration, called from server.js. */
function register(app) {
    /**
     * Vobiz answer webhook served BY THE BRIDGE ITSELF.
     *
     * The Next.js equivalent lives at app/api/voice/vobiz/tts-flash-xml, but
     * hosting it here means a real test call only needs this one service
     * deployed — the web app does not have to ship to production first.
     */
    app.all(['/tts-flash-xml', '/api/voice/vobiz/tts-flash-xml'], async (req, res) => {
        try {
            const leadId = req.query.leadId || req.body?.leadId || ''
            const profileId = req.query.profileId || req.body?.profileId || ''
            const voiceId = req.query.voiceId || ''
            const callUuid =
                req.query.CallUUID || req.query.call_uuid || req.query.callUuid ||
                req.body?.CallUUID || req.body?.call_uuid || ''

            const authId = req.query.vobizAuthId || req.body?.vobizAuthId || process.env.VOBIZ_AUTH_ID || ''
            const authToken = req.query.vobizAuthToken || req.body?.vobizAuthToken || process.env.VOBIZ_AUTH_TOKEN || ''

            const host = req.headers['x-forwarded-host'] || req.headers.host || ''
            console.log(`[TTS-FLASH XML] Answer webhook on bridge: lead=${leadId} profile=${profileId} call=${callUuid} host=${host}`)

            if (!leadId || !host) {
                return res.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup /></Response>')
            }

            // Carrier-side recording, saved by our own /vobiz-status handler.
            if (callUuid && authId && authToken) {
                const recordCb = `https://${host}/vobiz-status?leadId=${encodeURIComponent(leadId)}&event=recording&vobizAuthId=${encodeURIComponent(authId)}&vobizAuthToken=${encodeURIComponent(authToken)}`
                fetch(`https://api.vobiz.ai/api/v1/Account/${authId}/Call/${callUuid}/Record/`, {
                    method: 'POST',
                    headers: { 'X-Auth-ID': authId, 'X-Auth-Token': authToken, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ file_format: 'mp3', time_limit: 1800, callback_url: recordCb, callback_method: 'POST' }),
                }).catch(e => warn('Recording trigger warning:', e.message))
            }

            const params = new URLSearchParams({ leadId, telephony: 'vobiz' })
            if (profileId) params.set('profileId', profileId)
            if (callUuid) params.set('callUuid', callUuid)
            if (voiceId) params.set('voiceId', voiceId)
            const gender = req.query.gender || req.body?.gender || ''
            if (gender) params.set('gender', gender)
            // Credentials ride along so the session can pull the recording URL
            // from the carrier when the call ends.
            if (authId) params.set('vobizAuthId', authId)
            if (authToken) params.set('vobizAuthToken', authToken)

            const wsUrl = `wss://${host}/tts-flash-stream?${params.toString()}`
            const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Stream bidirectional="true" keepCallAlive="true" streamTimeout="3600" contentType="audio/x-l16;rate=16000">${wsUrl.replace(/&/g, '&amp;')}</Stream>
</Response>`
            console.log(`[TTS-FLASH XML] Returning stream XML -> ${wsUrl}`)
            return res.type('application/xml').send(xml)
        } catch (e) {
            warn('Answer webhook error:', e.message)
            return res.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup /></Response>')
        }
    })

    app.post('/tts-flash-prewarm', async (req, res) => {
        const body = req.body || {}
        const leadId = body.leadId || req.query.leadId
        const profileId = body.profileId || req.query.profileId
        if (!leadId) return res.status(400).json({ ok: false, error: 'leadId required' })
        const result = await prewarm(leadId, profileId, {
            voiceId: body.voiceId || req.query.voiceId,
            language: body.language || req.query.language,
            gender: body.gender || req.query.gender,
            company: body.company,
            prospectName: body.prospectName,
            agentName: body.agentName,
            greeting: body.greeting,
            reason: body.reason,
            instruction: body.instruction,
        })
        return res.json(result)
    })

    app.get('/tts-flash-prewarm/status', (req, res) => {
        const leadId = req.query.leadId
        const warm = prewarmPool.get(leadId)
        res.json({ ok: true, ready: !!warm, readyMs: warm?.readyMs || null, greetingSec: warm ? +(warm.greetingPcm.length / 16000).toFixed(2) : null })
    })

    app.post('/tts-flash-voice', async (req, res) => {
        try {
            const { description, displayName } = req.body || {}
            const voice = await createDesignedVoice(description || DEFAULT_VOICE_DESIGN, displayName || undefined)
            res.json({ ok: true, voiceId: voice.id, sampleAudio: voice.sampleAudio })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    })

    app.get('/tts-flash-health', (req, res) => {
        res.json({
            ok: true,
            pipeline: 'gemini-tts-flash',
            models: { tts: CFG.ttsModel, asr: CFG.asrModel, llm: CFG.llmModel },
            stt: serviceAccount() ? 'google-cloud-stt (telephony)' : 'gemini-flash-lite',
            streamingStt: CFG.streamingStt ? STT_LIVE_MODEL : 'off',
            lastAsrEngine: CFG.lastAsrEngine || null,
            latency: {
                endpointSilenceMs: CFG.endpointSilenceMs,
                primeMs: CFG.primeMs,
                masker: CFG.fillerEnabled ? 'on' : 'off',
            },
            voiceId: CFG.voiceId || '(auto-design)',
            prewarmed: prewarmPool.size,
            hasApiKey: !!apiKey(),
        })
    })
}

module.exports = {
    handleTtsFlashConnection,
    register,
    prewarm,
    createDesignedVoice,
    resolveVoiceId,
    DEFAULT_VOICE_DESIGN,
    GREETINGS,
    LANGUAGES,
    CFG,
    // Exposed for the offline harness (scratch/*.js) and for debugging.
    __internal: {
        buildGreeting,
        buildSystemPrompt,
        genderRule,
        streamLlm,
        transcribe,
        speakable,
        similarTranscript,
        splitClauses,
        respectfulName,
        loadCallContext,
    },
}
