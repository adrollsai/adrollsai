/**
 * Which columns make a lead row 2 KB?
 *
 * The CRM pulls 28 columns for 16,000 rows. If one or two of them are free text, the list is paying
 * megabytes for data it displays in a drawer.
 */
import { createClient } from '@supabase/supabase-js';

const ACCOUNT = '2f62a259-f23b-48ee-a920-c436f36eaa4b'; // Blue Square Infra, 16,415 leads

(async () => {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data, error } = await db
    .from('leads')
    .select('*')
    .or(`user_id.eq.${ACCOUNT},assigned_to.eq.${ACCOUNT}`)
    .order('last_activity_at', { ascending: false })
    .range(0, 999);
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const totals: Record<string, number> = {};
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (value === null || value === undefined) continue;
      const size = typeof value === 'string' ? value.length : JSON.stringify(value).length;
      totals[key] = (totals[key] ?? 0) + size;
    }
  }

  const grand = Object.values(totals).reduce((sum, value) => sum + value, 0);
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  console.log(`1,000 rows, ${(grand / 1024 / 1024).toFixed(2)} MB of field data\n`);
  console.log('column'.padEnd(30), 'total'.padStart(10), 'per row'.padStart(10), 'share'.padStart(8));
  for (const [key, bytes] of sorted.slice(0, 14)) {
    console.log(
      key.padEnd(30),
      `${(bytes / 1024).toFixed(0)} KB`.padStart(10),
      `${Math.round(bytes / rows.length)} B`.padStart(10),
      `${((bytes / grand) * 100).toFixed(1)}%`.padStart(8)
    );
  }
  console.log(`\ncolumns returned: ${Object.keys(totals).length}`);
})();
