/**
 * Business skills: can a user actually add one, and does the agent then see it?
 *
 * The feature is only real if the row lands in `agent_skills`, the catalogue the prompt
 * gets contains it, and `get_skill` can return the body on demand. This walks that
 * whole path against the live database and cleans up after itself.
 *
 *   npm run verify:skills
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { createSkillTools, formatSkillCatalogue } from '../lib/agent/tools/skills';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  â€” ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  â€” ${detail}` : ''}`);
  }
}

const BODY = `# Diwali offer rules

- Always lead with the price band, never an exact figure.
- Mention the 15-minute site visit slot.
- Close with the WhatsApp number, never a URL.`;

(async () => {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: profile } = await sb.from('profiles').select('id').limit(1).maybeSingle();
  if (!profile?.id) {
    console.error('no profile');
    process.exit(1);
  }

  // Does the table exist at all? A missing migration is the usual cause of "the button
  // is there but nothing saves".
  const probe = await sb.from('agent_skills').select('id').limit(1);
  check('agent_skills table exists', !probe.error, probe.error?.message);
  if (probe.error) {
    console.log('\nApply sql/migrations/15_agent_skills.sql first.');
    process.exit(1);
  }

  const name = `verify-skill-${Date.now()}`;
  const { data: inserted, error: insErr } = await sb
    .from('agent_skills')
    .insert({
      user_id: profile.id,
      name,
      description: 'How we word Diwali offers: price band first, site visit slot, WhatsApp close.',
      content: BODY,
      source_filename: 'diwali.md',
      enabled: true,
    })
    .select('id, name, description, enabled')
    .single();
  check('a user can add a skill', !insErr && !!inserted?.id, insErr?.message);

  const tools: any = createSkillTools(sb, profile.id);
  const listed: any = await (tools.list_skills as any).execute({}, { toolCallId: 't1', messages: [] });
  const names = (listed.skills || []).map((s: any) => s.name);
  check('list_skills returns it', names.includes(name), `${listed.skills?.length ?? 0} skills`);
  check(
    'the catalogue shows a description, not the body',
    JSON.stringify(listed).includes('price band first') && !JSON.stringify(listed).includes('15-minute'),
    'progressive disclosure'
  );

  const got: any = await (tools.get_skill as any).execute({ name }, { toolCallId: 't2', messages: [] });
  check('get_skill returns the full body', String(got.content || '').includes('15-minute site visit slot'));

  const cat = formatSkillCatalogue(listed.skills || []);
  check('the prompt catalogue names it', cat.includes(name), `${cat.length} chars`);

  // Disabling must remove it from the catalogue, without deleting history.
  await sb.from('agent_skills').update({ enabled: false }).eq('id', inserted!.id);
  const after: any = await (tools.list_skills as any).execute({}, { toolCallId: 't3', messages: [] });
  check(
    'a disabled skill is hidden from the agent',
    !(after.skills || []).some((s: any) => s.name === name)
  );

  await sb.from('agent_skills').delete().eq('id', inserted!.id);
  const gone = await sb.from('agent_skills').select('id').eq('id', inserted!.id).maybeSingle();
  check('a skill can be deleted', !gone.data);

  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} â€” ${pass}/${pass + fail} checks passed`);
  if (fail) process.exit(1);
})().catch((e) => {
  console.error('verify-skills crashed:', e?.message || e);
  process.exit(1);
});

