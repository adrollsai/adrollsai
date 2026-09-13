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

interface LocationItem {
  key: string;
  name: string;
  type: 'city' | 'region' | 'country' | 'zip';
  region?: string;
  country_code?: string;
  radius: number;
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
  const initialTab = searchParams?.get('tab') === 'locations' ? 'locations' : 'creatives';

  // Navigation tab
  const [activeTab, setActiveTab] = useState<'creatives' | 'locations'>(initialTab);

  // Common states
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState('Workspace');
  const [campaign, setCampaign] = useState<CampaignInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedMessage, setSubmittedMessage] = useState('');

  // --- Creatives Tab States ---
  const [creatives, setCreatives] = useState<CreativeItem[]>([]);
  const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
  const [activeTypeFilter, setActiveTypeFilter] = useState<'all' | 'image' | 'video' | 'ai'>('all');
  const [activeRatioFilter, setActiveRatioFilter] = useState<string>('all');
  const [creativeSearchQuery, setCreativeSearchQuery] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewMedia, setPreviewMedia] = useState<CreativeItem | null>(null);

  // --- Locations Tab States ---
  const [selectedLocations, setSelectedLocations] = useState<LocationItem[]>([]);
  const [locationSearchText, setLocationSearchText] = useState('');
  const [locationResults, setLocationResults] = useState<any[]>([]);
  const [isSearchingLocations, setIsSearchingLocations] = useState(false);

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

        if (Array.isArray(data.savedLocations) && data.savedLocations.length > 0) {
          setSelectedLocations(
            data.savedLocations.map((loc: any) => ({
              key: loc.key || `key_${Math.random().toString(36).substring(2, 8)}`,
              name: loc.name || 'Location',
              type: loc.type || 'city',
              region: loc.region || '',
              country_code: loc.country_code || 'IN',
              radius: loc.radius || 25,
            }))
          );
        }
      } catch (err: any) {
        setError(err.message || 'Unable to load session');
      } finally {
        setLoading(false);
      }
    }

    fetchSession();
  }, [token]);

  // Debounced search for locations against live Meta server
  useEffect(() => {
    if (!token) return;
    const query = locationSearchText.trim();
    if (query.length < 2) {
      setLocationResults([]);
      setIsSearchingLocations(false);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setIsSearchingLocations(true);
        const res = await fetch(
          `/api/creatives/picker-session/locations?token=${encodeURIComponent(token)}&q=${encodeURIComponent(query)}`
        );
        const json = await res.json();
        if (json.data) {
          setLocationResults(json.data);
        } else {
          setLocationResults([]);
        }
      } catch (e) {
        console.warn('Location search error:', e);
      } finally {
        setIsSearchingLocations(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [locationSearchText, token]);

  // Toggle creative selection
  const toggleSelect = (url: string) => {
    setSelectedUrls((prev) =>
      prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url]
    );
  };

  // Add location to selected list
  const addLocation = (item: any) => {
    if (selectedLocations.some((l) => l.key === item.key)) return;
    setSelectedLocations((prev) => [
      ...prev,
      {
        key: item.key,
        name: item.name,
        type: item.type || 'city',
        region: item.region || '',
        country_code: item.country_code || 'IN',
        radius: item.default_radius || (item.type === 'city' ? 25 : 0),
      },
    ]);
    setLocationSearchText('');
    setLocationResults([]);
  };

  // Remove location
  const removeLocation = (key: string) => {
    setSelectedLocations((prev) => prev.filter((l) => l.key !== key));
  };

  // Update radius for a city
  const updateRadius = (key: string, newRadius: number) => {
    setSelectedLocations((prev) =>
      prev.map((l) => (l.key === key ? { ...l, radius: Math.max(17, Math.min(80, newRadius)) } : l))
    );
  };

  // Quick Presets
  const applyPreset = (presetName: string) => {
    if (presetName === 'tricity') {
      const tricity = [
        { key: '1021145', name: 'Chandigarh', type: 'city' as const, region: 'Chandigarh', country_code: 'IN', radius: 25 },
        { key: '1035473', name: 'Mohali', type: 'city' as const, region: 'Punjab', country_code: 'IN', radius: 25 },
        { key: '2676092', name: 'Panchkula', type: 'city' as const, region: 'Haryana', country_code: 'IN', radius: 25 },
      ];
      setSelectedLocations((prev) => {
        const existingKeys = new Set(prev.map((p) => p.key));
        const toAdd = tricity.filter((t) => !existingKeys.has(t.key));
        return [...prev, ...toAdd];
      });
    } else if (presetName === 'delhi_ncr') {
      const ncr = [
        { key: '1024580', name: 'Delhi', type: 'city' as const, region: 'Delhi', country_code: 'IN', radius: 25 },
        { key: '1026297', name: 'Gurugram', type: 'city' as const, region: 'Haryana', country_code: 'IN', radius: 25 },
        { key: '2678292', name: 'Noida', type: 'city' as const, region: 'Uttar Pradesh', country_code: 'IN', radius: 25 },
        { key: '2678255', name: 'Greater Noida', type: 'city' as const, region: 'Uttar Pradesh', country_code: 'IN', radius: 25 },
        { key: '1025516', name: 'Faridabad', type: 'city' as const, region: 'Haryana', country_code: 'IN', radius: 25 },
        { key: '1026027', name: 'Ghaziabad', type: 'city' as const, region: 'Uttar Pradesh', country_code: 'IN', radius: 25 },
      ];
      setSelectedLocations((prev) => {
        const existingKeys = new Set(prev.map((p) => p.key));
        const toAdd = ncr.filter((t) => !existingKeys.has(t.key));
        return [...prev, ...toAdd];
      });
    } else if (presetName === 'mumbai') {
      const mmr = [
        { key: '1035921', name: 'Mumbai', type: 'city' as const, region: 'Maharashtra', country_code: 'IN', radius: 25 },
        { key: '1039860', name: 'Thane', type: 'city' as const, region: 'Maharashtra', country_code: 'IN', radius: 25 },
        { key: '2678280', name: 'Navi Mumbai', type: 'city' as const, region: 'Maharashtra', country_code: 'IN', radius: 25 },
      ];
      setSelectedLocations((prev) => {
        const existingKeys = new Set(prev.map((p) => p.key));
        const toAdd = mmr.filter((t) => !existingKeys.has(t.key));
        return [...prev, ...toAdd];
      });
    } else if (presetName === 'bangalore') {
      const blr = [
        { key: '1017930', name: 'Bangalore', type: 'city' as const, region: 'Karnataka', country_code: 'IN', radius: 25 },
      ];
      setSelectedLocations((prev) => {
        const existingKeys = new Set(prev.map((p) => p.key));
        const toAdd = blr.filter((t) => !existingKeys.has(t.key));
        return [...prev, ...toAdd];
      });
    }
  };

  // Filtered creatives
  const filteredCreatives = useMemo(() => {
    return creatives.filter((item) => {
      if (activeTypeFilter === 'image' && item.type !== 'image') return false;
      if (activeTypeFilter === 'video' && item.type !== 'video') return false;
      if (activeTypeFilter === 'ai' && !item.is_ai_generated) return false;

      if (activeRatioFilter !== 'all' && item.aspect_ratio !== activeRatioFilter) return false;

      if (creativeSearchQuery.trim()) {
        const q = creativeSearchQuery.toLowerCase();
        const matchesTitle = item.title.toLowerCase().includes(q);
        const matchesUrl = item.url.toLowerCase().includes(q);
        if (!matchesTitle && !matchesUrl) return false;
      }

      return true;
    });
  }, [creatives, activeTypeFilter, activeRatioFilter, creativeSearchQuery]);

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

      setCreatives((prev) => [data.asset, ...prev]);
      setSelectedUrls((prev) => [data.asset.url, ...prev]);
    } catch (err: any) {
      alert(`Upload error: ${err.message}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Submit Creatives
  const handleSubmitCreatives = async () => {
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

      setSubmittedMessage(`Linked ${selectedUrls.length} creative(s) to your Meta campaign draft.`);
      setSubmitted(true);
    } catch (err: any) {
      alert(`Error saving creatives: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Submit Locations
  const handleSubmitLocations = async () => {
    if (selectedLocations.length === 0) {
      alert('Please select at least one target location.');
      return;
    }

    try {
      setSubmitting(true);
      const res = await fetch('/api/creatives/picker-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          selectedLocations,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save locations');
      }

      const locSummary = selectedLocations
        .map((l) => `${l.name}${l.type === 'city' && l.radius ? ` (${l.radius} km)` : ''}`)
        .join(', ');
      setSubmittedMessage(`Target locations set to: ${locSummary}`);
      setSubmitted(true);
    } catch (err: any) {
      alert(`Error saving locations: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

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
        <p className="text-slate-400 text-sm font-medium">Loading session...</p>
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
        <h2 className="text-2xl font-bold text-slate-100 mb-2">Saved to Campaign!</h2>
        <p className="text-slate-300 text-sm max-w-sm mb-2 font-medium">
          {submittedMessage}
        </p>
        <p className="text-slate-400 text-xs max-w-xs mb-8">
          A live confirmation was dispatched to your WhatsApp. You can return to the chat now to review or launch.
        </p>
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button
            onClick={handleReturnToWhatsApp}
            className="w-full py-3.5 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white font-semibold rounded-2xl shadow-lg shadow-emerald-500/25 transition-all text-sm flex items-center justify-center gap-2"
          >
            <span>Open WhatsApp Chat</span>
            <span>→</span>
          </button>
          <button
            onClick={() => setSubmitted(false)}
            className="w-full py-2.5 bg-slate-900 border border-slate-800 text-slate-300 font-medium rounded-xl text-xs hover:bg-slate-800 transition-all"
          >
            Continue Editing Draft
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-28 select-none">
      {/* Top Sticky Header */}
      <header className="sticky top-0 z-30 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/80 px-4 py-3">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm shadow-md shadow-indigo-500/20 shrink-0">
              N
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-slate-100 truncate">{workspaceName}</h1>
              <p className="text-xs text-slate-400 truncate">
                {campaign ? `Campaign: ${campaign.name}` : 'Campaign Setup'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-full text-xs font-semibold">
              {activeTab === 'creatives' ? `${selectedUrls.length} creatives` : `${selectedLocations.length} locations`}
            </span>
          </div>
        </div>

        {/* Tab Switcher Pills */}
        <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-900/90 border border-slate-800 rounded-xl mb-2">
          <button
            onClick={() => setActiveTab('creatives')}
            className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'creatives'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>🖼️ Creatives</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
              activeTab === 'creatives' ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-400'
            }`}>
              {selectedUrls.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('locations')}
            className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'locations'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>📍 Target Locations</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
              activeTab === 'locations' ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-400'
            }`}>
              {selectedLocations.length}
            </span>
          </button>
        </div>

        {/* Creatives Sub-header / Filters */}
        {activeTab === 'creatives' && (
          <div>
            <div className="relative mb-2">
              <input
                type="text"
                placeholder="Search by title or prompt..."
                value={creativeSearchQuery}
                onChange={(e) => setCreativeSearchQuery(e.target.value)}
                className="w-full bg-slate-900/90 border border-slate-800 rounded-xl px-3.5 py-2 pl-9 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/60 transition-all"
              />
              <span className="absolute left-3 top-2.5 text-slate-500 text-xs">🔍</span>
              {creativeSearchQuery && (
                <button
                  onClick={() => setCreativeSearchQuery('')}
                  className="absolute right-3 top-2 text-slate-400 hover:text-slate-200 text-xs"
                >
                  ✕
                </button>
              )}
            </div>

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
                Images ({counts.image})
              </button>
              <button
                onClick={() => setActiveTypeFilter('video')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                  activeTypeFilter === 'video'
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                }`}
              >
                Videos ({counts.video})
              </button>
              <button
                onClick={() => setActiveTypeFilter('ai')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                  activeTypeFilter === 'ai'
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                }`}
              >
                ✨ AI Generated ({counts.ai})
              </button>
            </div>
          </div>
        )}

        {/* Locations Sub-header / Presets */}
        {activeTab === 'locations' && (
          <div>
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
              <span className="text-[10px] text-slate-500 uppercase font-semibold shrink-0">Quick Presets:</span>
              <button
                onClick={() => applyPreset('tricity')}
                className="px-2.5 py-1 rounded-lg text-xs bg-slate-900 hover:bg-slate-800 text-indigo-300 border border-indigo-500/20 whitespace-nowrap transition-all"
              >
                + Chandigarh Tricity
              </button>
              <button
                onClick={() => applyPreset('delhi_ncr')}
                className="px-2.5 py-1 rounded-lg text-xs bg-slate-900 hover:bg-slate-800 text-indigo-300 border border-indigo-500/20 whitespace-nowrap transition-all"
              >
                + Delhi NCR
              </button>
              <button
                onClick={() => applyPreset('mumbai')}
                className="px-2.5 py-1 rounded-lg text-xs bg-slate-900 hover:bg-slate-800 text-indigo-300 border border-indigo-500/20 whitespace-nowrap transition-all"
              >
                + Mumbai MMR
              </button>
              <button
                onClick={() => applyPreset('bangalore')}
                className="px-2.5 py-1 rounded-lg text-xs bg-slate-900 hover:bg-slate-800 text-indigo-300 border border-indigo-500/20 whitespace-nowrap transition-all"
              >
                + Bangalore
              </button>
            </div>
          </div>
        )}
      </header>

      {/* TAB 1: CREATIVES CONTENT */}
      {activeTab === 'creatives' && (
        <main className="px-4 py-4 max-w-2xl mx-auto">
          {/* Quick upload card */}
          <div className="mb-5 bg-gradient-to-br from-indigo-950/40 to-slate-900 border border-indigo-500/20 rounded-2xl p-4 flex items-center justify-between gap-3 shadow-lg shadow-indigo-500/5">
            <div>
              <h3 className="text-xs font-bold text-slate-100">Upload New Photo or Video</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">Directly from your gallery or phone storage</p>
            </div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept="image/*,video/*"
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl shadow-md shadow-indigo-600/30 transition-all shrink-0 flex items-center gap-1.5"
            >
              {uploading ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Uploading...</span>
                </>
              ) : (
                <>
                  <span>📤</span>
                  <span>Upload</span>
                </>
              )}
            </button>
          </div>

          {/* Creatives Grid */}
          {filteredCreatives.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-4xl mb-3">🎨</p>
              <h3 className="text-sm font-semibold text-slate-200 mb-1">No creatives found</h3>
              <p className="text-xs text-slate-500 max-w-xs mx-auto mb-4">
                {creativeSearchQuery ? 'Try adjusting your search query or filters.' : 'Upload an image/video or generate one in your chat.'}
              </p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-xs font-medium rounded-xl text-slate-300"
              >
                Upload from Device
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {filteredCreatives.map((item) => {
                const isSelected = selectedUrls.includes(item.url);
                return (
                  <div
                    key={item.id}
                    onClick={() => toggleSelect(item.url)}
                    className={`group relative rounded-2xl overflow-hidden border cursor-pointer transition-all duration-200 bg-slate-900 ${
                      isSelected
                        ? 'border-indigo-500 ring-2 ring-indigo-500/50 shadow-lg shadow-indigo-500/20 scale-[1.01]'
                        : 'border-slate-800/80 hover:border-slate-700'
                    }`}
                  >
                    {/* Media container */}
                    <div className="relative aspect-square bg-slate-950 flex items-center justify-center overflow-hidden">
                      {item.type === 'video' ? (
                        <div className="w-full h-full relative">
                          <video
                            src={item.url}
                            className="w-full h-full object-cover"
                            preload="metadata"
                            muted
                          />
                          <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                            <span className="w-9 h-9 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center text-white text-xs pl-0.5 shadow-lg">
                              ▶
                            </span>
                          </div>
                        </div>
                      ) : (
                        <img
                          src={item.url}
                          alt={item.title}
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                          loading="lazy"
                        />
                      )}

                      {/* Top badging */}
                      <div className="absolute top-2 left-2 flex items-center gap-1">
                        {item.is_ai_generated && (
                          <span className="px-1.5 py-0.5 bg-purple-600/90 backdrop-blur-md text-white text-[9px] font-bold rounded-md shadow-sm">
                            AI
                          </span>
                        )}
                        <span className="px-1.5 py-0.5 bg-black/70 backdrop-blur-md text-slate-300 text-[9px] font-medium rounded-md">
                          {item.aspect_ratio}
                        </span>
                      </div>

                      {/* Select indicator */}
                      <div className="absolute top-2 right-2">
                        <div
                          className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                            isSelected
                              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/50 scale-110'
                              : 'bg-black/50 border border-white/30 text-transparent hover:border-white/60'
                          }`}
                        >
                          <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 20 20">
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </div>
                      </div>

                      {/* Full preview action */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewMedia(item);
                        }}
                        className="absolute bottom-2 right-2 p-1.5 bg-black/60 hover:bg-black/90 backdrop-blur-sm rounded-lg text-slate-300 text-xs transition-opacity"
                        title="Expand preview"
                      >
                        🔍
                      </button>
                    </div>

                    {/* Metadata strip */}
                    <div className="p-2.5 bg-slate-900/90">
                      <p className="text-xs font-semibold text-slate-200 truncate">{item.title}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5 truncate">
                        {item.type.toUpperCase()} • {new Date(item.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      )}

      {/* TAB 2: LOCATIONS CONTENT */}
      {activeTab === 'locations' && (
        <main className="px-4 py-4 max-w-2xl mx-auto">
          {/* Live Search Input Box */}
          <div className="mb-5">
            <div className="relative">
              <input
                type="text"
                placeholder="Search city, region or district (e.g. Muktsar, Mohali, Gurgaon)..."
                value={locationSearchText}
                onChange={(e) => setLocationSearchText(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 pl-10 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all shadow-inner"
              />
              <span className="absolute left-3.5 top-3 text-slate-400 text-sm">📍</span>
              {isSearchingLocations && (
                <div className="absolute right-3.5 top-3.5">
                  <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {locationSearchText && !isSearchingLocations && (
                <button
                  onClick={() => {
                    setLocationSearchText('');
                    setLocationResults([]);
                  }}
                  className="absolute right-3.5 top-2.5 text-slate-400 hover:text-slate-200 text-sm"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Live Search Results Dropdown */}
            {locationResults.length > 0 && (
              <div className="mt-2 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl divide-y divide-slate-800/80 max-h-72 overflow-y-auto">
                <div className="px-3.5 py-2 bg-slate-950/60 text-[11px] font-semibold text-slate-400 flex items-center justify-between">
                  <span>Live Meta Ad Geolocation Results</span>
                  <span className="text-emerald-400 font-normal">Direct from Meta API</span>
                </div>
                {locationResults.map((result) => {
                  const alreadyAdded = selectedLocations.some((l) => l.key === result.key);
                  return (
                    <div
                      key={result.key}
                      onClick={() => !alreadyAdded && addLocation(result)}
                      className={`p-3 flex items-center justify-between gap-3 transition-colors ${
                        alreadyAdded ? 'bg-slate-950/40 opacity-60' : 'hover:bg-slate-800/80 cursor-pointer'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-slate-100 truncate">{result.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-300 rounded uppercase font-medium">
                            {result.type}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 truncate mt-0.5">
                          {result.region ? `${result.region}, ` : ''}{result.country_name || result.country_code}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={alreadyAdded}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold shrink-0 transition-all ${
                          alreadyAdded
                            ? 'bg-slate-800 text-slate-500'
                            : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30'
                        }`}
                      >
                        {alreadyAdded ? 'Added ✓' : '+ Add'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Selected Locations Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Targeting Locations ({selectedLocations.length})
              </h3>
              {selectedLocations.length > 0 && (
                <button
                  onClick={() => setSelectedLocations([])}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  Clear All
                </button>
              )}
            </div>

            {selectedLocations.length === 0 ? (
              <div className="py-12 border-2 border-dashed border-slate-800/80 rounded-2xl text-center p-6">
                <p className="text-3xl mb-2">🗺️</p>
                <h4 className="text-sm font-semibold text-slate-200 mb-1">No locations selected</h4>
                <p className="text-xs text-slate-500 max-w-xs mx-auto mb-4">
                  Search above for specific cities (e.g. Muktsar, Mohali, Gurgaon) or choose a quick preset.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    onClick={() => applyPreset('tricity')}
                    className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-xs text-slate-300"
                  >
                    Chandigarh Tricity
                  </button>
                  <button
                    onClick={() => applyPreset('delhi_ncr')}
                    className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-xs text-slate-300"
                  >
                    Delhi NCR
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                {selectedLocations.map((loc) => (
                  <div
                    key={loc.key}
                    className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 shadow-md"
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-100 truncate">{loc.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 rounded uppercase font-semibold">
                            {loc.type}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 truncate mt-0.5">
                          {loc.region ? `${loc.region}, ` : ''}{loc.country_code}
                        </p>
                      </div>
                      <button
                        onClick={() => removeLocation(loc.key)}
                        className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-red-500/20 text-slate-400 hover:text-red-300 flex items-center justify-center text-xs transition-colors shrink-0"
                        title="Remove location"
                      >
                        ✕
                      </button>
                    </div>

                    {/* Radius Slider if it is a City */}
                    {loc.type === 'city' && (
                      <div className="mt-3 pt-3 border-t border-slate-800/80">
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <span className="text-slate-400 font-medium">Radius:</span>
                          <span className="font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-md border border-indigo-500/20">
                            {loc.radius} km
                          </span>
                        </div>
                        <input
                          type="range"
                          min="17"
                          max="80"
                          value={loc.radius}
                          onChange={(e) => updateRadius(loc.key, Number(e.target.value))}
                          className="w-full accent-indigo-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg appearance-none"
                        />
                        <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1">
                          <span>17 km</span>
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => updateRadius(loc.key, 20)}
                              className={`px-1.5 py-0.5 rounded ${loc.radius === 20 ? 'bg-indigo-600 text-white' : 'bg-slate-800 hover:text-slate-300'}`}
                            >
                              20km
                            </button>
                            <button
                              onClick={() => updateRadius(loc.key, 25)}
                              className={`px-1.5 py-0.5 rounded ${loc.radius === 25 ? 'bg-indigo-600 text-white' : 'bg-slate-800 hover:text-slate-300'}`}
                            >
                              25km
                            </button>
                            <button
                              onClick={() => updateRadius(loc.key, 50)}
                              className={`px-1.5 py-0.5 rounded ${loc.radius === 50 ? 'bg-indigo-600 text-white' : 'bg-slate-800 hover:text-slate-300'}`}
                            >
                              50km
                            </button>
                          </div>
                          <span>80 km</span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      )}

      {/* Sticky Bottom Action Bar */}
      <footer className="fixed bottom-0 left-0 right-0 z-30 bg-slate-950/95 backdrop-blur-lg border-t border-slate-800/80 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
          <div className="min-w-0">
            {activeTab === 'creatives' ? (
              <>
                <p className="text-xs font-bold text-slate-100">
                  {selectedUrls.length} Creative{selectedUrls.length === 1 ? '' : 's'} Selected
                </p>
                <p className="text-[11px] text-slate-400 truncate">
                  {selectedUrls.length === 0 ? 'Pick at least 1 ad creative' : 'Ready to attach to campaign draft'}
                </p>
              </>
            ) : (
              <>
                <p className="text-xs font-bold text-slate-100">
                  {selectedLocations.length} Location{selectedLocations.length === 1 ? '' : 's'} Targeted
                </p>
                <p className="text-[11px] text-slate-400 truncate">
                  {selectedLocations.length === 0
                    ? 'Search & add target cities'
                    : selectedLocations.map((l) => l.name).join(', ')}
                </p>
              </>
            )}
          </div>

          {activeTab === 'creatives' ? (
            <button
              onClick={handleSubmitCreatives}
              disabled={submitting || selectedUrls.length === 0}
              className="px-5 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-40 text-white text-xs font-bold rounded-xl shadow-lg shadow-indigo-600/25 transition-all flex items-center gap-2 shrink-0"
            >
              {submitting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <span>Attach Creatives</span>
                  <span className="bg-white/20 px-2 py-0.5 rounded-full text-[10px] font-bold">
                    {selectedUrls.length}
                  </span>
                </>
              )}
            </button>
          ) : (
            <button
              onClick={handleSubmitLocations}
              disabled={submitting || selectedLocations.length === 0}
              className="px-5 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-40 text-white text-xs font-bold rounded-xl shadow-lg shadow-indigo-600/25 transition-all flex items-center gap-2 shrink-0"
            >
              {submitting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <span>Save Locations</span>
                  <span className="bg-white/20 px-2 py-0.5 rounded-full text-[10px] font-bold">
                    {selectedLocations.length}
                  </span>
                </>
              )}
            </button>
          )}
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
