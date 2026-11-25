/**
 * How slow is the CRM's lead load, really?
 *
 * Measures the exact queries the CRM page makes for a big workspace, page by page, so the fix can be
 * aimed at the slow part instead of guessed at.
 *
 *   npx tsx scripts/probe-crm-lead-load.ts
 */
import { createClient } from '@supabase/supabase-js';

const ACCOUNTS: Array<{ label: string; id: string }> = [
  { label: 'Blue Square Infra', id: '2f62a259-f23b-48ee-a920-c436f36eaa4b' },
  { label: 'Nobogent (owner)', id: 'bc63c065-9bcc-4793-bedc-f0960406425b' },
];

const leadFields =
  'id, created_at, user_id, name, email, phone, notes, status, pipeline_stage, source, ad_name, form_name, next_followup, assigned_to, budget, custom_fields, booked_time, pixel_id, property_id, campaign_id, csv_audience, whatsapp_enabled, calling_enabled, dnp_count, last_call_at, last_call_status, facebook_created_at, last_activity_at';

const ms = (start: number) => `${Date.now() - start}ms`;

(async () => {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  for (const account of ACCOUNTS) {
    console.log(`\n=== ${account.label} ===`);

    let t = Date.now();
    const { count } = await db
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .or(`user_id.eq.${account.id},assigned_to.eq.${account.id}`);
    console.log(`count: ${count} (${ms(t)})`);
    if (!count) continue;

    // Exactly what the page does: first 1000, then every remaining page in parallel.
    const pages = Math.ceil(count / 1000);
    const samplePages = [0, 1, Math.floor(pages / 2), pages - 1].filter((value, index, all) => all.indexOf(value) === index && value >= 0);

    for (const page of samplePages) {
      t = Date.now();
      const { data, error } = await db
        .from('leads')
        .select(leadFields)
        .or(`user_id.eq.${account.id},assigned_to.eq.${account.id}`)
        .order('last_activity_at', { ascending: false })
        .range(page * 1000, (page + 1) * 1000 - 1);
      const bytes = data ? JSON.stringify(data).length : 0;
      console.log(
        `page ${String(page).padStart(2)} rows ${String(data?.length ?? 0).padStart(4)} ` +
          `${ms(t).padStart(7)}  ~${(bytes / 1024).toFixed(0)} KB${error ? `  ERROR ${error.message}` : ''}`
      );
    }

    // The whole thing, the way Promise.all runs it.
    t = Date.now();
    const all = await Promise.all(
      Array.from({ length: pages }, (_, index) =>
        db
          .from('leads')
          .select(leadFields)
          .or(`user_id.eq.${account.id},assigned_to.eq.${account.id}`)
          .order('last_activity_at', { ascending: false })
          .range(index * 1000, (index + 1) * 1000 - 1)
      )
    );
    const rows = all.reduce((sum, page) => sum + (page.data?.length ?? 0), 0);
    const bytes = all.reduce((sum, page) => sum + (page.data ? JSON.stringify(page.data).length : 0), 0);
    console.log(`ALL ${pages} pages in parallel: ${rows} rows, ~${(bytes / 1024 / 1024).toFixed(1)} MB in ${ms(t)}`);
  }
})();
