import { tool } from 'ai';
import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';

export function createFileManagerTools(supabase: SupabaseClient, userId: string) {
  return {
    list_user_files: tool({
      description: 'Lists all stored files and folders in the user asset library (videos, images, templates, documents). The agent can view file names, URLs, types, and folder organization.',
      inputSchema: z.object({
        type: z.enum(['all', 'video', 'image', 'document']).default('all'),
        folder: z.string().optional().describe('Filter by folder name (e.g. "Campaigns", "Raw Videos", "Creatives")'),
        limit: z.number().default(20),
      }),
      execute: async ({ type, folder, limit }) => {
        try {
          let q = supabase
            .from('assets')
            .select('id, type, url, caption, status, created_at, metadata')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);

          if (type !== 'all') {
            q = q.eq('type', type);
          }

          const { data, error } = await q;
          if (error) throw error;

          const files = (data || []).filter((item: any) => {
            if (!folder) return true;
            return item.metadata?.folder?.toLowerCase() === folder.toLowerCase();
          }).map((f: any) => ({
            id: f.id,
            name: f.caption || f.metadata?.title || 'Untitled File',
            type: f.type,
            url: f.url,
            folder: f.metadata?.folder || 'Root',
            duration: f.metadata?.duration ? `${f.metadata.duration}s` : undefined,
            createdAt: f.created_at,
          }));

          return {
            success: true,
            totalFiles: files.length,
            folder: folder || 'All Folders',
            files,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),

    organize_or_move_file: tool({
      description: 'Moves a file into a specific folder or renames it in the user file manager.',
      inputSchema: z.object({
        fileId: z.string().describe('The UUID of the asset to update'),
        newFolder: z.string().optional().describe('Destination folder (e.g. "Instagram Reels", "Raw Footage", "WhatsApp Assets")'),
        newName: z.string().optional().describe('New name or caption for the file'),
      }),
      execute: async ({ fileId, newFolder, newName }) => {
        try {
          const { data: asset, error: fetchErr } = await supabase
            .from('assets')
            .select('metadata, caption')
            .eq('id', fileId)
            .eq('user_id', userId)
            .single();

          if (fetchErr) throw fetchErr;

          const updatedMetadata = {
            ...(asset?.metadata || {}),
            ...(newFolder ? { folder: newFolder } : {}),
            ...(newName ? { title: newName } : {}),
          };

          const { error: updateErr } = await supabase
            .from('assets')
            .update({
              metadata: updatedMetadata,
              ...(newName ? { caption: newName } : {}),
            })
            .eq('id', fileId)
            .eq('user_id', userId);

          if (updateErr) throw updateErr;

          return {
            success: true,
            message: `File updated successfully.${newFolder ? ` Moved to "${newFolder}".` : ''}${newName ? ` Renamed to "${newName}".` : ''}`,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),

    delete_user_file: tool({
      description: 'Deletes a file from the user asset library by file ID.',
      inputSchema: z.object({
        fileId: z.string().describe('UUID of the file to delete'),
      }),
      execute: async ({ fileId }) => {
        try {
          const { error } = await supabase
            .from('assets')
            .delete()
            .eq('id', fileId)
            .eq('user_id', userId);

          if (error) throw error;

          return {
            success: true,
            message: `File ${fileId} deleted from library.`,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),
  };
}

