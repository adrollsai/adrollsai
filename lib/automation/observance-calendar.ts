/**
 * The observance calendar: days a business can build a creative around that are NOT festivals.
 *
 * WHY THIS IS SEPARATE FROM THE FESTIVAL CALENDAR
 * `utils/festival-helper.ts` answers questions we do not control - Diwali, Eid, Holi, Thanksgiving -
 * where the DATE moves every year and gets its value from a published calendar. These are the other
 * kind: World Environment Day is 5 June every year, Women's Day is 8 March every year, Mother's Day is
 * the second Sunday of May. Different mechanics, different lead time, different creative angle, so a
 * different table. Mixing them into the festival list would have meant every lunisolar lookup also
 * carrying fixed dates, and the real question for a routine ("what is coming up that I should make
 * something for?") spans both.
 *
 * WHAT MAKES AN OBSERVANCE USABLE
 *  - a FIXED or Nth-weekday rule, so it can be resolved for any year without a lookup table;
 *  - a creative ANGLE, because "Happy Women's Day" with no offer is a greeting card, not marketing -
 *    the angle is what turns the day into something worth a creative;
 *  - a LEAD TIME (days before) because the whole point of putting these in the routine is that the
 *    creative exists and is approved BEFORE the day, not on it.
 *
 * Deliberately excluded: awareness days that a commercial brand can easily get wrong or that carry
 * political/religious weight outside their own festival calendar. A wrong creative on those is worse
 * than no creative.
 *
 * Pure: dates in, dates out. No database, no clock of its own.
 */

import { localDateOf } from '@/lib/agent/routine-schedule';

export type ObservanceScope = 'global' | 'IN' | 'US' | 'AE';

/** A fixed date, or the Nth weekday of a month (weekday 0 = Sunday). */
export type ObservanceRule =
  | { kind: 'fixed'; month: number; day: number }
  | { kind: 'nthWeekday'; month: number; weekday: number; nth: number };

export interface Observance {
  id: string;
  name: string;
  rule: ObservanceRule;
  scope: ObservanceScope[];
  /** One line of creative direction: what the day is FOR, commercially. */
  angle: string;
  /** How many days ahead the creative should exist. */
  leadDays: number;
}

/**
 * The table. `leadDays` defaults to 5 on purpose: enough room for an approval card to be looked at,
 * not so much that the creative goes stale before the day arrives.
 */
export const OBSERVANCES: Observance[] = [
  {
    id: 'new_year',
    name: "New Year's Day",
    rule: { kind: 'fixed', month: 1, day: 1 },
    scope: ['global'],
    angle: 'New-year intention, fresh start. Pair it with a booking or site-visit offer rather than a plain greeting.',
    leadDays: 10,
  },
  {
    id: 'republic_day',
    name: 'Republic Day',
    rule: { kind: 'fixed', month: 1, day: 26 },
    scope: ['IN'],
    angle: 'Civic pride, nation-building and home. Keep it respectful; tie to the locality you actually serve.',
    leadDays: 7,
  },
  {
    id: 'valentines',
    name: "Valentine's Day",
    rule: { kind: 'fixed', month: 2, day: 14 },
    scope: ['global'],
    angle: 'Couples planning a first home together. Ask for a joint decision, not a solo one - it is the honest hook.',
    leadDays: 7,
  },
  {
    id: 'womens_day',
    name: "International Women's Day",
    rule: { kind: 'fixed', month: 3, day: 8 },
    scope: ['global'],
    angle: 'Women as owners and decision-makers. Celebrate a real customer or a female-led milestone; never clip-art a stereotype.',
    leadDays: 7,
  },
  {
    id: 'water_day',
    name: 'World Water Day',
    rule: { kind: 'fixed', month: 3, day: 22 },
    scope: ['global'],
    angle: 'Water security and the practical infrastructure of a home or project. Only use it if the project can honestly claim something.',
    leadDays: 5,
  },
  {
    id: 'health_day',
    name: 'World Health Day',
    rule: { kind: 'fixed', month: 4, day: 7 },
    scope: ['global'],
    angle: 'Health and wellbeing in the space people live in: light, air, open space. Keep claims factual.',
    leadDays: 5,
  },
  {
    id: 'earth_day',
    name: 'Earth Day',
    rule: { kind: 'fixed', month: 4, day: 22 },
    scope: ['global'],
    angle: 'Sustainability that is verifiable - green cover, solar, water harvesting, open space. Never claim a certification you do not hold.',
    leadDays: 7,
  },
  {
    id: 'labour_day',
    name: 'Labour Day',
    rule: { kind: 'fixed', month: 5, day: 1 },
    scope: ['global'],
    angle: 'The people who build and run the business. Thank the site team; a real photograph beats a stock one.',
    leadDays: 5,
  },
  {
    id: 'mothers_day',
    name: "Mother's Day",
    rule: { kind: 'nthWeekday', month: 5, weekday: 0, nth: 2 },
    scope: ['global'],
    angle: 'The home a family grows in, decided by the person who runs it. Warm, not saccharine.',
    leadDays: 7,
  },
  {
    id: 'environment_day',
    name: 'World Environment Day',
    rule: { kind: 'fixed', month: 6, day: 5 },
    scope: ['global'],
    angle: 'What the project does for its surroundings. Same rule as Earth Day: only what you can evidence.',
    leadDays: 7,
  },
  {
    id: 'fathers_day',
    name: "Father's Day",
    rule: { kind: 'nthWeekday', month: 6, weekday: 0, nth: 3 },
    scope: ['global'],
    angle: 'Legacy, security, the long view - the honest angle for a father buying property.',
    leadDays: 7,
  },
  {
    id: 'yoga_day',
    name: 'International Yoga Day',
    rule: { kind: 'fixed', month: 6, day: 21 },
    scope: ['global', 'IN'],
    angle: 'Morning light, open space, calm. Works best as a lifestyle scene in the amenity, not a slogan.',
    leadDays: 7,
  },
  {
    id: 'independence_day',
    name: 'Independence Day (India)',
    rule: { kind: 'fixed', month: 8, day: 15 },
    scope: ['IN'],
    angle: 'Freedom and the place you call your own. Civic, restrained, local.',
    leadDays: 7,
  },
  {
    id: 'friendship_day',
    name: 'Friendship Day',
    rule: { kind: 'nthWeekday', month: 8, weekday: 0, nth: 1 },
    scope: ['IN'],
    angle: 'Buying together - friends investing side by side. A referral hook that does not feel like a discount ad.',
    leadDays: 5,
  },
  {
    id: 'teachers_day',
    name: "Teachers' Day (India)",
    rule: { kind: 'fixed', month: 9, day: 5 },
    scope: ['IN'],
    angle: 'Gratitude with a name and a face. For an education business, a student outcome is the creative.',
    leadDays: 7,
  },
  {
    id: 'gandhi_jayanti',
    name: 'Gandhi Jayanti',
    rule: { kind: 'fixed', month: 10, day: 2 },
    scope: ['IN'],
    angle: 'Cleanliness, simplicity, restraint. A quiet brand piece; no offer is in better taste than a hard sell.',
    leadDays: 7,
  },
  {
    id: 'childrens_day',
    name: "Children's Day (India)",
    rule: { kind: 'fixed', month: 11, day: 14 },
    scope: ['IN'],
    angle: 'Space for kids to grow - play areas, schools nearby, safety. Family-facing, factual.',
    leadDays: 7,
  },
  {
    id: 'new_years_eve',
    name: "New Year's Eve",
    rule: { kind: 'fixed', month: 12, day: 31 },
    scope: ['global'],
    angle: "Close the year with the year's own numbers: units sold, families moved in, sites handed over.",
    leadDays: 10,
  },
  {
    id: 'christmas',
    name: 'Christmas',
    rule: { kind: 'fixed', month: 12, day: 25 },
    scope: ['global'],
    angle: 'Warmth and gifting. If the business is not in a Christmas market, keep it to a greeting and a year-end thanks.',
    leadDays: 10,
  },
];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The calendar date an observance falls on in a given year. */
export function observanceDate(rule: ObservanceRule, year: number): { year: number; month: number; day: number } {
  if (rule.kind === 'fixed') return { year, month: rule.month, day: rule.day };

  // Nth weekday: first day of the month, then step to the first matching weekday and add weeks.
  const first = new Date(Date.UTC(year, rule.month - 1, 1));
  const offset = (rule.weekday - first.getUTCDay() + 7) % 7;
  const day = 1 + offset + (Math.max(1, rule.nth) - 1) * 7;
  return { year, month: rule.month, day };
}

/** Days between two calendar dates (b - a), both treated as plain dates. */
function dayDiff(a: { year: number; month: number; day: number }, b: { year: number; month: number; day: number }): number {
  const ms =
    Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
  return Math.round(ms / 86_400_000);
}

export interface UpcomingObservance {
  id: string;
  name: string;
  /** YYYY-MM-DD in the tenant's timezone. */
  date: string;
  daysAway: number;
  angle: string;
  leadDays: number;
  /** True when the creative should already exist - the day is inside its lead time. */
  needsCreativeNow: boolean;
  scope: ObservanceScope[];
}

export interface UpcomingOptions {
  /** How far ahead to look, in days. Default 14. */
  withinDays?: number;
  /** Tenant timezone, so "today" is the business's today. Default Asia/Kolkata. */
  timezone?: string;
  /** Which scopes this tenant cares about. Default: global plus India. */
  scopes?: ObservanceScope[];
}

/** Merge duplicate names (Christmas is in both this table and the festival calendar) without losing scope. */
function dedupe(list: UpcomingObservance[]): UpcomingObservance[] {
  const byKey = new Map<string, UpcomingObservance>();
  for (const item of list) {
    const key = `${item.name.toLowerCase()}|${item.date}`;
    const found = byKey.get(key);
    if (found) found.scope = [...new Set([...found.scope, ...item.scope])];
    else byKey.set(key, item);
  }
  return [...byKey.values()];
}

/**
 * Observances coming up within `withinDays`, soonest first.
 *
 * Spans the year boundary (late December looks into January) by resolving both this year and next.
 */
export function upcomingObservances(now: Date, options: UpcomingOptions = {}): UpcomingObservance[] {
  const withinDays = Math.max(0, Math.min(120, Number(options.withinDays ?? 14)));
  const timezone = options.timezone || 'Asia/Kolkata';
  const scopes = options.scopes ?? ['global', 'IN'];

  const today = localDateOf(now, timezone);
  const out: UpcomingObservance[] = [];

  for (const year of [today.year, today.year + 1]) {
    for (const observance of OBSERVANCES) {
      if (!observance.scope.some((s) => scopes.includes(s))) continue;
      const date = observanceDate(observance.rule, year);
      const daysAway = dayDiff(today, date);
      if (daysAway < 0 || daysAway > withinDays) continue;
      out.push({
        id: observance.id,
        name: observance.name,
        date: `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`,
        daysAway,
        angle: observance.angle,
        leadDays: observance.leadDays,
        needsCreativeNow: daysAway <= observance.leadDays,
        scope: [...observance.scope],
      });
    }
  }

  return dedupe(out).sort((a, b) => a.daysAway - b.daysAway);
}

/** The next time this observance comes round, whether or not it is inside a window. */
export function nextObservance(id: string, now: Date, timezone = 'Asia/Kolkata'): UpcomingObservance | null {
  const observance = OBSERVANCES.find((o) => o.id === id);
  if (!observance) return null;
  const today = localDateOf(now, timezone);
  for (const year of [today.year, today.year + 1]) {
    const date = observanceDate(observance.rule, year);
    const daysAway = dayDiff(today, date);
    if (daysAway < 0) continue;
    return {
      id: observance.id,
      name: observance.name,
      date: `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`,
      daysAway,
      angle: observance.angle,
      leadDays: observance.leadDays,
      needsCreativeNow: daysAway <= observance.leadDays,
      scope: [...observance.scope],
    };
  }
  return null;
}

/** One readable line, e.g. "World Environment Day — 2026-06-05 (in 12 days)". */
export function describeObservance(item: UpcomingObservance): string {
  const when =
    item.daysAway === 0 ? 'today' : item.daysAway === 1 ? 'tomorrow' : `in ${item.daysAway} days`;
  return `${item.name} — ${item.date} (${when})`;
}

/**
 * The brief lines for the routine.
 *
 * Two different asks, because they are two different situations:
 *  - inside the lead time: the creative must exist NOW, ahead of the day;
 *  - further out: plan it, do not make it yet (a creative made two weeks early goes stale, and the
 *    money is better spent closer to the day).
 */
export function observanceBriefLines(upcoming: UpcomingObservance[], max = 4): string[] {
  if (!upcoming.length) return [];
  const soon = upcoming.filter((u) => u.needsCreativeNow);
  const later = upcoming.filter((u) => !u.needsCreativeNow).slice(0, Math.max(0, max - soon.length));

  const lines: string[] = [];
  if (soon.length) {
    lines.push(
      `- MAKE SOMETHING NOW for: ${soon
        .slice(0, max)
        .map((u) => `${u.name} (${u.date}, ${u.daysAway === 0 ? 'TODAY' : u.daysAway === 1 ? 'tomorrow' : `${u.daysAway} days`})`)
        .join('; ')}`
    );
    for (const u of soon.slice(0, max)) lines.push(`  · ${u.name}: ${u.angle}`);
    lines.push(
      '  These are inside their lead time, so the creative has to exist today and be approved before the day itself, not on it.'
    );
  }
  if (later.length) {
    lines.push(
      `- COMING UP, plan only (do not spend on it yet): ${later.map((u) => `${u.name} (${u.date})`).join('; ')}`
    );
  }
  return lines;
}
