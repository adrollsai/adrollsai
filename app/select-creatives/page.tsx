'use client';

import React, { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

interface CreativeItem {
  id: string;
  url: string;
  title: string;
  type: 'image' | 'video';
  aspect_ratio: string;
  is_ai_generated: boolean;
  created_at: string;
}

interface CampaignInfo {
  id: string;
  name: string;
  daily_budget: number;
  target_locations: string;
  status: string;
}

function CreativePickerContent() {
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') || '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState('Workspace');
  const [campaign, setCampaign] = useState<CampaignInfo | null>(null);
  const [creatives, setCreatives] = useState<CreativeItem[]>([]);
  const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedCount, setSubmittedCount] = useState(0);

  // Filters
  const [activeTypeFilter, setActiveTypeFilter] = useState<'all' | 'image' | 'video' | 'ai'>('all');
  const [activeRatioFilter, setActiveRatioFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Uploading
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Lightbox Preview Modal
  const [previewMedia, setPreviewMedia] = useState<CreativeItem | null>(null);

  useEffect(() => {
    if (!token) {
      setError('No session token provided. Please open the link directly from your WhatsApp conversation.');
      setLoading(false);
      return;
    }

    async function fetchSession() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/api/creatives/picker-session?token=${encodeURIComponent(token)}`);
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Failed to load session');
        }

        setWorkspaceName(data.profile?.business_name || 'Nobogent Workspace');
        setCampaign(data.campaign || null);
        setCreatives(data.creatives || []);
        setSelectedUrls(data.selectedUrls || []);
      } catch (err: any) {
        setError(err.message || 'Unable to load creatives');
      } finally {
        setLoading(false);
      }
    }

    fetchSession();
  }, [token]);

  // Toggle selection
  const toggleSelect = (url: string) => {
    setSelectedUrls((prev) =>
      prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url]
    );
  };

  // Filtered creatives
  const filteredCreatives = useMemo(() => {
    return creatives.filter((item) => {
      // Type filter
      if (activeTypeFilter === 'image' && item.type !== 'image') return false;
      if (activeTypeFilter === 'video' && item.type !== 'video') return false;
      if (activeTypeFilter === 'ai' && !item.is_ai_generated) return false;

      // Aspect ratio filter
      if (activeRatioFilter !== 'all' && item.aspect_ratio !== activeRatioFilter) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = item.title.toLowerCase().includes(q);
        const matchesUrl = item.url.toLowerCase().includes(q);
        if (!matchesTitle && !matchesUrl) return false;
      }

      return true;
    });
  }, [creatives, activeTypeFilter, activeRatioFilter, searchQuery]);

  // Counts for filter tabs
  const counts = useMemo(() => {
    return {
      all: creatives.length,
      image: creatives.filter((c) => c.type === 'image').length,
      video: creatives.filter((c) => c.type === 'video').length,
      ai: creatives.filter((c) => c.is_ai_generated).length,
    };
  }, [creatives]);

  // Handle direct file upload from phone
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      const formData = new FormData();
      formData.append('token', token);
      formData.append('file', file);

      const res = await fetch('/api/creatives/upload-direct', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok || !data.asset) {
        throw new Error(data.error || 'Upload failed');
      }

      // Prepend newly uploaded creative and auto-select it
      setCreatives((prev) => [data.asset, ...prev]);
      setSelectedUrls((prev) => [data.asset.url, ...prev]);
    } catch (err: any) {
      alert(`Upload error: ${err.message}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Submit selection
  const handleSubmit = async () => {
    if (selectedUrls.length === 0) {
      alert('Please select at least one creative to attach.');
      return;
    }

    try {
      setSubmitting(true);
      const res = await fetch('/api/creatives/picker-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          selectedUrls,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to attach creatives');
      }

      setSubmittedCount(selectedUrls.length);
      setSubmitted(true);
    } catch (err: any) {
      alert(`Error saving creatives: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Close webview or open WhatsApp
  const handleReturnToWhatsApp = () => {
    try {
      window.close();
    } catch (e) {}
    window.location.href = 'whatsapp://';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
        <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-slate-400 text-sm font-medium">Loading your creative assets...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center justify-center mb-4 text-2xl">
          ⚠️
        </div>
        <h2 className="text-xl font-bold text-slate-100 mb-2">Session Error</h2>
        <p className="text-slate-400 text-sm max-w-sm mb-6">{error}</p>
        <button
          onClick={handleReturnToWhatsApp}
          className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl shadow-lg shadow-indigo-500/20 transition-all"
        >
          Return to WhatsApp
        </button>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 text-center animate-in fade-in zoom-in duration-300">
        <div className="w-20 h-20 bg-emerald-500/10 border border-emerald-500/30 rounded-full flex items-center justify-center mb-5 text-4xl shadow-xl shadow-emerald-500/10">
          ✅
        </div>
        <h2 className="text-2xl font-bold text-slate-100 mb-2">Creatives Attached!</h2>
        <p className="text-slate-300 text-sm max-w-sm mb-2">
          Successfully linked <span className="font-bold text-emerald-400">{submittedCount} creative(s)</span> to your Meta campaign draft.
        </p>
        <p className="text-slate-400 text-xs max-w-xs mb-8">
          We have sent a live confirmation to your WhatsApp. You can return to the chat now to review or launch.
        </p>
        <button
          onClick={handleReturnToWhatsApp}
          className="w-full max-w-xs py-3.5 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white font-semibold rounded-2xl shadow-lg shadow-emerald-500/25 transition-all text-sm flex items-center justify-center gap-2"
        >
          <span>Open WhatsApp Chat</span>
          <span>→</span>
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-28 select-none">
      {/* Top Sticky Header */}
      <header className="sticky top-0 z-30 bg-slate-950/80 backdrop-blur-md border-b border-slate-800/80 px-4 py-3">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm shadow-md shadow-indigo-500/20 shrink-0">
              N
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-slate-100 truncate">{workspaceName}</h1>
              <p className="text-xs text-slate-400 truncate">
                {campaign ? `Campaign: ${campaign.name}` : 'Creative Library'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-full text-xs font-semibold">
              {selectedUrls.length} selected
            </span>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative mb-2.5">
          <input
            type="text"
            placeholder="Search by title, prompt, or file..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-900/90 border border-slate-800 rounded-xl px-3.5 py-2 pl-9 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/60 transition-all"
          />
          <span className="absolute left-3 top-2.5 text-slate-500 text-xs">🔍</span>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-2 text-slate-400 hover:text-slate-200 text-xs"
            >
              ✕
            </button>
          )}
        </div>

        {/* Primary Type Filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          <button
            onClick={() => setActiveTypeFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
              activeTypeFilter === 'all'
                ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            All ({counts.all})
          </button>
          <button
            onClick={() => setActiveTypeFilter('image')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
              activeTypeFilter === 'image'
                ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            🖼️ Images ({counts.image})
          </button>
          <button
            onClick={() => setActiveTypeFilter('video')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
              activeTypeFilter === 'video'
                ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            🎥 Videos ({counts.video})
          </button>
          <button
            onClick={() => setActiveTypeFilter('ai')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
              activeTypeFilter === 'ai'
                ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            ✨ AI ({counts.ai})
          </button>
        </div>

        {/* Aspect Ratio Filter Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar mt-2 pt-1 border-t border-slate-800/40">
          <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mr-1">Ratio:</span>
          {['all', '1:1', '9:16', '16:9', '4:5'].map((ratio) => (
            <button
              key={ratio}
              onClick={() => setActiveRatioFilter(ratio)}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
                activeRatioFilter === ratio
                  ? 'bg-slate-700 text-indigo-300 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {ratio === 'all' ? 'Any' : ratio}
            </button>
          ))}
        </div>
      </header>

      {/* Grid Content */}
      <main className="p-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {/* Upload New Creative Card */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="aspect-square rounded-2xl border-2 border-dashed border-slate-800 hover:border-indigo-500/50 bg-slate-900/40 hover:bg-slate-900/80 flex flex-col items-center justify-center p-3 cursor-pointer transition-all text-center group"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              onChange={handleFileUpload}
              className="hidden"
            />
            <div className="w-10 h-10 rounded-full bg-slate-800 group-hover:bg-indigo-600/20 flex items-center justify-center text-lg text-indigo-400 mb-2 transition-colors">
              {uploading ? (
                <div className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                '+'
              )}
            </div>
            <span className="text-xs font-semibold text-slate-300 group-hover:text-indigo-400">
              {uploading ? 'Uploading...' : 'Upload New'}
            </span>
            <span className="text-[10px] text-slate-500 mt-0.5">Photo or Video</span>
          </div>

          {/* Creatives List */}
          {filteredCreatives.map((creative) => {
            const isSelected = selectedUrls.includes(creative.url);
            const isVideo = creative.type === 'video';

            return (
              <div
                key={creative.id}
                onClick={() => toggleSelect(creative.url)}
                className={`relative group aspect-square rounded-2xl overflow-hidden bg-slate-900 cursor-pointer transition-all border-2 ${
                  isSelected
                    ? 'border-indigo-500 ring-2 ring-indigo-500/30 scale-[0.98] shadow-lg shadow-indigo-500/20'
                    : 'border-slate-800 hover:border-slate-700'
                }`}
              >
                {/* Media Image / Video Thumbnail */}
                {isVideo ? (
                  <div className="relative w-full h-full bg-slate-950 flex items-center justify-center">
                    <video
                      src={creative.url}
                      className="w-full h-full object-cover pointer-events-none opacity-80"
                      preload="metadata"
                    />
                    <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                      <div className="w-8 h-8 rounded-full bg-slate-900/80 border border-white/20 flex items-center justify-center text-xs text-white">
                        ▶
                      </div>
                    </div>
                  </div>
                ) : (
                  <img
                    src={creative.url}
                    alt={creative.title}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    loading="lazy"
                  />
                )}

                {/* Gradient Overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-black/20 pointer-events-none" />

                {/* Selection Checkmark Badge */}
                <div
                  className={`absolute top-2.5 left-2.5 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all shadow-md ${
                    isSelected
                      ? 'bg-emerald-500 text-white scale-110 shadow-emerald-500/30'
                      : 'bg-black/50 border border-white/40 text-transparent'
                  }`}
                >
                  ✓
                </div>

                {/* Preview / Eye Icon */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPreviewMedia(creative);
                  }}
                  className="absolute top-2.5 right-2.5 w-6 h-6 rounded-full bg-black/60 hover:bg-black/80 text-white/80 hover:text-white flex items-center justify-center text-[10px] backdrop-blur-sm transition-all"
                  title="Preview full size"
                >
                  🔍
                </button>

                {/* Badges & Title at Bottom */}
                <div className="absolute bottom-2 left-2 right-2 flex flex-col gap-0.5 pointer-events-none">
                  <div className="flex items-center gap-1">
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-black/60 backdrop-blur-sm text-slate-300 border border-white/10">
                      {creative.aspect_ratio}
                    </span>
                    {creative.is_ai_generated && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-purple-500/30 backdrop-blur-sm text-purple-300 border border-purple-500/30">
                        AI
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] font-medium text-white truncate drop-shadow-sm">
                    {creative.title}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Empty Filter State */}
        {filteredCreatives.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <span className="text-3xl mb-2">🔍</span>
            <p className="text-slate-300 text-sm font-semibold">No creatives match your filter</p>
            <p className="text-slate-500 text-xs mt-1">Try changing your search terms or filter selection.</p>
            <button
              onClick={() => {
                setActiveTypeFilter('all');
                setActiveRatioFilter('all');
                setSearchQuery('');
              }}
              className="mt-4 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors"
            >
              Reset Filters
            </button>
          </div>
        )}
      </main>

      {/* Floating Bottom Action Bar */}
      <footer className="fixed bottom-0 left-0 right-0 z-30 bg-slate-950/90 backdrop-blur-lg border-t border-slate-800/80 p-4">
        <div className="max-w-md mx-auto flex items-center gap-3">
          <button
            onClick={handleSubmit}
            disabled={selectedUrls.length === 0 || submitting}
            className={`flex-1 py-3.5 px-4 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 shadow-lg transition-all ${
              selectedUrls.length > 0 && !submitting
                ? 'bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 hover:from-indigo-500 hover:to-indigo-500 text-white shadow-indigo-500/25 active:scale-[0.98]'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
          >
            {submitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Attaching to Campaign...</span>
              </>
            ) : (
              <>
                <span>Attach to Campaign</span>
                <span className="bg-white/20 px-2 py-0.5 rounded-full text-xs font-bold">
                  {selectedUrls.length}
                </span>
              </>
            )}
          </button>
        </div>
      </footer>

      {/* Full Size Preview Lightbox Modal */}
      {previewMedia && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setPreviewMedia(null)}
        >
          <div className="relative max-w-lg w-full max-h-[85vh] flex flex-col items-center">
            <button
              onClick={() => setPreviewMedia(null)}
              className="absolute -top-10 right-0 text-white/80 hover:text-white text-xl font-bold p-2"
            >
              ✕ Close
            </button>

            {previewMedia.type === 'video' ? (
              <video
                src={previewMedia.url}
                controls
                autoPlay
                className="w-full max-h-[75vh] object-contain rounded-2xl shadow-2xl bg-black"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <img
                src={previewMedia.url}
                alt={previewMedia.title}
                className="w-full max-h-[75vh] object-contain rounded-2xl shadow-2xl bg-black"
                onClick={(e) => e.stopPropagation()}
              />
            )}

            <div className="w-full mt-3 flex items-center justify-between gap-3 text-white">
              <div className="min-w-0">
                <h4 className="text-sm font-semibold truncate">{previewMedia.title}</h4>
                <p className="text-xs text-slate-400">
                  {previewMedia.type.toUpperCase()} • {previewMedia.aspect_ratio}
                </p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSelect(previewMedia.url);
                  setPreviewMedia(null);
                }}
                className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all shrink-0 ${
                  selectedUrls.includes(previewMedia.url)
                    ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                    : 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30'
                }`}
              >
                {selectedUrls.includes(previewMedia.url) ? 'Remove Selection' : 'Select This Creative'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SelectCreativesPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
          <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <CreativePickerContent />
    </Suspense>
  );
}
