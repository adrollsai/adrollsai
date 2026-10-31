'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Sparkles,
    Building2,
    Upload,
    ArrowRight,
    CheckCircle2,
    CheckCircle,
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
    Calendar,
    Users,
    Share2,
    BarChart3,
    Database,
    Headphones,
    Send,
    Bot,
    CheckCheck,
    Play,
    Edit3,
    SmartphoneNfc,
    Search,
    X,
    Maximize2,
    Trash2,
    ImageIcon,
    PhoneCall,
    Palette,
    SlidersHorizontal,
    Type
} from 'lucide-react';
import { Player } from '@remotion/player';
import { CaptionsComposition, Caption, Effect, Theme } from '@/remotion/CaptionsComposition';
import { SUBTITLE_THEMES, ANIMATION_OPTIONS, DEFAULT_SUBTITLE_THEME } from '@/remotion/Constants';
// @ts-ignore
import confetti from 'canvas-confetti';
import { toast } from 'sonner';
import {
    ALL_REFERENCE_TEMPLATES,
    getReferenceTemplate,
    ReferenceTemplate
} from '@/utils/reference-templates-data';

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
    scriptText?: string;
    scriptCues?: Array<{ start?: number; end?: number; time?: number; text: string; emphasis?: boolean }>;
    captionStyle?: string;
    audioUrl?: string;
}

const POPULAR_INDIAN_LANGUAGES = [
    { value: 'hinglish', label: 'Hinglish (Hindi + English)' },
    { value: 'hindi', label: 'Hindi (हिन्दी)' },
    { value: 'english', label: 'English (Indian English)' },
    { value: 'punjabi', label: 'Punjabi (ਪੰਜਾਬੀ)' },
    { value: 'marathi', label: 'Marathi (मराठी)' },
    { value: 'gujarati', label: 'Gujarati (ગુજરાતી)' },
    { value: 'telugu', label: 'Telugu (తెలుగు)' },
    { value: 'tamil', label: 'Tamil (தமிழ்)' },
    { value: 'kannada', label: 'Kannada (ಕನ್ನಡ)' },
    { value: 'bengali', label: 'Bengali (বাংলা)' },
];

const PRESET_PROJECTS = [
    {
        name: 'The Grand Crest Luxury Residences',
        company: 'Apex Luxury Developments',
        price: '₹1.85 Cr',
        location: 'Golf Course Extension, Prime Metro Corridor',
        desc: 'Ultra-luxury 3 & 4 BHK residences with sky terraces, private infinity pool, Italian marble finishes, and 24x7 smart concierge.',
        image: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1400&q=80',
        logo: '',
        themeId: 'emerald'
    },
    {
        name: 'The Royal Palm Sky Mansions',
        company: 'Elysian Group',
        price: '₹2.45 Cr',
        location: 'Sector 82, Mohali Luxury Belt',
        desc: 'Exclusive 4BHK Sky Mansions featuring private infinity plunge pool, double-height ceilings, and panoramic golf course views.',
        image: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1400&q=80',
        logo: '',
        themeId: 'obsidian'
    }
];

interface ThemePalette {
    id: string;
    name: string;
    brand: string;
    accent: string;
    category: string;
}

const BRAND_THEMES: ThemePalette[] = [
    {
        id: 'emerald',
        name: 'Emerald Royal',
        brand: '#0e5b4e',
        accent: '#c79a4b',
        category: 'Classic Luxury'
    },
    {
        id: 'obsidian',
        name: 'Obsidian Penthouse',
        brand: '#0b1220',
        accent: '#d97706',
        category: 'Dark Modern'
    },
    {
        id: 'sapphire',
        name: 'Sapphire Waterfront',
        brand: '#1e3a8a',
        accent: '#0284c7',
        category: 'Coastal Marina'
    },
    {
        id: 'burgundy',
        name: 'Burgundy Heritage',
        brand: '#5b132b',
        accent: '#e09f67',
        category: 'Sovereign Estate'
    },
    {
        id: 'espresso',
        name: 'Tuscan Espresso',
        brand: '#3e2723',
        accent: '#b08968',
        category: 'Tuscan Villa'
    },
    {
        id: 'indigo',
        name: 'Royal Indigo',
        brand: '#312e81',
        accent: '#f59e0b',
        category: 'Architectural Gold'
    }
];

const REFERENCE_TEMPLATES = ALL_REFERENCE_TEMPLATES;

const SERVICE_COMPARISONS = [
    {
        name: 'Daily AI Image Creative',
        category: 'Omnichannel Creatives',
        agencyCost: '₹20,000/mo',
        agencyNote: 'Slow freelance turnarounds, cookie-cutter graphics',
        nobogentStatus: 'Daily Fresh Creative via WhatsApp 1-Tap Approval',
        icon: Layers
    },
    {
        name: 'Monthly Cinematic Videos (30s Reels)',
        category: 'Short-Form Reels',
        agencyCost: '₹35,000/mo',
        agencyNote: 'Costly freelance video editors',
        nobogentStatus: 'Studio-Grade 9:16 Reels with Multilingual Voiceover',
        icon: Film
    },
    {
        name: 'AI Voice Calling (500 Mins Included)',
        category: 'Sales Qualification',
        agencyCost: '₹40,000/mo',
        agencyNote: 'Manual telecaller salaries & missed leads',
        nobogentStatus: 'Instant <30s Inbound/Outbound Multilingual Closer',
        icon: Phone
    },
    {
        name: '24/7 AI WhatsApp Chatbot',
        category: 'Lead Conversions',
        agencyCost: '₹20,000/mo',
        agencyNote: 'Rule-based bots with high monthly fees',
        nobogentStatus: 'Autonomous Bot with Digital Brochure & Site Visit Drips',
        icon: MessageCircle
    },
    {
        name: 'Weekly WhatsApp Broadcasts',
        category: 'Re-engagement Campaigns',
        agencyCost: '₹15,000/mo',
        agencyNote: 'Manual CSV exports, frequent number bans',
        nobogentStatus: 'Automated 1x Weekly Personalized Drip',
        icon: Send
    },
    {
        name: 'Real Estate CRM Pipeline',
        category: 'Sales Pipeline',
        agencyCost: '₹25,000/mo',
        agencyNote: 'Per-seat fees & complex onboarding',
        nobogentStatus: 'Built-in 5-Stage Kanban & Native Meta CAPI',
        icon: Database
    },
    {
        name: 'High-Converting Website',
        category: 'Direct-Response Landing Page',
        agencyCost: '₹45,000',
        agencyNote: 'Bloated WordPress themes with slow load speeds',
        nobogentStatus: 'Ultra-Fast Sub-Second Astro Architecture',
        icon: Globe
    },
    {
        name: 'Cloud Hosting & SSL',
        category: 'Infrastructure',
        agencyCost: '₹5,000/mo',
        agencyNote: 'Separate VPS bills & SSL maintenance',
        nobogentStatus: 'Global Edge CDN & SSL Included Forever',
        icon: Zap
    },
    {
        name: 'Real-Time ROI Analytics',
        category: 'Attribution & Tracking',
        agencyCost: '₹10,000/mo',
        agencyNote: 'Monthly spreadsheets delivered 2 weeks late',
        nobogentStatus: 'Live Visual ROI & Speed-to-Lead Metrics',
        icon: BarChart3
    },
    {
        name: 'Team Access (5 Members)',
        category: 'Collaboration',
        agencyCost: '₹15,000/mo',
        agencyNote: 'Extra seat fees on third-party CRMs',
        nobogentStatus: 'Role-Based Seats for 5 Team Members',
        icon: Users
    },
    {
        name: 'Auto Social Media Posting',
        category: 'Omnichannel Distribution',
        agencyCost: '₹15,000/mo',
        agencyNote: 'Manual social media intern',
        nobogentStatus: '1-Tap WhatsApp Approval to IG, FB & LinkedIn',
        icon: Share2
    },
    {
        name: 'Dedicated Relationship Manager',
        category: 'Customer Support',
        agencyCost: '₹20,000/mo',
        agencyNote: 'Junior account reps juggling 30 accounts',
        nobogentStatus: 'Priority WhatsApp & Dedicated Technical Manager',
        icon: Headphones
    }
];

const CAPTION_COLOR_SWATCHES = [
    '#F59E0B', // Amber Gold
    '#FFE600', // Hormozi Yellow
    '#39FF14', // Neon Green
    '#00EAFF', // Cyber Cyan
    '#FF007F', // Neon Magenta
    '#EF4444', // Crimson Red
    '#FFFFFF', // Crisp White
    '#A855F7', // Electric Violet
];

export default function DemoPage() {
    const [step, setStep] = useState<DemoStep>('onboarding');

    // Onboarding Form States
    const [companyName, setCompanyName] = useState('Apex Luxury Developments');
    const [projectTitle, setProjectTitle] = useState('The Grand Crest Luxury Residences');
    const [projectPrice, setProjectPrice] = useState('₹1.85 Cr');
    const [location, setLocation] = useState('Golf Course Extension, Prime Metro Corridor');
    const [projectDescription, setProjectDescription] = useState('Ultra-luxury 3 & 4 BHK residences with sky terraces, private infinity pool, Italian marble finishes, and 24x7 smart concierge.');
    const [prospectName, setProspectName] = useState('Raman');
    const [prospectPhone, setProspectPhone] = useState('');
    const [videoLanguage, setVideoLanguage] = useState<string>('hinglish');
    const [callLanguage, setCallLanguage] = useState<string>('hinglish');
    const [voiceName, setVoiceName] = useState('Kore');
    const [websiteUrl, setWebsiteUrl] = useState('');
    const [extractingWebsite, setExtractingWebsite] = useState(false);

    // Media states
    const [selectedTemplateId, setSelectedTemplateId] = useState('pinterest_pin_0');
    const [projectImageUrl, setProjectImageUrl] = useState('https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/reference-creatives/dubai/pinterest_pin_1793111079523_0.jpg');
    const [isCustomImageUploaded, setIsCustomImageUploaded] = useState(false);
    const [logoUrl, setLogoUrl] = useState('');
    const [uploadingImage, setUploadingImage] = useState(false);
    const [uploadingLogo, setUploadingLogo] = useState(false);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const logoInputRef = useRef<HTMLInputElement>(null);

    // Branding Theme & Color Scheme States
    const [selectedTheme, setSelectedTheme] = useState<ThemePalette>(BRAND_THEMES[0]);
    const [customBrandColor, setCustomBrandColor] = useState('#0e5b4e');
    const [customAccentColor, setCustomAccentColor] = useState('#c79a4b');
    const [isCustomColorActive, setIsCustomColorActive] = useState(false);

    const activeBrandColor = isCustomColorActive ? customBrandColor : selectedTheme.brand;
    const activeAccentColor = isCustomColorActive ? customAccentColor : selectedTheme.accent;

    // Modal & Lightbox states
    const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
    const [templateSearchQuery, setTemplateSearchQuery] = useState('');
    const [templateCategoryFilter, setTemplateCategoryFilter] = useState<'all' | 'high_converting' | 'premium'>('all');
    const [imageLightboxUrl, setImageLightboxUrl] = useState<string | null>(null);

    // Asset Generation States
    const [isGenerating, setIsGenerating] = useState(false);
    const [generationStage, setGenerationStage] = useState(0);
    const [creative, setCreative] = useState<GeneratedCreative | null>(null);
    const [generatedVideo, setGeneratedVideo] = useState<GeneratedVideo | null>(null);

    // Remotion AI Caption Studio States
    const [isMounted, setIsMounted] = useState(false);
    const [selectedCaptionTheme, setSelectedCaptionTheme] = useState<string>('goldenLuxury');
    const [captionThemeConfig, setCaptionThemeConfig] = useState<Theme>(DEFAULT_SUBTITLE_THEME);
    const [captionStudioTab, setCaptionStudioTab] = useState<'styles' | 'animations' | 'custom' | 'subtitles'>('styles');
    const [editableCues, setEditableCues] = useState<Caption[]>([]);
    const remotionPlayerRef = useRef<any>(null);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    useEffect(() => {
        if (generatedVideo?.scriptCues && generatedVideo.scriptCues.length > 0) {
            setEditableCues(generatedVideo.scriptCues.map((c, i) => ({
                text: c.text,
                start: c.start ?? (i * 4.2),
                end: c.end ?? ((i + 1) * 4.2),
                emphasis: c.emphasis || i === 0 || i === 3
            })));
        } else {
            setEditableCues([
                { start: 0.5, end: 4.8, text: `${companyName || 'Nobogent'} presents ${projectTitle || 'Chandigarh Residencies'}`, emphasis: true },
                { start: 4.8, end: 9.2, text: `Experience bespoke architectural luxury at ${location || 'Prime Metro Corridor'}`, emphasis: false },
                { start: 9.2, end: 13.5, text: `Ultra luxury residences crafted with panoramic views and world-class amenities`, emphasis: true },
                { start: 13.5, end: 17.8, text: `Inaugural launch price starting at only ${projectPrice || '₹1.85 Cr'}`, emphasis: true },
                { start: 17.8, end: 22.0, text: `Exclusive high ROI launch privilege with flexible investor payment plans`, emphasis: false },
                { start: 22.0, end: 25.8, text: `Limited inventory available — Book your private VIP walkthrough today!`, emphasis: true }
            ]);
        }
    }, [generatedVideo, companyName, projectTitle, location, projectPrice]);

    const handleSelectCaptionTheme = (themeKey: string) => {
        setSelectedCaptionTheme(themeKey);
        const baseTheme = SUBTITLE_THEMES[themeKey] || DEFAULT_SUBTITLE_THEME;
        setCaptionThemeConfig(baseTheme);
        playChime('beep');
    };

    const updateCaptionTheme = (updates: Partial<Theme>) => {
        setCaptionThemeConfig(prev => ({ ...prev, ...updates }));
    };

    // Showcase View States (Clean tabs without numbers)
    const [showcaseTab, setShowcaseTab] = useState<'creative' | 'video' | 'website' | 'call' | 'broadcast' | 'crm'>('creative');
    const [websiteDevice, setWebsiteDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');

    // Video Captions & Outro Overlay States
    const [videoCurrentTime, setVideoCurrentTime] = useState(0);
    const [videoDuration, setVideoDuration] = useState(30);
    const [showVideoOutro, setShowVideoOutro] = useState(false);
    const videoElementRef = useRef<HTMLVideoElement>(null);

    // WhatsApp Dispatch Action States per step
    const [sendingTabWhatsApp, setSendingTabWhatsApp] = useState<string | null>(null);

    // WhatsApp Approval Simulation
    const [approvalStatus, setApprovalStatus] = useState<'pending' | 'approved' | 'revision'>('pending');
    const [revisionInput, setRevisionInput] = useState('');
    const [isRevising, setIsRevising] = useState(false);

    // Chatbot Interactive Simulator
    const [chatMessages, setChatMessages] = useState<Array<{ sender: 'user' | 'bot'; text: string; time: string }>>([
        { sender: 'bot', text: `Hi! Welcome to Apex Luxury Developments. I can help you with floor plans, pricing, and scheduling a VIP site visit for The Grand Crest Luxury Residences. What would you like to know?`, time: '10:00 AM' }
    ]);
    const [chatInput, setChatInput] = useState('');

    // CRM Pipeline Stages
    const [leadPipelineStage, setLeadPipelineStage] = useState<'New Lead' | 'AI Contacted' | 'Qualified' | 'Site Visit Booked' | 'Closed'>('New Lead');

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
                gain.gain.setValueAtTime(0.06, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
                osc.start();
                osc.stop(ctx.currentTime + 0.15);
            } else if (type === 'success') {
                osc.frequency.setValueAtTime(523.25, ctx.currentTime);
                osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.12);
                osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.24);
                gain.gain.setValueAtTime(0.1, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
                osc.start();
                osc.stop(ctx.currentTime + 0.5);
            } else if (type === 'call') {
                osc.frequency.setValueAtTime(400, ctx.currentTime);
                osc.frequency.setValueAtTime(450, ctx.currentTime + 0.2);
                gain.gain.setValueAtTime(0.07, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
                osc.start();
                osc.stop(ctx.currentTime + 0.4);
            }
        } catch { }
    };

    // Website extraction handler
    const handleExtractWebsite = async () => {
        if (!websiteUrl.trim()) {
            toast.error("Please enter a website URL.");
            return;
        }

        setExtractingWebsite(true);
        toast.info("Extracting brand details...");

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
                toast.success("Details extracted!");
            } else {
                toast.error(data.error || "Could not auto-extract details.");
            }
        } catch (e: any) {
            toast.error("Extraction error: " + (e.message || "Failed"));
        } finally {
            setExtractingWebsite(false);
        }
    };

    const currentTemplate = getReferenceTemplate(selectedTemplateId);

    const filteredTemplates = ALL_REFERENCE_TEMPLATES.filter((tmpl) => {
        const matchesCategory =
            templateCategoryFilter === 'all' ||
            tmpl.libraryCategory === templateCategoryFilter;
        const matchesSearch =
            !templateSearchQuery.trim() ||
            tmpl.name.toLowerCase().includes(templateSearchQuery.toLowerCase()) ||
            tmpl.category.toLowerCase().includes(templateSearchQuery.toLowerCase()) ||
            tmpl.badge.toLowerCase().includes(templateSearchQuery.toLowerCase());
        return matchesCategory && matchesSearch;
    });

    // Preset selector
    const handleSelectPreset = (preset: typeof PRESET_PROJECTS[0]) => {
        setProjectTitle(preset.name);
        setCompanyName(preset.company);
        setProjectPrice(preset.price);
        setLocation(preset.location);
        setProjectDescription(preset.desc);
        setProjectImageUrl(preset.image);
        setIsCustomImageUploaded(true);
        if (preset.logo) setLogoUrl(preset.logo);
        if ((preset as any).themeId) {
            const foundTheme = BRAND_THEMES.find(t => t.id === (preset as any).themeId);
            if (foundTheme) {
                setSelectedTheme(foundTheme);
                setIsCustomColorActive(false);
            }
        }
        playChime('beep');
        toast.info(`Loaded: ${preset.name.split(' ')[0]}`);
    };

    // Reference design template selector
    const handleSelectTemplate = (templateId: string) => {
        setSelectedTemplateId(templateId);
        const tmpl = getReferenceTemplate(templateId);
        if (!isCustomImageUploaded) {
            setProjectImageUrl(tmpl.url);
        }
        setIsTemplateModalOpen(false);
        playChime('beep');
        toast.success(`Design Selected: ${tmpl.name}`);
    };

    // Image upload handler using working /api/upload route
    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploadingImage(true);
        toast.info("Uploading your property photo...");

        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('folder', 'demo-uploads');

            const res = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            const data = await res.json();
            if (res.ok && data.url) {
                setProjectImageUrl(data.url);
                setIsCustomImageUploaded(true);
                playChime('success');
                toast.success("Property photo uploaded!");
            } else {
                toast.error(data.error || "Upload failed");
            }
        } catch (err: any) {
            toast.error("Upload error: " + err.message);
        } finally {
            setUploadingImage(false);
            if (imageInputRef.current) imageInputRef.current.value = '';
        }
    };

    // Remove or reset project image back to the selected template's default
    const handleRemoveProjectImage = () => {
        const tmpl = getReferenceTemplate(selectedTemplateId);
        setProjectImageUrl(tmpl.url);
        setIsCustomImageUploaded(false);
        toast.info("Reverted to reference template photo");
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
                toast.success("Logo uploaded!");
            } else {
                toast.error(data.error || "Logo upload failed");
            }
        } catch (err: any) {
            toast.error("Logo upload error: " + err.message);
        } finally {
            setUploadingLogo(false);
            if (logoInputRef.current) logoInputRef.current.value = '';
        }
    };

    const handleRemoveLogo = () => {
        setLogoUrl('');
        toast.info("Logo removed");
    };

    // Trigger Asset Generation (Real Creative, Real 30s Video, Real Website)
    const handleStartCreativeGeneration = async (stayInShowcase = false) => {
        if (!companyName.trim() || !projectTitle.trim()) {
            toast.error("Company Name and Project Title are required.");
            return;
        }

        if (!prospectPhone.trim() || prospectPhone.replace(/\D/g, '').length < 10) {
            toast.error("Please enter a valid 10-digit mobile number.");
            return;
        }

        if (!stayInShowcase) {
            setStep('generating_assets');
        }
        setIsGenerating(true);
        setGenerationStage(1);
        playChime('beep');

        const stageInterval = setInterval(() => {
            setGenerationStage(prev => {
                if (prev < 4) return prev + 1;
                return prev;
            });
        }, 2200);

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
                    contactNumber: prospectPhone,
                    videoLanguage,
                    callLanguage,
                    templateId: selectedTemplateId
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

            setGenerationStage(4);
            setIsGenerating(false);
            setStep('showcase');
            playChime('success');
            toast.success("Assets generated successfully!");

        } catch (err: any) {
            clearInterval(stageInterval);
            console.error("Asset generation failed:", err);
            toast.error(err.message || "Failed to generate assets.");
            setIsGenerating(false);
            // Do not kick user back to onboarding on error; keep them in showcase to test other features
            if (!stayInShowcase && step === 'generating_assets') {
                setStep('showcase');
            }
        }
    };

    // Skip creation step and jump directly to showcase to test AI calling or WhatsApp
    const handleSkipToLiveDemo = (targetTab: 'call' | 'broadcast' | 'website' = 'call') => {
        if (!prospectPhone.trim() || prospectPhone.replace(/\D/g, '').length < 10) {
            toast.error("Please enter your 10-digit phone number to test live AI Calling & WhatsApp.");
            return;
        }
        setStep('showcase');
        setShowcaseTab(targetTab);
        playChime('success');
        toast.success("Ready to test live AI Calling & WhatsApp!");
    };

    // Video player synchronized time tracking & outro detection
    const handleVideoTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
        const time = e.currentTarget.currentTime;
        const dur = e.currentTarget.duration || 30;
        setVideoCurrentTime(time);
        setVideoDuration(dur);
        // Display animated Outro Card in the last 4 seconds
        if (dur > 0 && time >= dur - 4.5) {
            setShowVideoOutro(true);
        } else {
            setShowVideoOutro(false);
        }
    };

    const handleReplayVideo = () => {
        if (videoElementRef.current) {
            videoElementRef.current.currentTime = 0;
            videoElementRef.current.play().catch(() => { });
            setShowVideoOutro(false);
        }
    };

    // Generic WhatsApp dispatcher for each step's action button
    const handleSendStepWhatsApp = async (type: string, successMsg: string) => {
        if (!prospectPhone || prospectPhone.replace(/\D/g, '').length < 10) {
            toast.error("Please enter a valid 10-digit mobile number.");
            return;
        }

        setSendingTabWhatsApp(type);
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
                    creativeUrl: creative?.imageUrl || projectImageUrl,
                    imageUrl: creative?.imageUrl || projectImageUrl,
                    type
                })
            });

            const data = await res.json();
            if (res.ok && data.success) {
                playChime('success');
                toast.success(successMsg);
            } else {
                toast.error(data.error || "WhatsApp delivery failed");
            }
        } catch (e: any) {
            toast.error("WhatsApp error: " + e.message);
        } finally {
            setSendingTabWhatsApp(null);
        }
    };

    // Trigger Outbound AI Call
    const handleStartLiveSpeedToLead = async () => {
        if (!prospectPhone.trim() || prospectPhone.replace(/\D/g, '').length < 10) {
            toast.error("Please enter a valid 10-digit mobile number to receive the AI call.");
            return;
        }

        setStep('speed_to_lead');
        setIsDialingCall(true);
        setCallStatus('dialing');
        setLeadPipelineStage('AI Contacted');
        playChime('call');

        // Dispatch initial WhatsApp template
        handleSendStepWhatsApp('lead_welcome', `WhatsApp message dispatched to +91 ${prospectPhone.slice(-10)}`);

        // Trigger real outbound AI call
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
                    language: callLanguage,
                    voiceName
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to trigger AI call");

            setCallLeadId(data.leadId);
            if (data.callerNumber) setCallerNumber(data.callerNumber);
            setCallStatus('ringing');
            toast.success(`Dialing +91 ${prospectPhone.slice(-10)}... Answer to speak with AI!`);

        } catch (err: any) {
            console.error("AI Call trigger failed:", err);
            toast.error(err.message || "Failed to place call.");
            setCallStatus('error');
        } finally {
            setIsDialingCall(false);
        }
    };

    // Revision feedback
    const handleRequestRevision = (feedbackText: string) => {
        if (!feedbackText.trim()) return;
        setIsRevising(true);
        toast.info(`Updating: "${feedbackText}"...`);
        setTimeout(() => {
            setIsRevising(false);
            setApprovalStatus('pending');
            setRevisionInput('');
            playChime('success');
            toast.success("Creative updated with your feedback!");
        }, 1200);
    };

    // Chatbot demo message
    const handleSendChatMessage = (msgText?: string) => {
        const text = msgText || chatInput;
        if (!text.trim()) return;

        const userMsg = { sender: 'user' as const, text, time: 'Just now' };
        setChatMessages(prev => [...prev, userMsg]);
        setChatInput('');

        setTimeout(() => {
            let botReply = `Thank you for your interest in ${projectTitle}. Located in ${location}, starting at ${projectPrice}. Would you like to schedule a VIP preview visit?`;

            const lower = text.toLowerCase();
            if (lower.includes('brochure') || lower.includes('pdf')) {
                botReply = `Here is the digital brochure for ${projectTitle} with floor plans and amenities. Can I schedule a call with our property advisor?`;
            } else if (lower.includes('price') || lower.includes('cost') || lower.includes('payment')) {
                botReply = `Pricing for ${projectTitle} starts at ${projectPrice} with a flexible 20:80 payment plan. Early buyers get complimentary Italian marble upgrades.`;
            } else if (lower.includes('visit') || lower.includes('tour') || lower.includes('tomorrow') || lower.includes('weekend')) {
                botReply = `Your VIP site visit is reserved for this weekend at ${projectTitle} in ${location}. A confirmation has been sent to your WhatsApp!`;
                setLeadPipelineStage('Site Visit Booked');
            }

            setChatMessages(prev => [...prev, { sender: 'bot' as const, text: botReply, time: 'Just now' }]);
            playChime('beep');
        }, 600);
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

    // Poll live lead status
    useEffect(() => {
        if (!callLeadId || step !== 'speed_to_lead') return;

        const interval = setInterval(async () => {
            try {
                const res = await fetch(`/api/demo/lead-status?leadId=${callLeadId}`);
                if (!res.ok) return;
                const data = await res.json();

                const st = (data.status || '').toLowerCase();
                if (st === 'in_call' || st === 'calling' || st === 'in-progress') {
                    if (callStatus !== 'in_call') setCallStatus('in_call');
                } else if (st === 'completed' || st === 'ended' || st === 'no_answer' || st === 'no-answer' || st === 'busy' || st === 'failed') {
                    setCallStatus('completed');
                }

                if (data.summary) {
                    setCallSummary(data.summary);
                }

                if (data.isAppointmentBooked) {
                    setLeadPipelineStage('Site Visit Booked');
                    setCallStatus('completed');
                }
            } catch { }
        }, 3000);

        return () => clearInterval(interval);
    }, [callLeadId, step, callStatus]);

    const goToPricingComparison = () => {
        setStep('pricing_comparison');
        playChime('success');

        confetti({
            particleCount: 90,
            spread: 80,
            origin: { y: 0.55 }
        });

        toast.success("Demo complete!");
    };

    const formatTimer = (sec: number) => {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    const cleanLogoParam = (logoUrl && !logoUrl.startsWith('data:')) ? logoUrl : '';
    const cleanHeroParam = (projectImageUrl && !projectImageUrl.startsWith('data:')) ? projectImageUrl : '';
    const websitePreviewUrl = `/real-estate-template/index.html?companyName=${encodeURIComponent(companyName)}&projectTitle=${encodeURIComponent(projectTitle)}&projectPrice=${encodeURIComponent(projectPrice)}&location=${encodeURIComponent(location)}&phone=${encodeURIComponent(prospectPhone || '+91 98886 26786')}&logoUrl=${encodeURIComponent(cleanLogoParam)}&heroImage=${encodeURIComponent(cleanHeroParam)}&themeColor=${encodeURIComponent(activeBrandColor)}&accentColor=${encodeURIComponent(activeAccentColor)}`;

    return (
        <div className="min-h-screen bg-[#F8FAFC] text-slate-800 flex flex-col justify-between font-sans relative overflow-x-hidden selection:bg-blue-600 selection:text-white">

            {/* Ambient background */}
            <div className="fixed top-[-10%] left-[-10%] w-[45%] h-[45%] rounded-full bg-blue-100/50 blur-[130px] pointer-events-none" />
            <div className="fixed bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-indigo-100/40 blur-[130px] pointer-events-none" />
            <div className="fixed inset-0 bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:24px_24px] pointer-events-none opacity-50" />

            {/* TOP HEADER */}
            <header className="w-full max-w-6xl mx-auto px-6 py-4 flex items-center justify-between z-30 border-b border-slate-200/80 bg-white/80 backdrop-blur-xl sticky top-0 shadow-xs">
                <div className="flex items-center gap-3">
                    <img src="/logo.png" alt="Nobogent" className="h-7 w-auto object-contain" />
                    <span className="text-base font-extrabold tracking-tight text-slate-900">Nobogent</span>
                </div>

                <div className="flex items-center gap-3">
                    <a
                        href="/login"
                        className="px-4 py-2 rounded-xl text-xs font-bold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 shadow-xs transition-all"
                    >
                        Sign In
                    </a>
                </div>
            </header>

            {/* PROGRESS STEPPER (NO NUMBERS) */}
            <div className="w-full max-w-3xl mx-auto px-4 pt-6 pb-2 z-20">
                <div className="relative flex items-center justify-between p-2 rounded-2xl bg-white/90 border border-slate-200/80 backdrop-blur-xl shadow-xs">
                    <div className="absolute top-1/2 left-8 right-8 -translate-y-1/2 h-[2px] bg-slate-100 z-0" />
                    {[
                        { key: 'onboarding', label: 'Onboard', icon: Building2 },
                        { key: 'showcase', label: 'Live Demo', icon: Layers },
                        { key: 'pricing_comparison', label: 'Pricing', icon: Award }
                    ].map((m) => {
                        const stepOrder = ['onboarding', 'showcase', 'pricing_comparison'];
                        const currentIdx = step === 'generating_assets' || step === 'speed_to_lead' ? 1 : stepOrder.indexOf(step);
                        const milestoneIdx = stepOrder.indexOf(m.key);
                        const isDone = currentIdx > milestoneIdx;
                        const isCurrent = (m.key === 'onboarding' && step === 'onboarding') ||
                                          (m.key === 'showcase' && (step === 'showcase' || step === 'speed_to_lead' || step === 'generating_assets')) ||
                                          (m.key === 'pricing_comparison' && step === 'pricing_comparison');

                        return (
                            <button
                                key={m.key}
                                type="button"
                                onClick={() => {
                                    if (m.key === 'showcase') {
                                        setStep('showcase');
                                        playChime('beep');
                                        return;
                                    }
                                    setStep(m.key as any);
                                    playChime('beep');
                                }}
                                className="relative z-10 flex flex-col items-center gap-1 px-3 cursor-pointer group transition-all hover:scale-105 active:scale-95"
                                title={`Navigate to ${m.label}`}
                            >
                                <div className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-300 ${isDone
                                        ? 'bg-emerald-600 text-white font-bold shadow-xs ring-2 ring-emerald-200 group-hover:bg-emerald-500'
                                        : isCurrent
                                            ? 'bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold shadow-md shadow-blue-500/20 ring-4 ring-blue-100 scale-105'
                                            : 'bg-slate-50 border border-slate-200 text-slate-400 group-hover:border-slate-300 group-hover:text-slate-600'
                                    }`}>
                                    {isDone ? <Check size={14} strokeWidth={3} /> : <m.icon size={14} />}
                                </div>
                                <span className={`text-[11px] font-bold transition-colors ${isCurrent ? 'text-blue-700' : isDone ? 'text-emerald-700 group-hover:text-emerald-800' : 'text-slate-400 group-hover:text-slate-600'
                                    }`}>
                                    {m.label}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* MAIN WORKSPACE */}
            <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-6 flex flex-col justify-center z-20">
                <AnimatePresence mode="wait">

                    {/* =========================================================================
                        STEP 1: CLEAN ONBOARDING FORM (SHORT & UNCLUTTERED)
                    ========================================================================= */}
                    {step === 'onboarding' && (
                        <motion.div
                            key="step-onboarding"
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -15 }}
                            transition={{ duration: 0.2 }}
                            className="bg-white/95 border border-slate-200/90 rounded-3xl p-6 sm:p-8 backdrop-blur-xl shadow-xl shadow-slate-200/50"
                        >
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-100">
                                <div>
                                    <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                                        See Nobogent In Action
                                    </h1>
                                    <p className="text-sm text-slate-500 mt-1 max-w-xl">
                                        Enter your details to generate your live ad creative, 30s voiceover reel, and landing page.
                                    </p>
                                </div>

                                <div className="flex flex-wrap items-center gap-2 shrink-0">
                                    <span className="text-xs font-semibold text-slate-400">Presets:</span>
                                    {PRESET_PROJECTS.map((p, idx) => (
                                        <button
                                            key={idx}
                                            onClick={() => handleSelectPreset(p)}
                                            className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-50 border border-slate-200 hover:border-blue-400 hover:bg-blue-50/50 text-slate-600 hover:text-blue-700 transition-all cursor-pointer shadow-2xs"
                                        >
                                            {p.name.split(' ')[0]}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Website auto-extractor strip */}
                            <div className="my-5 p-3.5 rounded-2xl bg-slate-50/80 border border-slate-200/70 flex flex-col sm:flex-row items-center gap-3">
                                <div className="flex items-center gap-2 text-xs font-bold text-slate-700 shrink-0">
                                    <Sparkles size={15} className="text-blue-600" />
                                    <span>Auto-Extract From Website:</span>
                                </div>
                                <div className="flex-1 w-full flex items-center gap-2">
                                    <input
                                        type="url"
                                        value={websiteUrl}
                                        onChange={(e) => setWebsiteUrl(e.target.value)}
                                        placeholder="https://yourbrandwebsite.com"
                                        className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 shadow-2xs"
                                    />
                                    <button
                                        onClick={handleExtractWebsite}
                                        disabled={extractingWebsite}
                                        className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shrink-0 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                                    >
                                        {extractingWebsite ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
                                        <span>Extract</span>
                                    </button>
                                </div>
                            </div>

                            {/* Reference Creative Design Selector Studio Banner */}
                            <div className="my-5 rounded-2xl border border-blue-200/90 bg-gradient-to-r from-blue-50/80 via-indigo-50/50 to-slate-50/90 p-4 sm:p-5 shadow-xs transition-all hover:border-blue-400 hover:shadow-md">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                    <div className="flex items-center gap-4">
                                        <div
                                            onClick={() => setIsTemplateModalOpen(true)}
                                            className="relative w-16 h-22 sm:w-20 sm:h-26 rounded-xl overflow-hidden shadow-md border-2 border-white ring-1 ring-blue-300/60 shrink-0 bg-slate-950 cursor-pointer group"
                                            title="Click to browse all 35 templates"
                                        >
                                            <img
                                                src={currentTemplate.url}
                                                alt={currentTemplate.name}
                                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                            />
                                            <span className="absolute bottom-0 inset-x-0 bg-slate-950/85 text-[8px] text-amber-300 font-extrabold text-center py-0.5 uppercase tracking-wider truncate px-1">
                                                {currentTemplate.badge}
                                            </span>
                                            <div className="absolute inset-0 bg-blue-900/25 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                <Maximize2 size={16} className="text-white drop-shadow" />
                                            </div>
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-[10px] font-extrabold text-blue-700 uppercase tracking-wider bg-blue-100 px-2 py-0.5 rounded-md border border-blue-200">
                                                    Active Reference Blueprint
                                                </span>
                                                <span className="text-xs text-slate-500 font-semibold hidden sm:inline">
                                                    • 35 Super-Admin Designs
                                                </span>
                                            </div>
                                            <h3 className="text-base sm:text-lg font-extrabold text-slate-900">
                                                {currentTemplate.name}
                                            </h3>
                                            <p className="text-xs text-slate-600 mt-0.5 max-w-lg line-clamp-2">
                                                {currentTemplate.description}
                                            </p>
                                        </div>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={() => setIsTemplateModalOpen(true)}
                                        className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-sm hover:shadow-md transition-all flex items-center justify-center gap-2 shrink-0 cursor-pointer"
                                    >
                                        <Layers size={14} />
                                        <span>Browse All 35 Templates</span>
                                        <ArrowRight size={13} />
                                    </button>
                                </div>

                                {/* Quick-Pick Popular Blueprints Strip */}
                                <div className="mt-3.5 pt-3 border-t border-blue-200/50 flex items-center gap-2 overflow-x-auto pb-1">
                                    <span className="text-[11px] font-bold text-slate-500 shrink-0">Popular Styles:</span>
                                    {ALL_REFERENCE_TEMPLATES.slice(0, 5).map((tmpl) => {
                                        const isSelected = selectedTemplateId === tmpl.id || (selectedTemplateId === 'pinterest_damac_island' && tmpl.index === 0);
                                        return (
                                            <button
                                                key={tmpl.id}
                                                type="button"
                                                onClick={() => handleSelectTemplate(tmpl.id)}
                                                className={`px-3 py-1 rounded-xl text-xs font-bold transition-all shrink-0 flex items-center gap-1.5 cursor-pointer ${isSelected
                                                        ? 'bg-blue-600 text-white shadow-xs'
                                                        : 'bg-white/85 hover:bg-white text-slate-700 border border-slate-200/80 hover:border-blue-300'
                                                    }`}
                                            >
                                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                                <span>{tmpl.name}</span>
                                            </button>
                                        );
                                    })}
                                    <button
                                        type="button"
                                        onClick={() => setIsTemplateModalOpen(true)}
                                        className="px-2.5 py-1 rounded-xl text-xs font-bold text-blue-700 hover:text-blue-800 hover:bg-blue-100/60 transition-colors shrink-0 cursor-pointer"
                                    >
                                        +30 More &rarr;
                                    </button>
                                </div>
                            </div>

                            {/* Form Grid */}
                            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6">
                                {/* Left Column: Developer & Property Specifications (7 cols) */}
                                <div className="lg:col-span-7 space-y-3.5">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 mb-1">
                                            Company / Developer Name
                                        </label>
                                        <input
                                            type="text"
                                            value={companyName}
                                            onChange={(e) => setCompanyName(e.target.value)}
                                            placeholder="Apex Luxury Developments"
                                            className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 text-sm text-slate-900 font-medium focus:outline-none focus:border-blue-500 shadow-2xs"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 mb-1">
                                            Project Title
                                        </label>
                                        <input
                                            type="text"
                                            value={projectTitle}
                                            onChange={(e) => setProjectTitle(e.target.value)}
                                            placeholder="The Grand Crest Luxury Residences"
                                            className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 text-sm text-slate-900 font-bold focus:outline-none focus:border-blue-500 shadow-2xs"
                                        />
                                    </div>

                                    {/* Responsive Pricing & Location */}
                                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                                        <div className="sm:col-span-5">
                                            <label className="block text-xs font-bold text-slate-700 mb-1">
                                                Pricing
                                            </label>
                                            <input
                                                type="text"
                                                value={projectPrice}
                                                onChange={(e) => setProjectPrice(e.target.value)}
                                                placeholder="₹1.85 Cr"
                                                className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 text-sm text-slate-900 font-bold focus:outline-none focus:border-blue-500 shadow-2xs"
                                            />
                                        </div>
                                        <div className="sm:col-span-7">
                                            <label className="block text-xs font-bold text-slate-700 mb-1">
                                                Location
                                            </label>
                                            <input
                                                type="text"
                                                value={location}
                                                onChange={(e) => setLocation(e.target.value)}
                                                placeholder="Golf Course Extension Road, Prime Sector"
                                                className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-blue-500 shadow-2xs"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 mb-1">
                                            Highlights &amp; Amenities
                                        </label>
                                        <textarea
                                            rows={3}
                                            value={projectDescription}
                                            onChange={(e) => setProjectDescription(e.target.value)}
                                            placeholder="Ultra-luxury 3 & 4 BHK residences with sky terraces, private infinity pool, Italian marble finishes, and 24x7 smart concierge."
                                            className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 text-xs text-slate-800 leading-relaxed focus:outline-none focus:border-blue-500 shadow-2xs"
                                        />
                                    </div>

                                    {/* WEBSITE BRANDING THEME & COLOR SCHEME */}
                                    <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/90 space-y-2.5">
                                        <div className="flex items-center justify-between">
                                            <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                                                <Sparkles size={13} className="text-amber-500" />
                                                <span>Website Branding Theme</span>
                                            </label>
                                            <span
                                                className="text-[10px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1"
                                                style={{
                                                    backgroundColor: `${activeBrandColor}15`,
                                                    borderColor: `${activeBrandColor}40`,
                                                    color: activeBrandColor
                                                }}
                                            >
                                                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: activeBrandColor }} />
                                                <span>{isCustomColorActive ? 'Custom Hex' : selectedTheme.name}</span>
                                            </span>
                                        </div>

                                        {/* Preset Luxury Palettes */}
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                            {BRAND_THEMES.map((theme) => {
                                                const isSelected = !isCustomColorActive && selectedTheme.id === theme.id;
                                                return (
                                                    <button
                                                        key={theme.id}
                                                        type="button"
                                                        onClick={() => {
                                                            setSelectedTheme(theme);
                                                            setIsCustomColorActive(false);
                                                        }}
                                                        className={`flex items-center gap-2 p-2 rounded-xl text-left border transition-all cursor-pointer ${isSelected
                                                                ? 'bg-white shadow-xs ring-2 ring-offset-1'
                                                                : 'bg-white/80 hover:bg-white border-slate-200'
                                                            }`}
                                                        style={{
                                                            borderColor: isSelected ? theme.brand : undefined,
                                                            boxShadow: isSelected ? `0 0 0 1px ${theme.brand}` : undefined
                                                        }}
                                                    >
                                                        <div
                                                            className="w-5 h-5 rounded-full shrink-0 relative overflow-hidden border border-slate-300 shadow-2xs"
                                                            style={{ backgroundColor: theme.brand }}
                                                        >
                                                            <div
                                                                className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-tl-full"
                                                                style={{ backgroundColor: theme.accent }}
                                                            />
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="text-[11px] font-bold text-slate-800 truncate leading-tight">
                                                                {theme.name}
                                                            </div>
                                                            <div className="text-[9px] text-slate-400 truncate">
                                                                {theme.category}
                                                            </div>
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>

                                        {/* Custom Color Toggle */}
                                        <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-xs">
                                            <label className="text-[11px] font-bold text-slate-600 flex items-center gap-1.5 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={isCustomColorActive}
                                                    onChange={(e) => setIsCustomColorActive(e.target.checked)}
                                                    className="rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                                                />
                                                <span>Custom Hex Palette</span>
                                            </label>

                                            {isCustomColorActive && (
                                                <div className="flex items-center gap-2.5">
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-[10px] text-slate-400 font-bold">Brand:</span>
                                                        <input
                                                            type="color"
                                                            value={customBrandColor}
                                                            onChange={(e) => setCustomBrandColor(e.target.value)}
                                                            className="w-6 h-6 rounded border border-slate-300 cursor-pointer p-0"
                                                        />
                                                        <span className="font-mono text-[10px] text-slate-700 font-bold uppercase">{customBrandColor}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-[10px] text-slate-400 font-bold">Accent:</span>
                                                        <input
                                                            type="color"
                                                            value={customAccentColor}
                                                            onChange={(e) => setCustomAccentColor(e.target.value)}
                                                            className="w-6 h-6 rounded border border-slate-300 cursor-pointer p-0"
                                                        />
                                                        <span className="font-mono text-[10px] text-slate-700 font-bold uppercase">{customAccentColor}</span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Right Column: Channels, Languages & Media Uploads (5 cols) */}
                                <div className="lg:col-span-5 space-y-3.5">
                                    {/* Phone input with country code badge and live indicator */}
                                    <div className="p-3.5 rounded-2xl bg-blue-50/70 border border-blue-200/90 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <label className="block text-xs font-bold text-blue-950 flex items-center gap-1.5">
                                                <PhoneCall size={14} className="text-blue-600" />
                                                <span>Your Phone (For Live Call &amp; WhatsApp)</span>
                                            </label>
                                            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-md border border-emerald-300 flex items-center gap-1">
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                                <span>Live Telephony</span>
                                            </span>
                                        </div>

                                        {/* Unified bulletproof phone input container */}
                                        <div className="flex items-center rounded-xl bg-white border border-blue-300 focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-500/20 shadow-xs overflow-hidden transition-all group">
                                            <div className="flex items-center gap-1.5 px-3 py-2.5 bg-slate-50 border-r border-slate-200 text-slate-700 font-bold text-xs select-none shrink-0 group-focus-within:bg-blue-50/50 transition-colors">
                                                <span className="text-sm leading-none">🇮🇳</span>
                                                <span className="font-mono text-slate-800 text-xs">+91</span>
                                            </div>
                                            <input
                                                type="tel"
                                                value={prospectPhone}
                                                onChange={(e) => {
                                                    // Allow only digits and limit to 10
                                                    const clean = e.target.value.replace(/\D/g, '').slice(0, 10);
                                                    setProspectPhone(clean);
                                                }}
                                                placeholder="9888626786 (10 digits)"
                                                className="flex-1 w-full px-3.5 py-2.5 bg-transparent text-sm text-slate-900 font-mono font-bold focus:outline-none placeholder:text-slate-400 placeholder:font-mono placeholder:font-normal tracking-wide"
                                            />
                                            {prospectPhone && (
                                                <button
                                                    type="button"
                                                    onClick={() => setProspectPhone('')}
                                                    className="px-3 text-slate-400 hover:text-slate-600 cursor-pointer transition-colors"
                                                    title="Clear number"
                                                >
                                                    <X size={14} />
                                                </button>
                                            )}
                                        </div>

                                        <p className="text-[10px] text-blue-800/80">
                                            Will receive outbound AI voice call &amp; verified WhatsApp ad creative.
                                        </p>

                                        {/* Instant Telephony & WhatsApp Fast-Track Trigger */}
                                        <div className="flex items-center justify-between pt-1 border-t border-blue-200/50 text-[11px]">
                                            <span className="text-slate-500 font-medium">Just want to test AI Calling or WhatsApp?</span>
                                            <button
                                                type="button"
                                                onClick={() => handleSkipToLiveDemo('call')}
                                                className="font-bold text-blue-700 hover:text-blue-900 hover:underline flex items-center gap-1 cursor-pointer transition-colors"
                                            >
                                                <span>Skip Creation &amp; Test Now ➔</span>
                                            </button>
                                        </div>
                                    </div>

                                    {/* Language Selectors */}
                                    <div className="grid grid-cols-2 gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-200/80">
                                        <div>
                                            <div className="flex items-center justify-between mb-1">
                                                <label className="block text-[11px] font-bold text-slate-700">
                                                    Video Voiceover
                                                </label>
                                                <span className="text-[9px] font-bold text-blue-600">3.8 TTS</span>
                                            </div>
                                            <select
                                                value={videoLanguage}
                                                onChange={(e) => setVideoLanguage(e.target.value)}
                                                className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs text-slate-800 font-bold focus:outline-none focus:border-blue-500 shadow-2xs cursor-pointer truncate"
                                            >
                                                {POPULAR_INDIAN_LANGUAGES.map(lang => (
                                                    <option key={lang.value} value={lang.value}>{lang.label}</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div>
                                            <div className="flex items-center justify-between mb-1">
                                                <label className="block text-[11px] font-bold text-slate-700">
                                                    AI Call Voice
                                                </label>
                                                <span className="text-[9px] font-bold text-emerald-600">Outbound</span>
                                            </div>
                                            <select
                                                value={callLanguage}
                                                onChange={(e) => setCallLanguage(e.target.value)}
                                                className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs text-slate-800 font-bold focus:outline-none focus:border-blue-500 shadow-2xs cursor-pointer truncate"
                                            >
                                                {POPULAR_INDIAN_LANGUAGES.map(lang => (
                                                    <option key={lang.value} value={lang.value}>{lang.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    {/* Media Upload Section: Property Image & Brand Logo */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        {/* Property Image Box (Cinematic Aspect, Blurred Background & Sharp Foreground) */}
                                        <div className="flex flex-col">
                                            <div className="flex items-center justify-between mb-1.5">
                                                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                                                    <ImageIcon size={14} className="text-blue-600" />
                                                    <span>Property Photo</span>
                                                </label>
                                                {isCustomImageUploaded ? (
                                                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100/90 px-2 py-0.5 rounded-full border border-emerald-300 flex items-center gap-1">
                                                        <Check size={10} strokeWidth={3} /> Custom Photo
                                                    </span>
                                                ) : (
                                                    <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                                                        Preset Default
                                                    </span>
                                                )}
                                            </div>

                                            <div className="relative rounded-2xl border border-slate-200 bg-slate-950 overflow-hidden group h-[180px] sm:h-[190px] flex items-center justify-center transition-all hover:border-blue-400 hover:shadow-sm">
                                                {uploadingImage ? (
                                                    <div className="flex flex-col items-center justify-center p-6 text-center space-y-2">
                                                        <Loader2 size={24} className="animate-spin text-blue-400" />
                                                        <span className="text-xs font-bold text-slate-200">Uploading to CDN...</span>
                                                    </div>
                                                ) : projectImageUrl ? (
                                                    <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
                                                        {/* Ambient Blurred Backdrop so vertical/landscape photos never show awkward black bars */}
                                                        <img
                                                            src={projectImageUrl}
                                                            alt=""
                                                            className="absolute inset-0 w-full h-full object-cover blur-md opacity-35 scale-110 pointer-events-none"
                                                        />
                                                        {/* Sharp Centered Foreground */}
                                                        <img
                                                            src={projectImageUrl}
                                                            alt="Property Preview"
                                                            className="relative z-10 max-h-full max-w-full object-contain p-2 rounded-xl transition-transform duration-300 group-hover:scale-102"
                                                        />

                                                        {/* Floating Action Controls */}
                                                        <div className="absolute inset-0 z-20 bg-slate-950/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 backdrop-blur-[2px]">
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setImageLightboxUrl(projectImageUrl);
                                                                }}
                                                                className="px-2.5 py-1.5 rounded-xl bg-white/95 hover:bg-white text-slate-800 text-xs font-bold shadow-md flex items-center gap-1 cursor-pointer transition-transform hover:scale-105"
                                                                title="View Full Resolution"
                                                            >
                                                                <Maximize2 size={12} />
                                                                <span>Preview</span>
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    imageInputRef.current?.click();
                                                                }}
                                                                className="px-2.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md flex items-center gap-1 cursor-pointer transition-transform hover:scale-105"
                                                                title="Upload Different Photo"
                                                            >
                                                                <Upload size={12} />
                                                                <span>Change</span>
                                                            </button>
                                                            {isCustomImageUploaded && (
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleRemoveProjectImage();
                                                                    }}
                                                                    className="px-2 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold shadow-md flex items-center gap-1 cursor-pointer transition-transform hover:scale-105"
                                                                    title="Reset to Template Default"
                                                                >
                                                                    <Trash2 size={12} />
                                                                </button>
                                                            )}
                                                        </div>

                                                        {/* Mobile persistent controls (always accessible) */}
                                                        <div className="absolute bottom-2 right-2 z-20 flex items-center gap-1 sm:hidden">
                                                            <button
                                                                type="button"
                                                                onClick={() => imageInputRef.current?.click()}
                                                                className="px-2.5 py-1 rounded-lg bg-slate-900/90 text-white font-bold text-[10px] shadow-sm backdrop-blur-xs flex items-center gap-1"
                                                            >
                                                                <Upload size={10} />
                                                                <span>Change</span>
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div
                                                        onClick={() => imageInputRef.current?.click()}
                                                        className="w-full h-full border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-2xl flex flex-col items-center justify-center cursor-pointer p-4 text-center transition-colors bg-white hover:bg-blue-50/20"
                                                    >
                                                        <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mb-2">
                                                            <Upload size={18} />
                                                        </div>
                                                        <span className="text-xs font-bold text-slate-700">Upload Property Photo</span>
                                                        <span className="text-[10px] text-slate-400 mt-0.5">JPG, PNG, WebP</span>
                                                    </div>
                                                )}
                                            </div>
                                            <input ref={imageInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                                        </div>

                                        {/* Brand Logo Box (Clean Dropzone with Zero Stray Change Button) */}
                                        <div className="flex flex-col">
                                            <div className="flex items-center justify-between mb-1.5">
                                                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                                                    <Building2 size={14} className="text-blue-600" />
                                                    <span>Brand Logo (Optional)</span>
                                                </label>
                                                {logoUrl && (
                                                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100/90 px-2 py-0.5 rounded-full border border-emerald-300 flex items-center gap-1">
                                                        <Check size={10} strokeWidth={3} /> Active
                                                    </span>
                                                )}
                                            </div>

                                            <div className="relative rounded-2xl border border-slate-200 bg-slate-50/70 overflow-hidden group h-[180px] sm:h-[190px] flex items-center justify-center transition-all hover:border-blue-400 hover:shadow-sm">
                                                {uploadingLogo ? (
                                                    <div className="flex flex-col items-center justify-center p-6 text-center space-y-2">
                                                        <Loader2 size={24} className="animate-spin text-blue-600" />
                                                        <span className="text-xs font-bold text-slate-700">Uploading logo...</span>
                                                    </div>
                                                ) : logoUrl ? (
                                                    <div className="relative w-full h-full bg-white flex items-center justify-center p-4 overflow-hidden">
                                                        <img
                                                            src={logoUrl}
                                                            alt="Brand Logo"
                                                            className="max-h-[85%] max-w-[85%] object-contain group-hover:scale-105 transition-transform duration-300"
                                                        />

                                                        {/* Floating Overlay on Hover */}
                                                        <div className="absolute inset-0 bg-slate-950/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 backdrop-blur-[2px]">
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setImageLightboxUrl(logoUrl);
                                                                }}
                                                                className="px-2.5 py-1.5 rounded-xl bg-white/95 hover:bg-white text-slate-800 text-xs font-bold shadow-md flex items-center gap-1 cursor-pointer transition-transform hover:scale-105"
                                                                title="Preview Logo"
                                                            >
                                                                <Maximize2 size={12} />
                                                                <span>Preview</span>
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    logoInputRef.current?.click();
                                                                }}
                                                                className="px-2.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md flex items-center gap-1 cursor-pointer transition-transform hover:scale-105"
                                                            >
                                                                <Upload size={12} />
                                                                <span>Change</span>
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleRemoveLogo();
                                                                }}
                                                                className="px-2 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold shadow-md flex items-center gap-1 cursor-pointer transition-transform hover:scale-105"
                                                                title="Remove Logo"
                                                            >
                                                                <Trash2 size={12} />
                                                            </button>
                                                        </div>

                                                        {/* Mobile persistent action */}
                                                        <div className="absolute bottom-2 right-2 flex items-center gap-1 sm:hidden">
                                                            <button
                                                                type="button"
                                                                onClick={() => logoInputRef.current?.click()}
                                                                className="px-2.5 py-1 rounded-lg bg-slate-900/90 text-white font-bold text-[10px] shadow-sm backdrop-blur-xs flex items-center gap-1"
                                                            >
                                                                <Upload size={10} />
                                                                <span>Change</span>
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div
                                                        onClick={() => logoInputRef.current?.click()}
                                                        className="w-full h-full border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-2xl flex flex-col items-center justify-center cursor-pointer p-4 text-center transition-colors bg-white hover:bg-blue-50/20"
                                                    >
                                                        <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center mb-2">
                                                            <Building2 size={18} />
                                                        </div>
                                                        <span className="text-xs font-bold text-slate-700">Upload Brand Logo</span>
                                                        <span className="text-[10px] text-slate-400 mt-0.5">Transparent PNG / SVG</span>
                                                        <span className="text-[9px] text-blue-600 font-semibold mt-1">Replaces website &amp; video outro brand</span>
                                                    </div>
                                                )}
                                            </div>
                                            <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Luxury Full-Width Action Banner & CTA */}
                            <div className="mt-8 pt-6 border-t border-slate-200/80 flex flex-col gap-4">
                                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                    <span className="font-bold text-slate-700">Instant Execution:</span>
                                    <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-semibold text-[11px] border border-slate-200">
                                        ✓ Real AI Ad Creative
                                    </span>
                                    <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-semibold text-[11px] border border-slate-200">
                                        ✓ 30s Reel + Voiceover
                                    </span>
                                    <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-semibold text-[11px] border border-slate-200">
                                        ✓ Outbound AI Call
                                    </span>
                                    <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-semibold text-[11px] border border-slate-200">
                                        ✓ WhatsApp Broadcast
                                    </span>
                                    <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-semibold text-[11px] border border-slate-200">
                                        ✓ Agency Website
                                    </span>
                                </div>

                                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3 w-full pt-1">
                                    {(creative?.imageUrl || generatedVideo?.script) ? (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => handleStartCreativeGeneration(false)}
                                                className="w-full sm:w-auto px-5 py-3.5 rounded-2xl bg-white hover:bg-slate-50 text-slate-700 font-extrabold text-xs uppercase tracking-wider transition-all border-2 border-slate-300 hover:border-slate-400 shadow-xs active:scale-98 flex items-center justify-center gap-2 cursor-pointer"
                                                title="Re-generate fresh AI creative and video reel with any updated inputs"
                                            >
                                                <RefreshCw size={14} className="text-blue-600" />
                                                <span>Re-generate Assets</span>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setStep('showcase');
                                                    playChime('beep');
                                                }}
                                                className="w-full sm:w-auto px-8 py-3.5 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-700 hover:to-indigo-800 text-white font-extrabold text-xs uppercase tracking-wider transition-all shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/35 active:scale-98 flex items-center justify-center gap-2.5 cursor-pointer"
                                            >
                                                <span>View Live Demo</span>
                                                <ArrowRight size={16} />
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => handleSkipToLiveDemo('call')}
                                                className="w-full sm:w-auto px-5 py-3.5 rounded-2xl bg-white hover:bg-slate-50 text-slate-800 font-extrabold text-xs uppercase tracking-wider transition-all border-2 border-slate-300 hover:border-slate-400 shadow-sm active:scale-98 flex items-center justify-center gap-2 cursor-pointer"
                                                title="Skip asset creation and immediately test live AI voice calling & WhatsApp"
                                            >
                                                <Phone size={14} className="text-emerald-600" />
                                                <span>Skip Creation (Test Calling / WhatsApp)</span>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => handleStartCreativeGeneration(false)}
                                                className="w-full sm:w-auto px-8 py-3.5 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-700 hover:to-indigo-800 text-white font-extrabold text-xs uppercase tracking-wider transition-all shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/35 active:scale-98 flex items-center justify-center gap-2.5 cursor-pointer"
                                            >
                                                <Sparkles size={16} />
                                                <span>Generate Assets &amp; Launch Demo</span>
                                                <ArrowRight size={16} />
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {/* =========================================================================
                        STEP 2: RADAR LOADER
                    ========================================================================= */}
                    {step === 'generating_assets' && (
                        <motion.div
                            key="step-generating"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-white/95 border border-slate-200/90 rounded-3xl p-8 sm:p-12 text-center max-w-lg mx-auto shadow-xl shadow-slate-200/50 backdrop-blur-xl"
                        >
                            <div className="relative w-24 h-24 mx-auto mb-5">
                                <div className="absolute inset-0 rounded-full border-2 border-blue-200 animate-ping" />
                                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-600 border-r-indigo-600 animate-spin" />
                                <div className="w-full h-full rounded-full bg-gradient-to-b from-blue-50 to-indigo-50 border border-blue-200 flex items-center justify-center text-blue-600 shadow-inner">
                                    <Sparkles size={32} className="text-blue-600 animate-pulse" />
                                </div>
                            </div>

                            <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                                Generating Your Assets
                            </h2>
                            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                                Rendering 3:4 Ad Creative, synthesizing 30s video with {videoLanguage.toUpperCase()} voiceover, and deploying landing page.
                            </p>

                            <div className="mt-5 w-full max-w-xs mx-auto bg-slate-100 rounded-full h-2 p-0.5 border border-slate-200 overflow-hidden">
                                <motion.div
                                    className="h-full rounded-full bg-gradient-to-r from-blue-600 to-indigo-600"
                                    initial={{ width: "15%" }}
                                    animate={{ width: `${Math.min(100, generationStage * 25 + 15)}%` }}
                                    transition={{ duration: 0.5 }}
                                />
                            </div>

                            {/* Action to move on immediately while assets render in background */}
                            <div className="mt-7 pt-5 border-t border-slate-100 flex flex-col items-center gap-2">
                                <button
                                    onClick={() => {
                                        setStep('showcase');
                                        setShowcaseTab('call');
                                        playChime('beep');
                                        toast.info("Navigated to Live Demo! Ready to test AI Calling & WhatsApp.");
                                    }}
                                    className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                                >
                                    <span>Test AI Calling &amp; WhatsApp While Assets Finish</span>
                                    <ArrowRight size={14} />
                                </button>
                                <span className="text-[11px] text-slate-400">
                                    Rendering runs in background &bull; assets pop in automatically when ready
                                </span>
                            </div>
                        </motion.div>
                    )}

                    {/* =========================================================================
                        STEP 3: SHOWCASE (CLEAN TABS & STEP ACTION BUTTONS)
                    ========================================================================= */}
                    {step === 'showcase' && (
                        <motion.div
                            key="step-showcase"
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -15 }}
                            className="bg-white/95 border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-xl shadow-slate-200/50 backdrop-blur-xl"
                        >
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-100">
                                <div>
                                    <div className="flex items-center gap-2.5">
                                        <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                                            Deliverables Preview
                                        </h2>
                                        {isGenerating ? (
                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-[11px] font-bold animate-pulse">
                                                <Loader2 size={12} className="animate-spin text-blue-600" />
                                                <span>Rendering in Background</span>
                                            </span>
                                        ) : !creative && !generatedVideo ? (
                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-bold">
                                                <span>⚡ Creation Skipped (Fast-Track)</span>
                                            </span>
                                        ) : null}
                                    </div>
                                    <p className="text-xs text-slate-500 mt-0.5">
                                        Test and trigger each deliverable directly to your phone.
                                    </p>
                                </div>

                                <div className="flex items-center gap-2.5 shrink-0">
                                    {!creative && !generatedVideo && !isGenerating && (
                                        <button
                                            type="button"
                                            onClick={() => handleStartCreativeGeneration(true)}
                                            className="px-4 py-2.5 rounded-xl bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 font-bold text-xs flex items-center gap-1.5 shadow-2xs cursor-pointer transition-all active:scale-95"
                                        >
                                            <Sparkles size={13} className="text-amber-500" />
                                            <span>Generate AI Assets</span>
                                        </button>
                                    )}
                                    <button
                                        onClick={handleStartLiveSpeedToLead}
                                        className="px-5 py-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-md active:scale-95 flex items-center gap-2 cursor-pointer shrink-0"
                                    >
                                        <Phone size={14} />
                                        <span>Test Live Inbound Flow</span>
                                    </button>
                                </div>
                            </div>

                            {/* Clean Tabs without Numbers */}
                            <div className="flex flex-wrap items-center gap-1.5 my-5 p-1 bg-slate-100/80 rounded-2xl border border-slate-200/70 overflow-x-auto">
                                {[
                                    { key: 'creative', label: 'Ad Creative', icon: Layers },
                                    { key: 'video', label: '30s Video Reel', icon: Film },
                                    { key: 'website', label: 'Website', icon: Globe },
                                    { key: 'call', label: 'AI Caller', icon: Phone },
                                    { key: 'broadcast', label: 'WhatsApp Broadcast', icon: Send },
                                    { key: 'crm', label: 'CRM Pipeline', icon: Database }
                                ].map((tab) => (
                                    <button
                                        key={tab.key}
                                        onClick={() => setShowcaseTab(tab.key as any)}
                                        className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${showcaseTab === tab.key
                                                ? 'bg-white text-blue-700 shadow-xs border border-slate-200'
                                                : 'text-slate-600 hover:text-slate-900'
                                            }`}
                                    >
                                        <tab.icon size={13} className={showcaseTab === tab.key ? 'text-blue-600' : 'text-slate-400'} />
                                        <span>{tab.label}</span>
                                    </button>
                                ))}
                            </div>

                            {/* TAB 1: AD CREATIVE */}
                            {showcaseTab === 'creative' && (
                                <div className="space-y-4">
                                    {!creative?.imageUrl && !isGenerating && (
                                        <div className="p-3.5 rounded-2xl bg-gradient-to-r from-amber-50/90 to-orange-50/90 border border-amber-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
                                            <div className="flex items-center gap-2.5">
                                                <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700 shrink-0">
                                                    <Sparkles size={16} />
                                                </div>
                                                <div>
                                                    <div className="text-xs font-bold text-slate-800">
                                                        Asset creation was skipped
                                                    </div>
                                                    <div className="text-[11px] text-slate-500">
                                                        Showing property photo placeholder. You can synthesize custom high-converting AI creatives anytime.
                                                    </div>
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => handleStartCreativeGeneration(true)}
                                                className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs cursor-pointer active:scale-95 transition-all shrink-0"
                                            >
                                                <Sparkles size={13} />
                                                <span>Generate Real AI Creative &amp; Reel</span>
                                            </button>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                                    <div className="lg:col-span-6 rounded-2xl p-4 bg-slate-50 border border-slate-200">
                                        <div className="w-full aspect-[3/4] rounded-xl overflow-hidden bg-slate-100 relative border border-slate-200 shadow-md">
                                            {creative?.imageUrl ? (
                                                <img
                                                    src={creative.imageUrl}
                                                    alt="Ad Creative"
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : isGenerating ? (
                                                <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-white space-y-3">
                                                    <div className="relative w-12 h-12 flex items-center justify-center">
                                                        <Loader2 size={28} className="animate-spin text-blue-600" />
                                                    </div>
                                                    <div className="text-xs font-bold text-slate-800">Synthesizing 3:4 Ad Creative...</div>
                                                    <p className="text-[11px] text-slate-500 max-w-xs">
                                                        Compositing architectural typography and luxury badges onto your property photo in the background.
                                                    </p>
                                                </div>
                                            ) : (
                                                <img
                                                    src={projectImageUrl}
                                                    alt="Ad Creative"
                                                    className="w-full h-full object-cover"
                                                />
                                            )}
                                        </div>
                                    </div>

                                    <div className="lg:col-span-6 space-y-4">
                                        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                                            <div className="flex items-center justify-between">
                                                <h3 className="text-xs font-bold text-slate-800">WhatsApp Daily Creative Approval</h3>
                                                <span className="text-[10px] text-slate-400">8:00 AM Daily</span>
                                            </div>

                                            <p className="text-xs text-slate-600 leading-relaxed bg-white p-3 rounded-xl border border-slate-200">
                                                Good morning! Here is today&apos;s ad creative for <strong>{projectTitle}</strong>. Tap below to post or request changes.
                                            </p>

                                            {/* Action Button for Step 1: Dispatches WhatsApp */}
                                            <button
                                                onClick={() => handleSendStepWhatsApp('creative_preview', `Creative preview sent to +91 ${prospectPhone.slice(-10)}!`)}
                                                disabled={sendingTabWhatsApp === 'creative_preview'}
                                                className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
                                            >
                                                {sendingTabWhatsApp === 'creative_preview' ? (
                                                    <Loader2 size={13} className="animate-spin" />
                                                ) : (
                                                    <Send size={13} />
                                                )}
                                                <span>Send Creative to My WhatsApp (+91 {prospectPhone.slice(-10) || 'Phone'})</span>
                                            </button>
                                        </div>

                                        <div className="p-4 rounded-2xl bg-white border border-slate-200 space-y-2">
                                            <span className="text-xs font-bold text-slate-700 block">Request Revision:</span>
                                            <div className="flex flex-wrap gap-1.5">
                                                {["Change headline", "Make price bold", "Switch to evening shot"].map((chip, i) => (
                                                    <button
                                                        key={i}
                                                        onClick={() => handleRequestRevision(chip)}
                                                        className="text-[10px] px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-600 font-medium cursor-pointer"
                                                    >
                                                        {chip}
                                                    </button>
                                                ))}
                                            </div>
                                            <div className="flex items-center gap-2 pt-1">
                                                <input
                                                    type="text"
                                                    value={revisionInput}
                                                    onChange={(e) => setRevisionInput(e.target.value)}
                                                    placeholder="e.g. Change price or layout..."
                                                    className="flex-1 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                                                />
                                                <button
                                                    onClick={() => handleRequestRevision(revisionInput)}
                                                    disabled={isRevising || !revisionInput.trim()}
                                                    className="px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-bold cursor-pointer disabled:opacity-40"
                                                >
                                                    {isRevising ? <Loader2 size={11} className="animate-spin" /> : 'Revise'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            )}

                            {/* TAB 2: 30s VIDEO REEL */}
                            {showcaseTab === 'video' && (
                                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                                    {/* Left Column: Remotion Live Video Reel Mockup (5 Cols) */}
                                    <div className="lg:col-span-5 flex flex-col items-center">
                                        <div className="relative mx-auto w-full max-w-[280px] sm:max-w-[290px] aspect-[9/16] rounded-[38px] p-2.5 bg-slate-950 shadow-2xl overflow-hidden border-4 border-slate-800">
                                            {/* Top Dynamic Island / Speaker */}
                                            <div className="absolute top-3.5 left-1/2 -translate-x-1/2 w-20 h-4 bg-slate-900 rounded-full z-30 flex items-center justify-center pointer-events-none">
                                                <div className="w-2.5 h-2.5 rounded-full bg-slate-950 mr-2" />
                                                <div className="w-1.5 h-1.5 rounded-full bg-blue-500/40" />
                                            </div>

                                            <div className="w-full h-full rounded-[28px] overflow-hidden bg-black relative flex items-center justify-center">
                                                {isMounted ? (
                                                    <Player
                                                        ref={remotionPlayerRef}
                                                        component={CaptionsComposition}
                                                        durationInFrames={900}
                                                        compositionWidth={1080}
                                                        compositionHeight={1920}
                                                        fps={30}
                                                        controls
                                                        autoPlay
                                                        loop
                                                        style={{ width: '100%', height: '100%', borderRadius: '28px' }}
                                                        inputProps={{
                                                            videoUrl: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/demo-creatives/clean_silent_luxury_walkthrough.mp4',
                                                            audioUrl: generatedVideo?.audioUrl || undefined,
                                                            captions: editableCues,
                                                            effects: [
                                                                { type: 'zoom', start: 0, end: 2.5 },
                                                                { type: 'border', start: 9.0, end: 12.0 },
                                                                { type: 'zoom', start: 14.5, end: 17.0 }
                                                            ],
                                                            theme: captionThemeConfig,
                                                            profile: {
                                                                business_name: companyName || 'Apex Luxury Developments',
                                                                logo_url: logoUrl || null,
                                                                phone: prospectPhone || '+91 98886 26786',
                                                                brand_color: customBrandColor || '#F59E0B',
                                                                verified: true
                                                            },
                                                            isPlayer: true
                                                        }}
                                                    />
                                                ) : (
                                                    <div className="flex flex-col items-center justify-center p-6 text-center text-white space-y-2">
                                                        <Loader2 size={24} className="animate-spin text-blue-400" />
                                                        <span className="text-xs font-bold">Mounting Video Player...</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Player Quick Timeline Scrub & Preview Jump */}
                                        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => remotionPlayerRef.current?.seekTo(0)}
                                                className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-slate-700 font-bold text-xs border border-slate-200 shadow-2xs flex items-center gap-1.5 cursor-pointer transition-all active:scale-95"
                                                title="Play from Beginning"
                                            >
                                                <RefreshCw size={12} />
                                                <span>Replay (0s)</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => remotionPlayerRef.current?.seekTo(780)}
                                                className="px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold text-xs border border-amber-200 shadow-2xs flex items-center gap-1.5 cursor-pointer transition-all active:scale-95"
                                                title="Preview Brand Logo & Outro Card (26s)"
                                            >
                                                <Eye size={12} className="text-amber-600" />
                                                <span>Preview Outro (Logo)</span>
                                            </button>
                                        </div>
                                    </div>

                                    {/* Right Column: AI Caption Studio (Font Styling & Animation Options - 7 Cols) */}
                                    <div className="lg:col-span-7 rounded-3xl bg-slate-950 text-white border border-slate-800 shadow-2xl p-5 sm:p-6 flex flex-col space-y-5">
                                        {/* Studio Header */}
                                        <div className="flex items-center justify-between pb-4 border-b border-white/10">
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <Sparkles className="text-amber-400 animate-pulse" size={18} />
                                                    <h3 className="text-base sm:text-lg font-black tracking-tight">AI Caption Studio</h3>
                                                </div>
                                                <p className="text-xs text-slate-400 mt-0.5">Real-time viral subtitle typography, animations &amp; styling</p>
                                            </div>
                                            <span className="text-[10px] font-extrabold uppercase tracking-wider bg-amber-500/15 text-amber-300 border border-amber-500/30 px-2.5 py-1 rounded-full">
                                                {selectedCaptionTheme.replace(/([A-Z])/g, ' $1')}
                                            </span>
                                        </div>

                                        {/* Navigation Tabs (Styles, Animations, Adjust, Subtitles) */}
                                        <div className="flex gap-1.5 p-1 bg-white/5 border border-white/5 rounded-2xl">
                                            {[
                                                { id: 'styles', label: 'Styles', icon: Palette },
                                                { id: 'animations', label: 'Animations', icon: Zap },
                                                { id: 'custom', label: 'Adjust', icon: SlidersHorizontal },
                                                { id: 'subtitles', label: 'Subtitles', icon: Type }
                                            ].map((tab) => (
                                                <button
                                                    key={tab.id}
                                                    type="button"
                                                    onClick={() => setCaptionStudioTab(tab.id as any)}
                                                    className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                                                        captionStudioTab === tab.id
                                                            ? 'bg-blue-600 text-white shadow-md'
                                                            : 'text-slate-400 hover:text-white'
                                                    }`}
                                                >
                                                    <tab.icon size={13} />
                                                    <span>{tab.label}</span>
                                                </button>
                                            ))}
                                        </div>

                                        {/* Tab 1: STYLES & PRESETS */}
                                        {captionStudioTab === 'styles' && (
                                            <div className="space-y-4">
                                                <div>
                                                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-2">
                                                        Viral Subtitle Presets (8 Styles)
                                                    </label>
                                                    <div className="grid grid-cols-2 gap-2.5 max-h-[300px] overflow-y-auto pr-1">
                                                        {Object.entries(SUBTITLE_THEMES).map(([themeKey, themeData]) => {
                                                            const isSelected = selectedCaptionTheme === themeKey;
                                                            return (
                                                                <button
                                                                    key={themeKey}
                                                                    type="button"
                                                                    onClick={() => handleSelectCaptionTheme(themeKey)}
                                                                    className={`p-3 rounded-2xl border-2 transition-all text-left relative overflow-hidden cursor-pointer ${
                                                                        isSelected
                                                                            ? 'border-blue-500 bg-blue-500/15 shadow-md shadow-blue-500/20'
                                                                            : 'border-white/5 bg-white/5 hover:bg-white/10'
                                                                    }`}
                                                                >
                                                                    {isSelected && (
                                                                        <div className="absolute top-2 right-2 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
                                                                            <Check size={10} className="text-white" strokeWidth={3} />
                                                                        </div>
                                                                    )}
                                                                    <p className={`font-extrabold text-xs capitalize ${isSelected ? 'text-blue-400' : 'text-slate-200'}`}>
                                                                        {themeKey.replace(/([A-Z])/g, ' $1')}
                                                                    </p>
                                                                    <div className="flex items-center gap-1.5 mt-2">
                                                                        <div
                                                                            className="w-3.5 h-3.5 rounded-full border border-white/20 shadow-xs"
                                                                            style={{ backgroundColor: themeData.highlightColor }}
                                                                            title="Highlight Color"
                                                                        />
                                                                        <div
                                                                            className="w-3.5 h-3.5 rounded-full border border-white/20 shadow-xs"
                                                                            style={{ backgroundColor: themeData.secondaryHighlightColor || themeData.color }}
                                                                            title="Secondary Color"
                                                                        />
                                                                        <span className="text-[10px] text-slate-400 font-mono capitalize ml-1">
                                                                            {themeData.animation}
                                                                        </span>
                                                                    </div>
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Tab 2: ANIMATIONS */}
                                        {captionStudioTab === 'animations' && (
                                            <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
                                                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block">
                                                    Select Animation Dynamic
                                                </label>
                                                {ANIMATION_OPTIONS.map((anim) => {
                                                    const isSelected = captionThemeConfig.animation === anim.id;
                                                    return (
                                                        <button
                                                            key={anim.id}
                                                            type="button"
                                                            onClick={() => updateCaptionTheme({ animation: anim.id })}
                                                            className={`w-full p-3 rounded-2xl border-2 transition-all flex items-center justify-between text-left cursor-pointer ${
                                                                isSelected
                                                                    ? 'border-blue-500 bg-blue-500/15 shadow-md shadow-blue-500/20'
                                                                    : 'border-white/5 bg-white/5 hover:bg-white/10'
                                                                }`}
                                                        >
                                                            <div className="flex items-center gap-3">
                                                                <span className="text-xl p-2 bg-white/5 rounded-xl border border-white/5">
                                                                    {anim.icon}
                                                                </span>
                                                                <div>
                                                                    <p className={`font-black text-xs ${isSelected ? 'text-blue-400' : 'text-white'}`}>
                                                                        {anim.label}
                                                                    </p>
                                                                    <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                                                                        {anim.description}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                                                                isSelected ? 'border-blue-500 bg-blue-500' : 'border-slate-700'
                                                            }`}>
                                                                {isSelected && <Check size={10} className="text-white" strokeWidth={3} />}
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}

                                        {/* Tab 3: CUSTOM ADJUSTMENTS */}
                                        {captionStudioTab === 'custom' && (
                                            <div className="space-y-4 max-h-[320px] overflow-y-auto pr-1">
                                                {/* Vertical Position */}
                                                <div>
                                                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest block mb-1.5">
                                                        Vertical Position
                                                    </label>
                                                    <div className="grid grid-cols-3 gap-2">
                                                        {(['top', 'center', 'bottom'] as const).map((pos) => (
                                                            <button
                                                                key={pos}
                                                                type="button"
                                                                onClick={() => updateCaptionTheme({ position: pos })}
                                                                className={`py-2 rounded-xl border font-bold text-xs capitalize transition-all cursor-pointer ${
                                                                    captionThemeConfig.position === pos
                                                                        ? 'border-blue-500 bg-blue-500/20 text-blue-400 font-black'
                                                                        : 'border-white/5 bg-white/5 text-slate-400 hover:text-white'
                                                                }`}
                                                            >
                                                                {pos}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>

                                                {/* Font Family */}
                                                <div>
                                                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest block mb-1.5">
                                                        Typography Font Family
                                                    </label>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        {['Outfit', 'Montserrat', 'Roboto', 'Inter'].map((font) => (
                                                            <button
                                                                key={font}
                                                                type="button"
                                                                onClick={() => updateCaptionTheme({ fontFamily: font })}
                                                                className={`py-2 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                                                                    captionThemeConfig.fontFamily === font
                                                                        ? 'border-blue-500 bg-blue-500/20 text-blue-400 font-black'
                                                                        : 'border-white/5 bg-white/5 text-slate-400 hover:text-white'
                                                                }`}
                                                                style={{ fontFamily: font }}
                                                            >
                                                                {font}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>

                                                {/* Font Size Slider */}
                                                <div>
                                                    <div className="flex justify-between items-center mb-1.5">
                                                        <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                                                            Font Size
                                                        </label>
                                                        <span className="text-xs font-mono font-bold text-blue-400">
                                                            {captionThemeConfig.fontSize || 54}px
                                                        </span>
                                                    </div>
                                                    <input
                                                        type="range"
                                                        min="40"
                                                        max="100"
                                                        step="2"
                                                        value={captionThemeConfig.fontSize || 54}
                                                        onChange={(e) => updateCaptionTheme({ fontSize: parseInt(e.target.value) })}
                                                        className="w-full accent-blue-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                                                    />
                                                </div>

                                                {/* Highlight Colors */}
                                                <div>
                                                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest block mb-2">
                                                        Viral Highlight Color
                                                    </label>
                                                    <div className="flex flex-wrap gap-2">
                                                        {CAPTION_COLOR_SWATCHES.map((color) => (
                                                            <button
                                                                key={color}
                                                                type="button"
                                                                onClick={() => updateCaptionTheme({ highlightColor: color })}
                                                                className={`w-7 h-7 rounded-xl border-2 transition-transform active:scale-90 flex items-center justify-center cursor-pointer ${
                                                                    captionThemeConfig.highlightColor === color ? 'border-white scale-110 shadow-md' : 'border-transparent hover:scale-105'
                                                                }`}
                                                                style={{ backgroundColor: color }}
                                                            >
                                                                {captionThemeConfig.highlightColor === color && (
                                                                    <Check size={12} className={color === '#FFFFFF' || color === '#FFE600' ? 'text-black' : 'text-white'} strokeWidth={3} />
                                                                )}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>

                                                {/* Box Style */}
                                                <div>
                                                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest block mb-1.5">
                                                        Box &amp; Background Styling
                                                    </label>
                                                    <div className="grid grid-cols-4 gap-1.5">
                                                        {(['none', 'shadow', 'badge', 'glass'] as const).map((style) => (
                                                            <button
                                                                key={style}
                                                                type="button"
                                                                onClick={() => updateCaptionTheme({ boxStyle: style })}
                                                                className={`py-1.5 rounded-xl border text-[11px] font-bold capitalize transition-all cursor-pointer ${
                                                                    captionThemeConfig.boxStyle === style
                                                                        ? 'border-blue-500 bg-blue-500/20 text-blue-400 font-black'
                                                                        : 'border-white/5 bg-white/5 text-slate-400 hover:text-white'
                                                                }`}
                                                            >
                                                                {style}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Tab 4: SUBTITLES LIST */}
                                        {captionStudioTab === 'subtitles' && (
                                            <div className="space-y-2.5 max-h-[320px] overflow-y-auto pr-1">
                                                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block">
                                                    Timed Caption Segments ({editableCues.length})
                                                </label>
                                                {editableCues.map((cue, idx) => (
                                                    <div key={idx} className="p-2.5 rounded-xl bg-white/5 border border-white/10 space-y-1.5">
                                                        <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                                                            <span className="font-bold text-blue-400">#{idx + 1}</span>
                                                            <span>{cue.start.toFixed(1)}s - {cue.end.toFixed(1)}s</span>
                                                        </div>
                                                        <input
                                                            type="text"
                                                            value={cue.text}
                                                            onChange={(e) => {
                                                                const updated = [...editableCues];
                                                                updated[idx] = { ...updated[idx], text: e.target.value };
                                                                setEditableCues(updated);
                                                            }}
                                                            className="w-full bg-slate-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white font-medium focus:outline-none focus:border-blue-500"
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {/* Bottom In-Browser Live Preview & WhatsApp Action (NO RENDER BUTTON) */}
                                        <div className="pt-3 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3">
                                            <div className="flex items-center gap-2 text-xs text-slate-400">
                                                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                                <span className="font-medium">Live Browser Preview (No rendering wait)</span>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => handleSendStepWhatsApp('video_preview', `30s Video preview link sent to +91 ${prospectPhone.slice(-10)}!`)}
                                                className="w-full sm:w-auto px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md active:scale-95"
                                            >
                                                <Send size={12} />
                                                <span>Send VIP Preview to WhatsApp</span>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* TAB 3: WEBSITE */}
                            {showcaseTab === 'website' && (
                                <div className="space-y-4">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-slate-50 border border-slate-200 rounded-2xl">
                                        <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-slate-200 shadow-2xs">
                                            <button
                                                onClick={() => setWebsiteDevice('desktop')}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer ${websiteDevice === 'desktop' ? 'bg-blue-600 text-white' : 'text-slate-600'
                                                    }`}
                                            >
                                                <Monitor size={13} />
                                                <span>Desktop</span>
                                            </button>
                                            <button
                                                onClick={() => setWebsiteDevice('mobile')}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer ${websiteDevice === 'mobile' ? 'bg-blue-600 text-white' : 'text-slate-600'
                                                    }`}
                                            >
                                                <Smartphone size={13} />
                                                <span>Mobile</span>
                                            </button>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            {/* Action Button for Step 3 */}
                                            <button
                                                onClick={() => handleSendStepWhatsApp('website_preview', `Website link sent to +91 ${prospectPhone.slice(-10)}!`)}
                                                disabled={sendingTabWhatsApp === 'website_preview'}
                                                className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                                            >
                                                {sendingTabWhatsApp === 'website_preview' ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                                                <span>Send Website to WhatsApp</span>
                                            </button>

                                            <button
                                                onClick={() => window.open(websitePreviewUrl, '_blank')}
                                                className="px-3.5 py-1.5 rounded-xl bg-white hover:bg-slate-50 text-blue-700 border border-slate-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-2xs"
                                            >
                                                <span>Open Live Tab</span>
                                                <ExternalLink size={12} />
                                            </button>
                                        </div>
                                    </div>

                                    <div className="w-full flex justify-center bg-slate-100 p-4 rounded-2xl border border-slate-200 overflow-hidden min-h-[500px]">
                                        <div className={`transition-all duration-300 rounded-xl overflow-hidden shadow-lg border border-slate-200 bg-white ${websiteDevice === 'desktop' ? 'w-full h-[540px]' : 'w-[375px] h-[540px]'
                                            }`}>
                                            <iframe
                                                src={websitePreviewUrl}
                                                key={websitePreviewUrl}
                                                title="Luxury Real Estate Multipage Website"
                                                className="w-full h-full border-0"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* TAB 4: AI CALLER */}
                            {showcaseTab === 'call' && (
                                <div className="max-w-xl mx-auto rounded-3xl p-6 bg-slate-50 border border-slate-200 text-center space-y-5">
                                    <div className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800 bg-emerald-100/70 px-3 py-1 rounded-full border border-emerald-300">
                                        <Phone size={13} className="text-emerald-700" />
                                        <span>500 Free Calling Minutes</span>
                                    </div>

                                    <div>
                                        <h3 className="text-xl font-extrabold text-slate-900">
                                            Outbound AI Voice Closer
                                        </h3>
                                        <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                                            Starts calling in <strong>{callLanguage.toUpperCase()}</strong>. Automatically switches to any regional Indian language if asked.
                                        </p>
                                    </div>

                                    <div className="p-3.5 rounded-2xl bg-white border border-slate-200 text-xs flex items-center justify-between">
                                        <span className="text-slate-600 font-medium">Destination Number:</span>
                                        <span className="font-mono font-bold text-blue-700">+91 {prospectPhone || '9888626786'}</span>
                                    </div>

                                    {/* Action Button for Step 4 */}
                                    <button
                                        onClick={handleStartLiveSpeedToLead}
                                        className="w-full py-3 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                                    >
                                        <Phone size={14} />
                                        <span>Call My Phone Now (+91 {prospectPhone.slice(-10) || 'Phone'})</span>
                                    </button>
                                </div>
                            )}

                            {/* TAB 5: WHATSAPP BROADCAST */}
                            {showcaseTab === 'broadcast' && (
                                <div className="max-w-xl mx-auto rounded-3xl p-6 bg-slate-50 border border-slate-200 space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h3 className="text-sm font-bold text-slate-900">WhatsApp Broadcast Drip</h3>
                                            <p className="text-[11px] text-slate-500 mt-0.5">Automated re-engagement template sent directly to prospects.</p>
                                        </div>
                                        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-full border border-emerald-200">
                                            Verified Delivery
                                        </span>
                                    </div>

                                    {/* WhatsApp Message Preview Card with Attached Creative */}
                                    <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-3">
                                        <div className="w-full aspect-[16/9] rounded-xl overflow-hidden bg-slate-900 relative border border-slate-200">
                                            <img
                                                src={creative?.imageUrl || projectImageUrl}
                                                alt="Broadcast Attached Asset"
                                                className="w-full h-full object-cover"
                                            />
                                            <div className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-full bg-black/70 backdrop-blur-md text-white text-[10px] font-bold flex items-center gap-1">
                                                <Layers size={10} className="text-amber-400" />
                                                <span>Attached 3:4 Ad Creative</span>
                                            </div>
                                        </div>

                                        <div className="p-3.5 rounded-xl bg-[#EFEAE2] border border-slate-200 text-xs space-y-2">
                                            <div className="flex items-center gap-1.5 text-emerald-800 font-bold text-[11px]">
                                                <CheckCircle2 size={12} className="text-emerald-600" />
                                                <span>Approved Template Dispatch</span>
                                            </div>
                                            <div className="p-3 bg-white rounded-xl text-slate-800 leading-relaxed shadow-xs text-xs space-y-1">
                                                <p>
                                                    Hi <strong>{prospectName}</strong>, your appointment is confirmed for <strong>VIP Walkthrough &amp; Preview</strong> with <strong>{projectTitle}</strong> from <strong>{companyName}</strong>. We look forward to connecting with you!
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Action Button for Broadcast */}
                                    <button
                                        onClick={() => handleSendStepWhatsApp('weekly_broadcast', `Broadcast template dispatched to +91 ${prospectPhone.slice(-10)}!`)}
                                        disabled={sendingTabWhatsApp === 'weekly_broadcast'}
                                        className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:opacity-50 active:scale-98 transition-all"
                                    >
                                        {sendingTabWhatsApp === 'weekly_broadcast' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                                        <span>Send Broadcast to My WhatsApp (+91 {prospectPhone.slice(-10) || 'Phone'})</span>
                                    </button>
                                </div>
                            )}

                            {/* TAB 7: CRM PIPELINE */}
                            {showcaseTab === 'crm' && (
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-2xl">
                                        <div className="flex items-center gap-2">
                                            <Database size={15} className="text-blue-600" />
                                            <span className="text-xs font-bold text-slate-800">Sales Pipeline with Meta CAPI</span>
                                        </div>
                                        <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-200">
                                            Live Ingestion
                                        </span>
                                    </div>

                                    {/* 5-Column Kanban */}
                                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                        {[
                                            { stage: 'New Lead', count: leadPipelineStage === 'New Lead' ? 1 : 0 },
                                            { stage: 'AI Contacted', count: leadPipelineStage === 'AI Contacted' ? 1 : 0 },
                                            { stage: 'Qualified', count: leadPipelineStage === 'Qualified' ? 1 : 0 },
                                            { stage: 'Site Visit Booked', count: leadPipelineStage === 'Site Visit Booked' ? 1 : 0 },
                                            { stage: 'Closed', count: 0 }
                                        ].map((col, idx) => (
                                            <div key={idx} className="p-3 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col justify-between min-h-[160px]">
                                                <div>
                                                    <div className="flex items-center justify-between mb-2">
                                                        <span className="text-[11px] font-bold text-slate-700">{col.stage}</span>
                                                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white text-slate-600 font-bold border border-slate-200">
                                                            {col.count}
                                                        </span>
                                                    </div>

                                                    {col.count > 0 && (
                                                        <div className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-1">
                                                            <div className="text-xs font-bold text-slate-900">{prospectName}</div>
                                                            <div className="text-[10px] text-slate-500 font-mono">+91 {prospectPhone.slice(-10) || '9888626786'}</div>
                                                        </div>
                                                    )}
                                                </div>

                                                <span className="text-[9px] text-slate-400 text-center">Auto-Updated</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                        </motion.div>
                    )}

                    {/* =========================================================================
                        STEP 4: LIVE TELEPHONY DIALER & POST-CALL ACTION DECK
                    ========================================================================= */}
                    {step === 'speed_to_lead' && (
                        <motion.div
                            key="step-speed-to-lead"
                            initial={{ opacity: 0, scale: 0.96 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.96 }}
                            className="bg-white border border-blue-200 rounded-3xl p-6 sm:p-8 shadow-xl max-w-lg mx-auto text-center space-y-4"
                        >
                            {/* Top Bar with Live Badge & Direct Return */}
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-blue-700 bg-blue-50 px-3 py-1 rounded-full border border-blue-200 flex items-center gap-1.5">
                                    <Phone size={12} />
                                    <span>Live Telephony</span>
                                </span>

                                <button
                                    type="button"
                                    onClick={() => {
                                        setStep('showcase');
                                        setShowcaseTab('creative');
                                        playChime('beep');
                                    }}
                                    className="text-xs font-bold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-3.5 py-1 rounded-full border border-slate-200 flex items-center gap-1.5 transition-all cursor-pointer"
                                >
                                    <Layers size={12} />
                                    <span>← Back to Creatives</span>
                                </button>
                            </div>

                            <div className="mt-2 relative w-20 h-20 mx-auto">
                                <div className={`absolute inset-0 rounded-full border-2 border-blue-300 ${callStatus === 'ringing' || callStatus === 'in_call' ? 'animate-ping' : ''}`} />
                                <div className={`w-full h-full rounded-full flex items-center justify-center text-white shadow-lg ${callStatus === 'completed' ? 'bg-gradient-to-tr from-emerald-600 to-teal-600' : 'bg-gradient-to-tr from-blue-600 to-indigo-600'}`}>
                                    {callStatus === 'completed' ? (
                                        <CheckCircle2 size={32} />
                                    ) : (
                                        <Phone size={30} className={callStatus === 'ringing' ? 'animate-bounce' : ''} />
                                    )}
                                </div>
                            </div>

                            <div>
                                <h2 className="text-xl font-extrabold text-slate-900 mt-2">
                                    {callStatus === 'ringing'
                                        ? 'Ringing Your Phone...'
                                        : callStatus === 'in_call'
                                            ? 'Call in Progress with AI'
                                            : callStatus === 'completed'
                                                ? 'Test Call Finished!'
                                                : 'Calling Your Number...'}
                                </h2>

                                <div className="mt-1 text-xs text-blue-700 font-mono font-bold">
                                    {callerNumber} ➔ +91 {prospectPhone.slice(-10)} ({formatTimer(callTimer)})
                                </div>
                            </div>

                            {/* Soundwave animation */}
                            {callStatus !== 'completed' && (
                                <div className="flex items-center justify-center gap-1.5 my-3 h-7">
                                    {[30, 70, 45, 90, 60, 100, 40, 80, 50, 95, 35, 75, 45].map((h, i) => (
                                        <div
                                            key={i}
                                            style={{ height: `${h}%` }}
                                            className="w-1 bg-gradient-to-t from-blue-600 to-indigo-500 rounded-full animate-pulse"
                                        />
                                    ))}
                                </div>
                            )}

                            {callSummary && (
                                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-left">
                                    <strong className="text-slate-800">Transcript Summary:</strong>
                                    <p className="text-slate-600 mt-1 italic">{callSummary}</p>
                                </div>
                            )}

                            {/* DELIVERABLES & CREATIVES ACTION CARD */}
                            <div className="p-4 rounded-2xl bg-gradient-to-r from-blue-50/80 to-indigo-50/80 border border-blue-200 text-left space-y-2.5">
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-black uppercase tracking-wider text-blue-900 flex items-center gap-1.5">
                                        <Sparkles size={13} className="text-blue-600" />
                                        <span>AI Deliverables Status</span>
                                    </span>
                                    {isGenerating ? (
                                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-100/80 px-2 py-0.5 rounded-full border border-amber-300">
                                            <Loader2 size={10} className="animate-spin" /> Rendering Stage {generationStage}/4
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-100/90 px-2.5 py-0.5 rounded-full border border-emerald-300">
                                            <Check size={11} strokeWidth={3} /> Ready to Review
                                        </span>
                                    )}
                                </div>

                                <p className="text-xs text-slate-600 leading-relaxed">
                                    {isGenerating
                                        ? 'Your 3:4 Ad Creative and 30s Multi-Scene Reel are completing in background.'
                                        : 'Your customized luxury Ad Creative, 30s Commercial Reel, and Multipage Website are ready!'}
                                </p>

                                <div className="grid grid-cols-2 gap-2 pt-1">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setStep('showcase');
                                            setShowcaseTab('creative');
                                            playChime('beep');
                                        }}
                                        className="py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs active:scale-95"
                                    >
                                        <Layers size={13} />
                                        <span>Check Creatives</span>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => {
                                            setStep('showcase');
                                            setShowcaseTab('video');
                                            playChime('beep');
                                        }}
                                        className="py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs active:scale-95"
                                    >
                                        <Play size={13} />
                                        <span>Watch 30s Reel</span>
                                    </button>
                                </div>
                            </div>

                            {/* WHATSAPP DISPATCH CARD */}
                            <div className="p-4 rounded-2xl bg-emerald-50/80 border border-emerald-200 text-left space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-black uppercase tracking-wider text-emerald-900 flex items-center gap-1.5">
                                        <MessageCircle size={13} className="text-emerald-600" />
                                        <span>WhatsApp Verification</span>
                                    </span>
                                    <span className="text-[10px] font-bold text-emerald-700">Official Template</span>
                                </div>

                                <p className="text-xs text-slate-600 leading-relaxed">
                                    Send verified WhatsApp template directly to <strong>+91 {prospectPhone.slice(-10)}</strong>.
                                </p>

                                <div className="flex items-center gap-2 pt-1">
                                    <button
                                        type="button"
                                        onClick={() => handleSendStepWhatsApp('lead_welcome', `WhatsApp message dispatched to +91 ${prospectPhone.slice(-10)}!`)}
                                        disabled={sendingTabWhatsApp === 'lead_welcome'}
                                        className="flex-1 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs disabled:opacity-50 active:scale-95"
                                    >
                                        {sendingTabWhatsApp === 'lead_welcome' ? (
                                            <>
                                                <Loader2 size={13} className="animate-spin" />
                                                <span>Sending...</span>
                                            </>
                                        ) : (
                                            <>
                                                <Send size={13} />
                                                <span>Test WhatsApp Message</span>
                                            </>
                                        )}
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => {
                                            setStep('showcase');
                                            setShowcaseTab('broadcast');
                                            playChime('beep');
                                        }}
                                        className="py-2.5 px-3 rounded-xl bg-white hover:bg-emerald-50 text-emerald-800 border border-emerald-300 font-bold text-xs flex items-center justify-center gap-1 transition-all cursor-pointer"
                                    >
                                        <span>Broadcast →</span>
                                    </button>
                                </div>
                            </div>

                            {/* Bottom Navigation */}
                            <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setStep('showcase');
                                        playChime('beep');
                                    }}
                                    className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                                >
                                    <span>← Back to Deliverables</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={goToPricingComparison}
                                    className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-xs cursor-pointer flex items-center gap-1.5"
                                >
                                    <span>Pricing Matrix ➔</span>
                                </button>
                            </div>
                        </motion.div>
                    )}

                    {/* =========================================================================
                        STEP 5: PRICING COMPARISON
                    ========================================================================= */}
                    {step === 'pricing_comparison' && (
                        <motion.div
                            key="step-pricing-comparison"
                            initial={{ opacity: 0, scale: 0.96 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-10 shadow-xl"
                        >
                            <div className="text-center max-w-2xl mx-auto mb-8">
                                <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">
                                    All Included: <span className="text-blue-600">₹9,999 / Month</span>
                                </h2>
                                <p className="text-xs sm:text-sm text-slate-500 mt-2">
                                    No marketing agency retainers or freelance delays. The entire engine operates 24x7.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-8">
                                <div className="p-5 rounded-2xl bg-red-50/50 border border-red-200 flex flex-col justify-between">
                                    <div>
                                        <div className="flex items-center justify-between text-xs font-bold text-red-700 mb-1">
                                            <span>Traditional Agency</span>
                                            <span>Typical Retainer</span>
                                        </div>
                                        <div className="text-2xl font-black text-slate-900">
                                            ₹1,85,000 - ₹2,50,000<span className="text-xs font-normal text-slate-500"> / mo</span>
                                        </div>
                                        <ul className="mt-3 space-y-1.5 text-xs text-slate-600">
                                            <li className="flex items-center gap-2">
                                                <XCircle size={13} className="text-red-500 shrink-0" />
                                                <span>3 to 4 weeks setup time</span>
                                            </li>
                                            <li className="flex items-center gap-2">
                                                <XCircle size={13} className="text-red-500 shrink-0" />
                                                <span>Manual telecallers miss after-hours leads</span>
                                            </li>
                                        </ul>
                                    </div>
                                    <div className="mt-4 pt-3 border-t border-red-200 text-xs font-bold text-red-700">
                                        Total Yearly Burn: ₹22,00,000+
                                    </div>
                                </div>

                                <div className="p-5 rounded-2xl bg-gradient-to-br from-blue-50/80 to-indigo-50/80 border-2 border-blue-600 shadow-md flex flex-col justify-between">
                                    <div>
                                        <div className="flex items-center justify-between text-xs font-bold text-blue-700 mb-1">
                                            <span>Nobogent</span>
                                            <span className="text-amber-700 font-extrabold">Instant</span>
                                        </div>
                                        <div className="text-3xl font-black text-slate-900">
                                            ₹9,999<span className="text-xs font-bold text-slate-500"> + GST / mo</span>
                                        </div>
                                        <ul className="mt-3 space-y-1.5 text-xs text-slate-700">
                                            <li className="flex items-center gap-2">
                                                <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />
                                                <span>Instant setup under 60 seconds</span>
                                            </li>
                                            <li className="flex items-center gap-2">
                                                <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />
                                                <span>&lt;30s AI calling &amp; WhatsApp qualification</span>
                                            </li>
                                        </ul>
                                    </div>
                                    <div className="mt-4 pt-3 border-t border-blue-200 text-xs font-bold text-emerald-700">
                                        Save Over ₹20,00,000 Annually
                                    </div>
                                </div>
                            </div>

                            {/* Comparison List */}
                            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden mb-6">
                                <div className="divide-y divide-slate-100">
                                    {SERVICE_COMPARISONS.map((item, idx) => (
                                        <div key={idx} className="px-5 py-3 flex items-center justify-between gap-2 hover:bg-slate-50/60 transition-colors text-xs">
                                            <div className="flex items-center gap-2.5">
                                                <div className="w-6 h-6 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 flex items-center justify-center shrink-0">
                                                    <item.icon size={13} />
                                                </div>
                                                <span className="font-bold text-slate-800">{item.name}</span>
                                            </div>

                                            <div className="flex items-center gap-6">
                                                <span className="text-red-500 line-through hidden sm:inline">{item.agencyCost}</span>
                                                <span className="text-emerald-700 font-bold flex items-center gap-1">
                                                    <Check size={13} /> Included
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center justify-center gap-3 pt-4 border-t border-slate-100">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setStep('showcase');
                                        setShowcaseTab('creative');
                                        playChime('beep');
                                    }}
                                    className="px-5 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer shadow-sm active:scale-95"
                                >
                                    <Layers size={14} />
                                    <span>← Back to Creatives &amp; Video</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => handleSendStepWhatsApp('lead_welcome', `WhatsApp message dispatched to +91 ${prospectPhone.slice(-10)}!`)}
                                    disabled={sendingTabWhatsApp === 'lead_welcome'}
                                    className="px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer shadow-sm disabled:opacity-50 active:scale-95"
                                >
                                    <Send size={14} />
                                    <span>Test WhatsApp Message</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setStep('onboarding')}
                                    className="px-5 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer"
                                >
                                    <RefreshCw size={13} />
                                    <span>Test Another Brand</span>
                                </button>

                                <a
                                    href="/login"
                                    className="px-7 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-md active:scale-95 flex items-center gap-2 cursor-pointer"
                                >
                                    <span>Get Started</span>
                                    <ArrowRight size={15} />
                                </a>
                            </div>
                        </motion.div>
                    )}

                </AnimatePresence>
            </main>

            {/* FOOTER */}
            <footer className="w-full max-w-6xl mx-auto px-6 py-4 border-t border-slate-200 text-center text-xs text-slate-500 z-20 flex flex-col sm:flex-row items-center justify-between gap-2">
                <span>© 2026 Nobogent Technologies Inc.</span>
                <span className="text-slate-400">
                    Vobiz Telephony • Meta Graph API • Astro JS
                </span>
            </footer>

            {/* =========================================================================
                POPUP MODAL: ALL 35+ SUPER ADMIN REFERENCE CREATIVE DESIGNS
            ========================================================================= */}
            <AnimatePresence>
                {isTemplateModalOpen && (
                    <div
                        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/70 backdrop-blur-md"
                        onClick={() => setIsTemplateModalOpen(false)}
                    >
                        <motion.div
                            initial={{ opacity: 0, scale: 0.96, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.96, y: 10 }}
                            transition={{ duration: 0.2 }}
                            onClick={(e) => e.stopPropagation()}
                            className="relative w-full max-w-5xl max-h-[90vh] bg-white rounded-3xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
                        >
                            {/* Modal Header */}
                            <div className="p-4 sm:p-6 border-b border-slate-100 flex flex-col gap-3 shrink-0 bg-slate-50/70">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2.5">
                                        <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center font-bold border border-blue-200 shadow-2xs">
                                            <Layers size={18} />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h2 className="text-base sm:text-lg font-extrabold text-slate-900 tracking-tight">
                                                    Select Reference Creative Design
                                                </h2>
                                                <span className="px-2 py-0.5 rounded-full bg-blue-100/70 text-blue-700 font-bold text-[10px] border border-blue-200">
                                                    35 Designs Available
                                                </span>
                                            </div>
                                            <p className="text-xs text-slate-500 mt-0.5">
                                                Choose any reference design from our Super Admin library. The AI creative engine will adapt your property image, badges, and typography to this layout.
                                            </p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setIsTemplateModalOpen(false)}
                                        className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                                    >
                                        <X size={18} />
                                    </button>
                                </div>

                                {/* Filter & Search Controls */}
                                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
                                    {/* Category Tabs */}
                                    <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
                                        {[
                                            { key: 'all', label: 'All Designs (35)' },
                                            { key: 'high_converting', label: 'High Converting (16)' },
                                            { key: 'premium', label: 'Ultra Luxury & Premium (19)' }
                                        ].map((tab) => (
                                            <button
                                                key={tab.key}
                                                onClick={() => setTemplateCategoryFilter(tab.key as any)}
                                                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${templateCategoryFilter === tab.key
                                                        ? 'bg-blue-600 text-white shadow-xs'
                                                        : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200 hover:bg-slate-50'
                                                    }`}
                                            >
                                                {tab.label}
                                            </button>
                                        ))}
                                    </div>

                                    {/* Search Input */}
                                    <div className="relative w-full sm:w-64">
                                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                        <input
                                            type="text"
                                            value={templateSearchQuery}
                                            onChange={(e) => setTemplateSearchQuery(e.target.value)}
                                            placeholder="Search by title, badge..."
                                            className="w-full pl-8 pr-7 py-1.5 text-xs bg-white border border-slate-200 rounded-xl text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 shadow-2xs"
                                        />
                                        {templateSearchQuery && (
                                            <button
                                                onClick={() => setTemplateSearchQuery('')}
                                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                                            >
                                                <X size={12} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Modal Body: Grid of all 35 templates */}
                            <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-100/70">
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5 sm:gap-4">
                                    {filteredTemplates.map((tmpl) => {
                                        const isSelected = selectedTemplateId === tmpl.id || selectedTemplateId === tmpl.url || (selectedTemplateId === 'pinterest_damac_island' && tmpl.index === 0);
                                        return (
                                            <div
                                                key={tmpl.id}
                                                onClick={() => handleSelectTemplate(tmpl.id)}
                                                className={`group relative rounded-2xl overflow-hidden bg-white border transition-all duration-200 flex flex-col justify-between cursor-pointer ${isSelected
                                                        ? 'border-blue-600 ring-2 ring-blue-500/30 shadow-md'
                                                        : 'border-slate-200/90 hover:border-blue-400 hover:shadow-md'
                                                    }`}
                                            >
                                                <div className="relative aspect-[3/4] w-full overflow-hidden bg-slate-950">
                                                    <img
                                                        src={tmpl.url}
                                                        alt={tmpl.name}
                                                        loading="lazy"
                                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                                    />
                                                    <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-slate-950/80 backdrop-blur-xs text-[9px] font-extrabold text-amber-300 uppercase tracking-wider shadow-xs">
                                                        {tmpl.badge}
                                                    </span>

                                                    {/* Fullsize preview icon button */}
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setImageLightboxUrl(tmpl.url);
                                                        }}
                                                        className="absolute bottom-2 right-2 p-1.5 rounded-lg bg-slate-950/80 hover:bg-slate-900 text-white opacity-0 group-hover:opacity-100 transition-opacity shadow-sm cursor-pointer"
                                                        title="View High-Res"
                                                    >
                                                        <Maximize2 size={13} />
                                                    </button>

                                                    {isSelected && (
                                                        <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-md">
                                                            <Check size={13} strokeWidth={3} />
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="p-3 bg-white">
                                                    <div className="text-xs font-extrabold text-slate-900 truncate">
                                                        {tmpl.name}
                                                    </div>
                                                    <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                                                        {tmpl.category} &bull; {tmpl.libraryCategory === 'high_converting' ? 'High Converting' : 'Ultra Luxury'}
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleSelectTemplate(tmpl.id);
                                                        }}
                                                        className={`mt-2 w-full py-1.5 rounded-xl text-[11px] font-bold transition-all cursor-pointer ${isSelected
                                                                ? 'bg-blue-600 text-white'
                                                                : 'bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700'
                                                            }`}
                                                    >
                                                        {isSelected ? '✓ Selected' : 'Use This Template'}
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                {filteredTemplates.length === 0 && (
                                    <div className="text-center py-12 text-slate-400">
                                        <Layers size={32} className="mx-auto mb-2 opacity-50" />
                                        <p className="text-sm font-bold text-slate-600">No matching templates found</p>
                                        <p className="text-xs text-slate-400 mt-1">Try another keyword or category filter</p>
                                    </div>
                                )}
                            </div>

                            {/* Modal Footer */}
                            <div className="p-4 border-t border-slate-200 bg-white flex items-center justify-between">
                                <div className="text-xs text-slate-600">
                                    Current Choice: <strong className="text-slate-900">{currentTemplate.name}</strong> <span className="text-slate-400">({currentTemplate.badge})</span>
                                </div>
                                <button
                                    onClick={() => setIsTemplateModalOpen(false)}
                                    className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-all cursor-pointer shadow-xs"
                                >
                                    Done
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* =========================================================================
                HIGH-RES IMAGE LIGHTBOX MODAL
            ========================================================================= */}
            <AnimatePresence>
                {imageLightboxUrl && (
                    <div
                        onClick={() => setImageLightboxUrl(null)}
                        className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md"
                    >
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.15 }}
                            onClick={(e) => e.stopPropagation()}
                            className="relative max-w-4xl max-h-[92vh] rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 shadow-2xl flex flex-col items-center justify-center p-2"
                        >
                            <button
                                onClick={() => setImageLightboxUrl(null)}
                                className="absolute top-3 right-3 z-10 p-2 rounded-full bg-slate-900/80 hover:bg-slate-800 text-white transition-all cursor-pointer shadow-md"
                            >
                                <X size={16} />
                            </button>
                            <img
                                src={imageLightboxUrl}
                                alt="Enlarged Preview"
                                className="max-w-full max-h-[85vh] object-contain rounded-xl"
                            />
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
