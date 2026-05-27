const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const geminiApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

if (!supabaseUrl || !supabaseServiceKey || !geminiApiKey) {
    console.error("Missing required environment variables in .env.local");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function analyzeProfileCharacter() {
    const targetUserId = '2f62a259-f23b-48ee-a920-c436f36eaa4b';
    
    // Fetch profile
    const { data: profile, error: fetchErr } = await supabase
        .from('profiles')
        .select('id, character_url')
        .eq('id', targetUserId)
        .single();

    if (fetchErr || !profile) {
        console.error("Error fetching profile:", fetchErr);
        return;
    }

    if (!profile.character_url) {
        console.log("No character_url found for this profile.");
        return;
    }

    console.log(`Fetching character image: ${profile.character_url}`);
    try {
        const imageRes = await fetch(profile.character_url);
        if (!imageRes.ok) {
            console.error(`Failed to fetch image: ${imageRes.statusText}`);
            return;
        }

        const buffer = Buffer.from(await imageRes.arrayBuffer());
        const mimeType = imageRes.headers.get('content-type') || 'image/jpeg';

        console.log("Initializing GoogleGenerativeAI...");
        const genAI = new GoogleGenerativeAI(geminiApiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

        const prompt = "You are a casting director. Analyze this profile character photo and describe their exact gender (e.g. 'male' or 'female'), ethnicity/appearance, age range, hair style/color, expression, clothing style, and background environment in a short single paragraph of under 40 words. Focus strictly on their physical appearance (e.g., 'A professional young Indian man with short black hair, clean-shaven, wearing a suit and smiling warmly'). Do not add any conversational intro or metadata.";

        console.log("Generating analysis with Gemini Vision...");
        const result = await model.generateContent([
            prompt,
            {
                inlineData: {
                    data: buffer.toString('base64'),
                    mimeType
                }
            }
        ]);

        const desc = result.response.text()?.trim();
        console.log(`Analyzed description: "${desc}"`);

        if (desc) {
            const { data: updatedProfile, error: updateErr } = await supabase
                .from('profiles')
                .update({ character_description: desc })
                .eq('id', targetUserId)
                .select()
                .single();

            if (updateErr) {
                console.error("Error updating profile in Supabase:", updateErr);
            } else {
                console.log("Successfully updated character_description in Supabase!");
                console.log(JSON.stringify(updatedProfile, null, 2));
            }
        }
    } catch (err) {
        console.error("Fatal error during analysis:", err);
    }
}

analyzeProfileCharacter();
