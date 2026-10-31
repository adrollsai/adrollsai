'use client';

import { useState, useEffect } from 'react';
import { 
    Sparkles, 
    Film, 
    Image as ImageIcon, 
    Plus, 
    SlidersHorizontal, 
    Check, 
    Loader2, 
    ArrowRight, 
    Maximize2, 
    ChevronRight, 
    Info, 
    ShieldCheck, 
    MessageCircle,
    LayoutGrid,
    Clock,
    RefreshCw,
    X,
    CheckCircle2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/utils/supabase/client';
import { toast } from 'sonner';
import { parsePropertyConfigurations } from '@/utils/property-tags';
import ImagePreviewModal from '@/components/ImagePreviewModal';

type PropertyItem = {
    id: string;
    title: string;
    address?: string;
    price?: string;
    image_url?: string;
    images?: string[];
    description?: string;
    auto_generate?: boolean;
    configurations?: string | null;
    created_at?: string;
    last_asset_created_at?: string | null;
    last_video_created_at?: string | null;
};

export default function DeliveryPlanPage() {
    const supabase = createClient();

    const [loading, setLoading] = useState(true);
    const [properties, setProperties] = useState<PropertyItem[]>([]);
    const [togglingPropId, setTogglingPropId] = useState<string | null>(null);
    const [previewImage, setPreviewImage] = useState<string>('');

    // Settings Modal States
    const [activeModalProp, setActiveModalProp] = useState<PropertyItem | null>(null);
    const [modalType, setModalType] = useState<'creative' | 'video'>('creative');
    const [savingSettings, setSavingSettings] = useState(false);

    // Creative Settings
    const [creativeTimeOfDay, setCreativeTimeOfDay] = useState('09:00');
    const [creativeCustomPrompt, setCreativeCustomPrompt] = useState('');

    // Video Settings
    const [videoDuration, setVideoDuration] = useState(30);
    const [videoCustomPrompt, setVideoCustomPrompt] = useState('');

    // New Project Modal State
    const [isAddProjectModalOpen, setIsAddProjectModalOpen] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newPrice, setNewPrice] = useState('');
    const [newDesc, setNewDesc] = useState('');
    const [creatingProject, setCreatingProject] = useState(false);

    // Load Properties with their round robin configurations & latest assets
    const fetchPropertiesData = async () => {
        setLoading(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const [propsRes, assetsRes] = await Promise.all([
                supabase.from('properties').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
                supabase.from('assets').select('property_id, type, created_at').eq('user_id', user.id).order('created_at', { ascending: false })
            ]);

            const loadedAssets = assetsRes.data || [];
            const mapped: PropertyItem[] = (propsRes.data || []).map((p: any) => {
                const propAssets = loadedAssets.filter(a => a.property_id === p.id);
                const lastImg = propAssets.find(a => a.type === 'image')?.created_at || null;
                const lastVid = propAssets.find(a => a.type === 'video')?.created_at || null;
                return {
                    ...p,
                    last_asset_created_at: lastImg,
                    last_video_created_at: lastVid
                };
            });

            setProperties(mapped);
        } catch (err) {
            console.error("Failed to load properties for round-robin:", err);
            toast.error("Failed to load project catalog.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPropertiesData();
    }, []);

    // Active in round-robin filters
    const creativePool = properties.filter(p => !!p.auto_generate);
    const videoPool = properties.filter(p => {
        const cfg = parsePropertyConfigurations(p.configurations);
        return !!cfg?.auto_gen_video;
    });

    // Determine Next In Turn for Creatives (oldest last_asset_created_at or null)
    const sortedCreativeTurn = [...creativePool].sort((a, b) => {
        const timeA = a.last_asset_created_at ? new Date(a.last_asset_created_at).getTime() : 0;
        const timeB = b.last_asset_created_at ? new Date(b.last_asset_created_at).getTime() : 0;
        return timeA - timeB;
    });

    // Determine Next In Turn for Videos (oldest last_video_created_at or null)
    const sortedVideoTurn = [...videoPool].sort((a, b) => {
        const timeA = a.last_video_created_at ? new Date(a.last_video_created_at).getTime() : 0;
        const timeB = b.last_video_created_at ? new Date(b.last_video_created_at).getTime() : 0;
        return timeA - timeB;
    });

    // Toggle Creative Round Robin
    const handleToggleCreative = async (prop: PropertyItem) => {
        const willEnable = !prop.auto_generate;
        setTogglingPropId(prop.id);
        try {
            const res = await fetch('/api/inventory', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'toggle-auto-generate',
                    propertyId: prop.id,
                    autoGenerate: willEnable,
                    settings: willEnable ? { dimensions: '3:4', time_of_day: '09:00' } : undefined
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to toggle creative auto-gen");

            setProperties(prev => prev.map(p => p.id === prop.id ? { ...p, auto_generate: willEnable } : p));
            if (willEnable) {
                toast.success(`✨ Added "${prop.title}" to Daily Creative Round-Robin!`);
            } else {
                toast.info(`Removed "${prop.title}" from Daily Creative rotation.`);
            }
        } catch (err: any) {
            toast.error(err.message || "Failed to update rotation.");
        } finally {
            setTogglingPropId(null);
        }
    };

    // Toggle Video Round Robin
    const handleToggleVideo = async (prop: PropertyItem) => {
        const cfg = parsePropertyConfigurations(prop.configurations);
        const willEnable = !cfg?.auto_gen_video;
        setTogglingPropId(prop.id);
        try {
            const res = await fetch('/api/inventory', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'toggle-auto-generate-video',
                    propertyId: prop.id,
                    autoGenerateVideo: willEnable,
                    settings: willEnable ? { duration: 30, caption_style: 'goldenLuxury' } : undefined
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to toggle video auto-gen");

            setProperties(prev => prev.map(p => {
                if (p.id === prop.id) {
                    const parsed = parsePropertyConfigurations(p.configurations) || {};
                    parsed.auto_gen_video = willEnable;
                    return { ...p, configurations: JSON.stringify(parsed) };
                }
                return p;
            }));

            if (willEnable) {
                toast.success(`🎬 Added "${prop.title}" to Video Reel Round-Robin!`);
            } else {
                toast.info(`Removed "${prop.title}" from Video Reel rotation.`);
            }
        } catch (err: any) {
            toast.error(err.message || "Failed to update video rotation.");
        } finally {
            setTogglingPropId(null);
        }
    };

    // Open Config Modal
    const handleOpenModal = (prop: PropertyItem, type: 'creative' | 'video') => {
        setActiveModalProp(prop);
        setModalType(type);
        const cfg = parsePropertyConfigurations(prop.configurations);

        if (type === 'creative') {
            const s = cfg?.auto_gen_settings;
            setCreativeTimeOfDay(s?.time_of_day || '09:00');
            setCreativeCustomPrompt(s?.custom_prompt || '');
        } else {
            const s = cfg?.auto_gen_video_settings;
            setVideoDuration(s?.duration || 30);
            setVideoCustomPrompt(s?.custom_prompt || '');
        }
    };

    // Save Modal Settings
    const handleSaveSettings = async () => {
        if (!activeModalProp) return;
        setSavingSettings(true);
        try {
            if (modalType === 'creative') {
                const res = await fetch('/api/inventory', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'toggle-auto-generate',
                        propertyId: activeModalProp.id,
                        autoGenerate: true,
                        settings: {
                            dimensions: '3:4',
                            time_of_day: creativeTimeOfDay,
                            custom_prompt: creativeCustomPrompt
                        }
                    })
                });
                if (!res.ok) throw new Error("Failed to save creative settings");
                setProperties(prev => prev.map(p => p.id === activeModalProp.id ? { ...p, auto_generate: true } : p));
                toast.success("Daily Creative round-robin settings saved! ✨");
            } else {
                const res = await fetch('/api/inventory', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'toggle-auto-generate-video',
                        propertyId: activeModalProp.id,
                        autoGenerateVideo: true,
                        settings: {
                            duration: videoDuration,
                            custom_prompt: videoCustomPrompt,
                            caption_style: 'goldenLuxury'
                        }
                    })
                });
                if (!res.ok) throw new Error("Failed to save video settings");
                setProperties(prev => prev.map(p => {
                    if (p.id === activeModalProp.id) {
                        const parsed = parsePropertyConfigurations(p.configurations) || {};
                        parsed.auto_gen_video = true;
                        parsed.auto_gen_video_settings = { duration: videoDuration, custom_prompt: videoCustomPrompt, caption_style: 'goldenLuxury' };
                        return { ...p, configurations: JSON.stringify(parsed) };
                    }
                    return p;
                }));
                toast.success("Video Reel round-robin settings saved! 🎬");
            }
            setActiveModalProp(null);
        } catch (err: any) {
            toast.error(err.message || "Failed to save settings");
        } finally {
            setSavingSettings(false);
        }
    };

    // Quick Add Project
    const handleCreateProject = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTitle.trim() || !newDesc.trim()) {
            toast.error("Please provide title and description.");
            return;
        }

        setCreatingProject(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Unauthorized");

            const { data: newProp, error } = await supabase.from('properties').insert({
                user_id: user.id,
                title: newTitle.trim(),
                price: newPrice.trim() || 'Contact for Price',
                description: newDesc.trim(),
                address: 'Online',
                property_type: 'Generic',
                status: 'Active',
                auto_generate: true, // Enroll in creative round robin by default
                configurations: JSON.stringify({
                    auto_gen_video: true, // Enroll in video round robin by default
                    auto_gen_video_settings: { duration: 30, caption_style: 'goldenLuxury' }
                })
            }).select().single();

            if (error) throw error;

            toast.success(`🎉 "${newProp.title}" created & added to Round-Robin rotation!`);
            setIsAddProjectModalOpen(false);
            setNewTitle('');
            setNewPrice('');
            setNewDesc('');
            fetchPropertiesData();
        } catch (err: any) {
            toast.error("Failed to create project: " + err.message);
        } finally {
            setCreatingProject(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-[70vh] flex flex-col items-center justify-center p-8 space-y-3">
                <Loader2 size={32} className="animate-spin text-blue-600" />
                <p className="text-sm font-bold text-slate-600">Loading Round-Robin Scheduled Pipeline...</p>
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-28 space-y-7">
            {/* Lightbox Modal */}
            <ImagePreviewModal
                isOpen={!!previewImage}
                onClose={() => setPreviewImage('')}
                imageUrl={previewImage}
            />

            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-extrabold text-blue-700 uppercase tracking-wider bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-200">
                            Zero-Human Fulfillment Engine
                        </span>
                        <span className="text-xs text-slate-500 font-semibold hidden sm:inline">
                            &bull; Dynamic Round-Robin Rotation
                        </span>
                    </div>
                    <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
                        <span>Scheduled Creations &amp; Round-Robin Planner</span>
                        <RefreshCw size={20} className="text-blue-600" />
                    </h1>
                    <p className="text-sm text-slate-500 mt-1 max-w-2xl">
                        Toggle projects on/off to include or exclude them from automated generation. Nobogent's AI cycles through your enabled projects in turn, delivering fresh ad creatives and 30s video commercials to your WhatsApp.
                    </p>
                </div>

                <div className="flex items-center gap-2.5">
                    <button
                        type="button"
                        onClick={() => setIsAddProjectModalOpen(true)}
                        className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs uppercase tracking-wider shadow-sm hover:shadow-md transition-all flex items-center gap-2 cursor-pointer"
                    >
                        <Plus size={14} />
                        <span>Add Project</span>
                    </button>
                </div>
            </div>

            {/* =========================================================================
                ROUND-ROBIN LIVE QUEUE STATUS (VISUAL TURN PIPELINE)
            ========================================================================= */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 1. Daily Creative Turn Queue */}
                <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-sm space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center">
                                <Sparkles size={16} />
                            </div>
                            <div>
                                <h3 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider">
                                    Daily Creative Round-Robin
                                </h3>
                                <p className="text-[11px] text-slate-500 font-medium">
                                    {creativePool.length} Project(s) in active rotation &bull; 09:00 AM Daily
                                </p>
                            </div>
                        </div>
                        <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                            3:4 Portrait
                        </span>
                    </div>

                    {sortedCreativeTurn.length === 0 ? (
                        <p className="text-xs text-slate-400 py-3 text-center">
                            No projects currently enabled for daily creative round-robin. Toggle one below!
                        </p>
                    ) : (
                        <div className="space-y-1.5">
                            {sortedCreativeTurn.slice(0, 3).map((p, idx) => (
                                <div 
                                    key={p.id}
                                    className={`p-2.5 rounded-xl flex items-center justify-between text-xs transition-colors ${
                                        idx === 0 
                                            ? 'bg-amber-50/80 border border-amber-200 text-amber-950 font-bold' 
                                            : 'bg-slate-50 border border-slate-100 text-slate-700 font-medium'
                                    }`}
                                >
                                    <div className="flex items-center gap-2 truncate">
                                        <span className={`w-5 h-5 rounded-full text-[10px] font-extrabold flex items-center justify-center shrink-0 ${
                                            idx === 0 ? 'bg-amber-600 text-white' : 'bg-slate-200 text-slate-600'
                                        }`}>
                                            {idx + 1}
                                        </span>
                                        <span className="truncate">{p.title}</span>
                                    </div>
                                    <span className="text-[10px] uppercase font-bold shrink-0">
                                        {idx === 0 ? '⭐ Next Up Today' : 'In Line'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* 2. Video Reel Turn Queue */}
                <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-sm space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-600 flex items-center justify-center">
                                <Film size={16} />
                            </div>
                            <div>
                                <h3 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider">
                                    Video Reel Round-Robin
                                </h3>
                                <p className="text-[11px] text-slate-500 font-medium">
                                    {videoPool.length} Project(s) in active rotation &bull; 9:16 Voiceover
                                </p>
                            </div>
                        </div>
                        <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                            Golden Luxury
                        </span>
                    </div>

                    {sortedVideoTurn.length === 0 ? (
                        <p className="text-xs text-slate-400 py-3 text-center">
                            No projects currently enabled for video round-robin. Toggle one below!
                        </p>
                    ) : (
                        <div className="space-y-1.5">
                            {sortedVideoTurn.slice(0, 3).map((p, idx) => (
                                <div 
                                    key={p.id}
                                    className={`p-2.5 rounded-xl flex items-center justify-between text-xs transition-colors ${
                                        idx === 0 
                                            ? 'bg-indigo-50/80 border border-indigo-200 text-indigo-950 font-bold' 
                                            : 'bg-slate-50 border border-slate-100 text-slate-700 font-medium'
                                    }`}
                                >
                                    <div className="flex items-center gap-2 truncate">
                                        <span className={`w-5 h-5 rounded-full text-[10px] font-extrabold flex items-center justify-center shrink-0 ${
                                            idx === 0 ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-600'
                                        }`}>
                                            {idx + 1}
                                        </span>
                                        <span className="truncate">{p.title}</span>
                                    </div>
                                    <span className="text-[10px] uppercase font-bold shrink-0">
                                        {idx === 0 ? '🎬 Next Reel in Turn' : 'In Line'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* =========================================================================
                DEFAULT VIDEO CAPTION SPECIFICATION CARD
            ========================================================================= */}
            <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-amber-950 via-slate-950 to-slate-900 text-white shadow-md relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-400/30 tracking-wider">
                            Default Video Caption Engine
                        </span>
                        <span className="text-xs font-bold text-amber-200">Golden Luxury Style Active</span>
                    </div>
                    <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
                        Every synthesized video reel automatically receives high-retention captions styled in <strong>Golden Luxury</strong>: smooth <strong>Fade-in</strong> animation, positioned at the <strong>Center</strong>, using <strong>Outfit (Premium Font)</strong> with a restrained <strong>54px</strong> font size so it never overpowers the visual scene.
                    </p>
                </div>

                <div className="flex items-center gap-2 self-start md:self-auto shrink-0 bg-slate-900/90 border border-amber-500/30 px-3 py-2 rounded-xl text-center">
                    <div>
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Style &amp; Motion</div>
                        <div className="text-xs font-extrabold text-amber-300 font-mono">Golden Luxury &bull; Fade In</div>
                    </div>
                </div>
            </div>

            {/* =========================================================================
                PROJECTS CATALOG WITH DUAL TOGGLES
            ========================================================================= */}
            <div className="bg-white border border-slate-200/90 rounded-3xl p-5 sm:p-7 shadow-sm space-y-5">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <div>
                        <h2 className="text-base sm:text-lg font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
                            <LayoutGrid size={18} className="text-blue-600" />
                            <span>Your Projects Catalog ({properties.length})</span>
                        </h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                            Toggle each project on or off. Enabled projects take turns in the round-robin schedule.
                        </p>
                    </div>
                </div>

                {properties.length === 0 ? (
                    <div className="text-center py-12 space-y-3">
                        <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 mx-auto flex items-center justify-center">
                            <LayoutGrid size={22} />
                        </div>
                        <h4 className="text-sm font-bold text-slate-800">No projects in your catalog yet</h4>
                        <p className="text-xs text-slate-400 max-w-sm mx-auto">
                            Add your first project or property listing to immediately start scheduled creations.
                        </p>
                        <button
                            type="button"
                            onClick={() => setIsAddProjectModalOpen(true)}
                            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs"
                        >
                            + Add First Project
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                        {properties.map((prop) => {
                            const cfg = parsePropertyConfigurations(prop.configurations);
                            const isCreativeOn = !!prop.auto_generate;
                            const isVideoOn = !!cfg?.auto_gen_video;
                            const heroImg = prop.image_url || prop.images?.[0] || '';

                            return (
                                <div 
                                    key={prop.id}
                                    className={`rounded-2xl border transition-all overflow-hidden flex flex-col justify-between bg-white ${
                                        isCreativeOn || isVideoOn 
                                            ? 'border-slate-300 shadow-sm' 
                                            : 'border-slate-200/70 opacity-80 hover:opacity-100'
                                    }`}
                                >
                                    {/* Top Image Preview & Meta */}
                                    <div>
                                        <div className="relative h-44 bg-slate-950 overflow-hidden group">
                                            {heroImg ? (
                                                <img 
                                                    src={heroImg} 
                                                    alt={prop.title}
                                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 text-xs">
                                                    <ImageIcon size={24} className="mb-1 text-slate-600" />
                                                    <span>No Image</span>
                                                </div>
                                            )}

                                            {/* Top badges */}
                                            <div className="absolute top-2.5 inset-x-2.5 flex items-center justify-between">
                                                <span className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full backdrop-blur-xs ${
                                                    isCreativeOn || isVideoOn 
                                                        ? 'bg-emerald-500/90 text-white' 
                                                        : 'bg-slate-900/80 text-slate-300'
                                                }`}>
                                                    {isCreativeOn || isVideoOn ? 'Active Rotation' : 'Paused'}
                                                </span>

                                                {heroImg && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setPreviewImage(heroImg)}
                                                        className="p-1 rounded-full bg-slate-900/70 text-white hover:bg-slate-900 transition-colors cursor-pointer"
                                                        title="Zoom Preview"
                                                    >
                                                        <Maximize2 size={12} />
                                                    </button>
                                                )}
                                            </div>

                                            {/* Bottom Title bar */}
                                            <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/85 via-black/40 to-transparent text-white">
                                                <h4 className="font-extrabold text-sm truncate drop-shadow">
                                                    {prop.title}
                                                </h4>
                                                <p className="text-[11px] text-slate-300 truncate font-medium">
                                                    {prop.price || 'Contact for Price'} {prop.address ? `• ${prop.address}` : ''}
                                                </p>
                                            </div>
                                        </div>

                                        {/* Description Snippet */}
                                        <div className="p-3.5 pb-2">
                                            <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                                                {prop.description || 'No description provided.'}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Dual Toggles Footer */}
                                    <div className="p-3.5 pt-2 border-t border-slate-100 bg-slate-50/50 space-y-3">
                                        {/* Toggle 1: Daily Creative */}
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                <span className="text-[10px] font-bold text-slate-600 flex items-center gap-1 uppercase tracking-wider">
                                                    <Sparkles size={13} className={isCreativeOn ? "text-amber-500 fill-amber-500/20" : "text-slate-400"} />
                                                    Daily Creative
                                                </span>
                                                {isCreativeOn && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleOpenModal(prop, 'creative')}
                                                        className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 border border-amber-200 hover:bg-amber-200 transition-colors cursor-pointer"
                                                        title="Edit Creative Settings"
                                                    >
                                                        3:4 &bull; 09:00 🎛️
                                                    </button>
                                                )}
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() => handleToggleCreative(prop)}
                                                disabled={togglingPropId === prop.id}
                                                className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-300 ease-in-out focus:outline-none ${
                                                    isCreativeOn ? 'bg-amber-500' : 'bg-slate-300'
                                                } ${togglingPropId === prop.id ? 'opacity-50 cursor-not-allowed' : ''}`}
                                            >
                                                <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-300 ease-out ${
                                                    isCreativeOn ? 'translate-x-5' : 'translate-x-0'
                                                }`} />
                                            </button>
                                        </div>

                                        {/* Toggle 2: Video Reel Round-Robin */}
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                <span className="text-[10px] font-bold text-slate-600 flex items-center gap-1 uppercase tracking-wider">
                                                    <Film size={13} className={isVideoOn ? "text-indigo-600 fill-indigo-600/20" : "text-slate-400"} />
                                                    Video Reel
                                                </span>
                                                {isVideoOn && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleOpenModal(prop, 'video')}
                                                        className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-indigo-100 text-indigo-800 border border-indigo-200 hover:bg-indigo-200 transition-colors cursor-pointer"
                                                        title="Edit Video Settings"
                                                    >
                                                        {cfg?.auto_gen_video_settings?.duration || 30}s &bull; Gold 🎛️
                                                    </button>
                                                )}
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() => handleToggleVideo(prop)}
                                                disabled={togglingPropId === prop.id}
                                                className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-300 ease-in-out focus:outline-none ${
                                                    isVideoOn ? 'bg-indigo-600' : 'bg-slate-300'
                                                } ${togglingPropId === prop.id ? 'opacity-50 cursor-not-allowed' : ''}`}
                                            >
                                                <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-300 ease-out ${
                                                    isVideoOn ? 'translate-x-5' : 'translate-x-0'
                                                }`} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* =========================================================================
                SETTINGS MODAL (CREATIVE OR VIDEO)
            ========================================================================= */}
            {activeModalProp && (
                <div 
                    onClick={() => setActiveModalProp(null)}
                    className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200"
                >
                    <div 
                        onClick={(e) => e.stopPropagation()}
                        className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-7 shadow-2xl border border-slate-200/80 space-y-5 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto"
                    >
                        <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border ${
                                    modalType === 'creative' 
                                        ? 'bg-amber-500/10 border-amber-500/20 text-amber-600' 
                                        : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-600'
                                }`}>
                                    {modalType === 'creative' ? <Sparkles size={24} /> : <Film size={24} />}
                                </div>
                                <div>
                                    <h3 className="text-lg font-extrabold text-slate-900 leading-snug">
                                        {modalType === 'creative' ? 'Daily Creative Settings' : 'Video Reel Settings'}
                                    </h3>
                                    <p className="text-xs font-semibold text-slate-500 truncate max-w-[280px] sm:max-w-xs">{activeModalProp.title}</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setActiveModalProp(null)}
                                className="bg-slate-100 hover:bg-slate-200 p-2 rounded-full text-slate-500 transition-colors shrink-0 cursor-pointer"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {modalType === 'creative' ? (
                            <>
                                <p className="text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-200/60 leading-relaxed">
                                    When this project's turn arrives in the daily schedule, Nobogent AI automatically synthesizes a 3:4 ad creative randomly styled with your chosen templates.
                                </p>

                                <div>
                                    <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                        <Clock size={14} className="text-amber-500" />
                                        Generation Time of Day (IST)
                                    </label>
                                    <div className="grid grid-cols-4 gap-2">
                                        {[
                                            { time: '09:00', label: '9:00 AM' },
                                            { time: '13:00', label: '1:00 PM' },
                                            { time: '18:00', label: '6:00 PM' },
                                            { time: '21:00', label: '9:00 PM' },
                                        ].map((p) => (
                                            <button
                                                key={p.time}
                                                type="button"
                                                onClick={() => setCreativeTimeOfDay(p.time)}
                                                className={`py-2 px-1 rounded-xl text-center border text-xs font-bold transition-all cursor-pointer ${
                                                    creativeTimeOfDay === p.time 
                                                        ? 'border-amber-500 bg-amber-50 text-amber-800 ring-2 ring-amber-500/20' 
                                                        : 'border-slate-200 bg-white text-slate-700'
                                                }`}
                                            >
                                                {p.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                                        <SlidersHorizontal size={14} className="text-amber-500" />
                                        Custom Prompt / Direction (Optional)
                                    </label>
                                    <textarea
                                        value={creativeCustomPrompt}
                                        onChange={(e) => setCreativeCustomPrompt(e.target.value)}
                                        rows={3}
                                        placeholder="e.g. Emphasize sunset balcony view, highlight 10:90 payment plan, mention luxury finishes..."
                                        className="w-full bg-slate-50 border border-slate-200 py-2.5 px-3.5 rounded-xl text-xs font-medium focus:ring-4 focus:ring-amber-500/20 focus:border-amber-400 outline-none transition-all resize-none text-slate-800"
                                    />
                                </div>
                            </>
                        ) : (
                            <>
                                <p className="text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-200/60 leading-relaxed">
                                    When this project's turn arrives in the video schedule, Nobogent AI synthesizes a high-converting 9:16 voiceover commercial reel with realistic visuals and Golden Luxury fade-in captions.
                                </p>

                                <div>
                                    <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                        <Clock size={14} className="text-indigo-500" />
                                        Reel Duration
                                    </label>
                                    <div className="grid grid-cols-4 gap-2">
                                        {[
                                            { dur: 15, label: '15s', desc: 'Fast Hook' },
                                            { dur: 30, label: '30s', desc: 'Standard' },
                                            { dur: 45, label: '45s', desc: 'Detailed' },
                                            { dur: 60, label: '60s', desc: 'Story' },
                                        ].map((d) => (
                                            <button
                                                key={d.dur}
                                                type="button"
                                                onClick={() => setVideoDuration(d.dur)}
                                                className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                                                    videoDuration === d.dur 
                                                        ? 'border-indigo-600 bg-indigo-50/70 text-indigo-700 font-bold ring-2 ring-indigo-500/20' 
                                                        : 'border-slate-200 bg-white text-slate-700'
                                                }`}
                                            >
                                                <div className="text-xs font-extrabold">{d.label}</div>
                                                <div className="text-[9px] text-slate-500">{d.desc}</div>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="p-3.5 rounded-2xl bg-amber-50/80 border border-amber-200/90 space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                                            <Sparkles size={13} className="text-amber-600" />
                                            <span>Default Caption Engine</span>
                                        </span>
                                        <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-amber-200/60 text-amber-900 border border-amber-300/80">
                                            Golden Luxury
                                        </span>
                                    </div>
                                    <p className="text-[11px] text-amber-950 leading-relaxed">
                                        Applied automatically: <strong>Fade-in</strong> animation &bull; <strong>Center</strong> position &bull; <strong>Outfit (Premium Font)</strong> &bull; Elegant <strong>54px</strong> font size.
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                                        <SlidersHorizontal size={14} className="text-indigo-500" />
                                        Script &amp; Visual Instructions (Optional)
                                    </label>
                                    <textarea
                                        value={videoCustomPrompt}
                                        onChange={(e) => setVideoCustomPrompt(e.target.value)}
                                        rows={3}
                                        placeholder="e.g. Focus on the private plunge pool, use natural conversational Hinglish dialogue with Devanagari script, mention 10:90 payment plan..."
                                        className="w-full bg-slate-50 border border-slate-200 py-2.5 px-3.5 rounded-xl text-xs font-medium focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-400 outline-none transition-all resize-none text-slate-800"
                                    />
                                </div>
                            </>
                        )}

                        <div className="flex items-center gap-3 pt-2">
                            <button
                                type="button"
                                onClick={() => setActiveModalProp(null)}
                                disabled={savingSettings}
                                className="flex-1 py-3 px-4 rounded-xl border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50 transition-colors disabled:opacity-50 cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleSaveSettings}
                                disabled={savingSettings}
                                className={`flex-1 py-3 px-4 rounded-xl text-white text-xs font-bold shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer ${
                                    modalType === 'creative' 
                                        ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/20' 
                                        : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/20'
                                }`}
                            >
                                {savingSettings ? (
                                    <>
                                        <Loader2 size={16} className="animate-spin" />
                                        <span>Saving...</span>
                                    </>
                                ) : (
                                    <>
                                        <Check size={16} />
                                        <span>Save &amp; Keep in Rotation</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* =========================================================================
                ADD NEW PROJECT MODAL
            ========================================================================= */}
            {isAddProjectModalOpen && (
                <div 
                    onClick={() => setIsAddProjectModalOpen(false)}
                    className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200"
                >
                    <div 
                        onClick={(e) => e.stopPropagation()}
                        className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-7 shadow-2xl border border-slate-200 space-y-4"
                    >
                        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                            <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                                <Plus size={18} className="text-blue-600" />
                                <span>Add Project to Round-Robin Rotation</span>
                            </h3>
                            <button
                                type="button"
                                onClick={() => setIsAddProjectModalOpen(false)}
                                className="bg-slate-100 hover:bg-slate-200 p-1.5 rounded-full text-slate-500 cursor-pointer"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <form onSubmit={handleCreateProject} className="space-y-3.5">
                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">
                                    Project / Offering Title <span className="text-rose-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={newTitle}
                                    onChange={(e) => setNewTitle(e.target.value)}
                                    placeholder="e.g. DLF Magnolias 4BHK Sky Penthouse"
                                    required
                                    className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs text-slate-900 font-bold focus:outline-none focus:border-blue-500"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">
                                    Price / Tagline (Optional)
                                </label>
                                <input
                                    type="text"
                                    value={newPrice}
                                    onChange={(e) => setNewPrice(e.target.value)}
                                    placeholder="e.g. ₹3.5 Cr"
                                    className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs text-slate-900 font-bold focus:outline-none focus:border-blue-500"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">
                                    Description &amp; Highlights <span className="text-rose-500">*</span>
                                </label>
                                <textarea
                                    rows={3}
                                    value={newDesc}
                                    onChange={(e) => setNewDesc(e.target.value)}
                                    placeholder="Describe key highlights, amenities, location advantages..."
                                    required
                                    className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs text-slate-800 leading-relaxed focus:outline-none focus:border-blue-500 resize-none"
                                />
                            </div>

                            <p className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                                💡 This project will be automatically enrolled in both <strong>Daily Creative</strong> and <strong>Video Reel</strong> round-robin rotations.
                            </p>

                            <div className="flex items-center gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setIsAddProjectModalOpen(false)}
                                    className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50 cursor-pointer"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={creatingProject}
                                    className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                                >
                                    {creatingProject ? (
                                        <>
                                            <Loader2 size={14} className="animate-spin" />
                                            <span>Adding...</span>
                                        </>
                                    ) : (
                                        <>
                                            <Plus size={14} />
                                            <span>Add to Rotation</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
