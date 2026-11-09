'use client';

import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
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
  FolderPlus,
  Loader2,
  Play,
  Upload,
  MoveRight,
  Edit2,
} from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import { uploadToR2 } from '@/utils/upload-helper';
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
  const fileUploadInputRef = useRef<HTMLInputElement>(null);

  const [assets, setAssets] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'video' | 'image' | 'document'>('all');
  const [selectedFolder, setSelectedFolder] = useState<string>('All');
  const [customFolders, setCustomFolders] = useState<string[]>(['Videos', 'Campaign Reels', 'B-Roll', 'WhatsApp Assets', 'Offerings']);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [previewMedia, setPreviewMedia] = useState<{ url: string; type: string; title: string } | null>(null);

  // New folder dialog
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // Moving asset
  const [movingAssetId, setMovingAssetId] = useState<string | null>(null);
  const [targetFolder, setTargetFolder] = useState<string>('Videos');

  const fetchAssets = async () => {
    setLoading(true);
    try {
      let q = supabase
        .from('assets')
        .select('id, type, url, caption, status, created_at, metadata')
        .order('created_at', { ascending: false })
        .limit(100);

      if (userId) {
        q = q.eq('user_id', userId);
      }

      const { data, error } = await q;
      if (error) throw error;
      setAssets(data || []);

      // Gather folders from metadata
      const extractedFolders = Array.from(
        new Set(
          (data || [])
            .map((a: any) => a.metadata?.folder)
            .filter((f: any) => Boolean(f) && typeof f === 'string')
        )
      ) as string[];

      setCustomFolders((prev) => Array.from(new Set([...prev, ...extractedFolders])));
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
      toast.success('Asset deleted');
    } catch (err: any) {
      toast.error('Could not delete asset');
    }
  };

  const handleCreateFolder = () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    if (!customFolders.includes(trimmed)) {
      setCustomFolders((prev) => [...prev, trimmed]);
    }
    setSelectedFolder(trimmed);
    setNewFolderName('');
    setShowNewFolderModal(false);
    toast.success(`Folder "${trimmed}" created`);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    toast.info(`Uploading ${files.length} file(s)...`);

    try {
      const currentFolder = selectedFolder === 'All' ? 'Uploads' : selectedFolder;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const isVideo = file.type.startsWith('video/') || file.name.endsWith('.mp4');
        const isImage = file.type.startsWith('image/');
        const mediaType = isVideo ? 'video' : isImage ? 'image' : 'document';

        // Upload to storage via existing R2 / S3 helper
        const publicUrl = await uploadToR2(file, currentFolder.toLowerCase());

        // Save asset row in Supabase
        const { data: newAsset, error } = await supabase
          .from('assets')
          .insert({
            user_id: userId || (await supabase.auth.getUser()).data.user?.id,
            title: file.name,
            caption: file.name,
            url: publicUrl,
            type: mediaType,
            status: 'ready',
            metadata: {
              folder: currentFolder,
              sizeBytes: file.size,
              uploadedAt: new Date().toISOString(),
            },
          })
          .select()
          .single();

        if (error) throw error;
        if (newAsset) {
          setAssets((prev) => [newAsset, ...prev]);
        }
      }

      toast.success('Files uploaded and indexed in File Manager');
    } catch (err: any) {
      console.error('[File Manager Upload Error]:', err);
      toast.error(err.message || 'File upload failed');
    } finally {
      setUploading(false);
      if (fileUploadInputRef.current) {
        fileUploadInputRef.current.value = '';
      }
    }
  };

  const handleMoveFolder = async (assetId: string, destFolder: string) => {
    try {
      const targetAsset = assets.find((a) => a.id === assetId);
      const updatedMeta = { ...(targetAsset?.metadata || {}), folder: destFolder };

      const { error } = await supabase
        .from('assets')
        .update({ metadata: updatedMeta })
        .eq('id', assetId);

      if (error) throw error;

      setAssets((prev) =>
        prev.map((a) => (a.id === assetId ? { ...a, metadata: updatedMeta } : a))
      );

      setMovingAssetId(null);
      toast.success(`Moved to "${destFolder}"`);
    } catch (err: any) {
      toast.error('Failed to move asset');
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-6 pb-20 sm:pb-24 animate-in fade-in-50">
      <div className="relative w-full max-w-4xl h-[82vh] max-h-[calc(100vh-120px)] dsh-surface-1 border dsh-border rounded-3xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b dsh-border dsh-surface-1">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl dsh-surface-3 dsh-warn flex items-center justify-center font-bold">
              <FolderOpen size={20} />
            </div>
            <div>
              <h3 className="dsh-t-s dsh-strong dsh-label-primary flex items-center gap-2">
                File & Asset Manager
                <span className="dsh-t-xxxs dsh-mono px-2 py-0.5 rounded-full dsh-surface-3 dsh-label-secondary">
                  {assets.length} items
                </span>
              </h3>
              <p className="dsh-t-xs dsh-label-tertiary">
                Create folders, upload videos and assets, or let Nobo organize them automatically.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Create Folder Button */}
            <button
              onClick={() => setShowNewFolderModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl dsh-surface-3 dsh-interactive dsh-label-secondary dsh-t-xs dsh-strong transition"
            >
              <FolderPlus size={14} className="dsh-accent" />
              <span>New Folder</span>
            </button>

            {/* Upload File Button */}
            <input
              type="file"
              ref={fileUploadInputRef}
              onChange={handleFileUpload}
              multiple
              accept="video/*,image/*,.pdf,.doc,.docx"
              className="hidden"
            />
            <button
              onClick={() => fileUploadInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl dsh-btn-primary dsh-t-xs dsh-strong transition disabled:opacity-50"
            >
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              <span>{uploading ? 'Uploading...' : 'Upload Asset'}</span>
            </button>

            <button
              onClick={fetchAssets}
              disabled={loading}
              className="p-1.5 rounded-xl dsh-label-tertiary dsh-interactive transition"
              title="Refresh"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-xl dsh-label-tertiary dsh-interactive transition"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Filter and Folder Navigation */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-2.5 border-b dsh-border dsh-surface-1 dsh-t-xs">
          {/* Media Types */}
          <div className="flex items-center gap-1 dsh-surface-3 p-1 rounded-xl">
            {(['all', 'video', 'image'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setFilterType(t)}
                className={`px-3 py-1 rounded-lg font-semibold capitalize transition ${
                  filterType === t
                    ? 'dsh-surface-1 dsh-label-primary'
                    : 'dsh-label-tertiary dsh-interactive'
                }`}
              >
                {t === 'all' ? 'All Files' : `${t}s`}
              </button>
            ))}
          </div>

          {/* Folder Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto max-w-lg py-1">
            <span className="dsh-t-xs dsh-label-tertiary flex items-center gap-1 mr-1 shrink-0">
              <Folder size={12} /> Folder:
            </span>
            <button
              onClick={() => setSelectedFolder('All')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition shrink-0 ${
                selectedFolder === 'All'
                  ? 'dsh-btn-primary'
                  : 'dsh-surface-3 dsh-label-secondary dsh-interactive'
              }`}
            >
              All
            </button>
            {customFolders.map((f) => (
              <button
                key={f}
                onClick={() => setSelectedFolder(f)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition shrink-0 ${
                  selectedFolder === f
                    ? 'dsh-btn-primary'
                    : 'dsh-surface-3 dsh-label-secondary dsh-interactive'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Media Grid */}
        <div className="flex-1 overflow-y-auto p-6 pb-16">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center dsh-label-tertiary gap-2">
              <Loader2 className="animate-spin dsh-accent" size={26} />
              <p className="text-xs">Loading media assets...</p>
            </div>
          ) : filteredAssets.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center dsh-label-tertiary gap-2">
              <FolderOpen size={40} className="dsh-label-caption" />
              <p className="text-xs font-semibold">No assets found in "{selectedFolder}".</p>
              <p className="dsh-t-xs dsh-label-tertiary">Upload assets using the button above or tell Nobo to generate one.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {filteredAssets.map((asset) => {
                const isVideo = asset.type === 'video';
                return (
                  <div
                    key={asset.id}
                    className="group relative dsh-surface-1 border dsh-border rounded-2xl overflow-hidden hover:shadow-md transition flex flex-col"
                  >
                    {/* Media Thumbnail */}
                    <div className="relative aspect-video bg-black flex items-center justify-center overflow-hidden">
                      {isVideo ? (
                        <video src={asset.url} className="w-full h-full object-cover" preload="metadata" />
                      ) : (
                        <img src={asset.url} alt={asset.caption || 'Asset'} className="w-full h-full object-cover" />
                      )}

                      {/* Play overlay for video */}
                      {isVideo && (
                        <button
                          onClick={() => setPreviewMedia({ url: asset.url, type: 'video', title: asset.caption || 'Video' })}
                          className="absolute inset-0 m-auto w-10 h-10 rounded-full bg-black/60 text-white flex items-center justify-center backdrop-blur-xs group-hover:scale-110 transition"
                        >
                          <Play size={16} fill="white" className="ml-0.5" />
                        </button>
                      )}

                      {/* Type Badge */}
                      <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-black/75 text-white backdrop-blur-xs flex items-center gap-1">
                        {isVideo ? <Film size={10} /> : <ImageIcon size={10} />}
                        {asset.type}
                      </span>

                      {/* Folder Badge */}
                      {asset.metadata?.folder && (
                        <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded dsh-t-xxxs dsh-strong dsh-btn-primary backdrop-blur-xs">
                          {asset.metadata.folder}
                        </span>
                      )}
                    </div>

                    {/* Meta info */}
                    <div className="p-3 flex-1 flex flex-col justify-between">
                      <div>
                        <p className="dsh-t-xs dsh-strong dsh-label-primary truncate" title={asset.caption || 'Untitled'}>
                          {asset.caption || asset.title || 'Untitled Asset'}
                        </p>
                        <p className="dsh-t-xxxs dsh-label-tertiary mt-0.5">
                          {new Date(asset.created_at).toLocaleDateString()}
                          {asset.metadata?.duration && ` • ${asset.metadata.duration}s`}
                        </p>
                      </div>

                      {/* Action Bar */}
                      <div className="flex items-center justify-between pt-2.5 mt-2.5 border-t dsh-border">
                        <button
                          onClick={() => handleCopy(asset.id, asset.url)}
                          className="dsh-t-xs dsh-strong dsh-label-tertiary dsh-interactive flex items-center gap-1"
                          title="Copy Public Link"
                        >
                          {copiedId === asset.id ? <Check size={12} className="dsh-success" /> : <Copy size={12} />}
                          <span>{copiedId === asset.id ? 'Copied' : 'Link'}</span>
                        </button>

                        <div className="flex items-center gap-1.5">
                          {onSelectAsset && (
                            <button
                              onClick={() => {
                                onSelectAsset(asset.url, asset.caption || 'Asset');
                                onClose();
                              }}
                              className="px-2 py-0.5 rounded dsh-t-xxxs dsh-strong dsh-btn-primary transition"
                            >
                              Use
                            </button>
                          )}

                          {/* Move to Folder Button */}
                          <button
                            onClick={() => setMovingAssetId(movingAssetId === asset.id ? null : asset.id)}
                            className="p-1 dsh-label-tertiary dsh-interactive transition"
                            title="Move to Folder"
                          >
                            <MoveRight size={12} />
                          </button>

                          <a
                            href={asset.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1 dsh-label-tertiary dsh-interactive"
                            title="Open URL"
                          >
                            <ExternalLink size={12} />
                          </a>

                          <button
                            onClick={() => handleDelete(asset.id)}
                            className="p-1 dsh-label-tertiary dsh-interactive-danger transition"
                            title="Delete Asset"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>

                      {/* Inline Move Picker */}
                      {movingAssetId === asset.id && (
                        <div className="mt-2 p-2 rounded-xl dsh-surface-3 space-y-1.5 animate-in fade-in-50">
                          <span className="dsh-t-xxxs dsh-strong dsh-label-tertiary block">Move to:</span>
                          <div className="flex items-center gap-1">
                            <select
                              value={targetFolder}
                              onChange={(e) => setTargetFolder(e.target.value)}
                              className="flex-1 dsh-t-xxxs dsh-surface-1 border dsh-border-l2 rounded p-1 dsh-label-primary"
                            >
                              {customFolders.map((f) => (
                                <option key={f} value={f}>
                                  {f}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => handleMoveFolder(asset.id, targetFolder)}
                              className="px-2 py-1 rounded dsh-btn-primary dsh-t-xxxs dsh-strong"
                            >
                              Move
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Create Folder Modal */}
        {showNewFolderModal && (
          <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <div className="w-full max-w-sm dsh-card rounded-2xl p-5 space-y-4">
              <h4 className="dsh-t-s dsh-strong dsh-label-primary flex items-center gap-2">
                <FolderPlus size={16} className="dsh-accent" />
                Create New Folder
              </h4>
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Folder name (e.g. Luxury Reels, Raw Video)..."
                className="w-full px-3 py-2 rounded-xl border dsh-border dsh-surface-1 dsh-t-xs dsh-label-primary outline-none"
                autoFocus
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setShowNewFolderModal(false)}
                  className="px-3 py-1.5 rounded-xl dsh-t-xs dsh-strong dsh-label-tertiary dsh-interactive"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateFolder}
                  className="px-3 py-1.5 rounded-xl dsh-btn-primary dsh-t-xs dsh-strong"
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Media Fullscreen Preview Modal */}
        {previewMedia && (
          <div className="absolute inset-0 z-50 bg-black/85 flex flex-col items-center justify-center p-4">
            <button
              onClick={() => setPreviewMedia(null)}
              className="absolute top-4 right-4 p-2 dsh-label-primary dsh-surface-2 dsh-border rounded-full dsh-interactive"
            >
              <X size={20} />
            </button>
            <div className="max-w-2xl w-full">
              {previewMedia.type === 'video' ? (
                <video controls autoPlay className="w-full max-h-[70vh] rounded-2xl bg-black" src={previewMedia.url} />
              ) : (
                <img src={previewMedia.url} alt={previewMedia.title} className="w-full max-h-[70vh] object-contain rounded-2xl" />
              )}
              <p className="text-center dsh-label-primary dsh-t-xs mt-3 dsh-strong">{previewMedia.title}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
