/* eslint-disable @typescript-eslint/no-explicit-any --
 * Provider payloads and supabase rows are untyped here (stale generated types),
 * matching utils/credits.ts and lib/automation/billing.ts.
 */
/**
 * What onboarding is about to spend, decided before anything is generated.
 *
 * Onboarding used to create Kie image tasks (10 credits each) and Seedance video
 * tasks (50 credits per 15s, up to 300s) with no affordability check, no ledger
 * entry and no deduction. A human does onboarding once; an agent can loop it. So
 * the whole run is priced first, funded by one hold, and charged per artefact.
 *
 * Pure functions on purpose: the trimming rules are the interesting part and they
 * are much easier to trust when they can be tested without a database.
 */
import { CREDIT_UNIT_COSTS } from './billing';

export type OnboardingItemKind = 'image' | 'video';

export interface OnboardingPlanItem {
  /** Index into the resolved projects array. */
  projectIndex: number;
  /** Index within that project's creatives or videos. */
  itemIndex: number;
  kind: OnboardingItemKind;
  /** Seconds for a video, 0 for an image. */
  duration: number;
  credits: number;
  /** What we tell the vendor we want, which is what we are billed for. */
  vendorDuration?: number;
}

export interface OnboardingPlan {
  items: OnboardingPlanItem[];
  costInCredits: number;
  /** Human-readable notes on what was dropped to fit the ceiling. */
  trimmed: string[];
  imageCount: number;
  videoCount: number;
}

export interface PlanProjectInput {
  creativesCount?: number;
  videos?: Array<{ duration?: number }>;
}

/**
 * Seedance mini accepts 15 or 30 seconds. A 45s brief is generated as 30s, so we
 * price what we actually ask for rather than what was requested — the old code
 * quoted nothing at all, but a plan that over-quotes gets trimmed needlessly.
 */
export function vendorVideoSeconds(requested: number): number {
  const d = Number(requested) || 15;
  return d <= 15 ? 15 : 30;
}

export function imageCredits(): number {
  return CREDIT_UNIT_COSTS.image;
}

export function videoCredits(requestedDuration: number): number {
  const seconds = vendorVideoSeconds(requestedDuration);
  return CREDIT_UNIT_COSTS.videoPer15s * Math.ceil(seconds / 15);
}

/** Total seconds of video a plan asks for, capped by the caller at 300s. */
export function planVideoSeconds(plan: OnboardingPlan): number {
  return plan.items
    .filter((i) => i.kind === 'video')
    .reduce((sum, i) => sum + (i.vendorDuration || i.duration), 0);
}

/**
 * Build the run's plan, trimmed to `maxCredits`.
 *
 * Trim order is deliberate: video is the expensive, slow, failure-prone half of a
 * first run, and one good image beats a rushed video. So videos go first (down to
 * zero), then extra creatives (down to one per project). If even one image per
 * project cannot be funded, the plan is left short and the caller paywalls.
 */
export function planOnboarding(
  projects: PlanProjectInput[],
  opts: { maxCredits?: number; maxVideoSeconds?: number } = {}
): OnboardingPlan {
  const maxCredits = opts.maxCredits ?? 4000;
  const maxVideoSeconds = opts.maxVideoSeconds ?? 300;

  let items: OnboardingPlanItem[] = [];
  const trimmed: string[] = [];

  let cumulativeVideoSeconds = 0;

  projects.forEach((project, projectIndex) => {
    const images = Math.max(1, Math.min(10, Number(project.creativesCount) || 3));
    for (let itemIndex = 0; itemIndex < images; itemIndex++) {
      items.push({
        projectIndex,
        itemIndex,
        kind: 'image',
        duration: 0,
        credits: imageCredits(),
      });
    }

    const videos = Array.isArray(project.videos) && project.videos.length > 0
      ? project.videos
      : [{ duration: 15 }];

    videos.forEach((video, itemIndex) => {
      const requested = Number(video?.duration) || 15;
      const vendorSeconds = vendorVideoSeconds(requested);
      if (cumulativeVideoSeconds + vendorSeconds > maxVideoSeconds) {
        trimmed.push(`video ${itemIndex + 1} of project ${projectIndex + 1}: the ${maxVideoSeconds}s video budget for one run is used up`);
        return;
      }
      cumulativeVideoSeconds += vendorSeconds;
      items.push({
        projectIndex,
        itemIndex,
        kind: 'video',
        duration: requested,
        vendorDuration: vendorSeconds,
        credits: videoCredits(requested),
      });
    });
  });

  const total = () => items.reduce((sum, i) => sum + i.credits, 0);

  // 1. Drop video, newest first, until the run fits.
  while (total() > maxCredits) {
    const lastVideo = [...items].reverse().find((i) => i.kind === 'video');
    if (!lastVideo) break;
    items = items.filter((i) => i !== lastVideo);
    trimmed.push(
      `a ${lastVideo.duration}s video: the per-run ceiling is ${maxCredits} credits, so the images come first`
    );
  }

  // 2. Then trim extra creatives, keeping at least one image per project.
  while (total() > maxCredits) {
    const candidates = items.filter((i) => i.kind === 'image');
    const perProject = new Map<number, number>();
    for (const item of candidates) {
      perProject.set(item.projectIndex, (perProject.get(item.projectIndex) || 0) + 1);
    }
    // Take the last image of whichever project has the most.
    let victim: OnboardingPlanItem | undefined;
    let most = 1;
    for (const item of [...candidates].reverse()) {
      const count = perProject.get(item.projectIndex) || 0;
      if (count > most) {
        victim = item;
        most = count;
        break;
      }
    }
    if (!victim) break;
    items = items.filter((i) => i !== victim);
    trimmed.push(
      `one extra creative: the per-run ceiling is ${maxCredits} credits, so every project still gets its first image`
    );
  }

  return {
    items,
    costInCredits: Math.round(total() * 100) / 100,
    trimmed,
    imageCount: items.filter((i) => i.kind === 'image').length,
    videoCount: items.filter((i) => i.kind === 'video').length,
  };
}

/** Stable job id, so a retried request re-attaches to its own reservation. */
export function onboardingJobId(userId: string, plan: OnboardingPlan): string {
  const signature = plan.items
    .map((i) => `${i.projectIndex}:${i.kind}:${i.itemIndex}:${i.duration}`)
    .sort()
    .join('|');
  let hash = 0;
  for (let i = 0; i < signature.length; i++) {
    hash = (hash * 31 + signature.charCodeAt(i)) | 0;
  }
  return `onboarding:${userId}:${Math.abs(hash).toString(36)}`;
}
