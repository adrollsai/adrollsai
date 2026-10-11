import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
import { isFreshStageName } from '../utils/pipeline-stages';

async function reconcileDatabaseLeads() {
  console.log('Fetching all leads marked New Lead / Fresh...');
  let allLeads: any[] = [];
  let page = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, name, phone, pipeline_stage, status, next_followup, custom_fields, assigned_to')
      .or('pipeline_stage.eq.New Lead,pipeline_stage.eq.new,pipeline_stage.eq.New,pipeline_stage.eq.fresh,pipeline_stage.eq.Fresh')
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error || !data || data.length === 0) break;
    allLeads = allLeads.concat(data);
    if (data.length < pageSize) break;
    page++;
  }

  console.log(`Loaded ${allLeads.length} leads with fresh stage in DB.`);

  // Find leads that actually have worked activity
  const toUpdate: any[] = [];
  for (const l of allLeads) {
    let cf = l.custom_fields;
    if (typeof cf === 'string') {
      try { while (typeof cf === 'string') cf = JSON.parse(cf); } catch (e) { cf = {}; }
    } else if (!cf) {
      cf = {};
    }

    const hasWorkedActivity = Boolean(
      l.next_followup ||
      cf?.next_action_date ||
      cf?.last_remark ||
      cf?.last_followup_at ||
      (cf?.followup_count && Number(cf.followup_count) > 0)
    );

    if (hasWorkedActivity) {
      const cfStage = (cf?.pipeline_stage || cf?.status || cf?.lead_status || '').trim();
      const targetStage = cfStage && !isFreshStageName(cfStage) ? cfStage : 'Contacted';
      
      const updatedCf = {
        ...cf,
        pipeline_stage: targetStage,
        status: targetStage
      };

      toUpdate.push({
        id: l.id,
        name: l.name,
        targetStage,
        updatedCf
      });
    }
  }

  console.log(`Found ${toUpdate.length} leads with worked activity that need database stage reconciliation.`);

  // Update in batches of 50
  let updatedCount = 0;
  for (let i = 0; i < toUpdate.length; i += 50) {
    const batch = toUpdate.slice(i, i + 50);
    for (const item of batch) {
      const { error } = await supabase
        .from('leads')
        .update({
          pipeline_stage: item.targetStage,
          status: item.targetStage,
          custom_fields: item.updatedCf
        })
        .eq('id', item.id);

      if (!error) {
        updatedCount++;
      } else {
        console.error(`Failed to update lead ${item.id}:`, error.message);
      }
    }
    console.log(`Reconciled ${updatedCount}/${toUpdate.length} leads...`);
  }

  console.log(`✅ Finished! Successfully reconciled ${updatedCount} leads in the database.`);
}

reconcileDatabaseLeads().catch(err => console.error('Fatal error:', err));
