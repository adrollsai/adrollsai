/**
 * Different calls need different words and a different voice.
 *
 * WHY THIS EXISTS
 * There was exactly one script and one voice for every call an account ever made: a brand-new enquiry
 * whose details the caller has never seen got the same opening as a person who booked a week ago, and
 * the same warm female voice confirmed a booking as chased a cold lead. An owner cannot express "when a
 * lead goes quiet for two weeks, call them in a lighter, male voice" anywhere in the product, and the
 * agent cannot either.
 *
 * WHAT A SCENARIO IS
 * Not a marketing segment. A scenario is a kind of phone call, decided from the lead's own state, which
 * the account can give its own script, first line, voice and language. Everything it does not override is
 * INHERITED from the account's default, and the defaults keep working exactly as before — an account
 * that never touches this feature gets byte-identical behaviour.
 *
 * WHY THE STATE IS THE TRUTH, NOT A FIELD TO SET
 * The scenario is derived from the lead (`booked_time`, stage, last activity), not stored per lead: a
 * lead that gets booked moves from "following up" to "confirming a booking" on its own, with no worker
 * to keep a column in sync and nothing to go stale.
 */
import { resolveCallingScript, renderCallingScript } from './calling-script';

export type CallScenarioId = 'new-lead' | 'follow-up' | 'booked' | 're-engage';

export interface CallScenarioDefinition {
  id: CallScenarioId;
  /** How the owner reads it in the settings page. */
  label: string;
  /** Plain words for when this call happens — shown under the label. */
  when: string;
  /** What the call is for, which is what the script should be written to achieve. */
  purpose: string;
  /** A starting point offered when the owner opens the editor. */
  starterOpener: string;
}

export const CALL_SCENARIOS: readonly CallScenarioDefinition[] = [
  {
    id: 'new-lead',
    label: 'A brand-new enquiry',
    when: 'They have just enquired and nobody has spoken to them yet.',
    purpose: 'Answer fast, confirm what they want, and get a time to talk or visit.',
    starterOpener: 'Hi {{name}}, this is calling from {{business}} about the enquiry you just sent us.',
  },
  {
    id: 'follow-up',
    label: 'Following up',
    when: 'They were contacted before but have not booked.',
    purpose: 'Re-open the conversation with something new, and book the next step.',
    starterOpener: 'Hi {{name}}, it is {{business}} again — I wanted to pick up where we left off.',
  },
  {
    id: 'booked',
    label: 'Confirming a booking',
    when: 'They already have a booking or a visit planned.',
    purpose: 'Confirm the time, make sure they have what they need, and cut no-shows.',
    starterOpener: 'Hi {{name}}, I am calling to confirm your booking with {{business}}.',
  },
  {
    id: 're-engage',
    label: 'Winning back a cold lead',
    when: 'Nothing has happened for two weeks and they never said no.',
    purpose: 'Find out whether it is dead, and either revive it or close it honestly.',
    starterOpener: 'Hi {{name}}, it is {{business}} — it has been a while, so I did not want to assume.',
  },
];

export interface ScenarioConfig {
  /** The words for this scenario. Empty means "inherit the account's script". */
  script?: string;
  /** The opening line, if this scenario opens differently. */
  firstMessage?: string;
  /** A voice from the platform's list. Empty means "inherit". */
  voice?: string;
  /** A starting language. Empty means "inherit". */
  language?: string;
}

export type VoiceScenarioMap = Partial<Record<CallScenarioId, ScenarioConfig>>;

const SCENARIO_IDS = CALL_SCENARIOS.map((scenario) => scenario.id);

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Read the stored overrides, tolerantly.
 *
 * Anything unrecognised is dropped rather than trusted: this JSON is written by a settings form, read by
 * the dialer, and a stray key must never become a call with no script.
 */
export function parseVoiceScenarios(raw: unknown): VoiceScenarioMap {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const out: VoiceScenarioMap = {};
  for (const id of SCENARIO_IDS) {
    const entry = (value as Record<string, unknown>)[id];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    const config: ScenarioConfig = {};
    const script = text(row.script);
    const firstMessage = text(row.firstMessage);
    const voice = text(row.voice);
    const language = text(row.language);
    if (script) config.script = script;
    if (firstMessage) config.firstMessage = firstMessage;
    if (voice) config.voice = voice;
    if (language) config.language = language;
    if (Object.keys(config).length) out[id] = config;
  }
  return out;
}

const BOOKED_STATUSES = ['booked', 'visit_planned', 'won', 'appointment booked', 'appointment_booked'];
const LOST_STATUSES = ['lost', 'junk', 'dnp', 'not_interested', 'invalid', 'opted_out'];
const UNTOUCHED = ['new', 'new lead', 'new_lead', 'fresh', 'pending', 'uncontacted', ''];

/** Two weeks of silence is what makes a lead "cold" here — the same bar the calling window uses for urgency. */
const COLD_AFTER_DAYS = 14;

export interface ScenarioLeadShape {
  pipeline_stage?: string | null;
  status?: string | null;
  booked_time?: string | null;
  last_activity_at?: string | null;
  created_at?: string | null;
  opted_out?: boolean | null;
}

/**
 * Which kind of call this is, from the lead's own state.
 *
 * Order matters: a booking beats everything (the call is about the appointment), an untouched lead beats
 * silence (nobody has called them at all), and only then does elapsed time make it a win-back.
 */
export function classifyCallScenario(lead: ScenarioLeadShape | null | undefined, now: Date = new Date()): CallScenarioId {
  if (!lead) return 'new-lead';
  const stage = String(lead.pipeline_stage ?? '').toLowerCase().trim();
  const status = String(lead.status ?? '').toLowerCase().trim();

  if (lead.booked_time) return 'booked';
  if (BOOKED_STATUSES.includes(stage) || BOOKED_STATUSES.includes(status)) return 'booked';
  if (LOST_STATUSES.includes(stage) || LOST_STATUSES.includes(status)) return 'follow-up';

  const untouched = UNTOUCHED.includes(stage) && UNTOUCHED.includes(status);
  if (untouched) return 'new-lead';

  const last = lead.last_activity_at || lead.created_at || null;
  if (last) {
    const ageDays = (now.getTime() - Date.parse(last)) / 86_400_000;
    if (Number.isFinite(ageDays) && ageDays >= COLD_AFTER_DAYS) return 're-engage';
  }
  return 'follow-up';
}

export interface ResolvedCallPlan {
  scenario: CallScenarioId;
  scenarioLabel: string;
  /** The words the agent will follow, already rendered with this lead's details. */
  script: string;
  /** Which layer the script came from, so the UI and the agent can both say. */
  scriptSource: 'scenario' | 'campaign' | 'playbook' | 'fallback' | 'default';
  firstMessage: string | null;
  voice: string;
  voiceSource: 'scenario' | 'account';
  language: string;
  languageSource: 'scenario' | 'account';
  /** True when this scenario has no overrides at all and everything is inherited. */
  inherited: boolean;
}

export interface ResolveCallPlanInput {
  lead?: ScenarioLeadShape | null;
  overrides?: VoiceScenarioMap | null;
  /** The account's own defaults: `profiles.voice_name`, `business_info.default_calling_language`. */
  baseVoice?: string | null;
  baseLanguage?: string | null;
  playbook?: { call_script?: unknown; industry?: string | null } | null;
  campaignScript?: string | null;
  fallbackScript?: string | null;
  businessName?: string | null;
  industry?: string | null;
  leadName?: string | null;
  now?: Date;
}

/**
 * The plan for one call: scenario, words, first line, voice, language — with inheritance made visible.
 *
 * The script keeps the existing precedence (campaign → playbook → fallback → shipped default) and the
 * scenario sits in front of it, so adding a scenario can never remove a layer that worked before.
 */
export function resolveCallPlan(input: ResolveCallPlanInput = {}): ResolvedCallPlan {
  const scenario = classifyCallScenario(input.lead, input.now ?? new Date());
  const definition = CALL_SCENARIOS.find((entry) => entry.id === scenario) ?? CALL_SCENARIOS[0];
  const config = (input.overrides || {})[scenario] || {};

  const renderCtx = {
    leadName: input.leadName ?? null,
    businessName: input.businessName ?? null,
    industry: input.industry ?? null,
  };

  const authoredScript = text(config.script);
  const base = resolveCallingScript({
    campaignScript: input.campaignScript ?? null,
    playbook: (input.playbook as any) ?? null,
    fallbackScript: input.fallbackScript ?? null,
    ...renderCtx,
  });

  const script = authoredScript ? renderCallingScript(authoredScript, renderCtx) : base.script;
  const scriptSource: ResolvedCallPlan['scriptSource'] = authoredScript ? 'scenario' : base.source;

  const authoredOpener = text(config.firstMessage);
  const firstMessage = authoredOpener
    ? renderCallingScript(authoredOpener, renderCtx)
    : base.firstMessage;

  const scenarioVoice = text(config.voice);
  const scenarioLanguage = text(config.language);

  return {
    scenario,
    scenarioLabel: definition.label,
    script,
    scriptSource,
    firstMessage,
    voice: scenarioVoice || text(input.baseVoice) || 'Aoede',
    voiceSource: scenarioVoice ? 'scenario' : 'account',
    language: scenarioLanguage || text(input.baseLanguage) || 'hinglish',
    languageSource: scenarioLanguage ? 'scenario' : 'account',
    inherited: !authoredScript && !authoredOpener && !scenarioVoice && !scenarioLanguage,
  };
}

/** The map with empty entries removed — what should be written back to the profile. */
export function compactVoiceScenarios(overrides: VoiceScenarioMap): VoiceScenarioMap {
  return parseVoiceScenarios(overrides);
}
