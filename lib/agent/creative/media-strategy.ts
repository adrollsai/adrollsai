import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Where each piece of media in an artefact comes from, decided before anything is generated.
 *
 * The order is fixed and the rules are not negotiable:
 *   1. the tenant's own assets that are linked to the product being advertised, chosen selectively
 *   2. a reference still put into motion with the video model
 *   3. representational media generated from the reference imagery, never reading as stock AI
 * and generated footage never exceeds 30 seconds, because a 15 second clip can carry several
 * scenes and the agent can cut from it.
 */

/** Nothing we generate may exceed this much footage per artefact. */
export const GENERATED_FOOTAGE_CAP_SEC = 30;

/** One generation covers several scenes; the agent cuts the needed shots out of it. */
export const SCENE_PACK_SEC = 15;

export type MediaApproach = 'tenant_product_assets' | 'animate_reference_still' | 'representational';

export interface TenantAsset {
  id: string;
  url: string;
  type: 'image' | 'video' | string;
  propertyId?: string | null;
  createdAt?: string | null;
}

export interface MediaDecision {
  approach: MediaApproach;
  /** Tenant media to place in frame as-is. */
  use: TenantAsset[];
  /** Tenant stills to animate with the video model (image-to-video). */
  animate: TenantAsset[];
  /** Representational media to generate when the tenant has nothing usable. */
  generate: { count: number; maxSeconds: number };
  reason: string;
}

export const MEDIA_RULES: readonly string[] = [
  'Use the business\'s own media when it exists and is linked to the product being advertised. Choose selectively — the asset that fits the frame and the story, never everything at once.',
  'To put a still in motion, animate that image with the video model instead of inventing a new scene: the real product in movement beats a generated approximation of it.',
  'When the business has nothing usable, generate representational media based on the reference imagery, and make it read as real photography, not as AI.',
  `Never generate more than ${GENERATED_FOOTAGE_CAP_SEC} seconds of footage for one artefact. Pack several scenes into a ${SCENE_PACK_SEC} second clip and cut the shots out of it.`,
  'Never invent product information. Names, prices, sizes, locations, phone numbers, amenities and claims come only from what the business supplied.',
  'The reference is the standard: compare your result against it before delivering, and fix what does not match.',
];

export function mediaRulesBlock(): string {
  return MEDIA_RULES.map((r, i) => `${i + 1}. ${r}`).join('\n');
}

/**
 * Selective, deterministic: product-linked assets win outright; otherwise recent images, newest
 * first. Never returns a tenant's whole library — a page or film needs a handful of frames.
 */
export function productAssets(
  assets: TenantAsset[],
  options: { propertyId?: string | null; want?: 'image' | 'video'; limit?: number } = {}
): TenantAsset[] {
  const { propertyId = null, want = 'image', limit = 6 } = options;
  const usable = (a: TenantAsset) => !!a?.url && /^https:\/\//i.test(a.url) && a.type === want;

  const linked = assets.filter((a) => usable(a) && propertyId && a.propertyId === propertyId);
  if (linked.length) return linked.slice(0, limit);

  return assets
    .filter((a) => usable(a) && !a.propertyId)
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
    .slice(0, limit);
}

export function decideMediaPlan(input: {
  assets: TenantAsset[];
  propertyId?: string | null;
  hasReferenceImage?: boolean;
  needsSeconds?: number;
}): MediaDecision {
  const { assets, propertyId = null, hasReferenceImage = false, needsSeconds = SCENE_PACK_SEC } = input;

  const stills = productAssets(assets, { propertyId, want: 'image' });
  const clips = productAssets(assets, { propertyId, want: 'video', limit: 3 });

  if (clips.length || stills.length >= 3) {
    return {
      approach: 'tenant_product_assets',
      use: [...clips, ...stills],
      animate: [],
      generate: { count: 0, maxSeconds: 0 },
      reason: clips.length
        ? `the business already has ${clips.length} video clip(s)${propertyId ? ' linked to this product' : ''}`
        : `the business has ${stills.length} usable still(s)${propertyId ? ' linked to this product' : ''}`,
    };
  }

  if (stills.length && hasReferenceImage) {
    return {
      approach: 'animate_reference_still',
      use: stills,
      animate: stills.slice(0, 2),
      generate: { count: 0, maxSeconds: 0 },
      reason: 'the business has few stills, so animate those stills with the video model rather than generating scenes',
    };
  }

  const wanted = Math.min(GENERATED_FOOTAGE_CAP_SEC, Math.max(SCENE_PACK_SEC, needsSeconds));
  return {
    approach: 'representational',
    use: [],
    animate: [],
    generate: { count: Math.ceil(wanted / SCENE_PACK_SEC), maxSeconds: wanted },
    reason: 'the business has no usable media of its own, so generate representational media from the reference',
  };
}

/** Reads a tenant's media, newest first, so the rules above have something to choose from. */
export async function fetchTenantAssets(
  supabase: SupabaseClient,
  userId: string,
  options: { limit?: number } = {}
): Promise<TenantAsset[]> {
  const { limit = 200 } = options;
  const { data, error } = await supabase
    .from('assets')
    .select('id, url, type, property_id, created_at, status')
    .eq('user_id', userId)
    .in('type', ['image', 'video'])
    .neq('status', 'Distributed')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data ?? []).map((row: any) => ({
    id: String(row.id),
    url: String(row.url ?? ''),
    type: String(row.type ?? ''),
    propertyId: row.property_id ?? null,
    createdAt: row.created_at ?? null,
  }));
}
