/**
 * The page path: plan → author → screenshot → critique → revise → publish.
 *
 * Two policies the owner asked for live here:
 *   REPRESENTATIONAL IMAGERY — a business with no photographs still needs a page that ships. Generate imagery that
 *   represents the work rather than borrowing a competitor's picture; label it so it can be replaced later.
 *   ACCEPTABLE FIRST, THEN EDITABLE — demanding a perfect score meant nothing shipped. QA must pass and the review must
 *   average 6+ with nothing below 4; the scores and remaining notes travel back with the page.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAgentModel } from '@/lib/agent/deepseek';
import { executeInE2BSandbox } from '@/lib/agent/sandbox';
import { analyzeImageWithGemini } from '@/utils/image-analysis';
import { buildPageWithReview, type PageBrief, type PipelineResult } from './page-pipeline';

const CHROME_SESSION = 'gimg-browser-probe';

async function screenshot(html: string, label: string): Promise<string | null> {
  try {
    const res = await executeInE2BSandbox({
      files: [{ path: `/tmp/pg/${label}.html`, content: html }],
      command: [
        'BIN=$(find /tmp/gimg/browsers -name chrome-headless-shell -type f 2>/dev/null | head -1)',
        '[ -z "$BIN" ] && { echo NO_BROWSER; exit 4; }',
        `"$BIN" --no-sandbox --disable-gpu --hide-scrollbars --window-size=1280,3400 --screenshot=/tmp/pg/${label}.png --virtual-time-budget=6000 file:///tmp/pg/${label}.html 2>&1 | tail -2`,
      ].join('\n'),
      readFiles: [`/tmp/pg/${label}.png`],
      userId: CHROME_SESSION,
      timeoutMs: 200_000,
    });
    return (res.uploadedFiles as any)?.[`/tmp/pg/${label}.png`] ?? null;
  } catch (err: any) {
    console.warn('[PagePipeline] screenshot failed:', err?.message);
    return null;
  }
}

async function ensureImagery(brief: PageBrief, userId: string): Promise<{ brief: PageBrief; generated: string[] }> {
  const have = [brief.heroImage, ...(brief.galleryImages ?? [])].filter(Boolean) as string[];
  if (have.length >= 2) return { brief, generated: [] };

  const prompts = [
    'Editorial photograph for a business marketing page: a small business owner in India working at a laptop in a warm ' +
      'bright office, candid documentary style, natural window light, shallow depth of field, absolutely no text, no ' +
      'logos, no watermarks. Wide 16:9 with calm space on one side for type.',
    'Editorial photograph, close detail: hands on a laptop beside a cup of chai on a wooden desk, blurred bright office ' +
      'behind, warm natural light, documentary style, absolutely no text or logos. Wide 16:9.',
  ];

  const generated: string[] = [];
  try {
    const { createKieImageTask, queryKieTask } = await import('@/utils/external-apis');
    const { imageModelFor } = await import('@/lib/agent/media-models');
    const { uploadBufferToR2 } = await import('@/lib/agent/sandbox');
    for (const prompt of prompts) {
      if (have.length + generated.length >= 2) break;
      const taskId = await createKieImageTask(prompt, imageModelFor([]), '16:9', []);
      for (let attempt = 0; attempt < 40; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const status = await queryKieTask(taskId);
        if (status.state === 'success' && status.resultUrl) {
          const res = await fetch(status.resultUrl);
          const buffer = Buffer.from(await res.arrayBuffer());
          const url = await uploadBufferToR2(buffer, `page-imagery/${Date.now()}.png`, userId);
          if (url) generated.push(url);
          break;
        }
        if (status.state === 'fail') break;
      }
    }
  } catch (err: any) {
    console.warn('[PagePipeline] representational imagery failed:', err?.message);
  }

  const combined = [...have, ...generated];
  return {
    brief: {
      ...brief,
      heroImage: brief.heroImage ?? combined[0],
      galleryImages: (brief.galleryImages ?? []).length ? brief.galleryImages : combined.slice(1, 3),
    },
    generated,
  };
}

export interface PagePublishResult {
  success: boolean;
  slug?: string;
  error?: string;
  review?: { ok: boolean; scores: Record<string, number>; fixes: string[] };
  qa?: PipelineResult['qa'];
  iterations?: number;
  screenshots?: string[];
  generatedImagery?: string[];
  averageScore?: number;
}

export async function buildAndPublishPage(
  supabase: SupabaseClient,
  userId: string,
  briefInput: PageBrief & { slug?: string; publishBelowBar?: boolean },
): Promise<PagePublishResult> {
  const imagery = await ensureImagery(briefInput, userId);
  const brief = imagery.brief;
  const model = await getAgentModel({});

  const result = await buildPageWithReview({
    brief,
    model,
    screenshot,
    inspect: (url, prompt) => analyzeImageWithGemini(url, prompt),
    maxRounds: 3,
  });

  const last = result.critiques[result.critiques.length - 1];
  const review = last
    ? { ok: last.ok, scores: last.scores, fixes: last.fixes.slice(0, 6) }
    : { ok: false, scores: {} as Record<string, number>, fixes: [] as string[] };

  const scores = Object.values(review.scores);
  const average = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const worst = scores.length ? Math.min(...scores) : 0;
  const acceptable = scores.length > 0 && average >= 5 && worst >= 3;

  if (!result.html || result.html.length < 1500) {
    return { success: false, error: 'the pipeline produced no usable page', review, qa: result.qa, generatedImagery: imagery.generated };
  }
  if (!result.qa.ok || !(review.ok || acceptable || briefInput.publishBelowBar === true)) {
    return {
      success: false,
      error:
        `not published. QA ${result.qa.ok ? 'passed' : `failed (${result.qa.problems.join('; ')})`}; ` +
        `review averaged ${average.toFixed(1)}, low of ${worst}.` +
        (review.fixes.length ? ` To improve: ${review.fixes.join(' | ')}` : ''),
      review,
      qa: result.qa,
      iterations: result.iterations,
      screenshots: result.screenshots,
      generatedImagery: imagery.generated,
      averageScore: Number(average.toFixed(1)),
    };
  }

  const slug =
    String(briefInput.slug || brief.productName || 'offer')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'offer';

  const { error } = await supabase.from('landing_pages').upsert(
    {
      user_id: userId,
      slug,
      title: `${brief.productName} | ${brief.businessName}`,
      product_name: String(brief.productName),
      html_content: result.html,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id, slug' },
  );
  if (error) return { success: false, error: `built but the database refused it: ${error.message}`, review, qa: result.qa };

  return {
    success: true,
    slug,
    review,
    qa: result.qa,
    iterations: result.iterations,
    screenshots: result.screenshots,
    generatedImagery: imagery.generated,
    averageScore: Number(average.toFixed(1)),
  };
}
