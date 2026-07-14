import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { callGemini } from '@/utils/external-apis'

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
    try {
        const { questionId } = await req.json()
        if (!questionId) {
            return NextResponse.json({ error: 'Missing questionId' }, { status: 400 })
        }

        // Fetch question text from DB
        const { data: fq, error: fetchErr } = await supabaseAdmin
            .from('flagged_questions')
            .select('question')
            .eq('id', questionId)
            .single()

        if (fetchErr || !fq) {
            return NextResponse.json({ error: 'Question not found' }, { status: 404 })
        }

        const questionText = fq.question

        // Use Gemini to analyze language and translate
        const prompt = `You are a translation assistant.
Analyze this user question from a business lead: "${questionText}".
Identify the language of the question (e.g. English, Hinglish, Spanish, Hindi, French, etc.) and translate it to English.
Respond with ONLY a valid JSON object matching this schema:
{
  "language": "string (name of the language/script, e.g., 'Hinglish', 'Hindi (Devanagari)', 'Spanish')",
  "translation": "string (the English translation of the question. If the original question is already in English, set this to the original text)"
}
Do NOT include any markdown formatting, backticks, or extra text. Return strictly the raw JSON object.`

        const rawRes = await callGemini(prompt)
        const cleanJson = rawRes.replace(/```json/gi, '').replace(/```/g, '').trim()
        
        let language = 'Unknown'
        let translation = questionText

        try {
            const parsed = JSON.parse(cleanJson)
            language = parsed.language || 'Unknown'
            translation = parsed.translation || questionText
        } catch (parseErr) {
            console.error('[ENRICH QUESTION] JSON parse failed on Gemini response:', rawRes)
            // Fallback: try regex matching
            const langMatch = rawRes.match(/"language"\s*:\s*"([^"]+)"/)
            const transMatch = rawRes.match(/"translation"\s*:\s*"([^"]+)"/)
            if (langMatch) language = langMatch[1]
            if (transMatch) translation = transMatch[1]
        }

        // Save back to database
        const { error: updateErr } = await supabaseAdmin
            .from('flagged_questions')
            .update({
                language,
                translation
            })
            .eq('id', questionId)

        if (updateErr) {
            console.error('[ENRICH QUESTION] Failed to update db:', updateErr)
        }

        return NextResponse.json({
            success: true,
            language,
            translation
        })

    } catch (e: any) {
        console.error('[ENRICH QUESTION] Unexpected error:', e)
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
    }
}
