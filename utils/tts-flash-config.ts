/**
 * Shared configuration for the Gemini 3.8 Flash TTS demo pipeline.
 *
 * The bridge (voice-bridge/tts-flash-pipeline.js) is a plain Node process and
 * cannot import from /utils, so the greeting templates and language list are
 * mirrored there. Keep the two in sync — the demo page previews exactly what
 * the bridge will say.
 */

export const TTS_FLASH_MODELS = {
    tts: process.env.TTS_FLASH_TTS_MODEL || 'gemini-3.8-flash-tts',
    asr: 'gemini-3.5-transcribe-live (streaming)',
    llm: process.env.TTS_FLASH_LLM_MODEL || 'gemini-2.5-flash',
}

/** Designed (prompted) voice created once against the project — reusable id. */
export const DEFAULT_TTS_FLASH_VOICE_ID =
    process.env.TTS_FLASH_VOICE_ID || process.env.NEXT_PUBLIC_TTS_FLASH_VOICE_ID || 'voice_rfag7y46pcq0'

export interface LanguageOption {
    id: string
    label: string
    native: string
    region: string
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
    { id: 'hinglish', label: 'Hinglish', native: 'Hinglish', region: 'North India · default' },
    { id: 'english', label: 'English', native: 'English', region: 'Pan-India' },
    { id: 'hindi', label: 'Hindi', native: 'हिन्दी', region: 'North India' },
    { id: 'punjabi', label: 'Punjabi', native: 'ਪੰਜਾਬੀ', region: 'Punjab' },
    { id: 'tamil', label: 'Tamil', native: 'தமிழ்', region: 'Tamil Nadu' },
    { id: 'telugu', label: 'Telugu', native: 'తెలుగు', region: 'Telangana / AP' },
    { id: 'marathi', label: 'Marathi', native: 'मराठी', region: 'Maharashtra' },
    { id: 'bengali', label: 'Bengali', native: 'বাংলা', region: 'West Bengal' },
    { id: 'kannada', label: 'Kannada', native: 'ಕನ್ನಡ', region: 'Karnataka' },
]

/**
 * The voice persona is designed once via POST /v1beta/voices (type "prompted"):
 * permanent traits only — age, timbre, accent, polyglot ability. Turn-level
 * emotion belongs in per-line style, not here.
 */
export const DEFAULT_VOICE_DESIGN_DESCRIPTION =
    'A warm, confident Indian woman in her late twenties, a senior real estate consultant. ' +
    'Natural conversational pace, a friendly smile in the voice, crisp articulation, subtle ' +
    'north-Indian English accent, never announcer-like or robotic. Fully polyglot and equally ' +
    'fluent in Hindi, Hinglish, Punjabi, Tamil, Telugu, Marathi, Bengali, Kannada and English, ' +
    'switching between them mid-sentence without any accent break.'

export const VOICE_DESIGN_PRESETS = [
    {
        id: 'aanya',
        name: 'Aanya · Warm Consultant',
        agentName: 'Aanya',
        gender: 'female' as AgentGender,
        description: DEFAULT_VOICE_DESIGN_DESCRIPTION,
    },
    {
        id: 'kabir',
        name: 'Kabir · Assured Senior Advisor',
        agentName: 'Kabir',
        gender: 'male' as AgentGender,
        description:
            'A calm, assured Indian man in his mid-thirties, a senior real estate advisor. Deep but ' +
            'relaxed timbre, unhurried delivery, confident and never pushy, subtle Delhi English accent. ' +
            'Fully polyglot — equally natural in Hindi, Hinglish, Punjabi, Urdu and English, switching ' +
            'mid-sentence without an accent break.',
    },
    {
        id: 'meera',
        name: 'Meera · Bright Site Executive',
        agentName: 'Meera',
        gender: 'female' as AgentGender,
        description:
            'A bright, energetic Indian woman in her mid-twenties, a site sales executive. Light, quick, ' +
            'genuinely cheerful delivery with a natural laugh in the voice, crisp consonants, subtle ' +
            'Mumbai accent. Fully polyglot in Hindi, Marathi, Hinglish, Gujarati and English.',
    },
]

export interface GreetingPreviewInput {
    name?: string
    company?: string
    agent?: string
    interest?: string
    language?: string
    gender?: AgentGender
}

export type AgentGender = 'female' | 'male'

/**
 * Mirrors GREETINGS in voice-bridge/tts-flash-pipeline.js.
 *
 * Hindi/Punjabi/Marathi conjugate the first-person verb by the speaker's
 * gender, so a male persona must say "bol raha hoon" / "बोल रहा हूँ" /
 * "ਬੋਲ ਰਿਹਾ ਹਾਂ" / "बोलतोय". The other languages here are gender-neutral.
 */
export function buildGreetingPreview({
    name = 'Rahul',
    company = 'Nobogent Realty',
    agent = 'Aanya',
    interest = '3 BHK in Mohali',
    language = 'hinglish',
    gender = 'female',
}: GreetingPreviewInput): string {
    const first = String(name || '').trim().split(/\s+/)[0]
    const n = !first || first === 'ji' ? 'ji' : `${first} ji`
    const male = gender === 'male'
    const map: Record<string, string> = {
        hinglish: `Hi ${n}, main ${agent} ${male ? 'bol raha hoon' : 'bol rahi hoon'} ${company} se. Aapne ${interest} ke liye enquiry ki thi na?`,
        english: `Hello ${n}, this is ${agent} from ${company}. You had enquired about ${interest} — is now a good time?`,
        hindi: `नमस्ते ${n}, मैं ${agent} ${male ? 'बोल रहा हूँ' : 'बोल रही हूँ'} ${company} से। आपने ${interest} के लिए पूछा था ना?`,
        punjabi: `ਸਤ ਸ੍ਰੀ ਅਕਾਲ ${n}, ਮੈਂ ${agent} ${male ? 'ਬੋਲ ਰਿਹਾ ਹਾਂ' : 'ਬੋਲ ਰਹੀ ਹਾਂ'} ${company} ਤੋਂ। ਤੁਸੀਂ ${interest} ਲਈ ਪੁੱਛਿਆ ਸੀ?`,
        tamil: `வணக்கம் ${n}, நான் ${company} இல் இருந்து ${agent} பேசுகிறேன். ${interest} பற்றி நீங்கள் விசாரித்தீர்களே?`,
        telugu: `నమస్తే ${n}, నేను ${company} నుండి ${agent} మాట్లాడుతున్నాను. మీరు ${interest} గురించి అడిగారు కదా?`,
        marathi: `नमस्कार ${n}, मी ${agent} ${male ? 'बोलतोय' : 'बोलतेय'} ${company} मधून. तुम्ही ${interest} साठी विचारणा केली होती ना?`,
        bengali: `নমস্কার ${n}, আমি ${company} থেকে ${agent} বলছি। আপনি ${interest} সম্পর্কে জিজ্ঞাসা করেছিলেন?`,
        kannada: `ನಮಸ್ಕಾರ ${n}, ನಾನು ${company} ನಿಂದ ${agent} ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ. ನೀವು ${interest} ಬಗ್ಗೆ ವಿಚಾರಿಸಿದ್ದೀರಿ?`,
    }
    return map[language] || map.hinglish
}

/** The qualification ladder the LLM is instructed to walk, shown in the UI. */
export const SCRIPT_STAGES = [
    {
        step: 1,
        title: 'Open & confirm identity',
        detail: 'Greets by name in the previewed language, states the company and the enquiry being called about.',
        sample: 'Hi Rahul ji, main Aanya bol rahi hoon Nobogent Realty se.',
    },
    {
        step: 2,
        title: 'Qualify the requirement',
        detail: 'Configuration (2/3/4 BHK, plot, villa), location, budget, timeline, home loan — only the gaps.',
        sample: 'Aap 3 BHK dekh rahe hain, aur budget sixty lakh tak?',
    },
    {
        step: 3,
        title: 'Pitch one matching option',
        detail: 'Quotes real inventory from the workspace with a single sharp benefit. Never invents a price.',
        sample: 'Isi range mein ek option hai — gated society, park facing, ready to move.',
    },
    {
        step: 4,
        title: 'Handle objections',
        detail: 'Price, "just looking", "already bought", "no time" — acknowledged in one line, then reframed.',
        sample: 'Bilkul samajh sakti hoon. Ek second, ek smaller option bhi hai.',
    },
    {
        step: 5,
        title: 'Book the site visit',
        detail: 'Offers two concrete slots and confirms day, time and how many people are coming.',
        sample: 'Saturday eleven, ya Sunday five — kaunsa better hai?',
    },
    {
        step: 6,
        title: 'Confirm & close',
        detail: 'Repeats name, best number and slot, thanks them, then ends the call with a warm goodbye.',
        sample: 'Perfect. Saturday eleven, aap dono aa rahe hain. Thank you, Rahul ji!',
    },
]

/** Latency budget the pipeline is engineered around (measured on real calls). */
export const LATENCY_BUDGET = [
    { stage: 'Answer → greeting audio', budget: '0.2–0.3 s', how: 'Greeting + call context pre-rendered during ringback' },
    { stage: 'Caller stops → transcript', budget: '~0 ms', how: 'gemini-3.5-transcribe-live streams interims while they talk' },
    { stage: 'Endpointing', budget: '280 ms', how: 'Energy VAD; the streaming interim is already complete at this point' },
    { stage: 'Transcript → first token', budget: '320–430 ms', how: 'gemini-2.5-flash, thinkingBudget 0, one-sentence turns' },
    { stage: 'First token → first audio', budget: '~700 ms', how: 'Streaming TTS, first clause cut at 4-5 words' },
    { stage: 'Turn total (measured)', budget: '1.33–1.40 s', how: '3 of 4 turns on the last verification call' },
]
