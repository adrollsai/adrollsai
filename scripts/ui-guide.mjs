/**
 * WALK THE REAL UI AND WRITE THE SUPPORT GUIDE FROM WHAT IS ACTUALLY THERE.
 *
 * WHY
 * The owner asked the agent "how do I launch a WhatsApp broadcast in Nobogent" and got instructions that were wrong and
 * ambiguous. Investigated: the agent has NO product documentation whatsoever — `house-skills.ts` is marketing craft, not
 * "how to use this app" — so the model improvised UI steps from tool names. An agent inventing button names is the same
 * class of bug as a report inventing numbers.
 *
 * This runner is the fix: one browser context, one login (Supabase rate-limits rapid sign-ins), walk each route, and
 * record what a person would actually see — the route, the section headings, the real button and tab labels, the inputs.
 * The output is markdown under `lib/agent/house-skills/product-guide/`, which the agent reads as a house skill.
 *
 *   NOBO_EMAIL=… NOBO_PASS=… node scripts/ui-guide.mjs            # all surfaces
 *   NOBO_EMAIL=… NOBO_PASS=… node scripts/ui-guide.mjs whatsapp    # one surface
 *
 * This deliberately only READS the UI: it clicks nothing that spends money, sends a message or changes data. Writing the
 * guide is the job; exercising the write paths is a different, deliberate act.
 */
import { chromium } from 'playwright';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { login, gotoDashboard } from './lib/ui-login.mjs';

const BASE = process.env.NOBO_BASE_URL || 'https://app.pipixel.io';
const OUT_DIR = path.join('lib', 'agent', 'house-skills', 'product-guide');

/** One entry per surface the support bot must be able to explain. */
export const SURFACES = [
  {
    id: 'whatsapp-broadcast',
    title: 'WhatsApp, templates and broadcasts',
    routes: ['/dashboard/whatsapp'],
    intent: 'How to send a WhatsApp broadcast, use templates, or grow the WhatsApp channel.',
  },
  { id: 'crm', title: 'CRM, leads and follow-ups', routes: ['/dashboard/crm'], intent: 'Finding leads, changing stage, assigning, follow-ups, bulk actions.' },
  { id: 'agent', title: 'The agent chat', routes: ['/dashboard/agent'], intent: 'Asking the agent for work, approvals, steering a run, what the cards mean.' },
  { id: 'ads', title: 'Ads launchpad and campaigns', routes: ['/dashboard/ads'], intent: 'Launching a campaign, budget, audiences, reading results.' },
  { id: 'analytics', title: 'Analytics and reports', routes: ['/dashboard/analytics'], intent: 'Reading the numbers, filtering, finding what changed.' },
  { id: 'creation', title: 'Creation tab (images and video)', routes: ['/dashboard/creation'], intent: 'Making an image or a video, presenter modes, voiceover vs avatar, brand kit.' },
  { id: 'assets', title: 'Materials, files and catalogue', routes: ['/dashboard/assets'], intent: 'Where files live, uploading, linking a catalogue item, deleting.' },
  { id: 'flows', title: 'Flows and automations', routes: ['/dashboard/flows'], intent: 'Building a flow, triggers, conditions, turning one on.' },
  { id: 'profile-brand', title: 'Profile, brand kit and activity', routes: ['/dashboard/profile', '/dashboard/profile/brand', '/dashboard/profile/history'], intent: 'Brand colour and rules, account settings, the activity log and reversals.' },
];

const slug = (id) => id;

async function readSurface(page, surface) {
  const pages = [];
  for (const route of surface.routes) {
    const landed = await gotoDashboard(page, BASE, route, {
      email: process.env.NOBO_EMAIL,
      password: process.env.NOBO_PASS,
    });
    const facts = await page.evaluate(() => {
      const text = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
      const uniq = (list) => Array.from(new Set(list.filter(Boolean)));
      const visible = (el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      return {
        headings: uniq(Array.from(document.querySelectorAll('h1,h2,h3,h4')).filter(visible).map(text)).slice(0, 24),
        tabs: uniq(Array.from(document.querySelectorAll('[role="tab"], nav a, nav button')).filter(visible).map(text)).slice(0, 24),
        buttons: uniq(Array.from(document.querySelectorAll('button')).filter(visible).map(text)).filter((t) => t && t.length < 44).slice(0, 48),
        inputs: uniq(
          Array.from(document.querySelectorAll('input,textarea,select'))
            .filter(visible)
            .map((el) => el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.getAttribute('name') || '')
        ).slice(0, 24),
      };
    });
    pages.push({ route, landed, ...facts });
  }
  return pages;
}

function renderGuide(surface, pages, walkedAt) {
  const lines = [
    `# ${surface.title}`,
    '',
    `_Written by \`npm run ui:guide\` on ${walkedAt} by driving the real interface. Every route, heading and label below was`,
    'read off the live page. If you change the UI, re-run that command — `verify:product-guide` fails when this file and the',
    'product disagree._',
    '',
    `**Answer this question from here:** ${surface.intent}`,
    '',
  ];
  for (const pageFacts of pages) {
    lines.push(`## \`${pageFacts.route}\`${pageFacts.landed && pageFacts.landed !== pageFacts.route ? ` (landed on \`${new URL(pageFacts.landed).pathname}\`)` : ''}`);
    lines.push('');
    if (pageFacts.headings.length) {
      lines.push('**Sections on this page:**', ...pageFacts.headings.map((h) => `- ${h}`), '');
    }
    if (pageFacts.tabs.length) {
      lines.push('**Tabs / nav:**', ...pageFacts.tabs.map((t) => `- ${t}`), '');
    }
    if (pageFacts.buttons.length) {
      lines.push('**Buttons available (use these exact labels):**', ...pageFacts.buttons.map((b) => `- ${b}`), '');
    }
    if (pageFacts.inputs.length) {
      lines.push('**Fields:**', ...pageFacts.inputs.map((i) => `- ${i}`), '');
    }
  }
  lines.push(
    '## How to answer',
    '',
    '1. Reply with the exact labels above, in the order they appear — never invent a button name.',
    '2. Name the route so the owner can open it directly.',
    '3. If the thing they need is not in this file, say so plainly and offer to escalate to the team; do not guess.',
    ''
  );
  return lines.join('\n');
}

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const surfaces = wanted.length ? SURFACES.filter((s) => wanted.includes(s.id)) : SURFACES;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });

try {
  await login(page, { baseUrl: BASE, email: process.env.NOBO_EMAIL, password: process.env.NOBO_PASS });
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const walkedAt = new Date().toISOString().slice(0, 10);
  for (const surface of surfaces) {
    const pages = await readSurface(page, surface);
    const file = path.join(OUT_DIR, `${slug(surface.id)}.md`);
    writeFileSync(file, renderGuide(surface, pages, walkedAt), 'utf8');
    const labels = pages.reduce((n, p) => n + p.buttons.length + p.headings.length, 0);
    console.log(`  ${surface.id.padEnd(18)} ${pages.length} route(s), ${labels} labels -> ${file}`);
  }
  // The markdown files are for humans and for review; the agent needs them BUNDLED, because a serverless build does not
  // ship arbitrary repo files. So the same content is emitted as a TS module that house-skills imports.
  const bundled = surfaces.map((s) => {
    const mdPath = path.join(OUT_DIR, `${s.id}.md`);
    const body = existsSync(mdPath) ? readFileSync(mdPath, 'utf8') : '';
    return `  { name: 'product-guide-${s.id}', title: ${JSON.stringify(s.title)}, body: ${JSON.stringify(body)} },`;
  });
  const moduleSource = [
    '// GENERATED by scripts/ui-guide.mjs — do not edit by hand.',
    '// Re-run: NOBO_EMAIL=… NOBO_PASS=… npm run ui:guide',
    'export interface ProductGuideDoc { name: string; title: string; body: string }',
    'export const PRODUCT_GUIDES: readonly ProductGuideDoc[] = [',
    ...bundled,
    '];',
    '',
  ].join('\n');
  writeFileSync(path.join(OUT_DIR, 'index.ts'), moduleSource, 'utf8');
  console.log('\nGuide written (markdown + bundled index.ts). Commit it: the agent reads it as a house skill.');
} catch (err) {
  console.error('ui:guide failed:', err?.message || err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
