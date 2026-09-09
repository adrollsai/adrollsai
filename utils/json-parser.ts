/**
 * Robust JSON extractor that handles:
 * 1. Clean JSON strings
 * 2. Markdown code fences (```json ... ``` or ``` ... ```)
 * 3. Conversational text surrounding JSON (e.g. "Here are the results: { ... }")
 * 4. Trailing commas and control characters
 */
export function extractJsonFromText<T = any>(text: string, defaultValue?: T): T {
    if (!text || typeof text !== 'string') {
        if (defaultValue !== undefined) return defaultValue;
        throw new Error("No text provided to extract JSON from.");
    }

    const trimmed = text.trim();

    // 1. Attempt standard direct parse
    try {
        return JSON.parse(trimmed);
    } catch (_) {}

    // 2. Strip markdown code fences (```json ... ``` or ``` ...)
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch && fenceMatch[1]) {
        try {
            return JSON.parse(fenceMatch[1].trim());
        } catch (_) {}
    }

    // 3. Locate the outermost JSON object {...} or array [...]
    const firstBrace = trimmed.indexOf('{');
    const firstBracket = trimmed.indexOf('[');

    let startIdx = -1;
    let endIdx = -1;

    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
        startIdx = firstBrace;
        endIdx = trimmed.lastIndexOf('}');
    } else if (firstBracket !== -1) {
        startIdx = firstBracket;
        endIdx = trimmed.lastIndexOf(']');
    }

    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        const candidate = trimmed.slice(startIdx, endIdx + 1);
        try {
            return JSON.parse(candidate);
        } catch (_) {
            // Attempt cleaning syntax quirks (trailing commas, non-printable characters)
            try {
                const cleaned = candidate
                    .replace(/,\s*([}\]])/g, '$1') // remove trailing commas before closing braces
                    .replace(/[\x00-\x1F\x7F-\x9F]/g, ' '); // replace control characters with spaces
                return JSON.parse(cleaned);
            } catch (_) {}
        }
    }

    if (defaultValue !== undefined) {
        return defaultValue;
    }

    throw new Error(`Failed to parse valid JSON from text: ${trimmed.slice(0, 120)}...`);
}
