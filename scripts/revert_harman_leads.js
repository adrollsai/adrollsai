const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const HARMAN_ID = '7ce0408f-b03f-4af8-a32d-852b6c22da2a';
const BLUESQUARE_ID = '2f62a259-f23b-48ee-a920-c436f36eaa4b';

async function revertHarmanRestoration() {
  console.log('=== REVERTING HARMAN BAJWA LEADS RESTORATION ===\n');

  const backupFilePath = path.join(__dirname, 'backups', 'harman_leads_backup_20260825.json');
  if (!fs.existsSync(backupFilePath)) {
    console.error(`Backup file not found at: ${backupFilePath}`);
    process.exit(1);
  }

  const backupData = JSON.parse(fs.readFileSync(backupFilePath, 'utf8'));
  const leads = backupData.leads || [];

  console.log(`Loaded backup from ${backupData.timestamp} containing ${leads.length} leads.`);

  // Group by previous assignee
  const groupsByPrevAssignee = {};
  leads.forEach(l => {
    const prev = l.previous_assigned_to || '__NULL__';
    if (!groupsByPrevAssignee[prev]) {
      groupsByPrevAssignee[prev] = [];
    }
    groupsByPrevAssignee[prev].push(l.id);
  });

  for (const [prevAssignee, leadIds] of Object.entries(groupsByPrevAssignee)) {
    const targetVal = prevAssignee === '__NULL__' ? null : prevAssignee;
    console.log(`Reverting ${leadIds.length} leads back to assigned_to: ${targetVal || 'Unassigned (null)'}...`);

    for (let i = 0; i < leadIds.length; i += 100) {
      const chunk = leadIds.slice(i, i + 100);
      const { error } = await supabase
        .from('leads')
        .update({ assigned_to: targetVal })
        .in('id', chunk);

      if (error) {
        console.error('Error updating chunk:', error);
      }
    }
  }

  const { count: finalCount } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', BLUESQUARE_ID)
    .eq('assigned_to', HARMAN_ID);

  console.log(`\n--- REVERT COMPLETE ---`);
  console.log(`Harman's current total lead count in DB: ${finalCount}`);
}

revertHarmanRestoration();
