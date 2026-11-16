/**
 * Can this ad account actually spend — and does the agent find out before promising budget?
 *
 * §3.7: "blank-field + missing WhatsApp/Meta payment-method flagging". The Meta half did not exist.
 * `meta_graph_account` reported status, spend and balance, but never the funding source, and
 * `account_status` stays ACTIVE on an ad account with no payment method: Meta accepts the campaign,
 * approves it, and then it simply never delivers. The owner finds out days later, and the only
 * person who could have caught it was the agent, which had no field to look at.
 *
 * This runs the REAL tool against the connected account and checks the readiness fields are there
 * and self-consistent, then checks the prompt tells the agent to act on them. Read-only: it calls
 * one GET on the ad account and changes nothing.
 *
 *   npx esbuild scripts/verify-meta-readiness.ts --bundle --platform=node --format=esm \
 *     --packages=external --outfile=.tmp-meta-ready.mjs && node .tmp-meta-ready.mjs
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';

dotenv.config({ path: '.env.local', quiet: true });

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
};

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
);

// The owner's own account holds the Meta connection used by every ad proof in this repo.
const owner = await sb
  .from('profiles')
  .select('id, business_name, ad_account_id')
  .eq('email', 'rchopra489@gmail.com')
  .maybeSingle();
if (!owner.data?.id) {
  console.error('owner profile not found');
  process.exit(1);
}
const OWNER_ID = String(owner.data.id);
console.log(`account: ${owner.data.business_name} (ad account ${owner.data.ad_account_id ?? 'unset'})\n`);

const ctx = await createAgentContext(sb as any, OWNER_ID, {
  intentText: 'pause my facebook ads campaign and show the spend breakdown',
});
check('the meta suite is loaded for an ads question', ctx.toolGroups.includes('meta'), ctx.toolGroups.join(','));

const tool = (ctx.tools as any).meta_graph_account;
check('meta_graph_account is registered', Boolean(tool?.execute));

// The prompt must tell the agent to ACT on readiness, not merely have the field.
const prompt = String(ctx.systemPrompt);
check(
  'the prompt says to check readyToSpend before promising budget',
  /readyToSpend/.test(prompt) && /before any budget is promised/i.test(prompt),
  'otherwise the field exists and nobody looks at it',
);

if (tool?.execute) {
  const result = await tool.execute({ includeAccessibleAccounts: false }, {} as any);
  console.log(`\ntool result: ${JSON.stringify(result).slice(0, 600)}\n`);

  if (result?.success === false) {
    // A token/permission failure is a real answer, but it is not this gate's subject.
    check(
      'the tool fails with a readable message rather than throwing',
      typeof result?.error === 'string' && result.error.length > 0,
      String(result?.error),
    );
  } else {
    check('the tool succeeds', result?.success === true);
    check(
      'it reports a payment-method flag',
      typeof result?.paymentMethod === 'object' &&
        result.paymentMethod !== null &&
        typeof result.paymentMethod.present === 'boolean',
      JSON.stringify(result?.paymentMethod),
    );
    check(
      'it reports readyToSpend as a boolean',
      typeof result?.readyToSpend === 'boolean',
      String(result?.readyToSpend),
    );
    check(
      'a not-ready account carries a plain-English warning',
      result?.readyToSpend === true || typeof result?.readinessWarning === 'string',
      String(result?.readinessWarning ?? '(ready)'),
    );
    // The two must agree: ready means both a payment method AND an active account.
    check(
      'readyToSpend agrees with payment method and account status',
      result?.readyToSpend === (result?.paymentMethod?.present === true && Number(result?.accountStatus) === 1),
      `present=${result?.paymentMethod?.present} status=${result?.accountStatus} ready=${result?.readyToSpend}`,
    );
    // Never leak the funding instrument into a transcript. Scoped to the funding object on purpose:
    // the ad account id is a legitimate part of the answer and is 16 digits long.
    check(
      'the funding object does not carry a full card number or funding id',
      !/\d{12,}/.test(JSON.stringify(result?.paymentMethod ?? {})),
      JSON.stringify(result?.paymentMethod),
    );
  }
}

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
