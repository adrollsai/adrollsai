const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function addCreditsToGnr() {
  const gnrUserId = '42d2e0c5-4fe6-4738-8a9f-63f09be01f12';
  
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, email, business_name, credits')
    .eq('id', gnrUserId)
    .single();

  const currentBalance = Number(profile.credits) || 0;
  const newBalance = currentBalance + 10000;

  console.log(`Adding 10,000 credits to GNR Homes (${profile.email}). Current: ${currentBalance} -> New: ${newBalance}`);

  const { error: updateErr } = await supabaseAdmin
    .from('profiles')
    .update({ credits: newBalance })
    .eq('id', gnrUserId);

  if (updateErr) {
    console.error("Failed to update credits:", updateErr);
  } else {
    // Record transaction
    try {
      await supabaseAdmin.from('credit_transactions').insert({
        user_id: gnrUserId,
        amount: 10000,
        type: 'bonus',
        description: 'Admin bonus: 10,000 Nobo credits added'
      });
    } catch (e) {
      console.log("Transaction log notice:", e.message);
    }
    console.log("SUCCESSFULLY added 10,000 Nobo Credits! New Balance:", newBalance);
  }
}

addCreditsToGnr();
