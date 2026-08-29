const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function revertShubhaRestoration() {
    console.log('================================================================');
    console.log('⏪ REVERTING SHUBHA RESTORATION TO PREVIOUS STATE');
    console.log('================================================================\n');

    const backupFilePath = path.join(__dirname, 'backups', 'shubha_leads_backup_20260826.json');
    if (!fs.existsSync(backupFilePath)) {
        console.error(`Backup file not found at: ${backupFilePath}`);
        return;
    }

    const backupData = JSON.parse(fs.readFileSync(backupFilePath, 'utf8'));
    console.log(`Loaded backup timestamped at: ${backupData.timestamp}`);
    console.log(`Total leads to revert: ${backupData.leads.length}`);

    let revertedCount = 0;
    const BATCH_SIZE = 100;

    for (let i = 0; i < backupData.leads.length; i += BATCH_SIZE) {
        const chunk = backupData.leads.slice(i, i + BATCH_SIZE);

        for (const item of chunk) {
            const revertPayload = {
                assigned_to: item.previous_assigned_to || null,
                pipeline_stage: item.previous_pipeline_stage,
                status: item.previous_status,
                notes: item.previous_notes,
                next_followup: item.previous_next_followup
            };

            const { error } = await supabase
                .from('leads')
                .update(revertPayload)
                .eq('id', item.id);

            if (error) {
                console.error(`Error reverting lead ${item.id}:`, error.message);
            } else {
                revertedCount++;
            }
        }
        process.stdout.write(`\r⏳ Reverting progress: ${revertedCount}/${backupData.leads.length} (${Math.round((revertedCount / backupData.leads.length) * 100)}%)...`);
    }

    console.log(`\n\n✅ REVERT COMPLETE!`);
    console.log(`Successfully reverted ${revertedCount} leads back to their exact previous state.`);
}

revertShubhaRestoration().catch(console.error);
