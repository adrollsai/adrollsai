const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const OWNER_ID = '2f62a259-f23b-48ee-a920-c436f36eaa4b';
const HARMAN_ID = '7ce0408f-b03f-4af8-a32d-852b6c22da2a';
const MUNENDER_ID = '17cd53d4-fed6-4d71-87c3-ad69ab052553';

async function checkAttempts() {
  // Check lead_history created in October 2026 for Harman and Munender
  const { data: hOct } = await supabase.from('lead_history')
    .select('*')
    .in('user_id', [HARMAN_ID, MUNENDER_ID])
    .gte('created_at', '2026-10-01T00:00:00Z');
  
  console.log('October history count for Harman & Munender:', hOct?.length || 0);
  if (hOct && hOct.length > 0) {
    console.log('Sample October history:', JSON.stringify(hOct.slice(0, 3), null, 2));
  }

  // Check leads with notes mentioning Harman or Munender
  const { data: leadsWithHarmanNotes } = await supabase.from('leads')
    .select('id, name, assigned_to, updated_at, notes')
    .eq('user_id', OWNER_ID)
    .ilike('notes', '%harman%')
    .limit(5);

  console.log('Leads with Harman in notes:', leadsWithHarmanNotes?.length || 0);
  if (leadsWithHarmanNotes && leadsWithHarmanNotes.length > 0) {
    console.log('Sample lead with Harman in notes:', leadsWithHarmanNotes[0].notes.slice(0, 200));
  }

  const { data: leadsWithMunenderNotes } = await supabase.from('leads')
    .select('id, name, assigned_to, updated_at, notes')
    .eq('user_id', OWNER_ID)
    .ilike('notes', '%munender%')
    .limit(5);

  console.log('Leads with Munender in notes:', leadsWithMunenderNotes?.length || 0);
  if (leadsWithMunenderNotes && leadsWithMunenderNotes.length > 0) {
    console.log('Sample lead with Munender in notes:', leadsWithMunenderNotes[0].notes.slice(0, 200));
  }
}

checkAttempts();
