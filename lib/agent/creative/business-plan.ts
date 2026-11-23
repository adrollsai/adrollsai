/**
 * Plan everything from the business's real state, then execute.
 *
 * THE PHILOSOPHY THIS ENCODES
 * The agent should not be handed a blank page and asked to be creative. It should know: who this business is, what it
 * sells, what it already has, what has worked, what is running right now, how much it can spend, and what the owner
 * asked for — and only then decide what to make. Tools are the easy half; knowing what to make is the job.
 *
 * So there are two steps and they are separate on purpose:
 *
 *   1. ASSEMBLE  every fact we hold about this business and its current state, in one object (no model, just reads).
 *   2. PLAN      a model turns that context plus the owner's own words into a decision: the objective, the audience,
 *                the offer angle, exactly which artefacts to make and why, the order to make them in, the assumptions
 *                it had to make, and the questions only the owner can answer.
 *
 * The plan is the spine. Everything after it is execution with the tools the agent already has, which is why this file
 * never touches a tool: a plan that dictates mechanics would be another template.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateText } from 'ai';
import { vendoredSkill } from '@/lib/agent/skills-vendor';
import { scanAll } from '@/lib/supabase/paged';

export interface BusinessContext {
  business: {
    name: string;
    industry: string | null;
    brandColor: string | null;
    logoUrl: string | null;
    contact: string | null;
    mission: string | null;
    customInstructions: string | null;
    currency: string;
  };
  catalogue: Array<{ name: string; price: string | null; summary: string | null }>;
  assets: { images: number; videos: number; recentImages: string[] };
  performance: {
    leadsLast30d: number;
    callsLast30d: number;
    bookedLast30d: number;
    topStage: string | null;
  };
  runningNow: { campaigns: number; pages: number; automations: number };
  capacity: { aiCredits: number; callingCredits: number };
  /** Where the gaps are, stated plainly, so the plan can be built around them. */
  gaps: string[];
}

const num = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/**
 * Read everything we know, and nothing we do not. Each query is best-effort: a missing table must not stop a plan, but
 * it must show up in `gaps` so the plan does not pretend to knowledge it does not have.
 */
export async function assembleBusinessContext(supabase: SupabaseClient, userId: string): Promise<BusinessContext> {
  const gaps: string[] = [];

  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name, industry, brand_color, logo_url, contact_number, mission_statement, custom_prompt, currency, credits, calling_credits, business_info')
    .eq('id', userId)
    .maybeSingle();

  const catalogue: BusinessContext['catalogue'] = [];
  try {
    const { data: products } = await supabase
      .from('properties')
      .select('title, price, description, status')
      .eq('user_id', userId)
      .limit(12);
    for (const row of products ?? []) {
      catalogue.push({
        name: String((row as any).title ?? 'Untitled'),
        price: (row as any).price != null ? String((row as any).price) : null,
        summary: (row as any).description ? String((row as any).description).slice(0, 160) : null,
      });
    }
  } catch {
    gaps.push('catalogue could not be read');
  }
  if (!catalogue.length) gaps.push('no products in the catalogue, so there is nothing specific to advertise');

  let assetCounts = { images: 0, videos: 0, recentImages: [] as string[] };
  try {
    const { data: assets } = await supabase
      .from('assets')
      .select('url, type, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(60);
    const images = (assets ?? []).filter((a: any) => String(a.type) === 'image');
    assetCounts = {
      images: images.length,
      videos: (assets ?? []).filter((a: any) => String(a.type) === 'video').length,
      recentImages: images.slice(0, 6).map((a: any) => String(a.url)).filter((u: string) => /^https:\/\//i.test(u)),
    };
  } catch {
    gaps.push('asset library could not be read');
  }
  if (assetCounts.images === 0) gaps.push('no imagery of its own, so any page or ad needs photographs made or supplied');

  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const performance = { leadsLast30d: 0, callsLast30d: 0, bookedLast30d: 0, topStage: null as string | null };
  try {
    // Paged, not `.limit(2000)`: PostgREST caps a response at 1000 rows and still answers 200, so a
    // business plan for a busy account was built on the first thousand leads of the month and reported
    // them as the month.
    const leadScan = await scanAll<any>(
      () =>
        supabase
          .from('leads')
          .select('created_at, pipeline_stage, voice_call_status, booked_time')
          .eq('user_id', userId)
          .gte('created_at', since),
      { cap: 60_000 }
    );
    const leads = leadScan.rows;
    performance.leadsLast30d = (leads ?? []).length;
    performance.callsLast30d = (leads ?? []).filter((l: any) => l.voice_call_status).length;
    performance.bookedLast30d = (leads ?? []).filter((l: any) => l.booked_time).length;
    const stages = new Map<string, number>();
    for (const lead of leads ?? []) {
      const stage = String((lead as any).pipeline_stage ?? 'unknown');
      stages.set(stage, (stages.get(stage) ?? 0) + 1);
    }
    performance.topStage = [...stages.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  } catch {
    gaps.push('lead history could not be read, so there is no recent performance to plan against');
  }

  const runningNow = { campaigns: 0, pages: 0, automations: 0 };
  try {
    const { count: campaigns } = await supabase
      .from('voice_campaigns')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'running');
    runningNow.campaigns = num(campaigns);
  } catch {
    /* optional */
  }
  try {
    const { count: pages } = await supabase
      .from('landing_pages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    runningNow.pages = num(pages);
  } catch {
    /* optional */
  }
  try {
    const { data: policy } = await supabase
      .from('tenant_automations')
      .select('master_enabled')
      .eq('user_id', userId)
      .maybeSingle();
    runningNow.automations = policy?.master_enabled ? 1 : 0;
  } catch {
    /* optional */
  }

  const businessInfo = (profile as any)?.business_info ?? {};
  const industry = String((profile as any)?.industry ?? businessInfo?.industry ?? '').trim() || null;

  if (!industry) gaps.push('industry is not set, so vertical vocabulary and design rules are guesswork');
  if (!(profile as any)?.contact_number) gaps.push('no contact number, so no call to action can convert');

  return {
    business: {
      name: String((profile as any)?.business_name ?? '').trim() || 'this business',
      industry,
      brandColor: (profile as any)?.brand_color ?? null,
      logoUrl: (profile as any)?.logo_url ?? null,
      contact: (profile as any)?.contact_number ?? null,
      mission: (profile as any)?.mission_statement ?? null,
      customInstructions: (profile as any)?.custom_prompt ?? null,
      currency: String((profile as any)?.currency ?? 'INR'),
    },
    catalogue,
    assets: assetCounts,
    performance,
    runningNow,
    capacity: { aiCredits: num((profile as any)?.credits), callingCredits: num((profile as any)?.calling_credits) },
    gaps,
  };
}

export interface WorkPlan {
  objective: string;
  audience: string;
  offer: string;
  thesis: string;
  artefacts: Array<{ kind: 'ad_image' | 'landing_page' | 'website' | 'video' | 'whatsapp' | 'outbound_calls' | 'flow'; why: string; brief: string }>;
  order: string[];
  assumptions: string[];
  questions: string[];
  successMetric: string;
  raw: string;
}

/** A readable digest of the context, so the model plans against facts rather than impressions. */
export function describeContext(context: BusinessContext): string {
  const lines = [
    `Business: ${context.business.name}${context.business.industry ? ` (${context.business.industry})` : ' (industry not set)'}`,
    context.business.mission ? `Mission: ${context.business.mission}` : '',
    context.business.contact ? `Contact for calls to action: ${context.business.contact}` : 'NO CONTACT NUMBER',
    context.business.customInstructions ? `Owner standing instructions: ${context.business.customInstructions}` : '',
    '',
    `Catalogue (${context.catalogue.length}): ${context.catalogue.map((c) => `${c.name}${c.price ? ` at ${c.price}` : ''}`).join(' | ') || 'empty'}`,
    `Own assets: ${context.assets.images} images, ${context.assets.videos} videos`,
    `Last 30 days: ${context.performance.leadsLast30d} leads, ${context.performance.callsLast30d} called, ${context.performance.bookedLast30d} booked${context.performance.topStage ? `, busiest stage "${context.performance.topStage}"` : ''}`,
    `Running now: ${context.runningNow.campaigns} campaigns, ${context.runningNow.pages} pages, automation ${context.runningNow.automations ? 'on' : 'off'}`,
    `Credits: ${context.capacity.aiCredits} AI, ${context.capacity.callingCredits} calling`,
    '',
    context.gaps.length ? `GAPS THAT LIMIT WHAT IS POSSIBLE: ${context.gaps.join('; ')}` : 'No gaps recorded.',
  ];
  return lines.filter(Boolean).join('\n');
}

/**
 * Turn the context plus the owner's words into a plan.
 *
 * Deliberately NOT a template of a plan: the model decides which artefacts are worth making for THIS business at THIS
 * moment, and is required to name the assumptions it made and the questions only the owner can answer. A plan that
 * assumes silently is how an agent confidently makes the wrong thing.
 */
export async function planBusinessWork(opts: {
  context: BusinessContext;
  request: string;
  model: any;
  maxOutputTokens?: number;
}): Promise<WorkPlan> {
  const structure = (vendoredSkill('landing-structure')?.content ?? '').slice(0, 4000);
  const copywriting = (vendoredSkill('landing-copywriting')?.content ?? '').slice(0, 4000);
  const metaAds = (vendoredSkill('meta-ads-creative')?.content ?? '').slice(0, 3000);

  const { text } = await generateText({
    model: opts.model,
    maxOutputTokens: opts.maxOutputTokens ?? 9000,
    system: [
      'You are the marketing head for this business, and you have just been handed its live account.',
      'You decide what work is worth doing, in what order, and why. You do not write the artefacts; you plan them.',
      'Rules:',
      '- Plan from the facts given. Never invent a price, a product, a result or a deadline.',
      '- If a fact you need is missing, put it under QUESTIONS instead of assuming it.',
      '- Name every assumption you had to make under ASSUMPTIONS.',
      '- Choose ONLY the artefacts that serve the objective. A video is not always needed; three formats are not better than one.',
      '- Where the data shows a gap (no imagery, no catalogue, calling off), plan around it or plan to fix it first.',
      '',
      'HOW A PAGE IS STRUCTURED AND WRITTEN:',
      structure,
      '',
      copywriting,
      '',
      'WHAT MAKES A PAID SOCIAL CREATIVE CONVERT:',
      metaAds,
    ].join('\n'),
    prompt: [
      `THE OWNER ASKED FOR: ${opts.request}`,
      '',
      'THE BUSINESS, AS IT ACTUALLY IS RIGHT NOW:',
      describeContext(opts.context),
      '',
      'Answer in exactly these blocks, no preamble:',
      'OBJECTIVE: one sentence, the business outcome, not the deliverable',
      'AUDIENCE: who specifically, from the facts',
      'OFFER: the offer as it should appear, taken from the catalogue or the request',
      'THESIS: the one argument the work makes',
      'ARTEFACTS: one per line, "kind - why - the brief in one line". Kinds: ad_image, landing_page, website, video, whatsapp, outbound_calls, flow',
      'ORDER: the sequence, by number',
      'ASSUMPTIONS: one per line',
      'QUESTIONS: one per line, only what the owner must answer',
      'SUCCESS METRIC: the number that would tell us this worked',
    ].join('\n'),
  });

  const raw = String(text ?? '').trim();
  const block = (name: string) =>
    new RegExp(`${name}\\s*:?\\s*([\\s\\S]*?)(?=\\n[A-Z][A-Z ]{3,}\\s*:|$)`, 'i').exec(raw)?.[1]?.trim() ?? '';
  const lines = (name: string) =>
    block(name)
      .split('\n')
      .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*])\s*/, '').trim())
      .filter(Boolean);

  const artefacts = lines('ARTEFACTS').map((line) => {
    const [kind, why, brief] = line.split(/\s+[-–]\s+/).map((part) => (part ?? '').trim());
    const normalised = (kind ?? '').toLowerCase().replace(/[^a-z_]/g, '');
    return { kind: normalised as WorkPlan['artefacts'][number]['kind'], why: why ?? '', brief: brief ?? '' };
  }).filter((a) => a.kind);

  return {
    objective: block('OBJECTIVE'),
    audience: block('AUDIENCE'),
    offer: block('OFFER'),
    thesis: block('THESIS'),
    artefacts,
    order: lines('ORDER'),
    assumptions: lines('ASSUMPTIONS'),
    questions: lines('QUESTIONS'),
    successMetric: block('SUCCESS METRIC'),
    raw,
  };
}
