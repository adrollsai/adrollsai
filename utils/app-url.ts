/**
 * Central resolution of the public app URL and voice-bridge URL.
 *
 * Why this exists
 * ---------------
 * These values are pasted into the Vercel dashboard by hand, and a pasted
 * value can silently carry invisible characters - most often a UTF-8 BOM
 * (U+FEFF) when the string is copied out of a file, but also zero-width
 * spaces or a stray pair of quotes.
 *
 * Those characters are invisible in the dashboard but they are *truthy*, so
 * the usual `process.env.X || 'https://fallback'` keeps them and every URL
 * built from the value is no longer an absolute URL:
 *
 *   answer_url = "\uFEFFhttps://app.nobogent.com/api/voice/vobiz/xml?..."
 *
 * Vobiz then rejects the call with `answer_url parameter is not valid`, the
 * call is never placed, and the only user-visible symptom is
 * "AI calling doesn't work" - no exception, no call record, nothing to grep.
 * The same corruption also poisons status/recording callbacks and the
 * telephony WebSocket stream URL.
 *
 * Resolution therefore strips invisible characters, surrounding quotes,
 * whitespace and trailing slashes, and falls back to the known-good value
 * when nothing usable survives.
 */

export const PUBLIC_APP_URL_FALLBACK = 'https://app.nobogent.com'
export const VOICE_BRIDGE_URL_FALLBACK = 'wss://gemini-voice-bridge-805895515412.us-central1.run.app'

/** Invisible characters that sneak in through copy/paste. U+00A0 is a non-breaking space. */
const INVISIBLE_CHARS = /[\uFEFF\u200B\u200C\u200D\u2060\u00A0]/g
/** Same set, non-global so `.test()` stays stateless. */
const HAS_INVISIBLE_CHARS = /[\uFEFF\u200B\u200C\u200D\u2060\u00A0]/

/**
 * Strips invisible characters, surrounding quotes/whitespace and trailing
 * slashes from an env-provided URL. Returns the fallback when the value is
 * missing, blank, or reduced to nothing but junk.
 */
export function sanitizeEnvUrl(raw: string | null | undefined, fallback: string): string {
    const cleaned = String(raw ?? '')
        .replace(INVISIBLE_CHARS, '')
        .replace(/^[\s"']+/, '')
        .replace(/[\s"']+$/, '')
        .replace(/\/+$/, '')

    return cleaned || fallback
}

/**
 * Absolute public origin of the web app - always `https://`, never a trailing
 * slash, never localhost. Safe to concatenate paths and query strings onto.
 */
export function resolveAppUrl(): string {
    const candidate = sanitizeEnvUrl(
        process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL,
        PUBLIC_APP_URL_FALLBACK
    )

    // A local/dev host is never a valid public callback target.
    if (/localhost|127\.0\.0\.1|local\.nobogent\.com/i.test(candidate)) {
        return PUBLIC_APP_URL_FALLBACK
    }

    // Anything that is not scheme-qualified would be rejected downstream
    // (Vobiz requires an absolute https answer_url).
    if (!/^https?:\/\//i.test(candidate)) {
        return PUBLIC_APP_URL_FALLBACK
    }

    // Telephony providers only accept https callbacks.
    return candidate.replace(/^http:\/\//i, 'https://')
}

/**
 * Voice-bridge host in WebSocket form (`wss://...`), which is what the
 * bidirectional media stream URL is built from.
 */
export function resolveVoiceBridgeUrl(): string {
    const candidate = sanitizeEnvUrl(
        process.env.GEMINI_VOICE_BRIDGE_URL || process.env.NEXT_PUBLIC_VOICE_BRIDGE_URL,
        VOICE_BRIDGE_URL_FALLBACK
    )

    if (!/^(wss?|https?):\/\//i.test(candidate)) {
        return VOICE_BRIDGE_URL_FALLBACK
    }

    return candidate
}

/**
 * Same bridge host in http(s) form, for health checks and XML/status routes.
 */
export function resolveVoiceBridgeHttpUrl(): string {
    return resolveVoiceBridgeUrl()
        .replace(/^wss:\/\//i, 'https://')
        .replace(/^ws:\/\//i, 'http://')
}

/**
 * Guard for telephony callbacks. Vobiz/Plivo require an absolute https URL;
 * anything else (a BOM-prefixed value, a relative path, plain http) is
 * rejected with a deliberately vague "not valid" error, so we check it here
 * and fail loudly with the reason instead.
 */
export function isAbsoluteHttpsUrl(value: string | null | undefined): boolean {
    if (!value || typeof value !== 'string') return false
    if (HAS_INVISIBLE_CHARS.test(value)) return false
    return /^https:\/\/[^\s/]+\.[^\s]+$/i.test(value)
}

/**
 * Human-readable description of why a URL is unusable - for logs and for the
 * error we surface to the caller.
 */
export function describeUrlProblem(value: string | null | undefined): string | null {
    if (!value) return 'URL is empty'
    if (HAS_INVISIBLE_CHARS.test(value)) {
        return 'URL contains invisible characters (BOM / zero-width) - check the env var for a bad paste'
    }
    if (!/^https?:\/\//i.test(value)) return 'URL is not absolute (missing https://)'
    if (!/^https:\/\//i.test(value)) return 'URL is not https (telephony providers require https)'
    return null
}
