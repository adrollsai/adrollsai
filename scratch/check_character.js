const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
    'https://dvygrupphzjitzbrtlve.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2eWdydXBwaHpqaXR6YnJ0bHZlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTM4OTkxNiwiZXhwIjoyMDgwOTY1OTE2fQ.WfJTY1EDtVAIePBlf97wVAiZlxNKUWydcXP-LcEiCDA'
);

async function main() {
    const { data, error } = await sb
        .from('profiles')
        .select('character_description, character_url')
        .eq('id', 'bc63c065-9bcc-4793-bedc-f0960406425b')
        .single();

    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Character Description:', data.character_description);
        console.log('Character URL:', data.character_url);
        
        // Test the OLD broken regex
        const oldIsMale = /male|man|boy|gentleman|he\b/i.test(data.character_description || "");
        console.log('\n--- OLD (broken) regex result ---');
        console.log('isMale:', oldIsMale, '→ voiceGender:', oldIsMale ? 'male' : 'female');
        
        // Test the NEW fixed regex
        const desc = data.character_description || "";
        const isFemale = /\bfemale\b|\bwoman\b|\bgirl\b|\blady\b|\bshe\b|\bher\b/i.test(desc);
        const newIsMale = !isFemale && /\bmale\b|\bman\b|\bboy\b|\bgentleman\b|\bhe\b/i.test(desc);
        console.log('\n--- NEW (fixed) regex result ---');
        console.log('isFemale:', isFemale);
        console.log('isMale:', newIsMale, '→ voiceGender:', newIsMale ? 'male' : 'female');
    }
}

main();
