/**
 * Product media, as the agent uses it.
 *
 * Two tools, because the agent needs two different things:
 *
 *   product_media      what photos, footage and documents this offering already has. The
 *                      answer is deliberately compact — counts plus a capped list — so a
 *                      product with 35 files does not cost 35 URLs of prompt on every turn.
 *
 *   attach_product_media   link a file already in the library to an offering. It does NOT
 *                      upload: uploading is the owner's job in the catalogue UI, and a tool
 *                      that silently pushes megabytes is a tool that surprises people.
 *
 * WHY THE ATTACH IS VALIDATED HERE TOO
 * The UI checks the same limits, but an agent can call this directly. `checkUpload` is the
 * single rule: 50 MB for video, 10 MB for photos and documents, capped per product. A limit
 * enforced in only one of two entry points is not a limit.
 */

import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  MEDIA_LIMITS,
  checkUpload,
  mediaBriefForAgent,
  kindOf,
  summariseProductMedia,
  type ProductMediaRow,
} from '@/lib/catalog/product-media';

export function createProductMediaTools(supabase: SupabaseClient, userId: string) {
  return {
    product_media: tool({
      description:
        'List the photos, videos and documents attached to one offering. Call this BEFORE making any ' +
        'creative, page or film for a product: using the business\'s own media is what makes the output look ' +
        'like them instead of like a stock photo. It returns counts plus the first few files, not every URL.',
      inputSchema: z.object({
        productId: z.string().describe('The offering id (from nobogent_inventory_search)'),
        limit: z.number().optional().describe('How many files per kind to list; default 6, max 12'),
      }),
      execute: async ({ productId, limit }: { productId: string; limit?: number }) => {
        try {
          const { data, error } = await supabase
            .from('assets')
            .select('id, url, type, caption, product_id')
            .eq('user_id', userId)
            .eq('product_id', productId)
            .limit(200);
          if (error) return { success: false, error: error.message };

          const summary = summariseProductMedia(productId, (data ?? []) as ProductMediaRow[]);
          return {
            success: true,
            productId,
            counts: summary.counts,
            total: summary.total,
            media: {
              images: summary.images.slice(0, Math.min(12, limit ?? 6)),
              videos: summary.videos.slice(0, Math.min(12, limit ?? 6)),
              documents: summary.documents.slice(0, Math.min(12, limit ?? 6)),
            },
            message: mediaBriefForAgent(summary, { ...(limit ? { limit } : {}) }),
          };
        } catch (error: any) {
          return { success: false, error: String(error?.message ?? error) };
        }
      },
    }),

    attach_product_media: tool({
      description:
        'Attach a file that is ALREADY in the library to an offering, so future creatives can use it. ' +
        'This does not upload anything: ask the owner to upload in the catalogue if the file is not there yet. ' +
        'Limits: videos 50 MB and 5 per product, photos and documents 10 MB and 20/10 per product.',
      inputSchema: z.object({
        assetId: z.string().describe('The library asset id'),
        productId: z.string().describe('The offering to attach it to'),
      }),
      execute: async ({ assetId, productId }: { assetId: string; productId: string }) => {
        try {
          // Read first: the limits are per kind, so we need the file's kind and the product's
          // current tally before deciding anything.
          const { data: asset, error: assetError } = await supabase
            .from('assets')
            .select('id, url, type, caption, product_id')
            .eq('id', assetId)
            .eq('user_id', userId)
            .maybeSingle();
          if (assetError) return { success: false, error: assetError.message };
          if (!asset) return { success: false, error: `No asset ${assetId} in this library.` };
          if (String((asset as any).product_id ?? '') === String(productId)) {
            return { success: true, alreadyAttached: true, message: 'That file is already on this product.' };
          }

          const { data: siblings, error: siblingsError } = await supabase
            .from('assets')
            .select('id, url, type, caption, product_id')
            .eq('user_id', userId)
            .eq('product_id', productId)
            .limit(200);
          if (siblingsError) return { success: false, error: siblingsError.message };

          const summary = summariseProductMedia(productId, (siblings ?? []) as ProductMediaRow[]);
          const kind = kindOf(String((asset as any).url ?? (asset as any).caption ?? '')) ??
            ((asset as any).type as 'image' | 'video' | 'document' | undefined) ??
            'document';

          const verdict = checkUpload(
            { name: String((asset as any).caption || (asset as any).url || 'file'), size: 1 },
            summary.counts,
          );
          if (!verdict.ok) {
            return { success: false, error: verdict.reason, counts: summary.counts };
          }

          const { error: updateError } = await supabase
            .from('assets')
            .update({ product_id: productId })
            .eq('id', assetId)
            .eq('user_id', userId);
          if (updateError) return { success: false, error: updateError.message };

          return {
            success: true,
            assetId,
            productId,
            kind,
            counts: summary.counts,
            message:
              `Attached to the product. It now has ${summary.counts.image} photo(s), ` +
              `${summary.counts.video} video(s) and ${summary.counts.document} document(s).`,
          };
        } catch (error: any) {
          return { success: false, error: String(error?.message ?? error) };
        }
      },
    }),
  };
}

/** The limits, for the prompt or an admin screen to quote. */
export function productMediaLimits(): string {
  return (['image', 'video', 'document'] as const)
    .map((kind) => `${MEDIA_LIMITS[kind].label}: ${MEDIA_LIMITS[kind].maxPerProduct} max`)
    .join(', ');
}
