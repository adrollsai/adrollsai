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
    ExternalLink,
    RefreshCw,
    Download,
    Eye,
    Layers,
    Award,
    Film,
    Globe,
    Monitor,
    Tablet,
    Smartphone,
    XCircle,
    Check,
    Coins,
    TrendingUp,
    ShieldCheck,
    Calendar,
    Users,
    Sliders,
    Flame,
    Share2,
    BarChart3,
    Clock,
    Database,
    Headphones,
    PackageCheck
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { toast } from 'sonner';

type DemoStep = 
    | 'onboarding'
    | 'generating_assets'
    | 'showcase'
    | 'speed_to_lead'
    | 'pricing_comparison';

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
        name: 'The Grand Crest Luxury Residences',
        company: 'Apex Luxury Developments',
        price: '₹1.85 Cr (Special Launch Offer)',
        location: 'Golf Course Extension, Prime Metro Corridor',
        desc: 'Ultra-luxury 3 & 4 BHK residences with sky terraces, private infinity pool, Italian marble finishes, and 24x7 smart concierge.',
        image: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1400&q=80',
        logo: ''
    },
    {
        name: 'The Royal Palm Sky Mansions',
        company: 'Elysian Group',
        price: 'Starting ₹2.45 Cr',
        location: 'Sector 82, Mohali Luxury Belt',
        desc: 'Exclusive 4BHK Sky Mansions featuring private infinity plunge pool, double-height ceilings, and panoramic golf course views.',
        image: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1400&q=80',
        logo: ''
    }
];

// 12-Item Comparison List requested by User
const SERVICE_COMPARISONS = [
    {
        name: 'Advanced Conversion API CRM',
        category: 'Lead Capture & Server CAPI',
        agencyCost: '₹25,000/mo',
        agencyNote: 'Third-party Zapier hacks, frequent broken syncs',
        nobogentStatus: 'Built-in Native Server CAPI & Real-time CRM',
        icon: Database
    },
    {
        name: 'AI Calling (Autonomous Inbound & Outbound)',
        category: 'Sales Qualification',
        agencyCost: '₹35,000/mo',
        agencyNote: 'Manual telecaller salaries, missed calls, high churn',
        nobogentStatus: 'Instant <30s Outbound & Inbound AI Closers',
        icon: Phone
    },
    {
        name: 'AI WhatsApp Bot',
        category: '24/7 Drips & Catalogs',
        agencyCost: '₹20,000/mo',
        agencyNote: 'Basic rule-based bots with expensive per-message fees',
        nobogentStatus: 'Omnichannel Autonomous Bot with Catalog & Drips',
        icon: MessageCircle
    },
    {
        name: '10 AI Videos / Month',
        category: 'Short-Form Reels & Stories',
        agencyCost: '₹30,000/mo',
        agencyNote: 'Slow freelance editors, 5-7 days turnaround per reel',
        nobogentStatus: '10 Studio-Grade Cinematic 9:16 Reels Monthly',
        icon: Film
    },
    {
        name: '30 Image Creatives / Month',
        category: 'Commercial Ad Creatives',
        agencyCost: '₹20,000/mo',
        agencyNote: 'Cookie-cutter Canva graphics, limited revisions',
        nobogentStatus: '30 High-Converting 3:4 & 1:1 Ad Creatives',
        icon: Layers
    },
    {
        name: 'High-Converting Website',
        category: 'Direct-Response Landing Page',
        agencyCost: '₹40,000 (one-time)',
        agencyNote: 'Bloated WordPress templates with slow load speeds',
        nobogentStatus: 'Ultra-Fast Astro JS Architecture & Mobile-First',
        icon: Globe
    },
    {
        name: 'Free High-Speed Cloud Hosting',
        category: 'Infrastructure',
        agencyCost: '₹5,000/mo',
        agencyNote: 'Separate VPS/cPanel bills, SSL management headaches',
        nobogentStatus: 'Global Edge CDN & SSL Included Free Forever',
        icon: Zap
    },
    {
        name: 'Real-Time Analytics & Attribution',
        category: 'ROI Dashboard',
        agencyCost: '₹10,000/mo',
        agencyNote: 'Confusing monthly spreadsheets delivered 2 weeks late',
        nobogentStatus: 'Live Visual ROI, Lead Funnels & Speed-to-Lead Metrics',
        icon: BarChart3
    },
    {
        name: 'Team Management (5 Users)',
        category: 'Collaboration & Access',
        agencyCost: '₹15,000/mo',
        agencyNote: 'Extra seat charges on third-party CRM platforms',
        nobogentStatus: 'Full Role-Based Team Seats for 5 Team Members',
        icon: Users
    },
    {
        name: 'Auto Social Media Posting',
        category: 'Omnichannel Distribution',
        agencyCost: '₹15,000/mo',
        agencyNote: 'Manual social media intern, inconsistent scheduling',
        nobogentStatus: '1-Tap WhatsApp Approval to IG, FB & LinkedIn',
        icon: Share2
    },
    {
        name: 'Inventory & Catalog Management',
        category: 'Asset Organization',
        agencyCost: '₹10,000/mo',
        agencyNote: 'Scattered PDF brochures and manual WhatsApp uploads',
        nobogentStatus: 'Structured Digital Catalog Auto-Synced to Bot & Lander',
        icon: PackageCheck
    },
    {
        name: 'Dedicated Relationship Manager',
        category: 'Customer Support',
        agencyCost: '₹20,000/mo',
        agencyNote: 'Junior account executives juggling 30 other clients',
        nobogentStatus: 'Priority WhatsApp & Dedicated Technical Manager',
        icon: Headphones
    }
];

export default function DemoPage() {
    const [step, setStep] = useState<DemoStep>('onboarding');

    // Onboarding Form States
    const [companyName, setCompanyName] = useState('Apex Luxury Developments');
    const [projectTitle, setProjectTitle] = useState('The Grand Crest Luxury Residences');
    const [projectPrice, setProjectPrice] = useState('₹1.85 Cr (Special Launch Offer)');
    const [location, setLocation] = useState('Golf Course Extension, Prime Metro Corridor');
    const [projectDescription, setProjectDescription] = useState('Ultra-luxury 3 & 4 BHK residences with sky terraces, private infinity pool, Italian marble finishes, and 24x7 smart concierge.');
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

    // Asset Generation States
    const [isGenerating, setIsGenerating] = useState(false);
    const [generationStage, setGenerationStage] = useState(0);
    const [creative, setCreative] = useState<GeneratedCreative | null>(null);
    const [generatedVideo, setGeneratedVideo] = useState<GeneratedVideo | null>({
        id: 'demo-video-15s',
        title: '15-Second Cinematic Voiceover Reel',
        videoUrl: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/demo-creatives/demo_15s_voiceover_reel_1793007112340.mp4',
        aspectRatio: '9:16',
        duration: 15
    });

    // Showcase View States
    const [showcaseTab, setShowcaseTab] = useState<'creative' | 'video' | 'website'>('creative');
    const [websiteDevice, setWebsiteDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
    const [websiteHtml, setWebsiteHtml] = useState<string>('');

    // WhatsApp Dispatch States
    const [isSendingWhatsApp, setIsSendingWhatsApp] = useState(false);
    const [whatsappMessageId, setWhatsappMessageId] = useState<string | null>(null);
    const [whatsappDelivered, setWhatsappDelivered] = useState(false);

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
            const formData = new FormData();
            formData.append('file', file);
            formData.append('folder', 'demo-logos');

            const res = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            const data = await res.json();
            if (res.ok && data.url) {
                setLogoUrl(data.url);
                playChime('success');
                toast.success("Logo uploaded to R2! 🎨");
            } else {
                const reader = new FileReader();
                reader.onloadend = () => {
                    setLogoUrl(reader.result as string);
                    playChime('success');
                    toast.success("Logo preview loaded!");
                };
                reader.readAsDataURL(file);
            }
        } catch {
            const reader = new FileReader();
            reader.onloadend = () => {
                setLogoUrl(reader.result as string);
                playChime('success');
                toast.success("Logo preview loaded!");
            };
            reader.readAsDataURL(file);
        } finally {
            setUploadingLogo(false);
        }
    };

    // Trigger Asset Generation (Creative, 15s Video, Website)
    const handleStartCreativeGeneration = async () => {
        if (!companyName.trim() || !projectTitle.trim()) {
            toast.error("Please provide both Company Name and Project Title.");
            return;
        }

        if (!prospectPhone.trim() || prospectPhone.replace(/\D/g, '').length < 10) {
            toast.error("Please enter a valid 10-digit Indian mobile number to experience the live AI phone call and WhatsApp message.");
            return;
        }

        setStep('generating_assets');
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
            if (!res.ok) throw new Error(data.error || "Failed to generate assets");

            if (data.creatives && data.creatives.length > 0) {
                setCreative(data.creatives[0]);
            }
            if (data.video) {
                setGeneratedVideo(data.video);
            }

            // Fetch live customized website HTML via POST (supports base64 without URL length limits)
            try {
                const webRes = await fetch('/api/demo/website', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        companyName,
                        projectTitle,
                        projectPrice,
                        location,
                        phone: prospectPhone || '+91 98886 26786',
                        logoUrl,
                        heroImage: projectImageUrl
                    })
                });
                if (webRes.ok) {
                    const text = await webRes.text();
                    setWebsiteHtml(text);
                }
            } catch (wErr) {
                console.warn("Website HTML fetch error:", wErr);
            }

            setGenerationStage(4);
            setIsGenerating(false);
            setStep('showcase');
            playChime('success');
            toast.success("✨ High-Converting Creative, 15s Video & Live Website Ready!");

        } catch (err: any) {
            clearInterval(stageInterval);
            console.error("Asset generation failed:", err);
            toast.error(err.message || "Failed to generate assets. Please try again.");
            setStep('onboarding');
            setIsGenerating(false);
        }
    };

    // Trigger Speed to Lead Demonstration (WhatsApp + Real Call)
    const handleStartLiveSpeedToLead = async () => {
        setStep('speed_to_lead');
        setIsSendingWhatsApp(true);
        setIsDialingCall(true);
        setCallStatus('dialing');
        playChime('call');

        // 1. Dispatch real WhatsApp message
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
                toast.success(`📲 Real WhatsApp message dispatched to +91 ${prospectPhone.slice(-10)}!`);
            }
        } catch (e: any) {
            console.warn("WhatsApp dispatch warning:", e);
        } finally {
            setIsSendingWhatsApp(false);
        }

        // 2. Trigger real AI outbound call to the phone
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
            toast.success(`📞 Outbound AI Call dialing to ${prospectPhone}! Answer your phone to speak with the AI sales executive.`);

        } catch (err: any) {
            console.error("AI Call trigger failed:", err);
            toast.error(err.message || "Failed to place outbound call.");
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
        if (!callLeadId || step !== 'speed_to_lead') return;

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
                    goToPricingComparison();
                }
            } catch {}
        }, 3000);

        return () => clearInterval(interval);
    }, [callLeadId, step, callStatus]);

    // Transition to Grand Comparison Screen
    const goToPricingComparison = () => {
        setStep('pricing_comparison');
        playChime('success');

        confetti({
            particleCount: 140,
            spread: 100,
            origin: { y: 0.55 }
        });

        setTimeout(() => {
            confetti({
                particleCount: 90,
                angle: 60,
                spread: 70,
                origin: { x: 0.1, y: 0.7 }
            });
            confetti({
                particleCount: 90,
                angle: 120,
                spread: 70,
                origin: { x: 0.9, y: 0.7 }
            });
        }, 350);

        toast.success("🏆 Journey Complete! Check out your autonomous stack comparison.");
    };

    const formatTimer = (sec: number) => {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    // Auto-fetch website HTML if entering showcase directly or empty
    useEffect(() => {
        if (step === 'showcase' && !websiteHtml) {
            fetch('/api/demo/website', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    companyName,
                    projectTitle,
                    projectPrice,
                    location,
                    phone: prospectPhone || '+91 98886 26786',
                    logoUrl,
                    heroImage: projectImageUrl
                })
            })
            .then(r => r.text())
            .then(t => setWebsiteHtml(t))
            .catch(() => {});
        }
    }, [step, websiteHtml, companyName, projectTitle, projectPrice, location, prospectPhone, logoUrl, projectImageUrl]);

    // Website preview URL with dynamic parameters (avoiding huge base64 strings in query)
    const cleanLogoParam = (logoUrl && !logoUrl.startsWith('data:')) ? logoUrl : '';
    const cleanHeroParam = (projectImageUrl && !projectImageUrl.startsWith('data:')) ? projectImageUrl : '';
    const websitePreviewUrl = `/api/demo/website?companyName=${encodeURIComponent(companyName)}&projectTitle=${encodeURIComponent(projectTitle)}&projectPrice=${encodeURIComponent(projectPrice)}&location=${encodeURIComponent(location)}&phone=${encodeURIComponent(prospectPhone || '+91 98886 26786')}&logoUrl=${encodeURIComponent(cleanLogoParam)}&heroImage=${encodeURIComponent(cleanHeroParam)}`;

    return (
        <div className="min-h-screen bg-[#090D16] text-slate-100 flex flex-col justify-between font-sans relative overflow-x-hidden selection:bg-blue-600 selection:text-white">
            
            {/* Ambient luxury mesh background glow */}
            <div className="fixed top-[-15%] left-[-10%] w-[60%] h-[60%] rounded-full bg-blue-600/10 blur-[160px] pointer-events-none" />
            <div className="fixed bottom-[-15%] right-[-10%] w-[55%] h-[55%] rounded-full bg-indigo-600/10 blur-[160px] pointer-events-none" />
            <div className="fixed top-[45%] right-[15%] w-[40%] h-[40%] rounded-full bg-amber-500/5 blur-[140px] pointer-events-none" />
            <div className="fixed inset-0 bg-[radial-gradient(#ffffff08_1px,transparent_1px)] [background-size:24px_24px] pointer-events-none" />

            {/* TOP HEADER */}
            <header className="w-full max-w-7xl mx-auto px-6 py-4 flex items-center justify-between z-30 border-b border-slate-800/80 bg-[#090D16]/80 backdrop-blur-xl sticky top-0">
                <div className="flex items-center gap-3.5">
                    <img src="/logo.png" alt="Nobogent" className="h-8 w-auto object-contain" />
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-extrabold tracking-tight text-white">Nobogent</span>
                        <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                            Autonomous OS
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="hidden sm:flex items-center gap-2 text-xs font-medium text-slate-400">
                        <span>Zero Fulfillment Architecture</span>
                    </div>

                    <a
                        href="/login"
                        className="px-4 py-2 rounded-xl text-xs font-bold text-slate-300 hover:text-white bg-slate-900 border border-slate-700/80 hover:border-slate-600 shadow-sm transition-all"
                    >
                        Sign In
                    </a>
                </div>
            </header>

            {/* STEP PROGRESS STEPPER */}
            <div className="w-full max-w-4xl mx-auto px-4 pt-6 pb-2 z-20">
                <div className="relative flex items-center justify-between p-3 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-xl shadow-lg shadow-black/40">
                    <div className="absolute top-1/2 left-8 right-8 -translate-y-1/2 h-[2px] bg-slate-800/80 z-0" />
                    {[
                        { key: 'onboarding', label: '1. Onboard', icon: Building2 },
                        { key: 'generating_assets', label: '2. Synthesizing', icon: Sparkles },
                        { key: 'showcase', label: '3. Assets & Site', icon: Layers },
                        { key: 'pricing_comparison', label: '4. Value Matrix', icon: Award }
                    ].map((m) => {
                        const stepOrder = ['onboarding', 'generating_assets', 'showcase', 'speed_to_lead', 'pricing_comparison'];
                        const currentIdx = stepOrder.indexOf(step);
                        const milestoneIdx = stepOrder.indexOf(m.key);
                        const isDone = currentIdx > milestoneIdx;
                        const isCurrent = currentIdx === milestoneIdx || (m.key === 'showcase' && step === 'speed_to_lead');

                        return (
                            <div key={m.key} className="relative z-10 flex flex-col items-center gap-1.5 px-2">
                                <div className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-300 ${
                                    isDone 
                                        ? 'bg-emerald-500 text-white font-black shadow-md shadow-emerald-500/30 ring-2 ring-emerald-400/30' 
                                        : isCurrent 
                                            ? 'bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-black shadow-xl shadow-blue-500/40 ring-4 ring-blue-500/20 scale-110' 
                                            : 'bg-slate-950 border border-slate-800 text-slate-500'
                                }`}>
                                    {isDone ? <Check size={16} strokeWidth={3} /> : <m.icon size={16} />}
                                </div>
                                <span className={`text-[10px] md:text-xs tracking-wider uppercase font-extrabold ${
                                    isCurrent ? 'text-blue-400 font-black' : isDone ? 'text-emerald-400' : 'text-slate-500'
                                }`}>
                                    {m.label}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* MAIN CONTENT WORKSPACE */}
            <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-6 flex flex-col justify-center z-20">
                <AnimatePresence mode="wait">

                    {/* =========================================================================
                        STEP 1: PREMIUM ONBOARDING FORM
                    ========================================================================= */}
                    {step === 'onboarding' && (
                        <motion.div
                            key="step-onboarding"
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -15 }}
                            transition={{ duration: 0.25 }}
                            className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 sm:p-10 backdrop-blur-2xl shadow-2xl shadow-black/80 relative"
                        >
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-800/80">
                                <div>
                                    <span className="text-xs font-black uppercase tracking-widest text-blue-400 bg-blue-500/10 px-3 py-1 rounded-full border border-blue-500/20">
                                        Zero-Fulfillment Setup • 60 Seconds
                                    </span>
                                    <h1 className="text-2xl sm:text-3xl font-black text-white mt-2 tracking-tight">
                                        Onboard Your Brand &amp; Launch The Engine
                                    </h1>
                                    <p className="text-sm text-slate-400 mt-1 max-w-xl">
                                        Enter your project details. We automatically synthesize a <strong>clean 3:4 ad creative</strong>, a <strong>15-second voiceover reel</strong>, and an <strong>Astro JS high-converting landing page</strong>!
                                    </p>
                                </div>

                                {/* Preset Shortcuts */}
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Presets:</span>
                                    {PRESET_PROJECTS.map((p, idx) => (
                                        <button
                                            key={idx}
                                            onClick={() => handleSelectPreset(p)}
                                            className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-800/80 border border-slate-700/80 hover:border-blue-500 hover:bg-blue-500/10 text-slate-300 hover:text-white transition-all cursor-pointer"
                                        >
                                            {p.name.split(' ')[0]}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Website auto-extractor strip */}
                            <div className="my-6 p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 flex flex-col sm:flex-row items-center gap-3">
                                <div className="flex items-center gap-2 text-xs font-bold text-slate-300 shrink-0">
                                    <Sparkles size={16} className="text-blue-400" />
                                    <span>Auto-Extract From Website:</span>
                                </div>
                                <div className="flex-1 w-full flex items-center gap-2">
                                    <input
                                        type="url"
                                        value={websiteUrl}
                                        onChange={(e) => setWebsiteUrl(e.target.value)}
                                        placeholder="https://yourbrandwebsite.com"
                                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                                    />
                                    <button
                                        onClick={handleExtractWebsite}
                                        disabled={extractingWebsite}
                                        className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shrink-0 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-md shadow-blue-600/30"
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
                                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                                            Company / Developer Name
                                        </label>
                                        <input
                                            type="text"
                                            value={companyName}
                                            onChange={(e) => setCompanyName(e.target.value)}
                                            placeholder="e.g. Bioque Estates International"
                                            className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950/60 border border-slate-800 text-sm text-white focus:outline-none focus:border-blue-500 transition-all"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                                            Project / Offering Title
                                        </label>
                                        <input
                                            type="text"
                                            value={projectTitle}
                                            onChange={(e) => setProjectTitle(e.target.value)}
                                            placeholder="e.g. The Grand Crest Luxury Residences"
                                            className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950/60 border border-slate-800 text-sm text-white font-bold focus:outline-none focus:border-blue-500 transition-all"
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                                                Pricing
                                            </label>
                                            <input
                                                type="text"
                                                value={projectPrice}
                                                onChange={(e) => setProjectPrice(e.target.value)}
                                                placeholder="₹49.5 Lakhs"
                                                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950/60 border border-slate-800 text-sm text-white focus:outline-none focus:border-blue-500 transition-all"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                                                Location / Market
                                            </label>
                                            <input
                                                type="text"
                                                value={location}
                                                onChange={(e) => setLocation(e.target.value)}
                                                placeholder="Bangalore Corridor"
                                                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950/60 border border-slate-800 text-sm text-white focus:outline-none focus:border-blue-500 transition-all"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                                            Value Proposition &amp; Specifications
                                        </label>
                                        <textarea
                                            rows={3}
                                            value={projectDescription}
                                            onChange={(e) => setProjectDescription(e.target.value)}
                                            placeholder="Describe key features, amenities, and unique selling points..."
                                            className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950/60 border border-slate-800 text-xs text-white focus:outline-none focus:border-blue-500 transition-all"
                                        />
                                    </div>
                                </div>

                                {/* Right Column: Mobile Number & Media */}
                                <div className="space-y-4">
                                    <div className="p-4 rounded-2xl bg-blue-950/30 border border-blue-800/40 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <label className="block text-xs font-bold text-blue-300 uppercase tracking-wider">
                                                Your Mobile Number (Live Demo Call &amp; WhatsApp)
                                            </label>
                                            <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
                                                Real Test Phone
                                            </span>
                                        </div>
                                        <input
                                            type="tel"
                                            value={prospectPhone}
                                            onChange={(e) => setProspectPhone(e.target.value)}
                                            placeholder="e.g. 9888626786 (10 digits)"
                                            className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-blue-500/40 text-sm text-white font-mono font-bold focus:outline-none focus:border-blue-400"
                                        />
                                        <p className="text-[11px] text-slate-400">
                                            Enter your active phone number. Our system will place an <strong>actual outbound AI phone call</strong> and send a <strong>verified WhatsApp catalog</strong> directly to your phone!
                                        </p>
                                    </div>

                                    {/* Upload Images & Logos */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                                                Project Image
                                            </label>
                                            <div
                                                onClick={() => imageInputRef.current?.click()}
                                                className="h-28 rounded-xl border border-dashed border-slate-700 hover:border-blue-500 bg-slate-950/60 flex flex-col items-center justify-center cursor-pointer overflow-hidden relative group transition-all"
                                            >
                                                {projectImageUrl ? (
                                                    <img src={projectImageUrl} alt="Project" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                                                ) : (
                                                    <div className="flex flex-col items-center text-slate-500 text-xs gap-1">
                                                        <Upload size={18} />
                                                        <span>Upload Image</span>
                                                    </div>
                                                )}
                                                <span className="absolute bottom-1 right-1 bg-black/80 text-[10px] text-white px-1.5 py-0.5 rounded border border-slate-700">Change</span>
                                            </div>
                                            <input ref={imageInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                                        </div>

                                        <div>
                                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                                                Brand Logo (Replaces on Site)
                                            </label>
                                            <div
                                                onClick={() => logoInputRef.current?.click()}
                                                className="h-28 rounded-xl border border-dashed border-slate-700 hover:border-blue-500 bg-slate-950/60 flex flex-col items-center justify-center cursor-pointer overflow-hidden relative group transition-all"
                                            >
                                                {logoUrl ? (
                                                    <img src={logoUrl} alt="Logo" className="w-full h-full object-contain p-2 group-hover:scale-105 transition-transform" />
                                                ) : (
                                                    <div className="flex flex-col items-center text-slate-500 text-xs gap-1">
                                                        <Upload size={18} />
                                                        <span>Upload Logo</span>
                                                    </div>
                                                )}
                                                <span className="absolute bottom-1 right-1 bg-black/80 text-[10px] text-white px-1.5 py-0.5 rounded border border-slate-700">Change</span>
                                            </div>
                                            <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Action Strip */}
                            <div className="mt-8 pt-6 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-4">
                                <span className="text-xs text-slate-400 font-medium">
                                    Autonomous pipeline creates 1 Static Creative (3:4), 1 15s Voiceover Video, and deploys high-converting Astro site.
                                </span>
                                <button
                                    onClick={handleStartCreativeGeneration}
                                    className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-500 hover:from-blue-500 hover:to-indigo-500 text-white font-black text-sm uppercase tracking-wider transition-all shadow-xl shadow-blue-600/30 active:scale-95 flex items-center justify-center gap-3 cursor-pointer"
                                >
                                    <span>Synthesize Assets &amp; Launch Demo</span>
                                    <ArrowRight size={18} />
                                </button>
                            </div>
                        </motion.div>
                    )}

                    {/* =========================================================================
                        STEP 2: HIGH-TECH RADAR SCANNER LOADER
                    ========================================================================= */}
                    {step === 'generating_assets' && (
                        <motion.div
                            key="step-generating"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ type: "spring", stiffness: 300, damping: 25 }}
                            className="bg-gradient-to-b from-slate-900/95 to-slate-950/95 border border-slate-800/80 rounded-3xl p-8 sm:p-12 text-center max-w-xl mx-auto shadow-2xl shadow-blue-900/20 backdrop-blur-2xl ring-1 ring-white/10 relative overflow-hidden"
                        >
                            {/* Ambient Top Glow */}
                            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-20 bg-blue-500/20 blur-3xl pointer-events-none" />

                            <div className="relative w-32 h-32 mx-auto mb-8">
                                <div className="absolute inset-0 rounded-full border-2 border-blue-500/20 animate-ping" />
                                <div className="absolute -inset-2 rounded-full border border-indigo-500/30 animate-pulse" />
                                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-500 border-r-indigo-500 animate-spin" />
                                <div className="w-full h-full rounded-full bg-gradient-to-b from-blue-950/80 to-slate-950 border border-blue-500/40 flex items-center justify-center text-blue-400 shadow-2xl shadow-blue-500/20">
                                    <Sparkles size={40} className="text-blue-400 animate-pulse" />
                                </div>
                            </div>

                            <div className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-blue-400 bg-blue-500/10 px-4 py-1.5 rounded-full border border-blue-500/20 mb-3 shadow-inner">
                                <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                                <span>Real-Time Autonomous Pipeline</span>
                            </div>
                            <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                                Synthesizing Creative, Video &amp; Site
                            </h2>
                            <p className="text-sm text-slate-400 mt-2 max-w-md mx-auto">
                                Analyzing {companyName}'s brand architecture. Rendering custom 3:4 Meta Ad, 15s voiceover video with Gemini TTS, and deploying Astro landing page in real time.
                            </p>

                            {/* Progress bar */}
                            <div className="mt-6 w-full max-w-md mx-auto bg-slate-950 rounded-full h-2.5 p-0.5 border border-slate-800 overflow-hidden">
                                <motion.div 
                                    className="h-full rounded-full bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-400"
                                    initial={{ width: "15%" }}
                                    animate={{ width: `${Math.min(100, generationStage * 25 + 15)}%` }}
                                    transition={{ duration: 0.6 }}
                                />
                            </div>

                            <div className="mt-8 space-y-3.5 text-left max-w-md mx-auto">
                                {[
                                    { text: "Rendering 3:4 Commercial Ad (Dubai Luxury Real Estate Meta Styling)", stage: 1 },
                                    { text: "Synthesizing 15s Cinematic Voiceover Reel (Gemini TTS + ffmpeg)", stage: 2 },
                                    { text: "Deploying High-Converting Astro JS Website (Zero-Latency)", stage: 3 },
                                    { text: "Connecting Nobogent WhatsApp (+91 98771 61216) & Voice Bridge", stage: 4 }
                                ].map((item, idx) => (
                                    <div key={idx} className="flex items-center gap-3.5 text-xs p-2 rounded-xl bg-slate-950/40 border border-slate-800/40">
                                        <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 transition-all ${
                                            generationStage >= item.stage 
                                                ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20' 
                                                : 'bg-slate-900 border border-slate-800 text-slate-500'
                                        }`}>
                                            {generationStage >= item.stage ? <CheckCircle2 size={14} /> : <Loader2 size={12} className="animate-spin text-blue-400" />}
                                        </div>
                                        <span className={generationStage >= item.stage ? 'text-slate-200 font-bold' : 'text-slate-400'}>
                                            {item.text}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </motion.div>
                    )}

                    {/* =========================================================================
                        STEP 3: ASSETS & WEBSITE SHOWCASE (1 Creative, 1 Video, 1 Astro Website)
                    ========================================================================= */}
                    {step === 'showcase' && (
                        <motion.div
                            key="step-showcase"
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -15 }}
                            className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-2xl"
                        >
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-800">
                                <div>
                                    <span className="text-xs font-black uppercase tracking-widest text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
                                        Autonomous Deliverables Ready
                                    </span>
                                    <h2 className="text-2xl sm:text-3xl font-black text-white mt-2 tracking-tight">
                                        Your Marketing Engine is Assembled
                                    </h2>
                                    <p className="text-sm text-slate-400 mt-1">
                                        Inspect your commercial static creative, 15s voiceover video reel, and live high-converting website.
                                    </p>
                                </div>

                                <button
                                    onClick={handleStartLiveSpeedToLead}
                                    className="px-6 py-3.5 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black text-xs uppercase tracking-wider transition-all shadow-lg shadow-emerald-500/20 active:scale-95 flex items-center gap-2 cursor-pointer shrink-0"
                                >
                                    <span>Test Live Inbound Flow (Real Call &amp; WhatsApp)</span>
                                    <ArrowRight size={16} />
                                </button>
                            </div>

                            {/* View Switcher Tabs */}
                            <div className="flex flex-wrap items-center gap-2.5 my-6">
                                <button
                                    onClick={() => setShowcaseTab('creative')}
                                    className={`px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 transition-all cursor-pointer ${
                                        showcaseTab === 'creative'
                                            ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                                            : 'bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-800'
                                    }`}
                                >
                                    <Layers size={14} />
                                    <span>Static Ad Creative (3:4)</span>
                                </button>

                                <button
                                    onClick={() => setShowcaseTab('video')}
                                    className={`px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 transition-all cursor-pointer ${
                                        showcaseTab === 'video'
                                            ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                                            : 'bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-800'
                                    }`}
                                >
                                    <Film size={14} />
                                    <span>15s Voiceover Video (9:16)</span>
                                </button>

                                <button
                                    onClick={() => setShowcaseTab('website')}
                                    className={`px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 transition-all cursor-pointer ${
                                        showcaseTab === 'website'
                                            ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                                            : 'bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-800'
                                    }`}
                                >
                                    <Globe size={14} />
                                    <span>Live Website (Astro JS)</span>
                                </button>
                            </div>

                            {/* TAB 1: SINGLE STATIC CREATIVE (CLEAN & FRAMELESS) */}
                            {showcaseTab === 'creative' && (
                                <div className="max-w-md mx-auto">
                                    <div className="rounded-2xl p-4 bg-slate-950/60 border border-slate-800 shadow-xl">
                                        <div className="flex items-center justify-between mb-3 text-xs">
                                            <span className="font-black text-blue-400 uppercase tracking-wider">
                                                3:4 Sponsored Ad Creative
                                            </span>
                                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-bold">
                                                Frameless High-Converting Visual
                                            </span>
                                        </div>

                                        <div className="w-full aspect-[3/4] rounded-xl overflow-hidden bg-black relative border border-slate-800 shadow-2xl">
                                            <img
                                                src={creative?.imageUrl || projectImageUrl}
                                                alt="Ad Creative"
                                                className="w-full h-full object-cover"
                                            />
                                        </div>

                                        <div className="mt-4 flex items-center justify-between pt-3 border-t border-slate-800/80 text-xs">
                                            <span className="text-slate-400 font-medium">Ready for Meta Sponsored Feed &amp; Socials</span>
                                            <a
                                                href={creative?.imageUrl || projectImageUrl}
                                                target="_blank"
                                                download="ad_creative.jpg"
                                                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1.5 transition-all"
                                            >
                                                <Download size={13} />
                                                <span>Download HD</span>
                                            </a>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* TAB 2: 15-SECOND VOICEOVER VIDEO REEL */}
                            {/* TAB 2: 15s VOICE-OVER VIDEO REEL */}
                            {showcaseTab === 'video' && generatedVideo && (
                                <div className="max-w-md mx-auto">
                                    <div className="rounded-3xl p-6 bg-gradient-to-b from-slate-900/90 to-slate-950/90 border border-slate-800/80 text-center shadow-2xl backdrop-blur-xl ring-1 ring-white/10">
                                        <div className="flex items-center justify-between mb-4 text-xs">
                                            <span className="font-black text-blue-400 uppercase tracking-wider flex items-center gap-2">
                                                <Film size={16} />
                                                {generatedVideo.title}
                                            </span>
                                            <span className="text-[10px] px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 font-black border border-emerald-500/20 flex items-center gap-1.5">
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                                15s • 9:16 Custom Reel
                                            </span>
                                        </div>

                                        {/* Smartphone Mockup Frame */}
                                        <div className="relative mx-auto w-[280px] sm:w-[320px] aspect-[9/16] rounded-[44px] p-3 bg-gradient-to-b from-slate-700 via-slate-800 to-slate-900 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] ring-1 ring-white/20">
                                            {/* Dynamic Island */}
                                            <div className="absolute top-5 left-1/2 -translate-x-1/2 w-24 h-6 bg-black rounded-full z-30 flex items-center justify-between px-3">
                                                <span className="w-2.5 h-2.5 rounded-full bg-slate-900" />
                                                <span className="w-2.5 h-2.5 rounded-full bg-blue-900/50" />
                                            </div>

                                            {/* Screen Area */}
                                            <div className="w-full h-full rounded-[36px] overflow-hidden bg-black relative">
                                                <video
                                                    src={generatedVideo.videoUrl}
                                                    controls
                                                    autoPlay
                                                    loop
                                                    playsInline
                                                    className="w-full h-full object-cover"
                                                />
                                            </div>
                                        </div>

                                        {/* Action Strip */}
                                        <div className="mt-5 flex items-center justify-between gap-3 text-xs">
                                            <span className="text-slate-400 text-left font-medium">
                                                🎙️ Custom Spoken Voiceover + Ken Burns Motion
                                            </span>
                                            <a
                                                href={generatedVideo.videoUrl}
                                                target="_blank"
                                                download
                                                className="px-4 py-2 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 font-bold flex items-center gap-1.5 transition-all cursor-pointer shrink-0"
                                            >
                                                <Download size={14} />
                                                <span>Download MP4</span>
                                            </a>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* TAB 3: HIGH-CONVERTING ASTRO JS WEBSITE PREVIEW */}
                            {showcaseTab === 'website' && (
                                <div className="space-y-4">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-slate-950/60 border border-slate-800 rounded-2xl">
                                        {/* Device Toggles */}
                                        <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
                                            <button
                                                onClick={() => setWebsiteDevice('desktop')}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                                                    websiteDevice === 'desktop' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                                                }`}
                                            >
                                                <Monitor size={14} />
                                                <span>Desktop</span>
                                            </button>
                                            <button
                                                onClick={() => setWebsiteDevice('tablet')}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                                                    websiteDevice === 'tablet' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                                                }`}
                                            >
                                                <Tablet size={14} />
                                                <span>Tablet</span>
                                            </button>
                                            <button
                                                onClick={() => setWebsiteDevice('mobile')}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                                                    websiteDevice === 'mobile' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                                                }`}
                                            >
                                                <Smartphone size={14} />
                                                <span>Mobile</span>
                                            </button>
                                        </div>

                                        {/* Open Fullsite Button */}
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-slate-400 truncate max-w-xs hidden md:inline">
                                                {companyName.toLowerCase().replace(/[^a-z0-9]/g, '')}.nobogent.com
                                            </span>
                                            <button
                                                onClick={() => {
                                                    if (websiteHtml) {
                                                        const blob = new Blob([websiteHtml], { type: 'text/html;charset=utf-8' });
                                                        const blobUrl = URL.createObjectURL(blob);
                                                        window.open(blobUrl, '_blank');
                                                    } else {
                                                        window.open(websitePreviewUrl, '_blank');
                                                    }
                                                }}
                                                className="px-4 py-2 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
                                            >
                                                <span>Open Live Site in New Tab</span>
                                                <ExternalLink size={13} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Responsive Mockup Container */}
                                    <div className="w-full flex justify-center bg-slate-950 p-4 rounded-2xl border border-slate-800 overflow-hidden min-h-[560px]">
                                        <div className={`transition-all duration-300 rounded-xl overflow-hidden shadow-2xl border border-slate-800 bg-white ${
                                            websiteDevice === 'desktop' ? 'w-full h-[620px]' : websiteDevice === 'tablet' ? 'w-[768px] h-[620px]' : 'w-[375px] h-[620px]'
                                        }`}>
                                            <iframe
                                                srcDoc={websiteHtml || undefined}
                                                src={!websiteHtml ? websitePreviewUrl : undefined}
                                                title="Astro Demo Website"
                                                className="w-full h-full border-0"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    )}

                    {/* =========================================================================
                        STEP 4: SPEED-TO-LEAD DEMONSTRATION (Real WhatsApp + Real AI Outbound Call)
                    ========================================================================= */}
                    {step === 'speed_to_lead' && (
                        <motion.div
                            key="step-speed-to-lead"
                            initial={{ opacity: 0, scale: 0.96 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.96 }}
                            className="bg-slate-900/90 border border-blue-500/30 rounded-3xl p-6 sm:p-10 shadow-2xl shadow-blue-500/10 max-w-2xl mx-auto text-center"
                        >
                            <span className="text-xs font-black uppercase tracking-widest text-blue-400 bg-blue-500/10 px-3.5 py-1 rounded-full border border-blue-500/20">
                                Live Telephony &amp; WhatsApp Integration
                            </span>

                            <div className="mt-6 relative w-24 h-24 mx-auto">
                                <div className="absolute inset-0 rounded-full border-2 border-blue-400/30 animate-ping" />
                                <div className="w-full h-full rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-xl shadow-blue-600/40">
                                    <Phone size={36} className={callStatus === 'ringing' ? 'animate-bounce' : ''} />
                                </div>
                            </div>

                            <h2 className="text-2xl sm:text-3xl font-black text-white mt-4">
                                {callStatus === 'ringing' ? 'Ringing Your Mobile Phone...' : callStatus === 'in_call' ? 'Call in Progress with AI Executive' : 'Calling Your Number...'}
                            </h2>

                            <div className="mt-2 text-sm text-blue-400 font-mono font-bold">
                                {callerNumber} ➔ +91 {prospectPhone.slice(-10)} ({formatTimer(callTimer)})
                            </div>

                            {/* Soundwave animation */}
                            <div className="flex items-center justify-center gap-1.5 my-6 h-10">
                                {[30, 70, 45, 90, 60, 100, 40, 80, 50, 95, 35, 75, 45].map((h, i) => (
                                    <div
                                        key={i}
                                        style={{ height: `${h}%` }}
                                        className="w-1.5 bg-gradient-to-t from-blue-500 to-indigo-400 rounded-full animate-pulse"
                                    />
                                ))}
                            </div>

                            {/* WhatsApp Status Card */}
                            <div className="p-4 rounded-2xl bg-emerald-950/30 border border-emerald-500/40 text-left text-xs mb-4 shadow-lg shadow-emerald-950/20">
                                <div className="flex items-center justify-between text-emerald-400 font-bold mb-1.5">
                                    <span className="flex items-center gap-1.5">
                                        <MessageCircle size={15} />
                                        WhatsApp Message (From Nobogent Verified: +91 98771 61216):
                                    </span>
                                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-black border border-emerald-500/30">
                                        {whatsappDelivered ? '✓✓ Delivered from Nobogent' : 'Dispatched'}
                                    </span>
                                </div>
                                <p className="text-slate-300 leading-relaxed">
                                    Sent from Nobogent's official WhatsApp Business number directly to your phone (+91 {prospectPhone.slice(-10)}) with your project inquiry details for <strong>{projectTitle}</strong>.
                                </p>
                            </div>

                            {callSummary && (
                                <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 text-xs text-left mb-4">
                                    <strong className="text-slate-300">Live AI Transcript Summary:</strong>
                                    <p className="text-slate-400 mt-1 italic">{callSummary}</p>
                                </div>
                            )}

                            {/* Continue CTA */}
                            <div className="mt-8 pt-4 border-t border-slate-800 flex items-center justify-between">
                                <span className="text-xs text-slate-400">Done testing your phone?</span>
                                <button
                                    onClick={goToPricingComparison}
                                    className="px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black text-xs uppercase tracking-wider transition-all shadow-lg shadow-emerald-500/20 active:scale-95 cursor-pointer"
                                >
                                    <span>View Pricing &amp; Service Comparison ➔</span>
                                </button>
                            </div>
                        </motion.div>
                    )}

                    {/* =========================================================================
                        STEP 5: GRAND COMPARISON SCREEN (Rs. 9,999 + GST vs Agency)
                    ========================================================================= */}
                    {step === 'pricing_comparison' && (
                        <motion.div
                            key="step-pricing-comparison"
                            initial={{ opacity: 0, scale: 0.96 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-10 shadow-2xl backdrop-blur-2xl"
                        >
                            {/* Headline Banner */}
                            <div className="text-center max-w-3xl mx-auto mb-10">
                                <span className="text-xs font-black uppercase tracking-widest text-amber-400 bg-amber-500/10 px-3.5 py-1 rounded-full border border-amber-500/20">
                                    ⚡ Autonomous Growth Stack • 95% Cost Reduction
                                </span>
                                <h2 className="text-3xl sm:text-5xl font-black text-white mt-4 tracking-tight">
                                    Everything You Experienced: <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-300 to-amber-300">₹9,999 / Month</span>
                                </h2>
                                <p className="text-sm sm:text-base text-slate-400 mt-3 max-w-2xl mx-auto">
                                    No marketing agency retainers. No freelancers to manage. Zero human fulfillment delays. The entire commercial engine operates 24x7 autonomously.
                                </p>
                            </div>

                            {/* Contrast Highlights Cards */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
                                {/* Agency Card */}
                                <div className="p-6 rounded-3xl bg-red-950/20 border border-red-500/30 flex flex-col justify-between">
                                    <div>
                                        <div className="flex items-center justify-between text-xs font-bold text-red-400 mb-2 uppercase tracking-wider">
                                            <span>Traditional Marketing Agency</span>
                                            <span>Typical Retainer</span>
                                        </div>
                                        <div className="text-3xl font-black text-white">
                                            ₹1,85,000 - ₹2,50,000<span className="text-sm font-normal text-slate-400"> / month</span>
                                        </div>
                                        <ul className="mt-4 space-y-2 text-xs text-slate-400">
                                            <li className="flex items-center gap-2">
                                                <XCircle size={14} className="text-red-400 shrink-0" />
                                                <span>3 to 4 weeks setup time before first ad goes live</span>
                                            </li>
                                            <li className="flex items-center gap-2">
                                                <XCircle size={14} className="text-red-400 shrink-0" />
                                                <span>Manual telecallers miss 60% of after-hours leads</span>
                                            </li>
                                            <li className="flex items-center gap-2">
                                                <XCircle size={14} className="text-red-400 shrink-0" />
                                                <span>Extra charges for landing page edits and video production</span>
                                            </li>
                                        </ul>
                                    </div>
                                    <div className="mt-6 pt-4 border-t border-red-500/20 text-xs font-bold text-red-300">
                                        Total Yearly Burn: ₹22,00,000+
                                    </div>
                                </div>

                                {/* Nobogent Card */}
                                <div className="p-6 rounded-3xl bg-gradient-to-br from-blue-950/60 to-indigo-950/60 border-2 border-blue-500 shadow-xl shadow-blue-500/10 flex flex-col justify-between relative overflow-hidden">
                                    <div className="absolute top-0 right-0 bg-gradient-to-l from-amber-400 to-amber-500 text-slate-950 text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-bl-xl shadow-md">
                                        RECOMMENDED
                                    </div>

                                    <div>
                                        <div className="flex items-center justify-between text-xs font-bold text-blue-400 mb-2 uppercase tracking-wider">
                                            <span>Nobogent Autonomous OS</span>
                                            <span className="text-amber-300">Zero Fulfillment</span>
                                        </div>
                                        <div className="text-4xl font-black text-white">
                                            ₹9,999<span className="text-sm font-bold text-slate-300"> + GST / month</span>
                                        </div>
                                        <ul className="mt-4 space-y-2 text-xs text-slate-300">
                                            <li className="flex items-center gap-2">
                                                <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                                                <span>Instant setup: Live in under 60 seconds from onboarding</span>
                                            </li>
                                            <li className="flex items-center gap-2">
                                                <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                                                <span>Instant &lt;30 second AI calling &amp; WhatsApp qualification</span>
                                            </li>
                                            <li className="flex items-center gap-2">
                                                <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                                                <span>10 Videos + 30 Images + Astro Website + 5 Team Seats</span>
                                            </li>
                                        </ul>
                                    </div>
                                    <div className="mt-6 pt-4 border-t border-blue-500/30 text-xs font-bold text-emerald-400">
                                        Save Over ₹20,00,000 Annually
                                    </div>
                                </div>
                            </div>

                            {/* Full 12-Item Comparison Table */}
                            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 overflow-hidden mb-8">
                                <div className="px-6 py-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-xs font-black uppercase tracking-wider text-slate-400">
                                    <span>Included Services (12-Point Autonomous Stack)</span>
                                    <div className="flex items-center gap-8 text-right">
                                        <span className="hidden sm:inline w-28 text-red-400">Agency Cost</span>
                                        <span className="w-36 text-emerald-400">Nobogent (₹9,999)</span>
                                    </div>
                                </div>

                                <div className="divide-y divide-slate-800/80">
                                    {SERVICE_COMPARISONS.map((item, idx) => (
                                        <div key={idx} className="px-6 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-slate-900/40 transition-colors">
                                            <div className="flex items-center gap-3">
                                                <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
                                                    <item.icon size={14} />
                                                </div>
                                                <div>
                                                    <span className="text-xs font-bold text-white block">{item.name}</span>
                                                    <span className="text-[11px] text-slate-500 hidden md:block">{item.nobogentStatus}</span>
                                                </div>
                                            </div>

                                            <div className="flex items-center justify-between sm:justify-end gap-8 text-xs font-mono">
                                                <span className="text-red-400 line-through sm:w-28 sm:text-right">{item.agencyCost}</span>
                                                <span className="text-emerald-400 font-bold sm:w-36 sm:text-right flex items-center gap-1 justify-end">
                                                    <Check size={14} /> Included Free
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Call To Action Buttons */}
                            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4 border-t border-slate-800">
                                <button
                                    onClick={() => setStep('onboarding')}
                                    className="w-full sm:w-auto px-6 py-4 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer"
                                >
                                    <RefreshCw size={14} />
                                    <span>Test Another Brand</span>
                                </button>

                                <a
                                    href="/login"
                                    className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-amber-500 hover:from-blue-500 hover:to-amber-400 text-white font-black text-sm uppercase tracking-wider transition-all shadow-xl shadow-blue-600/30 active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                                >
                                    <span>Get Started for ₹9,999 / mo</span>
                                    <ArrowRight size={16} />
                                </a>
                            </div>
                        </motion.div>
                    )}

                </AnimatePresence>
            </main>

            {/* FOOTER */}
            <footer className="w-full max-w-7xl mx-auto px-6 py-6 border-t border-slate-800/80 text-center text-xs text-slate-500 z-20 flex flex-col sm:flex-row items-center justify-between gap-2">
                <span>© 2026 Nobogent Technologies Inc. Autonomous AI Sales &amp; Marketing Engine.</span>
                <span className="flex items-center gap-2 text-slate-400">
                    <span>Vobiz Telephony</span> • <span>Meta Graph API</span> • <span>Astro JS Framework</span>
                </span>
            </footer>
        </div>
    );
}
