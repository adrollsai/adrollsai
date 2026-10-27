import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
import { parseCustomFields } from '../utils/lead-helpers';
import { categorizeLeadStage } from '../utils/pipeline-stages';

async function testSimulation() {
  const bhavdeepId = '59dd14ee-8af1-47fe-bec0-3b2d8914f4fe';
  const { data: leads, error } = await supabase.from('leads').select('*').eq('assigned_to', bhavdeepId);

  if (error || !leads) {
    console.error('Error fetching leads:', error);
    return;
  }

  console.log(`Fetched ${leads.length} leads for Bhavdeep.`);

  // Test 1: Action Manager Matrix calculation
  const todayObj = new Date();
  const todayStr = `${todayObj.getFullYear()}-${String(todayObj.getMonth() + 1).padStart(2, '0')}-${String(todayObj.getDate()).padStart(2, '0')}`;
  
  const getLocalDateStr = (dateVal: any): string | null => {
    if (!dateVal) return null;
    let d = new Date(dateVal);
    if (!d || isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const pendingLeads: any[] = [];
  leads.forEach((l, idx) => {
    try {
      let cf = parseCustomFields(l.custom_fields);
      const stageCat = categorizeLeadStage(l);
      if (stageCat === 'not_interested' || stageCat === 'trash') return;

      const stageLower = String(l.pipeline_stage || '').trim().toLowerCase();
      const statusLower = String(l.status || '').trim().toLowerCase();
      if (['won', 'closed'].includes(stageLower) || ['won', 'closed'].includes(statusLower)) return;

      const lastFollowupDateStr = getLocalDateStr(cf?.last_followup_at || l.last_call_at);
      const nextActionDateStr = getLocalDateStr(l.next_followup || cf?.next_action_date || l.booked_time);

      if (!nextActionDateStr) return;

      if (nextActionDateStr < todayStr) {
        pendingLeads.push(l);
      }
    } catch (err: any) {
      console.error(`Crash on lead ${l.id} (${l.name}) in matrix:`, err.message);
    }
  });

  console.log(`Found ${pendingLeads.length} active pending leads.`);

  // Test 2: Filter evaluation on drilldown for all pending leads
  const testFilters = [
    { type: 'ALL', nextActionFilter: 'ALL', dnp: 'ALL', search: '' },
    { type: 'Call', nextActionFilter: 'OVERDUE', dnp: 'ALL', search: '' },
    { type: 'Visit', nextActionFilter: 'ALL', dnp: 'DNP_ONLY', search: '' },
    { type: 'ALL', nextActionFilter: 'OVERDUE', dnp: 'DNP_1', search: 'Gur' },
    { type: 'Call', nextActionFilter: 'OVERDUE', dnp: 'ALL', dateRange: 'TODAY' },
    { type: 'Call', nextActionFilter: 'OVERDUE', dnp: 'ALL', dateRange: '7D' },
    { type: 'Call', nextActionFilter: 'OVERDUE', dnp: 'ALL', customDate: '2026-10-11' },
    { type: 'Call', nextActionFilter: 'OVERDUE', dnp: 'ALL', startDate: '2026-10-01', endDate: '2026-10-11' }
  ];

  testFilters.forEach((filterConfig, fIdx) => {
    try {
      const filtered = pendingLeads.filter(l => {
        let cf = parseCustomFields(l.custom_fields);
        const actionDateStr = l.next_action_date || l.next_followup || cf?.next_action_date || l.booked_time;
        const hasActionDate = !!actionDateStr;

        if (filterConfig.nextActionFilter === 'OVERDUE') {
          if (!hasActionDate) return false;
          const d = new Date(actionDateStr);
          if (isNaN(d.getTime())) return false;
          const now = new Date();
          const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          if (d >= startOfToday) return false;
        }

        if (filterConfig.type !== 'ALL') {
          const rawActType = String(cf?.next_action_type || l.next_action_type || l.last_followup_type || 'Call').trim().toLowerCase();
          let actType = 'Call';
          if (rawActType.includes('visit')) actType = 'Visit';
          if (actType.toLowerCase() !== filterConfig.type.toLowerCase()) return false;
        }

        if (filterConfig.search) {
          const q = filterConfig.search.toLowerCase().trim();
          const nameMatch = String(l.name || '').toLowerCase().includes(q);
          const phoneMatch = String(l.phone || '').includes(q);
          if (!nameMatch && !phoneMatch) return false;
        }

        return true;
      });
      console.log(`Filter Config #${fIdx} matched: ${filtered.length} leads.`);
    } catch (err: any) {
      console.error(`Crash on filter config #${fIdx}:`, err.message);
    }
  });

  // Test 3: Simulate adding remarks to every pending lead
  console.log('\n--- Simulating updating remarks on pending leads ---');
  let simulationErrors = 0;
  for (const lead of pendingLeads) {
    try {
      const updatedFields = {
        id: lead.id,
        status: 'Contacted',
        pipeline_stage: 'Contacted',
        next_followup: '2026-10-12T05:30:00.000Z',
        notes: (lead.notes || '') + '\n[Followup (Call)]: Spoke to client, reschedule tomorrow',
        custom_fields: {
          last_followup_at: new Date().toISOString(),
          last_followup_type: 'Call',
          last_call_dnp: false,
          next_action_date: '2026-10-12T05:30:00.000Z',
          next_action_type: 'Call',
          next_action_remark: 'Call tomorrow',
          last_remark: 'Spoke to client, reschedule tomorrow'
        }
      };

      const existingCf = parseCustomFields(lead.custom_fields);
      const updatedCf = parseCustomFields(updatedFields.custom_fields);
      const mergedUpdatedLead = {
        ...lead,
        ...updatedFields,
        custom_fields: {
          ...existingCf,
          ...updatedCf
        }
      };

      // Test shouldLeadStay
      const tLower = 'bhavdeep singh - all pending actions total 69 pending actions';
      const stageLower = String(mergedUpdatedLead.pipeline_stage || mergedUpdatedLead.status || '').trim().toLowerCase();
      const isLostOrWon = ['won', 'closed'].includes(stageLower);
      
      let stillBelongs = true;
      if (isLostOrWon) stillBelongs = false;
      if (tLower.includes('pending')) {
        const nextActionDateStr = getLocalDateStr(mergedUpdatedLead.next_followup || updatedCf.next_action_date);
        if (!nextActionDateStr || nextActionDateStr >= todayStr) {
          stillBelongs = false;
        }
      }

      if (stillBelongs !== false) {
        console.warn(`Lead ${lead.id} should have been rescheduled out of Pending!`);
      }
    } catch (err: any) {
      console.error(`Crash during remark update on lead ${lead.id}:`, err);
      simulationErrors++;
    }
  }

  console.log(`Simulation finished with ${simulationErrors} errors.`);
}

testSimulation().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
