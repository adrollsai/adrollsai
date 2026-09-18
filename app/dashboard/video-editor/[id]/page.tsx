'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Player } from '@remotion/player'
import { CaptionsComposition, Caption, Effect, Theme } from '@/remotion/CaptionsComposition'
import { SUBTITLE_THEMES, ANIMATION_OPTIONS } from '@/remotion/Constants'
import { createClient } from '@/utils/supabase/client'
import { motion, AnimatePresence } from 'framer-motion'
import {
    Sparkles,
    Download,
    Type,
    Palette,
    Layout,
    ChevronLeft,
    Loader2,
    Check,
    RefreshCw,
    Play,
    Pause,
    History,
    Globe,
    Languages,
    Plus,
    Trash2,
    Clock,
    FastForward,
    Rewind,
    Sliders,
    Zap,
    SlidersHorizontal,
    Maximize2
} from 'lucide-react'
import { toast } from 'sonner'

const CAPTION_LANGUAGES = [
    { value: 'hinglish', label: 'Hinglish (हिंग्लिश - Roman/English Alphabet)', flag: '🇮🇳' },
    { value: 'english', label: 'English (Clear English Subtitles)', flag: '🇬🇧' },
    { value: 'hindi', label: 'Hindi (हिन्दी - Native Devanagari)', flag: '🇮🇳' },
    { value: 'punjabi', label: 'Punjabi (ਪੰਜਾਬੀ)', flag: '🇮🇳' },
    { value: 'marathi', label: 'Marathi (मराठी)', flag: '🇮🇳' },
    { value: 'gujarati', label: 'Gujarati (ગુજરાતી)', flag: '🇮🇳' },
    { value: 'bengali', label: 'Bengali (বাংলা)', flag: '🇮🇳' },
    { value: 'tamil', label: 'Tamil (தமிழ்)', flag: '🇮🇳' },
    { value: 'telugu', label: 'Telugu (తెలుగు)', flag: '🇮🇳' },
    { value: 'kannada', label: 'Kannada (ಕನ್ನಡ)', flag: '🇮🇳' },
    { value: 'malayalam', label: 'Malayalam (മലയാളം)', flag: '🇮🇳' },
    { value: 'urdu', label: 'Urdu (اردو)', flag: '🇵🇰' },
    { value: 'arabic', label: 'Arabic (العربية)', flag: '🇦🇪' },
    { value: 'spanish', label: 'Spanish (Español)', flag: '🇪🇸' },
    { value: 'french', label: 'French (Français)', flag: '🇫🇷' },
    { value: 'german', label: 'German (Deutsch)', flag: '🇩🇪' },
]

const COLOR_SWATCHES = [
    '#FFE600', // Hormozi Yellow
    '#39FF14', // Neon Green
    '#00EAFF', // Cyber Cyan
    '#FF007F', // Neon Magenta
    '#F59E0B', // Amber Gold
    '#EF4444', // Crimson Red
    '#FFFFFF', // Crisp White
    '#A855F7', // Electric Violet
]

export default function VideoEditorPage() {
    const { id } = useParams()
    const router = useRouter()
    const searchParams = useSearchParams()
    const impersonate = searchParams?.get('impersonate')
    const supabase = createClient()

    const fixR2Url = (url: string) => {
        if (!url) return ''
        return url.replace('r2.dev/adrolls-storage/', 'r2.dev/')
    }

    const getBrowserMediaUrl = (url: string) => {
        const clean = fixR2Url(url)
        if (!clean) return ''
        return `/api/fetch-image?url=${encodeURIComponent(clean)}`
    }

    const [loading, setLoading] = useState(true)
    const [videoReady, setVideoReady] = useState(false)
    const [asset, setAsset] = useState<any>(null)
    const [captions, setCaptions] = useState<Caption[]>([])
    const [effects, setEffects] = useState<Effect[]>([])
    const [profile, setProfile] = useState<any>(null)
    const [selectedTheme, setSelectedTheme] = useState<string>('hormozi')
    const [themeConfig, setThemeConfig] = useState<Theme>(SUBTITLE_THEMES.hormozi)
    const [captionLanguage, setCaptionLanguage] = useState<string>('hinglish')
    const [isGenerating, setIsGenerating] = useState(false)
    const [isRendering, setIsRendering] = useState(false)
    const [durationInFrames, setDurationInFrames] = useState<number>(30 * 30) // fallback default
    const [activeTab, setActiveTab] = useState<'styles' | 'animations' | 'custom' | 'subtitles'>('styles')

    // Player controls
    const playerRef = useRef<any>(null)

    useEffect(() => {
        const fetchAssetAndProfile = async () => {
            setLoading(true)
            setVideoReady(false)
            
            // 1. Fetch Asset via Server API (supporting impersonation bypass)
            const apiUrl = `/api/assets?id=${id}${impersonate ? `&impersonate=${impersonate}` : ''}`
            let assetData: any = null
            try {
                const res = await fetch(apiUrl)
                if (res.ok) {
                    assetData = await res.json()
                }
            } catch (e) {}

            if (!assetData || assetData.error) {
                // Fallback to client Supabase
                const { data } = await supabase.from('assets').select('*').eq('id', id).single()
                assetData = data
            }

            if (!assetData) {
                toast.error("Failed to load video asset")
                router.push(impersonate ? `/dashboard/assets?impersonate=${impersonate}` : '/dashboard/assets')
                return
            }

            setAsset(assetData)
            if (assetData.metadata?.captions && Array.isArray(assetData.metadata.captions)) {
                setCaptions(assetData.metadata.captions)
            }
            if (assetData.metadata?.effects) {
                setEffects(assetData.metadata.effects)
            }

            // 2. Fetch Profile (respecting asset owner / impersonation)
            const { data: profileData } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', assetData.user_id)
                .single()
            
            if (profileData) {
                setProfile(profileData)
            }

            // 3. Load Video Duration dynamically in browser
            if (assetData.url) {
                const proxyUrl = getBrowserMediaUrl(assetData.url)
                const video = document.createElement('video')
                video.preload = 'metadata'

                let readyTriggered = false
                const handleDuration = () => {
                    if (readyTriggered) return
                    const videoDuration = video.duration
                    if (videoDuration && !isNaN(videoDuration) && isFinite(videoDuration) && videoDuration > 0) {
                        readyTriggered = true
                        console.log(`[Video Editor] Probed video duration: ${videoDuration}s`)
                        const calculatedFrames = Math.ceil(videoDuration * 30) + 120
                        setDurationInFrames(calculatedFrames)
                        setVideoReady(true)
                    }
                }

                video.onloadedmetadata = handleDuration
                video.onloadeddata = handleDuration
                video.oncanplay = handleDuration
                
                // Use proxy URL to avoid CORS blocks on cross-origin duration probing
                video.src = proxyUrl

                // Fallback timeout after 5s so editor never gets stuck
                setTimeout(() => {
                    if (!readyTriggered) {
                        if (video.duration && !isNaN(video.duration) && isFinite(video.duration) && video.duration > 0) {
                            handleDuration()
                        } else {
                            readyTriggered = true
                            setVideoReady(true)
                        }
                    }
                }, 5000)
            } else {
                setVideoReady(true)
            }

            setLoading(false)
        }

        fetchAssetAndProfile()
    }, [id])

    const generateCaptions = async (langOverride?: string) => {
        if (!asset) return
        setIsGenerating(true)
        const activeLang = langOverride || captionLanguage
        try {
            const res = await fetch('/api/video/captions/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    videoUrl: fixR2Url(asset.url), 
                    assetId: asset.id,
                    language: activeLang
                })
            })
            const data = await res.json()
            if (data.success && data.captions) {
                setCaptions(data.captions)
                setEffects(data.effects || [])
                const langObj = CAPTION_LANGUAGES.find(l => l.value === activeLang)
                toast.success(`Captions synchronized in ${langObj ? langObj.label.split(' ')[0] : activeLang}!`)
            } else {
                throw new Error(data.error)
            }
        } catch (e: any) {
            toast.error("Generation failed: " + e.message)
        } finally {
            setIsGenerating(false)
        }
    }

    const handleSelectTheme = (themeKey: string) => {
        setSelectedTheme(themeKey)
        const preset = SUBTITLE_THEMES[themeKey]
        if (preset) {
            setThemeConfig({ ...preset })
        }
    }

    const updateTheme = (patch: Partial<Theme>) => {
        setThemeConfig(prev => ({ ...prev, ...patch }))
    }

    const nudgeAllCaptions = (deltaSeconds: number) => {
        if (captions.length === 0) return
        setCaptions(prev => prev.map(c => ({
            ...c,
            start: Math.max(0, Number((c.start + deltaSeconds).toFixed(2))),
            end: Math.max(0.1, Number((c.end + deltaSeconds).toFixed(2)))
        })))
        toast.success(`Shifted captions by ${deltaSeconds > 0 ? '+' : ''}${deltaSeconds}s`)
    }

    const updateCaption = (index: number, patch: Partial<Caption>) => {
        setCaptions(prev => {
            const next = [...prev]
            next[index] = { ...next[index], ...patch }
            return next
        })
    }

    const deleteCaption = (index: number) => {
        setCaptions(prev => prev.filter((_, i) => i !== index))
    }

    const addCaption = () => {
        const lastCaption = captions[captions.length - 1]
        const newStart = lastCaption ? Number((lastCaption.end + 0.1).toFixed(2)) : 0
        const newEnd = Number((newStart + 1.2).toFixed(2))
        setCaptions(prev => [...prev, {
            text: 'NEW CAPTION',
            start: newStart,
            end: newEnd,
            emphasis: false
        }])
        toast.success("Added new caption segment")
    }

    const startRender = async () => {
        setIsRendering(true)
        try {
            // This will trigger the Remotion render on the server
            const res = await fetch('/api/video/render', {
                method: 'POST',
                body: JSON.stringify({
                    assetId: asset.id,
                    theme: themeConfig,
                    videoUrl: fixR2Url(asset.url),
                    captions,
                    effects, // Pass the visual effects as well
                    durationInFrames
                })
            })
            const data = await res.json()
            if (data.success) {
                toast.success("Rendering started! Check your assets library in a few minutes.")
                if (impersonate) {
                    router.push(`/dashboard/assets?impersonate=${impersonate}`)
                } else {
                    router.push('/dashboard/assets')
                }
            } else {
                throw new Error(data.error)
            }
        } catch (e: any) {
            toast.error("Rendering failed: " + e.message)
        } finally {
            setIsRendering(false)
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-950">
                <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
            </div>
        )
    }

    if (asset?.status === 'Rendering' || asset?.status === 'Processing') {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 text-white p-6 text-center space-y-4">
                <div className="w-16 h-16 bg-blue-600/10 border border-blue-500/20 rounded-2xl flex items-center justify-center text-blue-400">
                    <Loader2 className="w-8 h-8 animate-spin" />
                </div>
                <h2 className="text-2xl font-black">Video Processing in Progress</h2>
                <p className="text-sm text-slate-400 max-w-md leading-relaxed">
                    Your video is currently being generated or rendered in the cloud. Please wait a few moments for processing to complete.
                </p>
                <button
                    onClick={() => window.location.reload()}
                    className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs px-6 py-3 rounded-xl transition-all shadow-lg shadow-blue-600/20"
                >
                    Check Status
                </button>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-slate-950 text-white flex flex-col lg:flex-row overflow-y-auto">

            {/* LEFT SIDE - PREVIEW & PLAYER CONTROLS */}
            <div className="flex-1 relative flex flex-col items-center justify-center p-4 sm:p-8 bg-slate-900/40">

                <button
                    onClick={() => router.back()}
                    className="absolute top-6 left-6 z-20 bg-white/10 hover:bg-white/20 p-2.5 rounded-full backdrop-blur-md transition-all text-white border border-white/10 shadow-lg"
                >
                    <ChevronLeft size={22} />
                </button>

                {/* Video Player Canvas */}
                <div className="w-full max-w-[390px] aspect-[9/16] bg-black rounded-[2.5rem] overflow-hidden shadow-2xl shadow-blue-500/10 border-2 border-white/10 relative group">
                    {(!videoReady || isGenerating) && (
                        <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center z-30 space-y-3">
                            <Loader2 size={40} className="text-blue-500 animate-spin" />
                            <p className="font-extrabold text-sm text-white">
                                {isGenerating ? 'AI Syncing & Transcribing Captions...' : 'Loading Video Timeline...'}
                            </p>
                            <p className="text-xs text-slate-400 font-medium">
                                {isGenerating ? 'Matching exact audio speech speed & viral timing' : 'Preparing high-definition canvas'}
                            </p>
                        </div>
                    )}
                    <Player
                        ref={playerRef}
                        component={CaptionsComposition}
                        durationInFrames={durationInFrames}
                        compositionWidth={1080}
                        compositionHeight={1920}
                        fps={30}
                        controls
                        style={{ width: '100%', height: '100%' }}
                        inputProps={{
                            videoUrl: getBrowserMediaUrl(asset.url),
                            captions: captions,
                            effects: effects,
                            theme: themeConfig,
                            profile: profile
                        }}
                    />
                </div>

                {/* Quick Audio Sync & Re-run Bar */}
                <div className="mt-6 flex flex-col items-center gap-3 w-full max-w-[420px]">
                    <div className="w-full flex items-center justify-between bg-white/5 border border-white/10 rounded-2xl p-2.5 px-4">
                        <div className="flex items-center gap-2 text-xs font-bold text-slate-300">
                            <Clock size={14} className="text-amber-400" />
                            <span>Audio Sync Nudge:</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <button
                                onClick={() => nudgeAllCaptions(-0.2)}
                                title="Shift all captions earlier by 0.2s"
                                className="bg-white/5 hover:bg-white/15 px-2.5 py-1 rounded-lg text-xs font-mono font-bold text-slate-300 border border-white/5 transition-all"
                            >
                                -0.2s
                            </button>
                            <button
                                onClick={() => nudgeAllCaptions(-0.1)}
                                title="Shift all captions earlier by 0.1s"
                                className="bg-white/5 hover:bg-white/15 px-2.5 py-1 rounded-lg text-xs font-mono font-bold text-slate-300 border border-white/5 transition-all"
                            >
                                -0.1s
                            </button>
                            <button
                                onClick={() => nudgeAllCaptions(0.1)}
                                title="Shift all captions later by 0.1s"
                                className="bg-white/5 hover:bg-white/15 px-2.5 py-1 rounded-lg text-xs font-mono font-bold text-slate-300 border border-white/5 transition-all"
                            >
                                +0.1s
                            </button>
                            <button
                                onClick={() => nudgeAllCaptions(0.2)}
                                title="Shift all captions later by 0.2s"
                                className="bg-white/5 hover:bg-white/15 px-2.5 py-1 rounded-lg text-xs font-mono font-bold text-slate-300 border border-white/5 transition-all"
                            >
                                +0.2s
                            </button>
                        </div>
                    </div>

                    <div className="flex gap-3 w-full">
                        <button
                            onClick={() => generateCaptions()}
                            disabled={isGenerating || !videoReady || loading}
                            className="flex-1 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 py-3.5 px-6 rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-blue-600/20 disabled:opacity-50 active:scale-95 disabled:cursor-not-allowed border border-blue-400/20"
                        >
                            {(!videoReady || isGenerating) ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                            {!videoReady ? 'Loading...' : (isGenerating ? 'Syncing...' : (captions.length > 0 ? 'Re-Sync AI Captions' : 'AI Generate Captions'))}
                        </button>
                    </div>
                </div>

                {/* Mobile Spacer */}
                <div className="h-44 sm:hidden" />
            </div>

            {/* RIGHT SIDE - CONTROLS & TABS */}
            <div className="w-full lg:w-[480px] bg-slate-950 border-l border-white/10 flex flex-col h-screen overflow-hidden">

                {/* Header */}
                <div className="p-6 pb-4 border-b border-white/10 shrink-0 bg-slate-950/80 backdrop-blur-md">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-xl font-black flex items-center gap-2">
                                <Sparkles className="text-blue-400 animate-pulse" size={20} /> AI Caption Studio
                            </h2>
                            <p className="text-slate-400 text-xs mt-0.5">High-retention viral styling & animations</p>
                        </div>
                        {captions.length > 0 && (
                            <span className="text-[11px] font-extrabold bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2.5 py-1 rounded-full">
                                {captions.length} Segments
                            </span>
                        )}
                    </div>

                    {/* Navigation Tabs */}
                    <div className="flex gap-1.5 mt-4 p-1 bg-white/5 border border-white/5 rounded-2xl">
                        <button
                            onClick={() => setActiveTab('styles')}
                            className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${activeTab === 'styles' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}
                        >
                            <Palette size={13} /> Styles
                        </button>
                        <button
                            onClick={() => setActiveTab('animations')}
                            className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${activeTab === 'animations' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}
                        >
                            <Zap size={13} /> Animations
                        </button>
                        <button
                            onClick={() => setActiveTab('custom')}
                            className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${activeTab === 'custom' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}
                        >
                            <SlidersHorizontal size={13} /> Adjust
                        </button>
                        <button
                            onClick={() => setActiveTab('subtitles')}
                            className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${activeTab === 'subtitles' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}
                        >
                            <Type size={13} /> Subtitles
                        </button>
                    </div>
                </div>

                {/* Tab Content Body (Scrollable) */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">

                    {/* TAB 1: STYLES & PRESETS */}
                    {activeTab === 'styles' && (
                        <div className="space-y-6">
                            {/* Caption Language */}
                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1 mb-2 flex items-center gap-1.5">
                                    <Globe size={13} className="text-blue-400" /> Caption Language
                                </label>
                                <div className="relative">
                                    <select
                                        value={captionLanguage}
                                        onChange={(e) => {
                                            const newLang = e.target.value
                                            setCaptionLanguage(newLang)
                                            if (captions.length > 0) {
                                                generateCaptions(newLang)
                                            }
                                        }}
                                        className="w-full bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl py-3 pl-4 pr-10 text-xs font-bold text-white outline-none focus:border-blue-500 transition-all cursor-pointer appearance-none"
                                    >
                                        {CAPTION_LANGUAGES.map((lang) => (
                                            <option key={lang.value} value={lang.value} className="bg-slate-900 text-white">
                                                {lang.flag} {lang.label}
                                            </option>
                                        ))}
                                    </select>
                                    <Languages size={15} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                </div>
                            </div>

                            {/* Preset Themes Grid */}
                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1 mb-3 block">
                                    Viral Subtitle Presets (8 Styles)
                                </label>
                                <div className="grid grid-cols-2 gap-3">
                                    {Object.entries(SUBTITLE_THEMES).map(([themeKey, themeData]) => {
                                        const isSelected = selectedTheme === themeKey
                                        return (
                                            <button
                                                key={themeKey}
                                                onClick={() => handleSelectTheme(themeKey)}
                                                className={`p-3.5 rounded-2xl border-2 transition-all text-left group relative overflow-hidden ${isSelected ? 'border-blue-500 bg-blue-500/10 shadow-lg shadow-blue-500/10' : 'border-white/5 bg-white/5 hover:bg-white/10'}`}
                                            >
                                                {isSelected && (
                                                    <div className="absolute top-2 right-2 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
                                                        <Check size={10} className="text-white" />
                                                    </div>
                                                )}
                                                <p className={`font-extrabold text-xs capitalize ${isSelected ? 'text-blue-400' : 'text-slate-200'}`}>
                                                    {themeKey.replace(/([A-Z])/g, ' $1')}
                                                </p>
                                                <div className="flex items-center gap-1.5 mt-2.5">
                                                    <div 
                                                        className="w-4 h-4 rounded-full border border-white/20 shadow-sm" 
                                                        style={{ backgroundColor: themeData.highlightColor }} 
                                                        title="Highlight Color"
                                                    />
                                                    <div 
                                                        className="w-4 h-4 rounded-full border border-white/20 shadow-sm" 
                                                        style={{ backgroundColor: themeData.secondaryHighlightColor || themeData.color }} 
                                                        title="Secondary Color"
                                                    />
                                                    <span className="text-[10px] text-slate-400 font-mono capitalize ml-1">
                                                        {themeData.animation}
                                                    </span>
                                                </div>
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* TAB 2: ANIMATIONS */}
                    {activeTab === 'animations' && (
                        <div className="space-y-4">
                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1 mb-2 block">
                                    Select Caption Animation
                                </label>
                                <p className="text-xs text-slate-400 ml-1 mb-4 leading-relaxed">
                                    Control how subtitle words animate onto the screen in synchronization with speech tempo.
                                </p>
                            </div>

                            <div className="space-y-2.5">
                                {ANIMATION_OPTIONS.map((anim) => {
                                    const isSelected = themeConfig.animation === anim.id
                                    return (
                                        <button
                                            key={anim.id}
                                            onClick={() => updateTheme({ animation: anim.id })}
                                            className={`w-full p-4 rounded-2xl border-2 transition-all flex items-center justify-between text-left group ${isSelected ? 'border-blue-500 bg-blue-500/10 shadow-lg shadow-blue-500/10' : 'border-white/5 bg-white/5 hover:bg-white/10'}`}
                                        >
                                            <div className="flex items-center gap-3.5">
                                                <span className="text-2xl p-2 bg-white/5 rounded-xl border border-white/5">
                                                    {anim.icon}
                                                </span>
                                                <div>
                                                    <p className={`font-black text-sm ${isSelected ? 'text-blue-400' : 'text-white'}`}>
                                                        {anim.label}
                                                    </p>
                                                    <p className="text-xs text-slate-400 mt-0.5">
                                                        {anim.description}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${isSelected ? 'border-blue-500 bg-blue-500' : 'border-slate-700'}`}>
                                                {isSelected && <Check size={12} className="text-white" />}
                                            </div>
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                    )}

                    {/* TAB 3: CUSTOM ADJUSTMENTS */}
                    {activeTab === 'custom' && (
                        <div className="space-y-6">
                            {/* Position */}
                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1 mb-2.5 block">
                                    Vertical Position
                                </label>
                                <div className="grid grid-cols-3 gap-2">
                                    {(['top', 'center', 'bottom'] as const).map((pos) => (
                                        <button
                                            key={pos}
                                            onClick={() => updateTheme({ position: pos })}
                                            className={`py-2.5 rounded-xl border font-extrabold text-xs capitalize transition-all ${themeConfig.position === pos ? 'border-blue-500 bg-blue-500/20 text-blue-400' : 'border-white/5 bg-white/5 text-slate-400 hover:text-white'}`}
                                        >
                                            {pos}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Fine-tune Vertical Offset Slider */}
                            <div>
                                <div className="flex justify-between items-center mb-2">
                                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">
                                        Position Fine-Tune (Nudge Y)
                                    </label>
                                    <span className="text-xs font-mono font-bold text-blue-400">
                                        {themeConfig.verticalOffset || 0}px
                                    </span>
                                </div>
                                <input
                                    type="range"
                                    min="-180"
                                    max="180"
                                    step="5"
                                    value={themeConfig.verticalOffset || 0}
                                    onChange={(e) => updateTheme({ verticalOffset: parseInt(e.target.value) })}
                                    className="w-full accent-blue-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                                />
                            </div>

                            {/* Font Size Slider */}
                            <div>
                                <div className="flex justify-between items-center mb-2">
                                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">
                                        Font Size
                                    </label>
                                    <span className="text-xs font-mono font-bold text-blue-400">
                                        {themeConfig.fontSize || 88}px
                                    </span>
                                </div>
                                <input
                                    type="range"
                                    min="56"
                                    max="120"
                                    step="2"
                                    value={themeConfig.fontSize || 88}
                                    onChange={(e) => updateTheme({ fontSize: parseInt(e.target.value) })}
                                    className="w-full accent-blue-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                                />
                            </div>

                            {/* Highlight Accent Colors */}
                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1 mb-2.5 block">
                                    Viral Highlight Color
                                </label>
                                <div className="flex flex-wrap gap-2.5">
                                    {COLOR_SWATCHES.map((color) => (
                                        <button
                                            key={color}
                                            onClick={() => updateTheme({ highlightColor: color })}
                                            className={`w-9 h-9 rounded-xl border-2 transition-transform active:scale-90 flex items-center justify-center shadow-md ${themeConfig.highlightColor === color ? 'border-white scale-110' : 'border-transparent hover:scale-105'}`}
                                            style={{ backgroundColor: color }}
                                        >
                                            {themeConfig.highlightColor === color && (
                                                <Check size={14} className={color === '#FFFFFF' || color === '#FFE600' ? 'text-black' : 'text-white'} />
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Secondary Highlight Color */}
                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1 mb-2.5 block">
                                    Secondary Accent Color
                                </label>
                                <div className="flex flex-wrap gap-2.5">
                                    {COLOR_SWATCHES.map((color) => (
                                        <button
                                            key={color}
                                            onClick={() => updateTheme({ secondaryHighlightColor: color })}
                                            className={`w-9 h-9 rounded-xl border-2 transition-transform active:scale-90 flex items-center justify-center shadow-md ${(themeConfig.secondaryHighlightColor || '#39FF14') === color ? 'border-white scale-110' : 'border-transparent hover:scale-105'}`}
                                            style={{ backgroundColor: color }}
                                        >
                                            {(themeConfig.secondaryHighlightColor || '#39FF14') === color && (
                                                <Check size={14} className={color === '#FFFFFF' || color === '#FFE600' ? 'text-black' : 'text-white'} />
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Container Box Style */}
                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1 mb-2.5 block">
                                    Background Box / Badge
                                </label>
                                <div className="grid grid-cols-4 gap-2">
                                    {(['none', 'shadow', 'badge', 'glass'] as const).map((box) => (
                                        <button
                                            key={box}
                                            onClick={() => updateTheme({ boxStyle: box })}
                                            className={`py-2 rounded-xl border font-bold text-xs capitalize transition-all ${(themeConfig.boxStyle || 'none') === box ? 'border-blue-500 bg-blue-500/20 text-blue-400' : 'border-white/5 bg-white/5 text-slate-400 hover:text-white'}`}
                                        >
                                            {box}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Glow Toggle */}
                            <div className="flex items-center justify-between p-3 bg-white/5 border border-white/5 rounded-2xl">
                                <div>
                                    <p className="text-xs font-bold text-white">Neon Glow Shadow</p>
                                    <p className="text-[11px] text-slate-400">Radiant luminous back-glow behind words</p>
                                </div>
                                <button
                                    onClick={() => updateTheme({ glow: !themeConfig.glow })}
                                    className={`w-12 h-6 rounded-full transition-colors p-1 flex items-center ${themeConfig.glow ? 'bg-blue-600 justify-end' : 'bg-slate-800 justify-start'}`}
                                >
                                    <div className="w-4 h-4 rounded-full bg-white shadow-sm" />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* TAB 4: SUBTITLES & TIMINGS */}
                    {activeTab === 'subtitles' && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                                        Subtitle Timeline ({captions.length})
                                    </p>
                                    <p className="text-[11px] text-slate-500">Edit words and fine-tune start/end seconds</p>
                                </div>
                                <button
                                    onClick={addCaption}
                                    className="text-xs font-bold text-blue-400 hover:text-blue-300 flex items-center gap-1.5 bg-blue-500/10 hover:bg-blue-500/20 px-3 py-1.5 rounded-xl border border-blue-500/20 transition-all"
                                >
                                    <Plus size={13} /> Add Subtitle
                                </button>
                            </div>

                            {/* Caption List */}
                            <div className="space-y-2.5">
                                {captions.map((caption, i) => (
                                    <div 
                                        key={i} 
                                        className="bg-white/5 hover:bg-white/[0.07] border border-white/10 rounded-2xl p-3.5 space-y-2 transition-all"
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            {/* Timestamp Inputs */}
                                            <div className="flex items-center gap-1 text-xs">
                                                <span className="text-slate-500 font-bold">Start:</span>
                                                <input
                                                    type="number"
                                                    step="0.05"
                                                    value={caption.start}
                                                    onChange={(e) => updateCaption(i, { start: parseFloat(e.target.value) || 0 })}
                                                    className="w-16 bg-black/40 border border-white/10 rounded-lg px-2 py-0.5 text-xs font-mono font-bold text-slate-200 text-center outline-none focus:border-blue-500"
                                                />
                                                <span className="text-slate-500 font-bold ml-1">End:</span>
                                                <input
                                                    type="number"
                                                    step="0.05"
                                                    value={caption.end}
                                                    onChange={(e) => updateCaption(i, { end: parseFloat(e.target.value) || 0 })}
                                                    className="w-16 bg-black/40 border border-white/10 rounded-lg px-2 py-0.5 text-xs font-mono font-bold text-slate-200 text-center outline-none focus:border-blue-500"
                                                />
                                                <span className="text-[10px] text-slate-500 font-mono">s</span>
                                            </div>

                                            {/* Actions */}
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={() => updateCaption(i, { emphasis: !caption.emphasis })}
                                                    title={caption.emphasis ? 'Emphasized' : 'Normal'}
                                                    className={`p-1.5 rounded-lg transition-colors ${caption.emphasis ? 'text-yellow-400 bg-yellow-400/10' : 'text-slate-600 hover:text-slate-400'}`}
                                                >
                                                    <Sparkles size={14} />
                                                </button>
                                                <button
                                                    onClick={() => deleteCaption(i)}
                                                    title="Delete subtitle"
                                                    className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 transition-colors"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>

                                        {/* Subtitle Text Input */}
                                        <textarea
                                            value={caption.text}
                                            onChange={(e) => updateCaption(i, { text: e.target.value })}
                                            rows={2}
                                            className="w-full bg-black/30 border border-white/5 rounded-xl p-2 text-sm font-semibold resize-none outline-none focus:border-blue-500 text-white transition-colors"
                                        />
                                    </div>
                                ))}

                                {captions.length === 0 && (
                                    <div className="text-center py-12 border-2 border-dashed border-white/5 rounded-2xl px-4 space-y-3">
                                        <Type size={32} className="mx-auto text-slate-600" />
                                        <p className="text-slate-400 text-sm font-bold">No subtitles generated yet</p>
                                        <button
                                            onClick={() => generateCaptions()}
                                            disabled={isGenerating}
                                            className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs px-4 py-2 rounded-xl transition-all"
                                        >
                                            Generate AI Captions Now
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Action Export */}
                <div className="p-6 border-t border-white/10 bg-slate-950/90 backdrop-blur-xl shrink-0">
                    <button
                        onClick={startRender}
                        disabled={isRendering || captions.length === 0}
                        className="w-full bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 p-4.5 py-4 rounded-2xl font-black text-base flex items-center justify-center gap-3 transition-all shadow-xl shadow-blue-600/20 disabled:opacity-50 active:scale-[0.98]"
                    >
                        {isRendering ? <Loader2 size={22} className="animate-spin" /> : <Download size={22} />}
                        {isRendering ? 'Rendering Video...' : 'Export Final Rendered Video'}
                    </button>
                    <p className="text-center text-[10px] text-slate-500 mt-2.5 font-bold uppercase tracking-widest">
                        High-Speed Cloud Rendering (~2-3 minutes)
                    </p>
                </div>

            </div>
        </div>
    )
}
