import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { addCredits } from '../utils/credits';

dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("❌ Missing Supabase credentials");
  process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function runCreditAllocation() {
  const adminId = '29937131-1975-4c5f-9b78-e5b28f918d32'; // The ProEstate Main Admin
  const subId = '59cd329c-c1f5-45e1-9d41-a0642d5132f4';   // Aparna (Sub-account proestate)

  console.log("Adding 1000 credits to ProEstate main admin workspace...");
  const success1 = await addCredits(supabaseAdmin, adminId, 1000, 'topup', 'Manual admin topup (1000 Nobo Credits)');
  console.log("Main Admin credit grant success:", success1);

  console.log("Adding 1000 credits to ProEstate sub-account profile...");
  const { data: subProf } = await supabaseAdmin.from('profiles').select('credits').eq('id', subId).single();
  const currentSubCredits = subProf?.credits || 0;
  const newSubCredits = currentSubCredits + 1000;

  const { error: subErr } = await supabaseAdmin.from('profiles').update({ credits: newSubCredits }).eq('id', subId);
  await supabaseAdmin.from('credit_transactions').insert({
    user_id: subId,
    amount: 1000,
    category: 'topup',
    description: 'Manual sub-account topup (1000 Nobo Credits)'
  });

  if (subErr) {
    console.error("Sub account update error:", subErr);
  } else {
    console.log(`Sub account updated successfully! New sub-account credits: ${newSubCredits}`);
  }

  // Fetch updated balances
  const { data: updated } = await supabaseAdmin
    .from('profiles')
    .select('id, email, business_name, credits, role')
    .in('id', [adminId, subId]);

  console.log("==========================================");
  console.log("🎉 FINAL PROESTATE ACCOUNTS CREDIT BALANCE");
  console.log("==========================================");
  console.log(updated);
}

runCreditAllocation().catch(err => console.error("Fatal error:", err));
