import { tool } from 'ai';
import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';

export function createInventoryTools(supabase: SupabaseClient, userId: string) {
  const searchTool = tool({
    description: 'Search company product catalog, service offerings, inventory, or listings by keyword, category, price range, or location.',
    inputSchema: z.object({
      query: z.string().optional().describe('Search keyword in title or description'),
      category: z.string().optional().describe('Category filter (e.g. Products, Services, Packages, Units)'),
      maxPrice: z.number().optional().describe('Maximum price filter'),
      minPrice: z.number().optional().describe('Minimum price filter'),
      limit: z.number().default(10).describe('Max items to return'),
    }),
    execute: async ({ query, category, maxPrice, minPrice, limit }) => {
      try {
        let q = supabase
          .from('properties')
          .select('id, title, description, price, location, images, created_at, category')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(limit);

        if (query) {
          q = q.or(`title.ilike.%${query}%,description.ilike.%${query}%,location.ilike.%${query}%`);
        }

        if (category) {
          q = q.ilike('category', `%${category}%`);
        }

        if (maxPrice) {
          q = q.lte('price', maxPrice);
        }

        if (minPrice) {
          q = q.gte('price', minPrice);
        }

        const { data, error } = await q;
        if (error) throw error;

        return {
          success: true,
          count: data?.length || 0,
          items: (data || []).map((p: any) => ({
            id: p.id,
            title: p.title,
            price: p.price,
            category: p.category || 'General',
            location: p.location,
            imageCount: Array.isArray(p.images) ? p.images.length : (p.images ? 1 : 0),
            previewImage: Array.isArray(p.images) ? p.images[0] : p.images,
            description: p.description?.slice(0, 150),
          })),
        };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  });

  const addTool = tool({
    description: 'Adds a new product, service offering, package, or inventory item to the user catalog from extracted details (e.g. from brochure, flyer, specs, or user notes).',
    inputSchema: z.object({
      title: z.string().describe('Item title or service name'),
      price: z.number().optional().describe('Price in numbers'),
      location: z.string().optional().describe('City, location, or delivery area if applicable'),
      description: z.string().optional().describe('Key specifications, benefits, deliverables, or highlights'),
      category: z.string().default('General').describe('Category or industry classification'),
      imageUrl: z.string().optional().describe('Photo, banner, or brochure image URL if available'),
    }),
    execute: async ({ title, price, location, description, category, imageUrl }) => {
      try {
        const insertPayload: Record<string, any> = {
          user_id: userId,
          title,
          price: price || null,
          location: location || null,
          description: description || null,
          category,
          images: imageUrl ? [imageUrl] : [],
          created_at: new Date().toISOString(),
        };

        const { data, error } = await supabase
          .from('properties')
          .insert(insertPayload)
          .select()
          .single();

        if (error) throw error;

        return {
          success: true,
          message: `Item "${title}" successfully added to catalog.`,
          item: data,
        };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  });

  return {
    search_catalog_offerings: searchTool,
    add_catalog_offering: addTool,
    // Aliases for seamless backwards compatibility
    search_properties: searchTool,
    add_property_listing: addTool,
  };
}
