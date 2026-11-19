import type { SupabaseClient } from '@supabase/supabase-js';
import { listWhatsAppTemplates, whatsAppCredentials, GRAPH } from './templates';

/**
 * Can this account actually deliver a WhatsApp campaign right now?
 *
 * On 19 Nov a 16,317-recipient campaign was accepted, 122 messages went out, and then Meta refused
 * every remaining send with 131042 — a payment/eligibility problem on the WhatsApp Business account.
 * The product found out one recipient at a time, having already built a queue of sixteen thousand rows
 * and a screen that said "1,000 recipients".
 *
 * Everything needed to know that in advance is one or two Graph reads. This module performs them and
 * turns them into a verdict: ready, or not ready and here is what to fix. It is deliberately not a
 * blocker by default — a warning-level problem (a low quality rating, an unverified business) still
 * lets the owner launch, because they may know something we do not — but a payment/eligibility
 * refusal, a restricted account or a missing credential stops the campaign BEFORE it is created.
 */

export interface WhatsAppHealth {
  ok: boolean;
  /** Problems that must be fixed before a campaign can deliver. */
  blockers: string[];
  /** Things worth saying out loud that do not, on their own, stop a send. */
  warnings: string[];
  phone: {
    displayPhoneNumber: string | null;
    verifiedName: string | null;
    qualityRating: string | null;
    status: string | null;
    nameStatus: string | null;
  } | null;
  /** Meta's own messaging tier, e.g. "TIER_1K" — the number of distinct people per 24h. */
  messagingLimitTier: string | null;
  /** What that tier means in people per 24 hours. Null when Meta did not say. */
  dailyUniqueLimit: number | null;
  /** WABA-level health, when Meta reports it. */
  account: {
    healthStatus: string | null;
    accountReviewStatus: string | null;
    businessVerificationStatus: string | null;
  } | null;
  approvedTemplates: number;
  /** Human-readable one-liner for a badge. */
  headline: string;
}

const TIER_LIMITS: Record<string, number> = {
  TIER_50: 50,
  TIER_250: 250,
  TIER_1K: 1000,
  TIER_10K: 10000,
  TIER_100K: 100000,
  TIER_UNLIMITED: -1,
};

function tierLimit(tier: string | null): number | null {
  if (!tier) return null;
  return TIER_LIMITS[tier.toUpperCase()] ?? null;
}

/** Meta caps a single campaign at the tier's 24-hour unique-recipient allowance. */
export function dailyUniqueLimitFor(health: WhatsAppHealth): number | null {
  return health.dailyUniqueLimit;
}

export async function whatsAppHealth(supabase: SupabaseClient, userId: string): Promise<WhatsAppHealth> {
  const empty: WhatsAppHealth = {
    ok: false,
    blockers: [],
    warnings: [],
    phone: null,
    messagingLimitTier: null,
    dailyUniqueLimit: null,
    account: null,
    approvedTemplates: 0,
    headline: 'WhatsApp is not connected',
  };

  const credentials = await whatsAppCredentials(supabase, userId);
  if (!credentials) {
    return {
      ...empty,
      blockers: [
        'WhatsApp is not connected for this account (no access token / WABA id). Connect the WhatsApp Business ' +
          'account in settings before running a campaign.',
      ],
    };
  }

  const blockers: string[] = [];
  const warnings: string[] = [];

  let phone: WhatsAppHealth['phone'] = null;
  let tier: string | null = null;

  if (credentials.phoneNumberId) {
    try {
      const res = await fetch(
        `${GRAPH}/${credentials.phoneNumberId}` +
          '?fields=display_phone_number,verified_name,quality_rating,status,name_status,messaging_limit_tier',
        { headers: { Authorization: `Bearer ${credentials.token}` } }
      );
      const body: any = await res.json().catch(() => ({}));
      if (body?.error) {
        blockers.push(`Meta rejected the phone-number lookup: ${body.error.message}`);
      } else {
        phone = {
          displayPhoneNumber: body.display_phone_number ?? null,
          verifiedName: body.verified_name ?? null,
          qualityRating: body.quality_rating ?? null,
          status: body.status ?? null,
          nameStatus: body.name_status ?? null,
        };
        tier = body.messaging_limit_tier ?? null;

        const quality = String(phone.qualityRating ?? '').toUpperCase();
        if (quality === 'RED') {
          blockers.push(
            'The phone number’s quality rating is RED, so Meta is restricting delivery. Improve it (fewer ' +
              'blocks/reports on recent sends) before launching another campaign.'
          );
        } else if (quality === 'YELLOW') {
          warnings.push('The phone number’s quality rating is YELLOW — Meta may throttle delivery.');
        }

        const status = String(phone.status ?? '').toUpperCase();
        if (status && !['CONNECTED', 'ACTIVE', 'VERIFIED'].includes(status)) {
          blockers.push(`The phone number is ${status} at Meta, not connected — sends will not be delivered.`);
        }

        const nameStatus = String(phone.nameStatus ?? '').toUpperCase();
        if (nameStatus === 'DECLINED') {
          blockers.push('The display name was DECLINED by Meta; approve it in WhatsApp Manager before sending.');
        }
      }
    } catch (error: any) {
      warnings.push(`Could not read the phone number’s health from Meta (${String(error?.message || error)}).`);
    }
  } else {
    blockers.push('No WhatsApp phone number id is configured for this account.');
  }

  let account: WhatsAppHealth['account'] = null;
  try {
    const res = await fetch(
      `${GRAPH}/${credentials.wabaId}?fields=health_status,account_review_status,business_verification_status,messaging_limit_tier`,
      { headers: { Authorization: `Bearer ${credentials.token}` } }
    );
    const body: any = await res.json().catch(() => ({}));
    if (body?.error) {
      // Not every token may read WABA health; that is worth a warning, not a refusal.
      warnings.push(`Could not read the WhatsApp Business account health: ${body.error.message}`);
    } else {
      account = {
        healthStatus: body.health_status?.can_send_message ?? body.health_status ?? null,
        accountReviewStatus: body.account_review_status ?? null,
        businessVerificationStatus: body.business_verification_status ?? null,
      };
      // The tier is a WABA field on most API versions and a phone-number field on some; take whichever
      // answers rather than reporting "unknown" while the account is actually capped at 250 a day.
      if (!tier && body.messaging_limit_tier) tier = String(body.messaging_limit_tier);

      const canSend = String(account.healthStatus ?? '').toUpperCase();
      if (canSend && !['AVAILABLE', 'APPROVED', 'ACTIVE'].includes(canSend)) {
        blockers.push(
          `Meta reports the WhatsApp Business account health as ${canSend}, so messages are not being ` +
            'delivered. Check Meta Business Manager → Account health (this is also where a payment or ' +
            'eligibility hold such as 131042 appears).'
        );
      }
      const review = String(account.accountReviewStatus ?? '').toUpperCase();
      if (review === 'REJECTED') {
        blockers.push('The WhatsApp Business account review was REJECTED by Meta.');
      }
      if (String(account.businessVerificationStatus ?? '').toUpperCase() === 'NOT_VERIFIED') {
        warnings.push(
          'The business is not verified with Meta. Unverified businesses are limited to 250 unique recipients ' +
            'per day and can be refused entirely for marketing templates.'
        );
      }
    }
  } catch (error: any) {
    warnings.push(`Could not read the WhatsApp Business account health (${String(error?.message || error)}).`);
  }

  /**
   * THE SIGNAL META DOES NOT GIVE US: has this account just had every send refused?
   *
   * Meta's 131042 (payment/eligibility) is not exposed on any readable node — the account looks
   * HEALTHY and GREEN while every send is refused. What we do have is history: if an earlier campaign
   * on this account was paused with that refusal, the next launch will fail the same way until the
   * owner fixes it at Meta. This is how the Blue Square Infra campaign's state becomes a blocker
   * BEFORE the next campaign is built, instead of 16,317 rows later.
   */
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recent } = await supabase
      .from('whatsapp_broadcasts')
      .select('id, title, pause_reason, last_progress_at, created_at, failed_count')
      .eq('user_id', userId)
      .not('pause_reason', 'is', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(5);

    const refused = (recent ?? []).find((row: any) =>
      /payment|eligibility|131042|invalid.*token|190|permission/i.test(String(row.pause_reason ?? ''))
    );
    if (refused) {
      blockers.push(
        `A recent campaign ("${String((refused as any).title ?? 'untitled').slice(0, 60)}") was stopped by Meta: ` +
          `${String((refused as any).pause_reason ?? '').slice(0, 240)} Resolve that with Meta first — ` +
          'another campaign will be refused the same way.'
      );
    }
  } catch {
    /* history is an extra signal; never let it break the check */
  }

  let approvedTemplates = 0;
  try {
    const templates = await listWhatsAppTemplates(supabase, userId);
    approvedTemplates = templates.filter((t) => t.status === 'APPROVED').length;
    if (approvedTemplates === 0) {
      warnings.push('There are no APPROVED templates on this account, and a campaign can only send an approved template.');
    }
  } catch {
    /* the template list is a nicety for the badge; the campaign itself re-checks its own template */
  }

  const dailyUniqueLimit = tierLimit(tier);
  if (dailyUniqueLimit === 250) {
    warnings.push('This number is on the 250-recipients-per-day tier, so any campaign larger than that will be cut off by Meta.');
  } else if (dailyUniqueLimit === 1000) {
    warnings.push('This number is on the 1,000-recipients-per-day tier — a bigger campaign will stop at 1,000.');
  }

  const ok = blockers.length === 0;
  const headline = ok
    ? `Ready · ${tier ? tier.replace('TIER_', '') : 'tier unknown'}${phone?.qualityRating ? ` · quality ${phone.qualityRating}` : ''}`
    : `Not ready · ${blockers[0]?.slice(0, 90) ?? 'unknown problem'}`;

  return {
    ok,
    blockers,
    warnings,
    phone,
    messagingLimitTier: tier,
    dailyUniqueLimit,
    account,
    approvedTemplates,
    headline,
  };
}
