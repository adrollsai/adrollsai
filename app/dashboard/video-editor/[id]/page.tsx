'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Player } from '@remotion/player'
import { CaptionsComposition, Caption, Effect, Theme } from '@/remotion/CaptionsComposition'
import { SUBTITLE_THEMES } from '@/remotion/Constants'
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
    History
} from 'lucide-react'
import { toast } from 'sonner'

export default function VideoEditorPage() {
    const { id } = useParams()
    const router = useRouter()
    const searchParams = useSearchParams()
    const impersonate = searchParams?.get('impersonate')
    const supabase = createClient()

    const [loading, setLoading] = useState(true)
    const [asset, setAsset] = useState<any>(null)
    const [captions, setCaptions] = useState<Caption[]>([])
    const [effects, setEffects] = useState<Effect[]>([])
    const [profile, setProfile] = useState<any>(null)
    const [selectedTheme, setSelectedTheme] = useState<string>('hormozi')
    const [isGenerating, setIsGenerating] = useState(false)
    const [isRendering, setIsRendering] = useState(false)
    const [durationInFrames, setDurationInFrames] = useState<number>(30 * 30) // fallback default

    // Player controls
    const playerRef = useRef<any>(null)

    useEffect(() => {
        const fetchAssetAndProfile = async () => {
            setLoading(true)
            
            // 1. Fetch Asset
            const { data: assetData, error: assetError } = await supabase
                .from('assets')
                .select('*')
                .eq('id', id)
                .single()

            if (assetError || !assetData) {
                toast.error("Failed to load video asset")
                router.push('/dashboard/assets')
                return
            }

            setAsset(assetData)
            if (assetData.metadata?.captions) {
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
                const video = document.createElement('video')
                video.src = assetData.url
                video.addEventListener('loadedmetadata', () => {
                    const videoDuration = video.duration
                    // add 4 seconds for the outro (4 * 30fps = 120 frames)
                    setDurationInFrames(Math.ceil(videoDuration * 30) + 120)
                })
            }

            setLoading(false)
        }

        fetchAssetAndProfile()
    }, [id])

    const generateCaptions = async () => {
        if (!asset) return
        setIsGenerating(true)
        try {
            const res = await fetch('/api/video/captions/generate', {
                method: 'POST',
                body: JSON.stringify({ videoUrl: asset.url, assetId: asset.id })
            })
            const data = await res.json()
            if (data.success) {
                setCaptions(data.captions)
                setEffects(data.effects || [])
                toast.success("Captions generated successfully!")
            } else {
                throw new Error(data.error)
            }
        } catch (e: any) {
            toast.error("Generation failed: " + e.message)
        } finally {
            setIsGenerating(false)
        }
    }

    const startRender = async () => {
        setIsRendering(true)
        try {
            // This will trigger the Remotion render on the server
            const res = await fetch('/api/video/render', {
                method: 'POST',
                body: JSON.stringify({
                    assetId: asset.id,
                    theme: SUBTITLE_THEMES[selectedTheme],
                    videoUrl: asset.url,
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

    return (
        <div className="min-h-screen bg-slate-950 text-white flex flex-col md:flex-row overflow-y-auto">

            {/* LEFT SIDE - PREVIEW */}
            <div className="flex-1 relative flex flex-col items-center justify-center p-4 sm:p-8 bg-slate-900/50">

                <button
                    onClick={() => router.back()}
                    className="absolute top-6 left-6 z-20 bg-white/10 hover:bg-white/20 p-2 rounded-full backdrop-blur-md transition-all"
                >
                    <ChevronLeft size={24} />
                </button>

                <div className="w-full max-w-[400px] aspect-[9/16] bg-black rounded-[2rem] overflow-hidden shadow-2xl shadow-blue-500/10 border border-white/10 relative group">
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
                            videoUrl: asset.url,
                            captions: captions,
                            effects: effects,
                            theme: SUBTITLE_THEMES[selectedTheme],
                            profile: profile
                        }}
                    />
                </div>

                <div className="mt-8 flex gap-4">
                    <button className="bg-white/5 hover:bg-white/10 p-4 rounded-2xl transition-all border border-white/5">
                        <History size={20} className="text-slate-400" />
                    </button>
                    <button
                        onClick={generateCaptions}
                        disabled={isGenerating}
                        className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 px-8 py-4 rounded-2xl font-black flex items-center gap-2 transition-all shadow-lg shadow-blue-600/20 disabled:opacity-50 active:scale-95"
                    >
                        {isGenerating ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                        {captions.length > 0 ? 'Re-run AI Edit' : 'AI EDIT'}
                    </button>
                </div>

                {/* MASSIVE SPACER FOR MOBILE */}
                <div className="h-64 sm:hidden" />
            </div>

            {/* RIGHT SIDE - CONTROLS */}
            <div className="w-full md:w-[400px] bg-slate-950 border-l border-white/10 flex flex-col overflow-y-auto custom-scrollbar">

                <div className="p-8">
                    <h2 className="text-2xl font-bold mb-1 flex items-center gap-2">
                        <Sparkles className="text-blue-500 animate-pulse" /> AI Video Editor
                    </h2>
                    <p className="text-slate-400 text-sm mb-8">Let AI edit your video automatically</p>

                    {/* Theme Selector */}
                    <div className="space-y-6">
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1 mb-3 block">AI Editing Styles</label>
                            <div className="grid grid-cols-2 gap-3">
                                {Object.keys(SUBTITLE_THEMES).map((themeKey) => (
                                    <button
                                        key={themeKey}
                                        onClick={() => setSelectedTheme(themeKey)}
                                        className={`p-4 rounded-2xl border-2 transition-all text-left group ${selectedTheme === themeKey ? 'border-blue-600 bg-blue-600/10' : 'border-white/5 bg-white/5 hover:bg-white/10'}`}
                                    >
                                        <p className={`font-bold capitalize ${selectedTheme === themeKey ? 'text-blue-400' : 'text-slate-300'}`}>{themeKey.replace(/([A-Z])/g, ' $1')}</p>
                                        <div className="flex gap-1 mt-2">
                                            <div className="w-3 h-3 rounded-full bg-white opacity-20 group-hover:opacity-40" />
                                            <div className="w-3 h-3 rounded-full bg-white opacity-10 group-hover:opacity-20" />
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Caption Editor List */}
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1 mb-3 block">Adjust AI Subtitles</label>
                            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                                {captions.map((caption, i) => (
                                    <div key={i} className="bg-white/5 border border-white/5 rounded-xl p-3 flex gap-3">
                                        <div className="text-[10px] text-slate-500 font-mono mt-1 w-12 shrink-0">
                                            {caption.start.toFixed(1)}s
                                        </div>
                                        <textarea
                                            value={caption.text}
                                            onChange={(e) => {
                                                const newCaptions = [...captions]
                                                newCaptions[i].text = e.target.value
                                                setCaptions(newCaptions)
                                            }}
                                            rows={1}
                                            className="flex-1 bg-transparent border-none outline-none text-sm font-medium resize-none focus:text-blue-400 transition-colors"
                                        />
                                        <button
                                            onClick={() => {
                                                const newCaptions = [...captions]
                                                newCaptions[i].emphasis = !newCaptions[i].emphasis
                                                setCaptions(newCaptions)
                                            }}
                                            className={`p-1.5 rounded-lg transition-colors ${caption.emphasis ? 'text-yellow-400 bg-yellow-400/10' : 'text-slate-600 hover:text-slate-400'}`}
                                        >
                                            <Sparkles size={14} />
                                        </button>
                                    </div>
                                ))}
                                {captions.length === 0 && (
                                    <div className="text-center py-12 border-2 border-dashed border-white/5 rounded-2xl px-4">
                                        <p className="text-slate-500 text-sm">Click "AI EDIT" to start automated editing</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer Action */}
                <div className="mt-auto p-8 pb-40 sm:pb-8 border-t border-white/10 bg-slate-950/80 backdrop-blur-xl">
                    <button
                        onClick={startRender}
                        disabled={isRendering || captions.length === 0}
                        className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 p-5 rounded-[1.5rem] font-black text-lg flex items-center justify-center gap-3 transition-all shadow-xl shadow-blue-600/20 disabled:opacity-50 active:scale-[0.98]"
                    >
                        {isRendering ? <Loader2 size={24} className="animate-spin" /> : <Download size={24} />}
                        {isRendering ? 'Rendering Video...' : 'Export Final Video'}
                    </button>
                    <p className="text-center text-[10px] text-slate-500 mt-4 font-bold uppercase tracking-widest">Render takes ~2-3 minutes</p>
                </div>

                {/* MASSIVE SPACER FOR MOBILE */}
                <div className="h-64 sm:hidden" />
            </div>
        </div>
    )
}
