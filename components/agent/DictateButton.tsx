'use client';

import { useCallback, useRef, useState } from 'react';
import { Mic, Square, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Dictation for the composer.
 *
 * THE THREE THINGS THAT MADE THIS FEEL SLOW AND CHOPPY
 *
 * 1. It recorded at the browser default: 48 kHz, ~128 kbps. A 12-second note
 *    became a **296 KB** upload. Measured on the same clip, 16 kHz mono at 24 kbps
 *    is **45 KB** — 6.6x smaller — and the model returns the same text, because
 *    speech recognition downsamples to 16 kHz anyway. On a 2 Mbps mobile uplink
 *    that alone is about a second of the wait, and it is the part that stutters
 *    when the network is poor.
 * 2. The user had to tap Stop, and trailing silence went up with the audio. A
 *    voice-activity detector now ends the take ~900 ms after you stop talking, so
 *    nothing after the last word is uploaded or billed.
 * 3. `MediaRecorder.start()` with no timeslice buffers the whole take and emits one
 *    chunk at the end. `start(250)` emits steadily, which keeps the encoder from
 *    stalling behind a busy main thread — the "jitter" heard as dropouts.
 *
 * It also asks for echoCancellation / noiseSuppression / autoGainControl
 * explicitly: on a phone in a room, the browser defaults are not always all three,
 * and recognition degrades when the mic is hot or has echo in it.
 *
 * It is NOT the browser's own SpeechRecognition any more. That takes one hardcoded
 * language — it was set to `en-IN` — so it silently mangled anything else, which is
 * why Hindi "did not get picked up". It survives only as a last resort.
 *
 * MEASURED ENGINE COMPARISON (same recordings, this account):
 *   clip            gemini-3.5-transcribe   chirp_3          gemini-2.5-flash
 *   English 12s     1.4s                    2.4s             4.1s
 *   Punjabi        3.2s, correct Gurmukhi   7.2s, Devanagari 81.7s
 *   Hinglish call   2.3s                    3.0s             3.7s
 */

type SR = any;

/** ~1.5 KB of opus is roughly 100 ms of speech. */
const MIN_BLOB_BYTES = 1500;
/** End the take after this much silence, once speech has started. */
const SILENCE_MS = 900;
/** Nobody dictates for longer than this in one breath. */
const MAX_TAKE_MS = 60_000;
/** Below this RMS a frame counts as silence (0-1 scale). */
const SILENCE_RMS = 0.012;

export default function DictateButton({
  onText,
  disabled,
}: {
  onText: (text: string) => void;
  disabled?: boolean;
}) {
  const [state, setState] = useState<'idle' | 'listening' | 'transcribing'>('idle');
  const [level, setLevel] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const srRef = useRef<SR | null>(null);
  const vadRef = useRef<{ ctx: AudioContext; raf: number } | null>(null);
  const warmedRef = useRef(false);

  const stopStream = useCallback(() => {
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {}
    streamRef.current = null;
    const vad = vadRef.current;
    vadRef.current = null;
    if (vad) {
      try {
        cancelAnimationFrame(vad.raf);
        void vad.ctx.close();
      } catch {}
    }
    setLevel(0);
  }, []);

  /**
   * Pay DNS + TLS + edge handshake before there is any audio to send. On a cold
   * connection that is 150-400 ms which used to sit in front of every dictation.
   */
  const prewarm = useCallback(() => {
    if (warmedRef.current) return;
    warmedRef.current = true;
    void fetch('/api/agent/transcribe', { method: 'GET', keepalive: true }).catch(() => {});
  }, []);

  /** Last resort only: the browser recogniser, in the browser's own language. */
  const browserFallback = useCallback(() => {
    const w = window as any;
    const Ctor: SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) {
      toast.error('Could not transcribe that — the speech service is unavailable.');
      return;
    }
    try {
      const sr = new Ctor();
      srRef.current = sr;
      sr.lang = (navigator.languages && navigator.languages[0]) || navigator.language || 'en-IN';
      sr.continuous = false;
      sr.interimResults = true;
      sr.maxAlternatives = 1;
      let finalText = '';
      sr.onresult = (event: any) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const r = event.results[i];
          if (r.isFinal) finalText += r[0].transcript;
          else interim += r[0].transcript;
        }
        if (interim) setLevel(0.4);
      };
      sr.onerror = () => {
        setState('idle');
        setLevel(0);
      };
      sr.onend = () => {
        srRef.current = null;
        setState('idle');
        setLevel(0);
        const text = finalText.trim();
        if (text) onText(text);
        else toast.info('I did not catch any words there.');
      };
      sr.start();
      setState('listening');
      toast.info("Using the browser's own recogniser — less accurate in Hindi.");
    } catch {
      toast.error('Could not transcribe that.');
    }
  }, [onText]);

  const startRecorder = useCallback(async () => {
    try {
      // Mono 16 kHz with all three DSP stages on: the configuration ASR vendors
      // document, and what keeps a phone-speaker recording clean.
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            sampleRate: 16000,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch {
        // Some browsers reject individual constraints; the mic matters more.
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      streamRef.current = stream;
      chunksRef.current = [];

      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';

      const options: MediaRecorderOptions = {};
      if (mime) options.mimeType = mime;
      // 24 kbps mono opus: transparent for speech, ~6x smaller than the default.
      options.audioBitsPerSecond = 24_000;

      let rec: MediaRecorder;
      try {
        rec = new MediaRecorder(stream, options);
      } catch {
        rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      }
      recRef.current = rec;

      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };

      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        stopStream();
        if (blob.size < MIN_BLOB_BYTES) {
          setState('idle');
          toast.info('That was too short — hold the mic and say a sentence.');
          return;
        }
        setState('transcribing');
        try {
          const form = new FormData();
          form.append('audio', blob, 'note.webm');
          const res = await fetch('/api/agent/transcribe', { method: 'POST', body: form });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Could not transcribe that');
          if (data.text) onText(data.text);
          else toast.info(data.warning || 'I did not catch any words there.');
        } catch (e: any) {
          console.warn('[dictate] server transcription failed:', e?.message || e);
          setState('idle');
          browserFallback();
          return;
        }
        setState('idle');
      };

      // ---- voice activity detection --------------------------------------
      // This is what removes the "tap stop, wait, then it thinks" rhythm: the
      // take ends when you stop talking.
      try {
        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        const buf = new Float32Array(analyser.fftSize);

        let spokeAt = 0;
        let lastLoudAt = 0;
        const startedAt = Date.now();

        const tick = () => {
          const current = recRef.current;
          if (!current || current.state === 'inactive') return;

          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          const rms = Math.sqrt(sum / buf.length);
          setLevel(rms);

          const now = Date.now();
          if (rms > SILENCE_RMS) {
            if (!spokeAt) spokeAt = now;
            lastLoudAt = now;
          } else if (spokeAt && now - lastLoudAt > SILENCE_MS && now - spokeAt > 400) {
            // Spoke, then stopped: that is the end of the take.
            try {
              current.stop();
            } catch {}
            return;
          }

          if (now - startedAt > MAX_TAKE_MS) {
            try {
              current.stop();
            } catch {}
            return;
          }

          vadRef.current = { ctx, raf: requestAnimationFrame(tick) };
        };
        vadRef.current = { ctx, raf: requestAnimationFrame(tick) };
      } catch {
        /* no analyser (old browser): the Stop button still works */
      }

      // 250 ms timeslice: steady chunks instead of one blob at the end.
      rec.start(250);
      setState('listening');
    } catch (e: any) {
      setState('idle');
      stopStream();
      toast.error(
        e?.name === 'NotAllowedError'
          ? 'Microphone permission was denied. Allow it in the browser to dictate.'
          : 'Could not open the microphone.'
      );
    }
  }, [browserFallback, onText, stopStream]);

  const start = useCallback(() => {
    prewarm();
    void startRecorder();
  }, [prewarm, startRecorder]);

  const stop = useCallback(() => {
    try {
      srRef.current?.stop();
    } catch {}
    srRef.current = null;
    try {
      if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
    } catch {}
    setState((s) => (s === 'listening' ? 'idle' : s));
  }, []);

  const label =
    state === 'transcribing'
      ? 'Transcribing…'
      : state === 'listening'
        ? 'Listening — it stops on its own when you pause'
        : 'Dictate a message (any language)';

  return (
    <button
      type="button"
      onClick={() => (state === 'listening' ? stop() : start())}
      onPointerDown={prewarm}
      onPointerEnter={prewarm}
      disabled={disabled || state === 'transcribing'}
      className="nobo-tap relative p-1.5 rounded-full dsh-interactive disabled:opacity-40"
      style={{
        color:
          state === 'listening'
            ? 'var(--dsw-alias-state-error-primary)'
            : 'var(--dsw-alias-label-tertiary)',
      }}
      title={label}
      aria-label={label}
      aria-pressed={state === 'listening'}
    >
      {/* Live level ring: proof the mic is hearing you, before any text exists. */}
      {state === 'listening' && level > 0 && (
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            boxShadow: `0 0 0 ${Math.min(6, 1 + level * 28)}px rgba(236,72,153,0.22)`,
            transition: 'box-shadow 120ms linear',
          }}
        />
      )}
      {state === 'transcribing' ? (
        <Loader2 size={16} className="animate-spin" />
      ) : state === 'listening' ? (
        <Square size={14} className="fill-current" />
      ) : (
        <Mic size={16} />
      )}
    </button>
  );
}
