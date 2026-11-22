/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase rows are untyped. */
/**
 * Writing to the catalogue: the capability the agent did not have.
 *
 * WHAT WAS WRONG
 * `lib/agent/tools/inventory.ts` defined `add_catalog_offering` / `add_property_listing`, and it was never
 * registered in the orchestrator. So "add my new project to the catalogue" could not be served at all - the agent
 * could SEARCH the catalogue and not write to it. Worse, that module was also wrong about the schema: it filtered and
 * inserted `location` and `category`, while the `properties` table has `address` and `property_type`. Registering it
 * as written would have shipped the same class of bug already fixed in `nobogent_inventory_search` - a PostgREST
 * rejection dressed up as an empty catalogue.
 *
 * So this is a small, correct tool against the REAL columns, and it is deliberately only the WRITE half: reading the
 * catalogue is already served by `nobogent_inventory_search` (with the same corrected columns), and duplicating it
 * would cost every turn tokens for no new capability.
 *
 * Not review gated, on purpose: adding a catalogue row spends no money and messages nobody. It becomes visible to
 * customers only through a broadcast, a page or an ad - and each of those is gated where it happens.
 */
import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

/** The columns a catalogue item may be created with, as the table actually names them. */
const WRITABLE = [
  'title',
  'description',
  'price',
  'address',
  'property_type',
  'status',
  'image_url',
  'images',
  'rera_number',
  'brochure_url',
  'floor_plan_url',
  'configurations',
  'youtube_url',
  'show_on_landing_page',
] as const;

export interface CatalogueDraft {
  title?: string;
  description?: string;
  price?: number | string;
  address?: string;
  propertyType?: string;
  status?: string;
  imageUrls?: string[];
  reraNumber?: string;
  brochureUrl?: string;
  floorPlanUrl?: string;
  configurations?: string;
  youtubeUrl?: string;
  showOnLandingPage?: boolean;
}

/**
 * Build the row, refusing the two things that make a catalogue entry useless.
 *
 * Pure, so the refusals are tested without a database. A property with no title cannot be sent in a WhatsApp
 * catalogue and has no heading on the landing page; a length without a unit is a price nobody will quote.
 */
export function buildCatalogueRow(
  draft: CatalogueDraft
): { ok: boolean; error?: string; row?: Record<string, unknown>; warnings?: string[] } {
  const title = String(draft?.title ?? '').trim();
  if (!title) {
    return { ok: false, error: 'A catalogue item needs a title - it is the heading everywhere the item appears.' };
  }

  const warnings: string[] = [];
  const row: Record<string, unknown> = { title };

  if (draft.description !== undefined) row.description = String(draft.description).trim() || null;
  if (draft.address !== undefined) row.address = String(draft.address).trim() || null;
  if (draft.propertyType !== undefined) row.property_type = String(draft.propertyType).trim() || null;
  if (draft.status !== undefined) row.status = String(draft.status).trim() || null;
  if (draft.reraNumber !== undefined) row.rera_number = String(draft.reraNumber).trim() || null;
  if (draft.brochureUrl !== undefined) row.brochure_url = String(draft.brochureUrl).trim() || null;
  if (draft.floorPlanUrl !== undefined) row.floor_plan_url = String(draft.floorPlanUrl).trim() || null;
  if (draft.configurations !== undefined) row.configurations = String(draft.configurations).trim() || null;
  if (draft.youtubeUrl !== undefined) row.youtube_url = String(draft.youtubeUrl).trim() || null;
  if (draft.showOnLandingPage !== undefined) row.show_on_landing_page = draft.showOnLandingPage === true;

  if (draft.price !== undefined && draft.price !== null && draft.price !== '') {
    const price = Number(String(draft.price).replace(/[₹,\s]/g, ''));
    if (!Number.isFinite(price) || price < 0) {
      return { ok: false, error: `"${draft.price}" is not a price I can store. Give a number, e.g. 8500000 for 85 lakh.` };
    }
    row.price = price;
    if (price > 0 && price < 1000) {
      warnings.push(
        `The price stored is ${price}. If that was lakhs or crores, it must be the full figure (85 lakh = 8500000).`,
      );
    }
  }

  const images = (Array.isArray(draft.imageUrls) ? draft.imageUrls : [])
    .map((u) => String(u || '').trim())
    .filter((u) => /^https?:\/\//i.test(u));
  if (images.length) {
    row.images = images;
    row.image_url = images[0];
  }
  if (Array.isArray(draft.imageUrls) && draft.imageUrls.length && !images.length) {
    warnings.push('None of the image URLs were http(s) links, so no images were stored.');
  }

  return { ok: true, row, warnings: warnings.length ? warnings : undefined };
}

export function createCatalogueTools(supabase: SupabaseClient, userId: string) {
  const db = supabase as any;

  return {
    add_catalog_offering: tool({
      description:
        'Add a product, property or service to this business\'s CATALOGUE (the same list the WhatsApp catalogue, the landing page and ad creatives read from). Use it when the owner says "add my new project", "put this listing in the catalogue", or pastes a brochure/flyer\'s details. Title is required; everything else is optional. It stores FULL figures for prices (85 lakh = 8500000) and real https image URLs. If the owner has not given an image, add the item without one and say an image is still missing - do not invent a URL.',
      inputSchema: z.object({
        title: z.string().describe('Item or project name - the heading everywhere it appears'),
        description: z.string().optional().describe('What it is, in the owner\'s words: specifications, highlights, deliverables'),
        price: z.string().optional().describe('Full figure, e.g. "8500000" or "₹85,00,000". Never lakhs/crores as a bare number.'),
        address: z.string().optional().describe('Location / address / city'),
        propertyType: z.string().optional().describe('e.g. "3BHK apartment", "plot", "villa", "service package"'),
        status: z.string().optional().describe('e.g. "Ready to move", "Under construction", "Available"'),
        imageUrls: z.array(z.string()).optional().describe('Public https image URLs already uploaded or generated'),
        configurations: z.string().optional().describe('e.g. "2BHK, 3BHK"'),
        reraNumber: z.string().optional().describe('Approval or registration number, exactly as given'),
        brochureUrl: z.string().optional(),
        floorPlanUrl: z.string().optional(),
        youtubeUrl: z.string().optional(),
        showOnLandingPage: z.boolean().optional().describe('Whether the item appears on the public landing page'),
      }),
      execute: async (input: CatalogueDraft) => {
        try {
          const built = buildCatalogueRow(input);
          if (!built.ok || !built.row) return { ok: false, error: built.error };

          const { data, error } = await db
            .from('properties')
            .insert({ user_id: userId, ...built.row, created_at: new Date().toISOString() })
            .select('id, title, price, address, property_type, images, show_on_landing_page')
            .maybeSingle();

          if (error) {
            return {
              ok: false,
              error: `The catalogue rejected this item: ${error.message}. Nothing was added.`,
            };
          }

          const { count } = await db
            .from('properties')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId);

          const missing: string[] = [];
          if (!built.row.images) missing.push('an image (the catalogue and WhatsApp sends look bare without one)');
          if (!built.row.price) missing.push('a price');
          if (!built.row.address) missing.push('a location');

          return {
            ok: true,
            item: data,
            catalogueSize: count ?? null,
            warnings: built.warnings,
            missing,
            message:
              `"${built.row.title}" is in the catalogue` +
              (count ? ` (${count} item${count === 1 ? '' : 's'} now)` : '') +
              '. It appears wherever the catalogue is used; nothing was sent to anyone.' +
              (missing.length ? ` Still missing: ${missing.join(', ')}.` : ''),
          };
        } catch (e: any) {
          return { ok: false, error: e?.message || 'could not add the item; nothing was written' };
        }
      },
    }),
  };
}

/** Names this module registers, so a gate can assert they are actually wired. */
export const CATALOGUE_TOOLS = ['add_catalog_offering'] as const;

/** The columns this tool may write, exported so a gate can pin them to the table. */
export const CATALOGUE_WRITABLE_COLUMNS = WRITABLE;
