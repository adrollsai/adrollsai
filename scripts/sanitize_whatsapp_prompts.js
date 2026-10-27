const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabase.from('voice_campaigns').select('id, name, custom_prompt');
  if (error) {
    console.error('Fetch error:', error);
    return;
  }

  let updated = 0;
  for (const c of (data || [])) {
    if (!c.custom_prompt) continue;
    let p = c.custom_prompt;
    let changed = false;

    // Remove or replace any send_whatsapp_info references
    if (p.includes('send_whatsapp_info')) {
      p = p.replace(/[-*•]?\s*(?:Use|trigger|call)\s*[`'"]?send_whatsapp_info[`'"]?[^\n]*/gi, 
        '- If the prospect requests details or brochures on WhatsApp, state that our senior relationship manager will connect with them directly and share all details.');
      changed = true;
    }

    // Replace promises to send on WhatsApp in Hindi / Hinglish
    const hindiWhatsAppRegex = /"(?:Ji )?bilkul sir, main (?:complete brochure aur layout )?WhatsApp par (?:bhej rahi hoon|brochure aur layout share karwa deti hoon|inventory sheet aur details share karwa deti hoon)[^"]*"/gi;
    if (hindiWhatsAppRegex.test(p)) {
      p = p.replace(hindiWhatsAppRegex,
        '"Ji bilkul sir, main hamare senior relationship manager ko bol deti hoon, woh aapse directly connect karke saari details share kar denge."');
      changed = true;
    }

    // Generic pattern for "WhatsApp par bhej" or "WhatsApp par share"
    if (/WhatsApp par (?:bhej|share)/i.test(p)) {
      p = p.replace(/WhatsApp par (?:bhej|share) karwa? deti hoon[^.,\n"]*/gi,
        'hamare senior relationship manager ko bol deti hoon, woh aapse directly connect karke saari details share kar denge');
      changed = true;
    }

    // English promises
    if (/I will send (?:the )?(?:brochure|details) (?:to|on) (?:your )?WhatsApp/i.test(p)) {
      p = p.replace(/I will send (?:the )?(?:brochure|details) (?:to|on) (?:your )?WhatsApp[^.,\n]*/gi,
        'our senior relationship manager will connect with you directly and share all the details');
      changed = true;
    }

    if (/confirm you are sending the brochure and details on their WhatsApp/i.test(p)) {
      p = p.replace(/confirm you are sending the brochure and details on their WhatsApp/gi,
        'confirm that our senior relationship manager will connect with them directly with all details');
      changed = true;
    }

    if (changed) {
      const { error: updErr } = await supabase.from('voice_campaigns').update({ custom_prompt: p }).eq('id', c.id);
      if (updErr) {
        console.error('Failed to update', c.name, updErr);
      } else {
        updated++;
        console.log('Cleaned campaign:', c.name);
      }
    }
  }
  console.log(`Successfully sanitized ${updated} campaign prompts in DB.`);
}

run();
