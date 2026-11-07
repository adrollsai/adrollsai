'use client';

import * as React from 'react';
import { useState, useEffect } from 'react';
import {
  FolderOpen,
  X,
  Film,
  Image as ImageIcon,
  FileText,
  Trash2,
  Copy,
  ExternalLink,
  Check,
  RefreshCw,
  Folder,
  Loader2,
  Play,
  Upload,
} from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import { toast } from 'sonner';

interface FileManagerDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  userId?: string | null;
  onSelectAsset?: (url: string, name: string) => void;
}

export default function FileManagerDrawer({
  isOpen,
  onClose,
  userId,
  onSelectAsset,
}: FileManagerDrawerProps) {
  const supabase = createClient();
  const [assets, setAssets] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'video' | 'image' | 'template'>('all');
  const [selectedFolder, setSelectedFolder] = useState<string>('All');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [previewMedia, setPreviewMedia] = useState<{ url: string; type: string; title: string } | null>(null);

  const fetchAssets = async () => {
    setLoading(true);
    try {
      let q = supabase
        .from('assets')
        .select('id, type, url, caption, status, created_at, metadata')
        .order('created_at', { ascending: false })
        .limit(50);

      if (userId) {
        q = q.eq('user_id', userId);
      }

      const { data, error } = await q;
      if (error) throw error;
      setAssets(data || []);
    } catch (err: any) {
      toast.error('Failed to load file manager assets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchAssets();
    }
  }, [isOpen, userId]);

  if (!isOpen) return null;

  // Extract unique folders
  const folders = Array.from(
    new Set(assets.map((a) => a.metadata?.folder || 'Unsorted'))
  );

  const filteredAssets = assets.filter((item) => {
    if (filterType !== 'all' && item.type !== filterType) return false;
    if (selectedFolder !== 'All') {
      const itemFolder = item.metadata?.folder || 'Unsorted';
      if (itemFolder !== selectedFolder) return false;
    }
    return true;
  });

  const handleCopy = (id: string, url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    toast.success('Asset URL copied to clipboard');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase.from('assets').delete().eq('id', id);
      if (error) throw error;
      setAssets((prev) => prev.filter((a) => a.id !== id));
      toast.success('Asset removed from file manager');
    } catch (err: any) {
      toast.error('Could not delete asset');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in-50">
      <div className="relative w-full max-w-4xl h-[85vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold">
              <FolderOpen size={18} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                Asset & File Manager
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                  {assets.length} items
                </span>
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                All videos, images, and templates saved or controlled by the agent.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchAssets}
              disabled={loading}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              title="Refresh Files"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs">
          {/* Media Types */}
          <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
            {(['all', 'video', 'image'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setFilterType(t)}
                className={`px-3 py-1 rounded-lg font-semibold capitalize transition ${
                  filterType === t
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {t === 'all' ? 'All Files' : `${t}s`}
              </button>
            ))}
          </div>

          {/* Folder Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto max-w-md py-1">
            <span className="text-[11px] text-slate-400 flex items-center gap-1 mr-1">
              <Folder size={12} /> Folder:
            </span>
            <button
              onClick={() => setSelectedFolder('All')}
              className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition ${
                selectedFolder === 'All'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              All
            </button>
            {folders.map((f) => (
              <button
                key={f}
                onClick={() => setSelectedFolder(f)}
                className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition ${
                  selectedFolder === f
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Media Grid */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2">
              <Loader2 className="animate-spin text-blue-600" size={24} />
              <p className="text-xs">Loading media assets...</p>
            </div>
          ) : filteredAssets.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2">
              <FolderOpen size={36} className="text-slate-300 dark:text-slate-700" />
              <p className="text-xs font-medium">No files found in this category.</p>
              <p className="text-[11px] text-slate-400">Ask the DeepSeek agent to generate a video or upload photos.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {filteredAssets.map((asset) => {
                const isVideo = asset.type === 'video';
                return (
                  <div
                    key={asset.id}
                    className="group relative bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition flex flex-col"
                  >
                    {/* Media Preview Thumbnail */}
                    <div className="relative aspect-video bg-black flex items-center justify-center overflow-hidden">
                      {isVideo ? (
                        <video
                          src={asset.url}
                          className="w-full h-full object-cover"
                          preload="metadata"
                        />
                      ) : (
                        <img
                          src={asset.url}
                          alt={asset.caption || 'Asset'}
                          className="w-full h-full object-cover"
                        />
                      )}

                      {/* Play overlay for video */}
                      {isVideo && (
                        <button
                          onClick={() => setPreviewMedia({ url: asset.url, type: 'video', title: asset.caption || 'Video' })}
                          className="absolute inset-0 m-auto w-9 h-9 rounded-full bg-black/60 text-white flex items-center justify-center backdrop-blur-xs group-hover:scale-110 transition"
                        >
                          <Play size={16} fill="white" className="ml-0.5" />
                        </button>
                      )}

                      {/* Badges */}
                      <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-black/70 text-white backdrop-blur-xs flex items-center gap-1">
                        {isVideo ? <Film size={10} /> : <ImageIcon size={10} />}
                        {asset.type}
                      </span>

                      {asset.metadata?.folder && (
                        <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[9px] font-medium bg-blue-600/80 text-white backdrop-blur-xs">
                          {asset.metadata.folder}
                        </span>
                      )}
                    </div>

                    {/* Meta info */}
                    <div className="p-2.5 flex-1 flex flex-col justify-between">
                      <div>
                        <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate" title={asset.caption || 'Untitled'}>
                          {asset.caption || asset.metadata?.title || 'Untitled Asset'}
                        </p>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {new Date(asset.created_at).toLocaleDateString()}
                          {asset.metadata?.duration && ` • ${asset.metadata.duration}s`}
                        </p>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center justify-between pt-2 mt-2 border-t border-slate-100 dark:border-slate-800/60">
                        <button
                          onClick={() => handleCopy(asset.id, asset.url)}
                          className="text-[11px] font-medium text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-1"
                          title="Copy Link"
                        >
                          {copiedId === asset.id ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                          <span>{copiedId === asset.id ? 'Copied' : 'Link'}</span>
                        </button>

                        <div className="flex items-center gap-1.5">
                          {onSelectAsset && (
                            <button
                              onClick={() => {
                                onSelectAsset(asset.url, asset.caption || 'Asset');
                                onClose();
                              }}
                              className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-600 text-white hover:bg-blue-700 transition"
                            >
                              Use
                            </button>
                          )}
                          <a
                            href={asset.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                            title="Open URL"
                          >
                            <ExternalLink size={12} />
                          </a>
                          <button
                            onClick={() => handleDelete(asset.id)}
                            className="p-1 text-slate-400 hover:text-rose-500 transition"
                            title="Delete Asset"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Media Fullscreen Preview Modal */}
        {previewMedia && (
          <div className="absolute inset-0 z-50 bg-black/80 flex flex-col items-center justify-center p-4">
            <button
              onClick={() => setPreviewMedia(null)}
              className="absolute top-4 right-4 p-2 text-white bg-white/10 rounded-full hover:bg-white/20"
            >
              <X size={20} />
            </button>
            <div className="max-w-2xl w-full">
              {previewMedia.type === 'video' ? (
                <video
                  controls
                  autoPlay
                  className="w-full max-h-[70vh] rounded-xl shadow-2xl bg-black"
                  src={previewMedia.url}
                />
              ) : (
                <img
                  src={previewMedia.url}
                  alt={previewMedia.title}
                  className="w-full max-h-[70vh] object-contain rounded-xl shadow-2xl"
                />
              )}
              <p className="text-center text-white text-xs mt-3 font-semibold">{previewMedia.title}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

