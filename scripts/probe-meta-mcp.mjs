/**
 * Probes whether the user's stored Meta token can actually reach Meta's official
 * ads MCP server. Prints granted permissions and the raw MCP response, so the
 * next step is driven by evidence instead of assumption.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const GRAPH = 'https://graph.facebook.com/v21.0';
const MCP_URL = 'https://mcp.facebook.com/ads';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: profiles } = await sb
  .from('profiles')
  .select('id, business_name, facebook_token, ad_account_id, selected_page_id')
  .not('facebook_token', 'is', null)
  .limit(5);

console.log(`profiles with a facebook_token: ${profiles?.length || 0}\n`);

for (const p of profiles || []) {
  const token = String(p.facebook_token || '').trim();
  console.log(`--- ${p.id} (${p.business_name || 'unnamed'}) token len=${token.length} adAccount=${p.ad_account_id || 'none'}`);

  // 1. Which permissions did this token actually get?
  try {
    const res = await fetch(`${GRAPH}/me/permissions?access_token=${encodeURIComponent(token)}`);
    const json = await res.json();
    if (json.error) {
      console.log(`  permissions ERROR: ${json.error.message} (code ${json.error.code})`);
    } else {
      const granted = (json.data || []).filter((d) => d.status === 'granted').map((d) => d.permission);
      const has = (s) => (granted.includes(s) ? 'YES' : 'no');
      console.log(`  granted (${granted.length}): ${granted.join(', ') || 'none'}`);
      console.log(`  ads_mcp_management: ${has('ads_mcp_management')}  ads_management: ${has('ads_management')}  ads_read: ${has('ads_read')}`);
    }
  } catch (e) {
    console.log(`  permissions threw: ${e.message}`);
  }

  // 2. Does the official MCP server accept the token at all?
  try {
    const res = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
    });
    const text = await res.text();
    console.log(`  MCP tools/list -> HTTP ${res.status} ${res.headers.get('content-type') || ''}`);
    console.log(`  body: ${text.slice(0, 700)}`);
  } catch (e) {
    console.log(`  MCP call threw: ${e.message}`);
  }
  console.log('');
}
