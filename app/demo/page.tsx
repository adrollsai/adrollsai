'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Sparkles,
    Building2,
    Upload,
    ArrowRight,
    CheckCircle2,
    Loader2,
    Phone,
    MapPin,
    MessageCircle,
    Zap,
    Play,
    Pause,
    Volume2,
    Share2,
    ExternalLink,
    AlertCircle,
    TrendingUp,
    ShieldCheck,
    Calendar,
    Clock,
    UserCheck,
    RefreshCw,
    Download,
    Eye,
    ChevronRight,
    Send,
    Bot,
    Megaphone,
    Layers,
    Award,
    Video,
    Film
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { toast } from 'sonner';

type DemoStep = 
    | 'onboarding'
    | 'generating_creatives'
    | 'creatives_preview'
    | 'launch_campaign'
    | 'lead_captured'
    | 'ai_calling'
    | 'appointment_booked';

interface GeneratedCreative {
    id: string;
    name: string;
    styleName: string;
    aspectRatio: '3:4';
    imageUrl: string;
    headline: string;
    primaryText: string;
    ctaText: string;
}

interface GeneratedVideo {
    id: string;
    title: string;
    videoUrl: string;
    aspectRatio: '9:16';
    duration: number;
    taskId?: string;
}

const PRESET_PROJECTS = [
    {
        name: 'Amritha Vana Luxury Farm Retreats',
        company: 'Bioque Estates International',
        price: '₹49.5 Lakhs (Launch Offer)',
        location: 'Mysore-Madikeri Corridor, Bangalore',
        desc: '6,000 Sq.Ft Managed Farmlands with Luxury Glamping Dome, organic teakwood plantations, resort club, and 24x7 security.',
        image: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1400&q=80',
        logo: 'https://hpssqssdewmkmafxlfud.supabase.co/storage/v1/object/public/logos/bioque_logo.png'
    },
    {
        name: 'The Royal Palm Sky Mansions',
        company: 'Apex Luxury Developments',
        price: 'Starting ₹2.45 Cr',
        location: 'Sector 82, Mohali Luxury Belt',
        desc: 'Exclusive 4BHK Sky Mansions featuring private infinity plunge pool, double-height ceilings, and panoramic golf course views.',
        image: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1400&q=80',
        logo: ''
    }
];

export default function DemoPage() {
    const [step, setStep] = useState<DemoStep>('onboarding');

    // Onboarding Form States
    const [companyName, setCompanyName] = useState('Bioque Estates');
    const [projectTitle, setProjectTitle] = useState('Amritha Vana Luxury Farm Retreats');
    const [projectPrice, setProjectPrice] = useState('₹49.5 Lakhs (Launch Offer)');
    const [location, setLocation] = useState('Mysore Highway, Bangalore');
    const [projectDescription, setProjectDescription] = useState('6,000 Sq.Ft Managed Farmlands with Luxury Glamping Dome, organic orchards, resort club access, and immediate registration.');
    const [prospectName, setProspectName] = useState('Raman');
    const [prospectPhone, setProspectPhone] = useState('');
    const [language, setLanguage] = useState<'hinglish' | 'english'>('hinglish');
    const [voiceName, setVoiceName] = useState('Kore');
    const [websiteUrl, setWebsiteUrl] = useState('');
    const [extractingWebsite, setExtractingWebsite] = useState(false);

    // Media states
    const [projectImageUrl, setProjectImageUrl] = useState('https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1400&q=80');
    const [logoUrl, setLogoUrl] = useState('');
    const [uploadingImage, setUploadingImage] = useState(false);
    const [uploadingLogo, setUploadingLogo] = useState(false);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const logoInputRef = useRef<HTMLInputElement>(null);

    // Creative Generation States
    const [isGenerating, setIsGenerating] = useState(false);
    const [generationStage, setGenerationStage] = useState(0);
    const [creatives, setCreatives] = useState<GeneratedCreative[]>([]);
    const [generatedVideo, setGeneratedVideo] = useState<GeneratedVideo | null>({
        id: 'demo-video-15s',
        title: '15-Second Cinematic Meta Reel',
        videoUrl: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/demo-creatives/demo_15s_video_1792609681089.mp4',
        aspectRatio: '9:16',
        duration: 15
    });
    const [activeMediaTab, setActiveMediaTab] = useState<'creatives' | 'video'>('creatives');
    const [selectedCreativeIndex, setSelectedCreativeIndex] = useState(0);
    const [adCopy, setAdCopy] = useState({
        headline: '',
        primaryText: '',
        callToAction: ''
    });

    // Campaign Telemetry States
    const [campaignImpressions, setCampaignImpressions] = useState(1280);
    const [campaignClicks, setCampaignClicks] = useState(48);
    const [isCampaignRunning, setIsCampaignRunning] = useState(false);

    // WhatsApp Dispatch States
    const [isSendingWhatsApp, setIsSendingWhatsApp] = useState(false);
    const [whatsappMessageId, setWhatsappMessageId] = useState<string | null>(null);
    const [whatsappDelivered, setWhatsappDelivered] = useState(false);

    // Appointment WhatsApp Dispatch States
    const [appointmentWhatsappSent, setAppointmentWhatsappSent] = useState(false);
    const [appointmentMessageId, setAppointmentMessageId] = useState<string | null>(null);

    // AI Voice Call States
    const [isDialingCall, setIsDialingCall] = useState(false);
    const [callLeadId, setCallLeadId] = useState<string | null>(null);
    const [callStatus, setCallStatus] = useState<string>('idle');
    const [callTimer, setCallTimer] = useState(0);
    const [callSummary, setCallSummary] = useState<string | null>(null);
    const [callerNumber, setCallerNumber] = useState('+917965480539');

    // Audio chime helper
    const playChime = (type: 'beep' | 'success' | 'call') => {
        try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);

            if (type === 'beep') {
                osc.frequency.setValueAtTime(440, ctx.currentTime);
                gain.gain.setValueAtTime(0.08, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
                osc.start();
                osc.stop(ctx.currentTime + 0.15);
            } else if (type === 'success') {
                osc.frequency.setValueAtTime(523.25, ctx.currentTime);
                osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.12);
                osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.24);
                gain.gain.setValueAtTime(0.12, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
                osc.start();
                osc.stop(ctx.currentTime + 0.5);
            } else if (type === 'call') {
                osc.frequency.setValueAtTime(400, ctx.currentTime);
                osc.frequency.setValueAtTime(450, ctx.currentTime + 0.2);
                gain.gain.setValueAtTime(0.08, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
                osc.start();
                osc.stop(ctx.currentTime + 0.4);
            }
        } catch {}
    };

    // Website extraction handler
    const handleExtractWebsite = async () => {
        if (!websiteUrl.trim()) {
            toast.error("Please enter a website URL to extract info.");
            return;
        }

        setExtractingWebsite(true);
        toast.info("Extracting brand colors, logo, and project info from website...");

        try {
            const res = await fetch('/api/onboarding/extract-website', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ website: websiteUrl })
            });

            const data = await res.json();
            if (res.ok && data) {
                if (data.companyName) setCompanyName(data.companyName);
                if (data.projectTitle || data.productName) setProjectTitle(data.projectTitle || data.productName);
                if (data.description) setProjectDescription(data.description);
                if (data.price) setProjectPrice(data.price);
                if (data.logoUrl) setLogoUrl(data.logoUrl);
                if (data.imageUrl) setProjectImageUrl(data.imageUrl);
                playChime('success');
                toast.success("✨ Project details extracted automatically from website!");
            } else {
                toast.error(data.error || "Could not auto-extract details. Using default values.");
            }
        } catch (e: any) {
            toast.error("Extraction error: " + (e.message || "Failed"));
        } finally {
            setExtractingWebsite(false);
        }
    };

    // Preset selector
    const handleSelectPreset = (preset: typeof PRESET_PROJECTS[0]) => {
        setProjectTitle(preset.name);
        setCompanyName(preset.company);
        setProjectPrice(preset.price);
        setLocation(preset.location);
        setProjectDescription(preset.desc);
        setProjectImageUrl(preset.image);
        if (preset.logo) setLogoUrl(preset.logo);
        playChime('beep');
        toast.info(`Loaded preset: ${preset.name}`);
    };

    // Image upload handler
    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploadingImage(true);
        toast.info("Uploading project image to Cloudflare R2...");

        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('folder', 'demo-projects');

            const res = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            const data = await res.json();
            if (res.ok && data.url) {
                setProjectImageUrl(data.url);
                playChime('success');
                toast.success("Project image uploaded successfully!");
            } else {
                const reader = new FileReader();
                reader.onloadend = () => {
                    setProjectImageUrl(reader.result as string);
                    toast.success("Image preview loaded!");
                };
                reader.readAsDataURL(file);
            }
        } catch {
            const reader = new FileReader();
            reader.onloadend = () => {
                setProjectImageUrl(reader.result as string);
                toast.success("Image preview loaded!");
            };
            reader.readAsDataURL(file);
        } finally {
            setUploadingImage(false);
        }
    };

    // Logo upload handler
    const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploadingLogo(true);
        try {
            const reader = new FileReader();
            reader.onloadend = () => {
                setLogoUrl(reader.result as string);
                playChime('success');
                toast.success("Logo uploaded!");
                setUploadingLogo(false);
            };
            reader.readAsDataURL(file);
        } catch {
            setUploadingLogo(false);
        }
    };

    // =========================================================================
    // STEP 1 -> STEP 2: TRIGGER GPT 2.0 CREATIVE + 15S VIDEO GENERATION
    // =========================================================================
    const handleStartCreativeGeneration = async () => {
        if (!companyName.trim() || !projectTitle.trim()) {
            toast.error("Please provide both Company Name and Project Title.");
            return;
        }

        if (!prospectPhone.trim() || prospectPhone.replace(/\D/g, '').length < 10) {
            toast.error("Please enter a valid 10-digit Indian phone number so you can receive the test AI call and WhatsApp message.");
            return;
        }

        setStep('generating_creatives');
        setIsGenerating(true);
        setGenerationStage(1);
        playChime('beep');

        // Progress stage simulation ticks
        const stageInterval = setInterval(() => {
            setGenerationStage(prev => {
                if (prev < 4) return prev + 1;
                return prev;
            });
        }, 1800);

        try {
            const res = await fetch('/api/demo/generate-creatives', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    companyName,
                    projectTitle,
                    projectDescription,
                    projectPrice,
                    location,
                    logoUrl,
                    projectImageUrl,
                    prospectName,
                    contactNumber: prospectPhone
                })
            });

            clearInterval(stageInterval);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to generate creatives");

            setCreatives(data.creatives || []);
            if (data.video) {
                setGeneratedVideo(data.video);
            }
            setAdCopy(data.adCopy || {
                headline: `Limited Launch: ${projectTitle}`,
                primaryText: `${projectDescription} in ${location}.`,
                callToAction: 'Book VIP Site Visit'
            });

            setGenerationStage(4);
            setIsGenerating(false);
            setStep('creatives_preview');
            playChime('success');
            toast.success("🎨 2 Real GPT 2.0 3:4 Creatives & 15-Sec Grok Video Reel generated!");

        } catch (err: any) {
            clearInterval(stageInterval);
            console.error("Creative generation failed:", err);
            toast.error(err.message || "Failed to generate creatives. Please try again.");
            setStep('onboarding');
            setIsGenerating(false);
        }
    };

    // =========================================================================
    // STEP 2 -> STEP 3: LAUNCH META AD CAMPAIGN SIMULATION
    // =========================================================================
    const handleLaunchCampaign = () => {
        setStep('launch_campaign');
        setIsCampaignRunning(true);
        playChime('beep');

        // Increment telemetry counters
        const interval = setInterval(() => {
            setCampaignImpressions(prev => prev + Math.floor(Math.random() * 14) + 6);
            setCampaignClicks(prev => prev + (Math.random() > 0.6 ? 1 : 0));
        }, 300);

        // After 4.5 seconds, simulate real lead submission and trigger WhatsApp
        setTimeout(() => {
            clearInterval(interval);
            triggerLeadCaptureAndWhatsApp();
        }, 4500);
    };

    // =========================================================================
    // STEP 3 -> STEP 4: TRIGGER REAL WHATSAPP MESSAGE FROM NOBOGENT NUMBER
    // =========================================================================
    const triggerLeadCaptureAndWhatsApp = async () => {
        setStep('lead_captured');
        setIsSendingWhatsApp(true);
        playChime('beep');

        try {
            const res = await fetch('/api/demo/send-whatsapp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prospectPhone,
                    prospectName,
                    companyName,
                    projectTitle,
                    type: 'lead_welcome'
                })
            });

            const data = await res.json();
            if (res.ok && data.success) {
                setWhatsappMessageId(data.messageId);
                setWhatsappDelivered(true);
                playChime('success');
                toast.success(`📲 Real WhatsApp message sent to +91 ${prospectPhone.slice(-10)}!`);
            } else {
                console.warn("WhatsApp send response:", data);
                toast.info("Lead captured! Proceeding to AI outbound call...");
            }
        } catch (e: any) {
            console.warn("WhatsApp error:", e);
        } finally {
            setIsSendingWhatsApp(false);
        }
    };

    // =========================================================================
    // STEP 4 -> STEP 5: TRIGGER REAL LIVE AI OUTBOUND CALL VIA VOBIZ
    // =========================================================================
    const handleTriggerLiveCall = async () => {
        setStep('ai_calling');
        setIsDialingCall(true);
        setCallStatus('dialing');
        playChime('call');

        try {
            const res = await fetch('/api/demo/trigger-call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prospectPhone,
                    prospectName,
                    companyName,
                    projectTitle,
                    projectDescription,
                    projectPrice,
                    location,
                    language,
                    voiceName
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to trigger AI call");

            setCallLeadId(data.leadId);
            if (data.callerNumber) setCallerNumber(data.callerNumber);
            setCallStatus('ringing');
            toast.success(`📞 Outbound AI Call dialing to ${prospectPhone}! Answer your phone to speak with the AI.`);

        } catch (err: any) {
            console.error("AI Call trigger failed:", err);
            toast.error(err.message || "Failed to dial phone number.");
            setCallStatus('error');
        } finally {
            setIsDialingCall(false);
        }
    };

    // Timer for active call
    useEffect(() => {
        let timer: any = null;
        if (callStatus === 'in_call' || callStatus === 'ringing') {
            timer = setInterval(() => {
                setCallTimer(prev => prev + 1);
            }, 1000);
        }
        return () => clearInterval(timer);
    }, [callStatus]);

    // Poll live lead status & auto-detect appointment booking
    useEffect(() => {
        if (!callLeadId || step !== 'ai_calling') return;

        const interval = setInterval(async () => {
            try {
                const res = await fetch(`/api/demo/lead-status?leadId=${callLeadId}`);
                if (!res.ok) return;
                const data = await res.json();

                if (data.status === 'in_call' || data.status === 'calling') {
                    if (callStatus !== 'in_call') setCallStatus('in_call');
                }

                if (data.summary) {
                    setCallSummary(data.summary);
                }

                if (data.isAppointmentBooked) {
                    clearInterval(interval);
                    triggerAppointmentBookedCelebration();
                }
            } catch {}
        }, 3000);

        return () => clearInterval(interval);
    }, [callLeadId, step, callStatus]);

    // =========================================================================
    // STEP 6: CELEBRATION APPOINTMENT BOOKED & DISPATCH REAL WHATSAPP CONFIRMATION
    // =========================================================================
    const triggerAppointmentBookedCelebration = () => {
        setStep('appointment_booked');
        playChime('success');

        // Confetti burst
        confetti({
            particleCount: 120,
            spread: 90,
            origin: { y: 0.6 }
        });

        setTimeout(() => {
            confetti({
                particleCount: 80,
                angle: 60,
                spread: 70,
                origin: { x: 0.1, y: 0.7 }
            });
            confetti({
                particleCount: 80,
                angle: 120,
                spread: 70,
                origin: { x: 0.9, y: 0.7 }
            });
        }, 400);

        // DISPATCH REAL WHATSAPP APPOINTMENT CONFIRMATION MESSAGE!
        fetch('/api/demo/send-whatsapp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prospectPhone,
                prospectName,
                companyName,
                projectTitle,
                slotTime: 'Tomorrow at 11:30 AM IST',
                callerName: 'Priya (Executive Advisor)',
                type: 'appointment_booked'
            })
        }).then(r => r.json()).then(data => {
            if (data.success) {
                setAppointmentWhatsappSent(true);
                setAppointmentMessageId(data.messageId);
                toast.success(`📲 Real appointment booking confirmation sent to WhatsApp +91 ${prospectPhone.slice(-10)}!`);
            }
        }).catch(err => {
            console.warn("WhatsApp booking confirmation send error:", err);
        });

        toast.success("🎉 APPOINTMENT BOOKED ON CALENDAR! Lead qualified & scheduled.");
    };

    const formatTimer = (sec: number) => {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    return (
        <div className="min-h-screen bg-[#F8FAFC] text-slate-800 flex flex-col justify-between font-sans relative overflow-x-hidden">
            {/* Ambient background glows */}
            <div className="fixed top-[-10%] left-[-10%] w-[55%] h-[55%] rounded-full bg-[#00487c]/6 blur-[140px] pointer-events-none" />
            <div className="fixed bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-[#a81d33]/6 blur-[140px] pointer-events-none" />
            <div className="fixed top-[40%] right-[10%] w-[35%] h-[35%] rounded-full bg-[#e5a92a]/8 blur-[120px] pointer-events-none" />

            {/* TOP HEADER */}
            <header className="w-full max-w-7xl mx-auto px-6 py-5 flex items-center justify-between z-20 border-b border-slate-200/70 bg-white/80 backdrop-blur-md sticky top-0">
                <div className="flex items-center gap-3">
                    <img src="/logo.png" alt="Nobogent" className="h-9 w-auto object-contain" />
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest px-3 py-1 rounded-full bg-blue-50 text-[#00487c] border border-blue-100">
                        <span className="w-2 h-2 rounded-full bg-[#00487c] animate-pulse" />
                        Live Interactive SaaS Demo
                    </span>
                </div>

                <div className="flex items-center gap-4">
                    <div className="hidden sm:flex items-center gap-2 text-xs font-bold text-slate-500">
                        <span>Phase:</span>
                        <span className="text-[#00487c] capitalize font-extrabold">
                            {step.replace('_', ' ')}
                        </span>
                    </div>

                    <a
                        href="/login"
                        className="px-4 py-2 rounded-xl text-xs font-bold text-slate-700 hover:text-slate-900 bg-white border border-slate-200 hover:border-slate-300 shadow-sm transition-all"
                    >
                        Dashboard
                    </a>
                </div>
            </header>

            {/* MILESTONE PROGRESS BAR */}
            <div className="w-full max-w-5xl mx-auto px-4 pt-6 pb-2 z-10">
                <div className="grid grid-cols-6 gap-2 text-center text-[11px] font-bold">
                    {[
                        { key: 'onboarding', label: '1. Onboard', icon: Building2 },
                        { key: 'generating_creatives', label: '2. Creatives & Video', icon: Layers },
                        { key: 'launch_campaign', label: '3. Meta Ads', icon: Megaphone },
                        { key: 'lead_captured', label: '4. WhatsApp', icon: MessageCircle },
                        { key: 'ai_calling', label: '5. AI Call', icon: Phone },
                        { key: 'appointment_booked', label: '6. Booked', icon: Award }
                    ].map((m) => {
                        const stepOrder = ['onboarding', 'generating_creatives', 'creatives_preview', 'launch_campaign', 'lead_captured', 'ai_calling', 'appointment_booked'];
                        const currentIdx = stepOrder.indexOf(step);
                        const milestoneIdx = stepOrder.indexOf(m.key);
                        const isDone = currentIdx > milestoneIdx;
                        const isCurrent = currentIdx === milestoneIdx || (m.key === 'generating_creatives' && step === 'creatives_preview');

                        return (
                            <div key={m.key} className="flex flex-col items-center gap-1.5">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 ${
                                    isDone 
                                        ? 'bg-emerald-600 text-white font-black shadow-md shadow-emerald-600/20' 
                                        : isCurrent 
                                            ? 'bg-gradient-to-r from-[#00487c] to-[#a81d33] text-white font-black shadow-md shadow-blue-900/25 animate-pulse' 
                                            : 'bg-white border border-slate-200 text-slate-400 shadow-sm'
                                }`}>
                                    <m.icon size={14} />
                                </div>
                                <span className={`hidden md:inline ${isCurrent ? 'text-[#00487c] font-black' : isDone ? 'text-emerald-700' : 'text-slate-400'}`}>
                                    {m.label}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* MAIN CONTENT WORKSPACE */}
            <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-8 flex flex-col justify-center z-10">
                <AnimatePresence mode="wait">

                    {/* =========================================================================
                        STEP 1: BRAND ONBOARDING & PRODUCT CONFIG
                    ========================================================================= */}
                    {step === 'onboarding' && (
                        <motion.div
                            key="step-onboarding"
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -15 }}
                            transition={{ duration: 0.3 }}
                            className="bg-white/90 border border-slate-200/90 rounded-3xl p-6 sm:p-10 backdrop-blur-xl shadow-xl shadow-slate-200/50 relative"
                        >
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-100">
                                <div>
                                    <span className="text-xs font-black uppercase tracking-widest text-[#00487c] bg-blue-50 px-3 py-1 rounded-full border border-blue-100">
                                        Step 1 of 6 • Live Prospect Simulator
                                    </span>
                                    <h1 className="text-2xl sm:text-3xl font-black text-slate-900 mt-2">
                                        Onboard Your Project &amp; Experience the Flow
                                    </h1>
                                    <p className="text-sm text-slate-600 mt-1 max-w-xl">
                                        Experience the autonomous pipeline: <strong>2x Real GPT 2.0 3:4 creatives</strong> + <strong>15-sec Grok video</strong>, simulated Meta campaign, speed-to-lead WhatsApp, and an <strong>actual AI outbound phone call</strong> to your mobile!
                                    </p>
                                </div>

                                {/* Preset Shortcuts */}
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Presets:</span>
                                    {PRESET_PROJECTS.map((p, idx) => (
                                        <button
                                            key={idx}
                                            onClick={() => handleSelectPreset(p)}
                                            className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-50 border border-slate-200 hover:border-[#00487c] hover:bg-blue-50/50 text-slate-700 transition-all cursor-pointer"
                                        >
                                            {p.name.split(' ')[0]}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Website auto-extractor strip */}
                            <div className="my-6 p-4 rounded-2xl bg-slate-50/80 border border-slate-200/80 flex flex-col sm:flex-row items-center gap-3">
                                <div className="flex items-center gap-2 text-xs font-bold text-slate-700 shrink-0">
                                    <Sparkles size={16} className="text-[#00487c]" />
                                    <span>Auto-Extract From Website:</span>
                                </div>
                                <div className="flex-1 w-full flex items-center gap-2">
                                    <input
                                        type="url"
                                        value={websiteUrl}
                                        onChange={(e) => setWebsiteUrl(e.target.value)}
                                        placeholder="https://yourdeveloperwebsite.com/project"
                                        className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#00487c]"
                                    />
                                    <button
                                        onClick={handleExtractWebsite}
                                        disabled={extractingWebsite}
                                        className="px-4 py-2 rounded-xl bg-[#00487c] hover:bg-[#003860] text-white text-xs font-bold shrink-0 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                                    >
                                        {extractingWebsite ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                                        <span>Extract</span>
                                    </button>
                                </div>
                            </div>

                            {/* Main Form 2-Column Grid */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Left Column: Project Info */}
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                                            Developer / Brand Name
                                        </label>
                                        <input
                                            type="text"
                                            value={companyName}
                                            onChange={(e) => setCompanyName(e.target.value)}
                                            placeholder="e.g. Bioque Estates International"
                                            className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-[#00487c] focus:bg-white transition-all"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                                            Project Title
                                        </label>
                                        <input
                                            type="text"
                                            value={projectTitle}
                                            onChange={(e) => setProjectTitle(e.target.value)}
                                            placeholder="e.g. Amritha Vana Luxury Farm Retreats"
                                            className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 font-bold focus:outline-none focus:border-[#00487c] focus:bg-white transition-all"
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                                                Price / Offer
                                            </label>
                                            <input
                                                type="text"
                                                value={projectPrice}
                                                onChange={(e) => setProjectPrice(e.target.value)}
                                                placeholder="e.g. ₹49.5 Lakhs"
                                                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 font-semibold focus:outline-none focus:border-[#00487c] focus:bg-white transition-all"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                                                Location
                                            </label>
                                            <input
                                                type="text"
                                                value={location}
                                                onChange={(e) => setLocation(e.target.value)}
                                                placeholder="e.g. Mysore Highway, Bangalore"
                                                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-[#00487c] focus:bg-white transition-all"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                                            Key USPs &amp; Project Description
                                        </label>
                                        <textarea
                                            value={projectDescription}
                                            onChange={(e) => setProjectDescription(e.target.value)}
                                            rows={3}
                                            placeholder="6,000 Sq.Ft Managed Farmlands with Luxury Glamping Dome, resort club..."
                                            className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-[#00487c] focus:bg-white transition-all leading-relaxed"
                                        />
                                    </div>
                                </div>

                                {/* Right Column: Prospect Phone & Visual Assets */}
                                <div className="space-y-4">
                                    <div className="p-4 rounded-2xl bg-blue-50/70 border border-blue-200/80">
                                        <div className="flex items-center gap-2 mb-2 text-[#00487c] font-black text-xs uppercase tracking-wider">
                                            <Phone size={14} />
                                            Destination Phone for Real WhatsApp &amp; AI Call *
                                        </div>
                                        <div className="grid grid-cols-2 gap-3 mb-2">
                                            <div>
                                                <label className="block text-[11px] font-bold text-slate-600 mb-1">Your Name</label>
                                                <input
                                                    type="text"
                                                    value={prospectName}
                                                    onChange={(e) => setProspectName(e.target.value)}
                                                    placeholder="e.g. Raman"
                                                    className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-[#00487c]"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-[11px] font-bold text-slate-600 mb-1">Mobile (+91 Indian)</label>
                                                <input
                                                    type="tel"
                                                    value={prospectPhone}
                                                    onChange={(e) => setProspectPhone(e.target.value)}
                                                    placeholder="98726XXXXX"
                                                    className="w-full px-3 py-2 rounded-lg bg-white border border-blue-300 text-sm text-slate-900 font-bold tracking-wide focus:outline-none focus:ring-2 focus:ring-[#00487c]/20"
                                                />
                                            </div>
                                        </div>
                                        <p className="text-[11px] text-slate-500">
                                            ⚡ The AI will dial this phone and dispatch sample WhatsApp messages so you experience the live speed-to-lead flow!
                                        </p>
                                    </div>

                                    {/* Visual assets selector */}
                                    <div className="grid grid-cols-2 gap-3">
                                        {/* Project Photo */}
                                        <div>
                                            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                                                Project Photo (Optional)
                                            </label>
                                            <div
                                                onClick={() => imageInputRef.current?.click()}
                                                className="h-28 rounded-xl border-2 border-dashed border-slate-300 hover:border-[#00487c] bg-slate-50 flex flex-col items-center justify-center cursor-pointer overflow-hidden relative group transition-all"
                                            >
                                                {projectImageUrl ? (
                                                    <img src={projectImageUrl} alt="Project" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                                                ) : (
                                                    <div className="flex flex-col items-center text-slate-400 text-xs gap-1">
                                                        <Upload size={18} />
                                                        <span>Upload Image</span>
                                                    </div>
                                                )}
                                                <span className="absolute bottom-1 right-1 bg-white/90 text-[10px] text-slate-700 px-1.5 py-0.5 rounded shadow-sm border border-slate-200">Change</span>
                                            </div>
                                            <input ref={imageInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                                        </div>

                                        {/* Brand Logo */}
                                        <div>
                                            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                                                Brand Logo (Optional)
                                            </label>
                                            <div
                                                onClick={() => logoInputRef.current?.click()}
                                                className="h-28 rounded-xl border-2 border-dashed border-slate-300 hover:border-[#00487c] bg-slate-50 flex flex-col items-center justify-center cursor-pointer overflow-hidden relative group transition-all"
                                            >
                                                {logoUrl ? (
                                                    <img src={logoUrl} alt="Logo" className="w-full h-full object-contain p-2 group-hover:scale-105 transition-transform" />
                                                ) : (
                                                    <div className="flex flex-col items-center text-slate-400 text-xs gap-1">
                                                        <Upload size={18} />
                                                        <span>Upload Logo</span>
                                                    </div>
                                                )}
                                                <span className="absolute bottom-1 right-1 bg-white/90 text-[10px] text-slate-700 px-1.5 py-0.5 rounded shadow-sm border border-slate-200">Change</span>
                                            </div>
                                            <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                                        </div>
                                    </div>

                                    {/* Language selection */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-[11px] font-bold text-slate-600 mb-1">AI Voice Language</label>
                                            <select
                                                value={language}
                                                onChange={(e: any) => setLanguage(e.target.value)}
                                                className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-[#00487c]"
                                            >
                                                <option value="hinglish">Hinglish (Hindi + English)</option>
                                                <option value="english">Indian English</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-[11px] font-bold text-slate-600 mb-1">AI Persona Voice</label>
                                            <select
                                                value={voiceName}
                                                onChange={(e) => setVoiceName(e.target.value)}
                                                className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-[#00487c]"
                                            >
                                                <option value="Kore">Kore (Warm Professional)</option>
                                                <option value="Nova">Nova (Energetic Luxury)</option>
                                                <option value="Priya">Priya (Conversational)</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* CTA Action */}
                            <div className="mt-8 pt-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
                                <span className="text-xs text-slate-500 font-medium">
                                    Autonomous studio produces 2x GPT 2.0 3:4 ad creatives + 15s Grok cinematic video reel.
                                </span>
                                <button
                                    onClick={handleStartCreativeGeneration}
                                    className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-gradient-to-r from-[#00487c] via-[#003D6F] to-[#a81d33] hover:from-[#003860] hover:to-[#8c182a] text-white font-black text-sm uppercase tracking-wider transition-all shadow-lg shadow-blue-900/20 active:scale-95 flex items-center justify-center gap-3 cursor-pointer"
                                >
                                    <span>Produce Creatives, Video &amp; Launch Demo</span>
                                    <ArrowRight size={18} />
                                </button>
                            </div>
                        </motion.div>
                    )}

                    {/* =========================================================================
                        STEP 2: GENERATING 3:4 CREATIVES & 15S VIDEO (RADAR SCANNER)
                    ========================================================================= */}
                    {step === 'generating_creatives' && (
                        <motion.div
                            key="step-generating"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-white border border-blue-100 rounded-3xl p-10 text-center max-w-xl mx-auto shadow-2xl shadow-blue-900/10"
                        >
                            <div className="relative w-28 h-28 mx-auto mb-6">
                                <div className="absolute inset-0 rounded-full border-2 border-blue-400/20 animate-ping" />
                                <div className="absolute inset-0 rounded-full border border-blue-500/40 animate-spin" />
                                <div className="w-full h-full rounded-full bg-blue-50 border-2 border-[#00487c] flex items-center justify-center text-[#00487c]">
                                    <Sparkles size={36} className="animate-bounce" />
                                </div>
                            </div>

                            <span className="text-xs font-black uppercase tracking-widest text-[#00487c] bg-blue-50 px-3 py-1 rounded-full border border-blue-100">
                                Autonomous Studio Working
                            </span>
                            <h2 className="text-2xl font-black text-slate-900 mt-3">
                                Synthesizing GPT 2.0 Creatives &amp; 15s Video
                            </h2>
                            <p className="text-sm text-slate-600 mt-2 max-w-md mx-auto">
                                Analyzing {companyName}'s brand identity and rendering 2 high-converting 3:4 ad concepts + 15-second cinematic video reel...
                            </p>

                            <div className="mt-8 space-y-3 text-left max-w-md mx-auto">
                                {[
                                    { text: "Compositing 3:4 Architectural Canvas with GPT 2.0 Model", stage: 1 },
                                    { text: "Synthesizing 15-Second Cinematic Drone Tour Reel (Grok 1.5)", stage: 2 },
                                    { text: "Watermarking Official Brand Logo & Verified Badges", stage: 3 },
                                    { text: "Optimizing High-Performance Color Grading for Meta Ads", stage: 4 }
                                ].map((item, idx) => (
                                    <div key={idx} className="flex items-center gap-3 text-xs">
                                        <div className={`w-5 h-5 rounded-full flex items-center justify-center ${
                                            generationStage >= item.stage 
                                                ? 'bg-emerald-600 text-white' 
                                                : 'bg-slate-100 border border-slate-200 text-slate-400'
                                        }`}>
                                            {generationStage >= item.stage ? <CheckCircle2 size={12} /> : <Loader2 size={10} className="animate-spin" />}
                                        </div>
                                        <span className={generationStage >= item.stage ? 'text-slate-800 font-bold' : 'text-slate-400'}>
                                            {item.text}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </motion.div>
                    )}

                    {/* =========================================================================
                        STEP 3: 3:4 CREATIVES & 15S VIDEO PREVIEW
                    ========================================================================= */}
                    {step === 'creatives_preview' && (
                        <motion.div
                            key="step-creatives-preview"
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -15 }}
                            className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-10 shadow-xl shadow-slate-200/50"
                        >
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-100">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-black uppercase tracking-widest text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
                                            GPT 2.0 Model &amp; Grok Video Ready
                                        </span>
                                    </div>
                                    <h2 className="text-2xl sm:text-3xl font-black text-slate-900 mt-2">
                                        Production Assets Ready for Meta Ads
                                    </h2>
                                    <p className="text-sm text-slate-600 mt-1">
                                        Engineered specifically for Meta sponsored ads (Instagram Feed &amp; Reels) with branded logo and pricing.
                                    </p>
                                </div>

                                <button
                                    onClick={handleLaunchCampaign}
                                    className="px-6 py-3.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-black text-xs uppercase tracking-wider transition-all shadow-md shadow-emerald-700/20 active:scale-95 flex items-center gap-2 cursor-pointer shrink-0"
                                >
                                    <span>Launch Campaign &amp; Dial Prospect</span>
                                    <ArrowRight size={16} />
                                </button>
                            </div>

                            {/* Media Type Switcher Tabs */}
                            <div className="flex items-center gap-3 my-6">
                                <button
                                    onClick={() => setActiveMediaTab('creatives')}
                                    className={`px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 transition-all cursor-pointer ${
                                        activeMediaTab === 'creatives'
                                            ? 'bg-[#00487c] text-white shadow-md shadow-blue-900/20'
                                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                    }`}
                                >
                                    <Layers size={14} />
                                    <span>2x 3:4 Ad Creatives (GPT 2.0 Studio)</span>
                                </button>

                                <button
                                    onClick={() => setActiveMediaTab('video')}
                                    className={`px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 transition-all cursor-pointer ${
                                        activeMediaTab === 'video'
                                            ? 'bg-[#00487c] text-white shadow-md shadow-blue-900/20'
                                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                    }`}
                                >
                                    <Film size={14} />
                                    <span>15-Second Cinematic Video Reel (Grok 1.5 HD)</span>
                                </button>
                            </div>

                            {/* Tab 1: Dual 3:4 Creatives Grid */}
                            {activeMediaTab === 'creatives' && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    {creatives.map((creative, idx) => (
                                        <div
                                            key={creative.id}
                                            onClick={() => setSelectedCreativeIndex(idx)}
                                            className={`rounded-2xl p-4 border transition-all cursor-pointer relative group ${
                                                selectedCreativeIndex === idx 
                                                    ? 'bg-blue-50/40 border-[#00487c] ring-2 ring-[#00487c]/20 shadow-lg' 
                                                    : 'bg-white border-slate-200 hover:border-slate-300 shadow-sm'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between mb-3 text-xs">
                                                <span className="font-black text-[#00487c] uppercase tracking-wider">
                                                    {creative.name}
                                                </span>
                                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 font-bold">
                                                    3:4 Format (1200x1600)
                                                </span>
                                            </div>

                                            <div className="w-full aspect-[3/4] rounded-xl overflow-hidden bg-slate-900 relative border border-slate-200 shadow-inner">
                                                <img
                                                    src={creative.imageUrl}
                                                    alt={creative.name}
                                                    className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-300"
                                                />
                                                <div className="absolute top-2 right-2 bg-black/70 backdrop-blur-md px-2 py-1 rounded-md text-[10px] text-white font-bold">
                                                    GPT 2.0 Studio
                                                </div>
                                            </div>

                                            <div className="mt-3 text-xs space-y-1">
                                                <div className="font-bold text-slate-900 line-clamp-1">{creative.headline}</div>
                                                <div className="text-slate-500 text-[11px] line-clamp-2">{creative.primaryText}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Tab 2: 15-Second Video Reel Player */}
                            {activeMediaTab === 'video' && generatedVideo && (
                                <div className="max-w-md mx-auto p-4 rounded-3xl bg-slate-50 border border-slate-200 text-center shadow-lg">
                                    <div className="flex items-center justify-between mb-3 text-xs">
                                        <span className="font-black text-[#00487c] uppercase tracking-wider flex items-center gap-1.5">
                                            <Film size={14} />
                                            {generatedVideo.title}
                                        </span>
                                        <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-black border border-emerald-200">
                                            15.0s • 9:16 Reels
                                        </span>
                                    </div>

                                    <div className="w-full aspect-[9/16] rounded-2xl overflow-hidden bg-black relative border border-slate-300 shadow-2xl">
                                        <video
                                            src={generatedVideo.videoUrl}
                                            controls
                                            autoPlay
                                            loop
                                            playsInline
                                            className="w-full h-full object-cover"
                                        />
                                    </div>

                                    <div className="mt-3 text-xs text-slate-600 font-medium">
                                        Generated via Grok 1.5 Video API • Optimized for Instagram Reels &amp; Meta Stories
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    )}

                    {/* =========================================================================
                        STEP 4: META AD CAMPAIGN LAUNCH SIMULATION & TELEMETRY
                    ========================================================================= */}
                    {step === 'launch_campaign' && (
                        <motion.div
                            key="step-campaign-launch"
                            initial={{ opacity: 0, scale: 0.96 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.96 }}
                            className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-10 shadow-xl shadow-slate-200/50"
                        >
                            <div className="flex items-center justify-between pb-6 border-b border-slate-100">
                                <div>
                                    <span className="text-xs font-black uppercase tracking-widest text-[#00487c] bg-blue-50 px-3 py-1 rounded-full border border-blue-100">
                                        Meta Ads Engine Live
                                    </span>
                                    <h2 className="text-2xl sm:text-3xl font-black text-slate-900 mt-2">
                                        Campaign Deployed Across Facebook &amp; Instagram
                                    </h2>
                                    <p className="text-sm text-slate-600 mt-1">
                                        Targeting High Net Worth buyers in {location}. Simulating real-time impressions and instant lead capture...
                                    </p>
                                </div>

                                <div className="flex items-center gap-2 bg-emerald-50 text-emerald-700 border border-emerald-200 px-3.5 py-1.5 rounded-full text-xs font-black">
                                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                    CAMPAIGN ACTIVE 🟢
                                </div>
                            </div>

                            {/* Telemetry Counter Bars */}
                            <div className="grid grid-cols-3 gap-4 my-6">
                                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80">
                                    <span className="text-[11px] font-bold text-slate-500 uppercase">Live Impressions</span>
                                    <div className="text-2xl font-black text-slate-900 mt-1">{campaignImpressions.toLocaleString()}</div>
                                </div>
                                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80">
                                    <span className="text-[11px] font-bold text-slate-500 uppercase">Link Clicks</span>
                                    <div className="text-2xl font-black text-[#00487c] mt-1">{campaignClicks}</div>
                                </div>
                                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80">
                                    <span className="text-[11px] font-bold text-slate-500 uppercase">Avg Click-Through Rate</span>
                                    <div className="text-2xl font-black text-emerald-700 mt-1">3.84%</div>
                                </div>
                            </div>

                            {/* Mobile Instagram Sponsored Preview Mockup (Light Theme) */}
                            <div className="max-w-sm mx-auto bg-white rounded-3xl border border-slate-200 p-4 shadow-2xl">
                                <div className="flex items-center justify-between pb-3 text-xs border-b border-slate-100">
                                    <div className="flex items-center gap-2">
                                        <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-[#00487c] to-[#a81d33] p-0.5">
                                            <div className="w-full h-full rounded-full bg-white flex items-center justify-center text-[10px] font-black text-[#00487c]">
                                                {companyName.slice(0, 1)}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="font-black text-slate-900 text-[11px]">{companyName}</div>
                                            <div className="text-[10px] text-slate-500">Sponsored • Instagram Feed</div>
                                        </div>
                                    </div>
                                    <span className="text-slate-400 text-xs">•••</span>
                                </div>

                                {/* Creative 3:4 image in mockup */}
                                <div className="w-full aspect-[3/4] rounded-xl overflow-hidden mt-3 bg-black">
                                    <img
                                        src={creatives[selectedCreativeIndex]?.imageUrl || creatives[0]?.imageUrl || projectImageUrl}
                                        alt="Ad Preview"
                                        className="w-full h-full object-cover"
                                    />
                                </div>

                                <div className="mt-3 flex items-center justify-between bg-blue-50/70 border border-blue-100 px-3 py-2 rounded-xl text-xs">
                                    <div>
                                        <div className="font-bold text-slate-900 text-[11px]">{projectTitle}</div>
                                        <div className="text-[10px] text-[#00487c] font-bold">{projectPrice}</div>
                                    </div>
                                    <button className="px-3 py-1 bg-[#00487c] text-white font-black rounded-lg text-[10px] uppercase shadow-sm">
                                        Learn More
                                    </button>
                                </div>

                                <div className="mt-4 text-center">
                                    <div className="inline-flex items-center gap-2 text-xs font-bold text-[#a81d33] animate-bounce">
                                        <Loader2 size={12} className="animate-spin" />
                                        Prospect clicked! Submitting instant form...
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {/* =========================================================================
                        STEP 5: LEAD CAPTURED & REAL WHATSAPP SENT
                    ========================================================================= */}
                    {step === 'lead_captured' && (
                        <motion.div
                            key="step-lead-captured"
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -15 }}
                            className="bg-white border border-emerald-200 rounded-3xl p-6 sm:p-10 shadow-xl shadow-slate-200/50"
                        >
                            <div className="text-center max-w-xl mx-auto">
                                <span className="text-xs font-black uppercase tracking-widest text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
                                    Speed to Lead: Under 4 Seconds
                                </span>
                                <h2 className="text-2xl sm:text-3xl font-black text-slate-900 mt-3">
                                    🎯 Lead Captured &amp; WhatsApp Dispatched!
                                </h2>
                                <p className="text-sm text-slate-600 mt-1">
                                    Prospect <strong className="text-slate-900">{prospectName}</strong> submitted an inquiry for <strong className="text-slate-900">{projectTitle}</strong>.
                                </p>
                            </div>

                            {/* WhatsApp Verification Card */}
                            <div className="mt-8 max-w-lg mx-auto bg-[#EFEAE2] rounded-3xl border border-slate-200 p-5 shadow-xl">
                                <div className="flex items-center gap-3 pb-3 border-b border-slate-200/80 text-xs">
                                    <div className="w-9 h-9 rounded-full bg-[#008069] flex items-center justify-center text-white font-black shadow-sm">
                                        <MessageCircle size={18} />
                                    </div>
                                    <div>
                                        <div className="font-black text-slate-900">Nobogent Official WhatsApp</div>
                                        <div className="text-[11px] text-[#008069] font-bold flex items-center gap-1">
                                            <span>✓ Verified Business Account</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-4 p-4 rounded-2xl bg-white text-slate-800 text-xs leading-relaxed relative shadow-sm border border-slate-200/60">
                                    <p>
                                        Hi <strong>{prospectName}</strong>, thank you for reaching out to <strong>{companyName}</strong>. We have received your inquiry regarding <strong>{projectTitle}</strong> and our team will get back to you shortly!
                                    </p>
                                    <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-emerald-700 font-bold">
                                        <span>Just now</span>
                                        <span>✓✓ Delivered to +91 {prospectPhone.slice(-10)}</span>
                                    </div>
                                </div>

                                {whatsappMessageId && (
                                    <div className="mt-3 text-[10px] text-center text-slate-500 font-mono">
                                        Meta Message ID: {whatsappMessageId}
                                    </div>
                                )}
                            </div>

                            {/* Next CTA to trigger real call */}
                            <div className="mt-8 text-center">
                                <button
                                    onClick={handleTriggerLiveCall}
                                    className="px-8 py-4 rounded-2xl bg-gradient-to-r from-[#00487c] via-[#003D6F] to-[#a81d33] hover:from-[#003860] hover:to-[#8c182a] text-white font-black text-sm uppercase tracking-wider transition-all shadow-lg shadow-blue-900/20 active:scale-95 inline-flex items-center gap-3 cursor-pointer"
                                >
                                    <Phone size={18} />
                                    <span>Place Outbound AI Call to {prospectPhone} Now</span>
                                </button>
                                <p className="text-xs text-slate-500 mt-2">
                                    Pick up your mobile phone when it rings to converse with the AI sales executive!
                                </p>
                            </div>
                        </motion.div>
                    )}

                    {/* =========================================================================
                        STEP 6: REAL AI OUTBOUND CALL ACTIVE
                    ========================================================================= */}
                    {step === 'ai_calling' && (
                        <motion.div
                            key="step-ai-calling"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-white border border-blue-200 rounded-3xl p-6 sm:p-10 shadow-2xl shadow-blue-900/10 max-w-xl mx-auto text-center"
                        >
                            <span className="text-xs font-black uppercase tracking-widest text-[#00487c] bg-blue-50 px-3.5 py-1 rounded-full border border-blue-100">
                                Real Telephony Dialing • Vobiz &amp; Gemini
                            </span>

                            <div className="mt-6 relative w-24 h-24 mx-auto">
                                <div className="absolute inset-0 rounded-full border-2 border-blue-400/30 animate-ping" />
                                <div className="w-full h-full rounded-full bg-gradient-to-tr from-[#00487c] to-[#00a8e8] flex items-center justify-center text-white shadow-lg shadow-blue-900/30">
                                    <Phone size={36} className={callStatus === 'ringing' ? 'animate-bounce' : ''} />
                                </div>
                            </div>

                            <h2 className="text-2xl font-black text-slate-900 mt-4">
                                {callStatus === 'ringing' ? 'Ringing Prospect Phone...' : callStatus === 'in_call' ? 'Call in Progress with AI' : 'Initiating Call...'}
                            </h2>

                            <div className="mt-2 text-sm text-[#00487c] font-mono font-bold">
                                {callerNumber} ➔ +91 {prospectPhone.slice(-10)} ({formatTimer(callTimer)})
                            </div>

                            {/* Soundwave audio visualizer animation */}
                            <div className="flex items-center justify-center gap-1.5 my-6 h-10">
                                {[30, 70, 45, 90, 60, 100, 40, 80, 50, 95, 35, 75, 45].map((h, i) => (
                                    <div
                                        key={i}
                                        style={{ height: `${h}%` }}
                                        className="w-1.5 bg-gradient-to-t from-[#00487c] to-[#00a8e8] rounded-full animate-pulse"
                                    />
                                ))}
                            </div>

                            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-left space-y-2">
                                <div className="flex items-center justify-between text-slate-500 font-bold">
                                    <span>AI EXECUTIVE SCRIPT CONTEXT:</span>
                                    <span className="text-[#00487c]">{voiceName} Voice</span>
                                </div>
                                <p className="text-slate-700 italic">
                                    "Hi {prospectName} ji, main {companyName} se Priya baat kar rahi hoon aapki inquiry ke regarding {projectTitle} project ke liye..."
                                </p>
                            </div>

                            {callSummary && (
                                <div className="mt-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 text-left">
                                    <strong>AI Summary:</strong> {callSummary}
                                </div>
                            )}

                            {/* Manual appointment test button */}
                            <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
                                <span className="text-xs text-slate-500">Answer phone or trigger appointment:</span>
                                <button
                                    onClick={triggerAppointmentBookedCelebration}
                                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-wider transition-all shadow-sm cursor-pointer"
                                >
                                    Confirm Appointment Booked ✓
                                </button>
                            </div>
                        </motion.div>
                    )}

                    {/* =========================================================================
                        STEP 7: VIP APPOINTMENT BOOKED ON CALENDAR (FINAL CELEBRATION)
                    ========================================================================= */}
                    {step === 'appointment_booked' && (
                        <motion.div
                            key="step-appointment-booked"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="bg-white border border-emerald-200 rounded-3xl p-6 sm:p-10 shadow-2xl shadow-emerald-900/10 text-center max-w-2xl mx-auto"
                        >
                            <div className="w-20 h-20 rounded-full bg-emerald-50 border-2 border-emerald-600 flex items-center justify-center text-emerald-600 mx-auto mb-4">
                                <Award size={40} className="animate-bounce" />
                            </div>

                            <span className="text-xs font-black uppercase tracking-widest text-emerald-700 bg-emerald-50 px-3.5 py-1 rounded-full border border-emerald-200">
                                Full Journey Completed (100% Autonomous)
                            </span>
                            <h2 className="text-3xl font-black text-slate-900 mt-3">
                                🎉 Appointment Successfully Booked!
                            </h2>
                            <p className="text-sm text-slate-600 mt-2 max-w-lg mx-auto">
                                The autonomous loop ran seamlessly from brand onboarding to creative generation, 15s video production, Meta ad launch, instant WhatsApp nurture, AI phone qualification, and confirmed calendar booking!
                            </p>

                            {/* Real WhatsApp Confirmation Message Card */}
                            <div className="mt-6 max-w-xl mx-auto bg-[#EFEAE2] rounded-3xl border border-slate-200 p-5 shadow-xl text-left">
                                <div className="flex items-center gap-3 pb-3 border-b border-slate-200/80 text-xs">
                                    <div className="w-8 h-8 rounded-full bg-[#008069] flex items-center justify-center text-white font-black shadow-sm">
                                        <MessageCircle size={16} />
                                    </div>
                                    <div>
                                        <div className="font-black text-slate-900">Real WhatsApp Appointment Confirmation</div>
                                        <div className="text-[11px] text-[#008069] font-bold">
                                            <span>✓ Dispatched to +91 {prospectPhone.slice(-10)}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-3 p-4 rounded-2xl bg-white text-slate-800 text-xs leading-relaxed relative shadow-sm border border-slate-200/60">
                                    <p>
                                        Hi <strong>{prospectName}</strong>, your appointment has been confirmed for <strong>Tomorrow at 11:30 AM IST</strong> with <strong>Priya (Executive Advisor)</strong> from <strong>{companyName}</strong>. We look forward to connecting with you!
                                    </p>
                                    <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-emerald-700 font-bold">
                                        <span>Just now</span>
                                        <span>✓✓ Delivered to +91 {prospectPhone.slice(-10)}</span>
                                    </div>
                                </div>

                                {appointmentMessageId && (
                                    <div className="mt-2 text-[10px] text-center text-slate-500 font-mono">
                                        Meta Message ID: {appointmentMessageId}
                                    </div>
                                )}
                            </div>

                            {/* Confirmed Booking Summary Card */}
                            <div className="mt-6 p-5 rounded-2xl bg-emerald-50/60 border border-emerald-200 text-left space-y-3">
                                <div className="flex items-center justify-between text-xs font-bold pb-2 border-b border-emerald-200/80">
                                    <span className="text-emerald-800 font-black">CONFIRMED SITE VISIT &amp; CONSULTATION</span>
                                    <span className="text-emerald-700 bg-emerald-100/60 px-2.5 py-0.5 rounded-full">Status: Hot Qualified Lead</span>
                                </div>

                                <div className="grid grid-cols-2 gap-4 text-xs">
                                    <div>
                                        <span className="text-slate-500 block">Prospect</span>
                                        <span className="font-bold text-slate-900 text-sm">{prospectName} (+91 {prospectPhone.slice(-10)})</span>
                                    </div>
                                    <div>
                                        <span className="text-slate-500 block">Project &amp; Budget</span>
                                        <span className="font-bold text-slate-900 text-sm">{projectTitle} ({projectPrice})</span>
                                    </div>
                                    <div>
                                        <span className="text-slate-500 block">Scheduled Slot</span>
                                        <span className="font-black text-emerald-700 text-sm">Tomorrow at 11:30 AM IST</span>
                                    </div>
                                    <div>
                                        <span className="text-slate-500 block">Assigned Developer</span>
                                        <span className="font-bold text-slate-900 text-sm">{companyName}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Journey recap checkmarks */}
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-6 text-left text-xs">
                                {[
                                    "✓ Brand Onboarded",
                                    "✓ 2x GPT 2.0 Creatives",
                                    "✓ 15-Sec Video Reel Made",
                                    "✓ Meta Campaign Launched",
                                    "✓ Real WhatsApp Pinged",
                                    "✓ AI Voice Call Placed",
                                    "✓ Appointment Booked",
                                    "✓ WhatsApp Confirmation Sent"
                                ].map((stepText, idx) => (
                                    <div key={idx} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-emerald-700 font-bold">
                                        {stepText}
                                    </div>
                                ))}
                            </div>

                            {/* Final CTAs */}
                            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
                                <button
                                    onClick={() => setStep('onboarding')}
                                    className="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer"
                                >
                                    <RefreshCw size={14} />
                                    <span>Try Another Project</span>
                                </button>

                                <a
                                    href="/login"
                                    className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-gradient-to-r from-[#00487c] via-[#003D6F] to-[#a81d33] hover:from-[#003860] hover:to-[#8c182a] text-white font-black text-xs uppercase tracking-wider transition-all shadow-lg shadow-blue-900/20 active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                                >
                                    <span>Deploy For My Business</span>
                                    <ArrowRight size={16} />
                                </a>
                            </div>
                        </motion.div>
                    )}

                </AnimatePresence>
            </main>

            {/* FOOTER */}
            <footer className="w-full max-w-7xl mx-auto px-6 py-6 border-t border-slate-200/80 text-center text-xs text-slate-500 z-10 flex flex-col sm:flex-row items-center justify-between gap-2">
                <span>© 2026 Nobogent Technologies Inc. Autonomous AI Sales &amp; Marketing Engine.</span>
                <span className="flex items-center gap-2 text-slate-600">
                    <span>Telephony Powered by Vobiz</span> • <span>WhatsApp Cloud API</span> • <span>Gemini Live Audio</span>
                </span>
            </footer>
        </div>
    );
}
