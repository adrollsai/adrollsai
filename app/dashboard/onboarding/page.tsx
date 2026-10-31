'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
    Sparkles, 
    Building2, 
    Package, 
    Upload, 
    ArrowRight, 
    CheckCircle2, 
    Check, 
    Loader2, 
    Globe,
    Phone,
    MapPin,
    Facebook,
    MessageCircle,
    Crown,
    ExternalLink,
    AlertCircle,
    RefreshCw,
    ShieldCheck,
    Layers,
    Megaphone,
    Volume2,
    VolumeX,
    Zap,
    Maximize2,
    Trash2,
    ImageIcon,
    X,
    Award,
    Search,
    Plus
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
// @ts-ignore
import confetti from 'canvas-confetti';
import { uploadToR2 } from '@/utils/upload-helper';
import { toast } from 'sonner';
import { createClient } from '@/utils/supabase/client';
import { useRazorpay } from '@/utils/useRazorpay';
import { ALL_REFERENCE_TEMPLATES, ReferenceTemplate } from '@/utils/reference-templates-data';

type OnboardingStep = 'profile' | 'integrations' | 'product' | 'templates' | 'generating' | 'payment';

const INSPIRATIONAL_QUOTES = [
    {
        quote: "The average customer waits less than 5 minutes for a response. Nobogent's AI replies in under 10 seconds.",
        author: "Speed-to-Lead Advantage",
        badge: "⚡ Instant AI Response"
    },
    {
        quote: "Turn one product listing into hyper-converting Meta ads and video commercials without hiring an agency.",
        author: "Autonomous Creative Studio",
        badge: "🎨 AI Production"
    },
    {
        quote: "Businesses that connect Meta & WhatsApp see 3.4x faster lead response times and 42% higher conversion rates.",
        author: "Omnichannel Closing",
        badge: "📈 340% Higher ROI"
    },
    {
        quote: "While you sleep, Nobogent AI is qualifying leads, sending catalogs, and booking appointments on your calendar.",
        author: "Autonomous Growth Engine",
        badge: "🤖 24/7 Automation"
    }
];

export interface OnboardingProjectConfig {
    id: string;
    title: string;
    price: string;
    description: string;
    imageUrl: string;
    creativesCount: number;
    videos: Array<{
        id: string;
        duration: number; // 15, 30, 45, 60, 90
        customInstructions: string;
    }>;
    customInstructions: string;
}

export default function OnboardingPage() {
    const router = useRouter();
    const supabase = createClient();
    const { openCheckout, isProcessing: isPaymentProcessing } = useRazorpay();

    // Active Step
    const [step, setStep] = useState<OnboardingStep>('profile');
    const [paymentType, setPaymentType] = useState<'one_time' | 'recurring'>('one_time');
    const [hasPurchasedTrial, setHasPurchasedTrial] = useState<boolean>(false);

    // Quote rotation
    const [quoteIndex, setQuoteIndex] = useState(0);

    // Check trial status on mount
    useEffect(() => {
        const checkTrial = async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) return;
                const { data: profile } = await supabase
                    .from('profiles')
                    .select('subscription_plan, client_features')
                    .eq('id', user.id)
                    .single();
                if (profile?.client_features?.has_purchased_trial || profile?.subscription_plan === 'trial') {
                    setHasPurchasedTrial(true);
                }
            } catch {}
        };
        checkTrial();
    }, [supabase]);

    // Lightbox Modal
    const [imageLightboxUrl, setImageLightboxUrl] = useState('');

    // Website Fetch State
    const [websiteUrl, setWebsiteUrl] = useState('');
    const [fetchingWebsite, setFetchingWebsite] = useState(false);
    const [websiteFetched, setWebsiteFetched] = useState(false);

    // Profile Details
    const [companyName, setCompanyName] = useState('');
    const [country, setCountry] = useState('India');
    const [companyDescription, setCompanyDescription] = useState('');
    const [contactNumber, setContactNumber] = useState('');
    const [businessAddress, setBusinessAddress] = useState('');
    const [logoUrl, setLogoUrl] = useState('');
    const [uploadingLogo, setUploadingLogo] = useState(false);
    const logoInputRef = useRef<HTMLInputElement>(null);

    // Account Connections
    const [isMetaConnected, setIsMetaConnected] = useState(false);
    const [isConnectingMeta, setIsConnectingMeta] = useState(false);
    const [isWhatsAppConnected, setIsWhatsAppConnected] = useState(false);
    const [isConnectingWhatsApp, setIsConnectingWhatsApp] = useState(false);
    const [whatsappNumberInput, setWhatsappNumberInput] = useState('');
    const [isSavingWhatsappNum, setIsSavingWhatsappNum] = useState(false);

    // Product & Multi-Project Details

    const [productTitle, setProductTitle] = useState('');
    const [productDescription, setProductDescription] = useState('');
    const [productPrice, setProductPrice] = useState('');
    const [productImageUrl, setProductImageUrl] = useState('');
    const [uploadingProductImage, setUploadingProductImage] = useState(false);
    const productInputRef = useRef<HTMLInputElement>(null);

    // Multi-Project Delivery Allocation (5-Minute Global Video Pool)
    const MAX_VIDEO_POOL_SECONDS = 300;
    const [projects, setProjects] = useState<OnboardingProjectConfig[]>([
        {
            id: 'proj_1',
            title: '',
            price: '',
            description: '',
            imageUrl: '',
            creativesCount: 3,
            videos: [
                { id: 'vid_1', duration: 30, customInstructions: '' }
            ],
            customInstructions: ''
        }
    ]);
    const [activeProjectIndex, setActiveProjectIndex] = useState(0);

    const totalAllocatedVideoSeconds = projects.reduce((total, p) => {
        return total + ((p.videos || []).reduce((pTot, v) => pTot + (Number(v?.duration) || 0), 0));
    }, 0);
    const remainingVideoSeconds = Math.max(0, MAX_VIDEO_POOL_SECONDS - (totalAllocatedVideoSeconds || 0));
    const videoProgressPercent = Math.min(100, (((totalAllocatedVideoSeconds || 0) / MAX_VIDEO_POOL_SECONDS) * 100) || 0);

    const handleAddProject = () => {
        const defaultVidDuration = remainingVideoSeconds >= 30 ? 30 : (remainingVideoSeconds >= 15 ? 15 : 0);
        const newProj: OnboardingProjectConfig = {
            id: 'proj_' + Date.now(),
            title: '',
            price: '',
            description: '',
            imageUrl: '',
            creativesCount: 3,
            videos: defaultVidDuration > 0 ? [{ id: 'vid_' + Date.now(), duration: defaultVidDuration, customInstructions: '' }] : [],
            customInstructions: ''
        };
        setProjects(prev => [...prev, newProj]);
        setActiveProjectIndex(projects.length);
        playChime('beep');
        toast.success("Added new project slot! Configure deliverables below.");
    };

    const handleRemoveProject = (index: number) => {
        if (projects.length <= 1) {
            toast.error("You must have at least one project.");
            return;
        }
        setProjects(prev => prev.filter((_, i) => i !== index));
        if (activeProjectIndex >= index && activeProjectIndex > 0) {
            setActiveProjectIndex(activeProjectIndex - 1);
        }
        playChime('beep');
        toast.info("Project removed");
    };

    const handleUpdateProjectField = (index: number, field: keyof OnboardingProjectConfig, value: any) => {
        setProjects(prev => {
            const next = [...prev];
            next[index] = { ...next[index], [field]: value };
            return next;
        });
        if (index === 0) {
            if (field === 'title') setProductTitle(value);
            if (field === 'description') setProductDescription(value);
            if (field === 'price') setProductPrice(value);
            if (field === 'imageUrl') setProductImageUrl(value);
        }
    };

    const handleAddVideoToProject = (projectIndex: number) => {
        if (remainingVideoSeconds < 15) {
            toast.error("You have reached your 5-minute video duration budget. Remove or shorten existing videos to free up seconds.");
            return;
        }
        const newDuration = remainingVideoSeconds >= 30 ? 30 : 15;
        setProjects(prev => {
            const next = [...prev];
            next[projectIndex] = {
                ...next[projectIndex],
                videos: [...next[projectIndex].videos, { id: 'vid_' + Date.now(), duration: newDuration, customInstructions: '' }]
            };
            return next;
        });
        playChime('beep');
        toast.success('Added ' + newDuration + 's video reel to ' + (projects[projectIndex].title || 'Project') + '.');
    };

    const handleRemoveVideoFromProject = (projectIndex: number, videoIndex: number) => {
        setProjects(prev => {
            const next = [...prev];
            const updatedVideos = next[projectIndex].videos.filter((_, idx) => idx !== videoIndex);
            next[projectIndex] = { ...next[projectIndex], videos: updatedVideos };
            return next;
        });
        playChime('beep');
        toast.info("Video reel removed. Budget restored.");
    };

    const handleUpdateVideoDuration = (projectIndex: number, videoIndex: number, newDuration: number) => {
        const currentVideoDuration = projects[projectIndex].videos[videoIndex].duration;
        const durationDiff = newDuration - currentVideoDuration;

        if (durationDiff > remainingVideoSeconds) {
            toast.error('Not enough remaining duration. You have ' + remainingVideoSeconds + 's available.');
            return;
        }

        setProjects(prev => {
            const next = [...prev];
            const updatedVideos = [...next[projectIndex].videos];
            updatedVideos[videoIndex] = { ...updatedVideos[videoIndex], duration: newDuration };
            next[projectIndex] = { ...next[projectIndex], videos: updatedVideos };
            return next;
        });
        playChime('beep');
    };

    const handleUpdateVideoInstruction = (projectIndex: number, videoIndex: number, instruction: string) => {
        setProjects(prev => {
            const next = [...prev];
            const updatedVideos = [...next[projectIndex].videos];
            updatedVideos[videoIndex] = { ...updatedVideos[videoIndex], customInstructions: instruction };
            next[projectIndex] = { ...next[projectIndex], videos: updatedVideos };
            return next;
        });
    };

    // Design Template Selection (Up to 10 templates, pre-selected with top 5)
    const [selectedTemplates, setSelectedTemplates] = useState<string[]>([
        'pinterest_pin_0',
        'pinterest_pin_1',
        'pinterest_pin_2',
        'pinterest_pin_3',
        'pinterest_pin_4'
    ]);
    const [templateCategoryFilter, setTemplateCategoryFilter] = useState<'all' | 'high_converting' | 'premium' | 'waterfront' | 'direct_response' | 'dark_mode'>('all');
    const [templateSearchQuery, setTemplateSearchQuery] = useState('');

    // Generation State
    const [generatingAssets, setGeneratingAssets] = useState(false);
    const [generationFinished, setGenerationFinished] = useState(false);
    const [progressStep, setProgressStep] = useState(0);

    // Walkthrough video states
    const [isVideoMuted, setIsVideoMuted] = useState(true);
    const videoRef = useRef<HTMLVideoElement>(null);

    // Audio chime helper using Web Audio API synthesis
    const playChime = (type: 'beep' | 'success') => {
        try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);

            if (type === 'beep') {
                osc.frequency.setValueAtTime(440, ctx.currentTime);
                gain.gain.setValueAtTime(0.05, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
                osc.start();
                osc.stop(ctx.currentTime + 0.15);
            } else if (type === 'success') {
                osc.frequency.setValueAtTime(523.25, ctx.currentTime);
                osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1);
                gain.gain.setValueAtTime(0.07, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
                osc.start();
                osc.stop(ctx.currentTime + 0.35);
            }
        } catch {}
    };

    // Initial Load - Fetch profile to prefill any existing data & connection status
    useEffect(() => {
        const loadInitialData = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const { data: profile } = await supabase
                .from('profiles')
                .select('business_name, business_info, logo_url, contact_number, address, custom_domain, facebook_token, whatsapp_phone_number_id, whatsapp_phone_number, selected_templates')
                .eq('id', user.id)
                .single();

            if (profile) {
                if (profile.business_name && profile.business_name !== 'My Business') setCompanyName(profile.business_name);
                if (profile.business_info) setCompanyDescription(profile.business_info);
                if (profile.logo_url) setLogoUrl(profile.logo_url);
                if (profile.contact_number) {
                    setContactNumber(profile.contact_number);
                    setWhatsappNumberInput(profile.contact_number);
                }
                if (profile.address) setBusinessAddress(profile.address);
                if (profile.custom_domain) setWebsiteUrl(profile.custom_domain);
                if (profile.facebook_token) setIsMetaConnected(true);
                if (profile.whatsapp_phone_number_id || profile.whatsapp_phone_number) {
                    setIsWhatsAppConnected(true);
                    if (profile.whatsapp_phone_number) setWhatsappNumberInput(profile.whatsapp_phone_number);
                }
                if (profile.selected_templates && Array.isArray(profile.selected_templates) && profile.selected_templates.length > 0) {
                    setSelectedTemplates(profile.selected_templates.slice(0, 10));
                }
            }
        };

        loadInitialData();
    }, [supabase]);

    // Listen for Meta OAuth popup messages
    useEffect(() => {
        const handleAuthMessage = (event: MessageEvent) => {
            if (event.data?.type === 'FACEBOOK_CONNECTED') {
                setIsConnectingMeta(false);
                if (event.data.success) {
                    setIsMetaConnected(true);
                    playChime('success');
                    toast.success("Meta (Facebook & Instagram) connected successfully! 🎉");
                } else {
                    toast.error(event.data.message || "Meta connection failed.");
                }
            }
        };

        window.addEventListener('message', handleAuthMessage);
        return () => window.removeEventListener('message', handleAuthMessage);
    }, []);

    // Load Facebook SDK for WhatsApp Embedded Signup
    useEffect(() => {
        if (!document.getElementById('facebook-jssdk')) {
            const js = document.createElement('script');
            js.id = 'facebook-jssdk';
            js.src = 'https://connect.facebook.net/en_US/sdk.js';
            document.head.appendChild(js);
        }
        (window as any).fbAsyncInit = function () {
            (window as any).FB?.init({
                appId: process.env.NEXT_PUBLIC_FACEBOOK_APP_ID,
                cookie: true,
                xfbml: true,
                version: 'v20.0'
            });
        };
    }, []);

    // Rotate inspiring quotes periodically
    useEffect(() => {
        const timer = setInterval(() => {
            setQuoteIndex((prev) => (prev + 1) % INSPIRATIONAL_QUOTES.length);
        }, 6000);
        return () => clearInterval(timer);
    }, []);

    // --- WEBSITE AUTO-FETCH ---
    const handleFetchWebsite = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!websiteUrl.trim()) {
            toast.error("Please enter a website URL first.");
            return;
        }

        setFetchingWebsite(true);
        const toastId = toast.loading("Analyzing your website with AI...");

        try {
            const res = await fetch('/api/onboarding/extract-website', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: websiteUrl })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to extract website details");

            const extracted = data.data;

            if (extracted.businessName) setCompanyName(extracted.businessName);
            if (extracted.businessInfo) setCompanyDescription(extracted.businessInfo);
            if (extracted.contactNumber) {
                setContactNumber(extracted.contactNumber);
                if (!whatsappNumberInput) setWhatsappNumberInput(extracted.contactNumber);
            }
            if (extracted.businessAddress) setBusinessAddress(extracted.businessAddress);
            if (extracted.logoUrl && !logoUrl) setLogoUrl(extracted.logoUrl);

            // Also prefill product if found
            if (extracted.product) {
                if (extracted.product.title) setProductTitle(extracted.product.title);
                if (extracted.product.description) setProductDescription(extracted.product.description);
                if (extracted.product.price) setProductPrice(extracted.product.price);
                if (extracted.product.imageUrl) setProductImageUrl(extracted.product.imageUrl);

                setProjects(prev => {
                    const next = [...prev];
                    next[0] = {
                        ...next[0],
                        title: extracted.product.title || next[0].title,
                        description: extracted.product.description || next[0].description,
                        price: extracted.product.price || next[0].price,
                        imageUrl: extracted.product.imageUrl || next[0].imageUrl
                    };
                    return next;
                });
            }

            setWebsiteFetched(true);
            playChime('success');
            toast.dismiss(toastId);
            toast.success("✨ Brand profile & flagship product extracted from your website!");
        } catch (err: any) {
            toast.dismiss(toastId);
            toast.error(err.message || "Could not fetch website. You can fill details manually.");
        } finally {
            setFetchingWebsite(false);
        }
    };

    // --- LOGO UPLOAD ---
    const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploadingLogo(true);
        try {
            const publicUrl = await uploadToR2(file, 'logos');
            setLogoUrl(publicUrl);
            playChime('success');
            toast.success("Logo uploaded successfully! 🎨");
        } catch (err: any) {
            toast.error("Failed to upload logo: " + err.message);
        } finally {
            setUploadingLogo(false);
            if (logoInputRef.current) logoInputRef.current.value = '';
        }
    };

    const handleRemoveLogo = () => {
        setLogoUrl('');
        toast.info("Logo removed");
    };

    // --- PRODUCT IMAGE UPLOAD ---
    const handleProductImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploadingProductImage(true);
        try {
            const publicUrl = await uploadToR2(file, 'properties');
            setProductImageUrl(publicUrl);
            playChime('success');
            toast.success("Product image uploaded! 📸");
        } catch (err: any) {
            toast.error("Failed to upload product image: " + err.message);
        } finally {
            setUploadingProductImage(false);
            if (productInputRef.current) productInputRef.current.value = '';
        }
    };

    const handleRemoveProductImage = () => {
        setProductImageUrl('');
        toast.info("Product image removed");
    };

    // --- TEMPLATE TOGGLE HANDLER (UP TO 10 TEMPLATES) ---
    const handleToggleTemplate = (templateId: string) => {
        if (selectedTemplates.includes(templateId)) {
            setSelectedTemplates(prev => prev.filter(id => id !== templateId));
            playChime('beep');
        } else {
            if (selectedTemplates.length >= 10) {
                toast.error("You can select up to 10 favorite design templates. Please unselect one first.");
                return;
            }
            setSelectedTemplates(prev => [...prev, templateId]);
            playChime('beep');
        }
    };

    // --- META CONNECTION ---
    const handleConnectMeta = () => {
        setIsConnectingMeta(true);
        const width = 640;
        const height = 750;
        const left = window.screen.width / 2 - width / 2;
        const top = window.screen.height / 2 - height / 2;

        const popup = window.open(
            '/api/facebook/connect',
            'MetaAuth',
            `toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=yes, resizable=yes, copyhistory=no, width=${width}, height=${height}, top=${top}, left=${left}`
        );

        if (!popup) {
            window.location.href = '/api/facebook/connect';
        }
    };

    // --- WHATSAPP EMBEDDED SIGNUP CONNECTION ---
    const handleConnectWhatsApp = () => {
        if (!(window as any).FB) {
            toast.error("Meta SDK is initializing. Try again in 2 seconds.");
            return;
        }

        setIsConnectingWhatsApp(true);
        let code: string | null = null;
        let metadata: { wabaId?: string; phone_number_id?: string } | null = null;
        let submitted = false;

        const checkAndSubmit = async (forceSubmit = false) => {
            if (submitted) return;
            if (code && (metadata || forceSubmit)) {
                submitted = true;
                window.removeEventListener('message', messageListener);
                const finalMetadata = metadata || {};
                try {
                    const res = await fetch('/api/whatsapp/onboard', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            code,
                            wabaId: finalMetadata.wabaId,
                            phone_number_id: finalMetadata.phone_number_id
                        })
                    });

                    const result = await res.json();
                    if (res.ok) {
                        setIsWhatsAppConnected(true);
                        setWhatsappNumberInput(result.phone || 'Connected');
                        playChime('success');
                        toast.success("WhatsApp Business API connected! 🟢");
                    } else {
                        toast.error(`WhatsApp connection failed: ${result.error}`);
                        submitted = false;
                    }
                } catch {
                    toast.error("WhatsApp onboarding could not be completed.");
                    submitted = false;
                } finally {
                    setIsConnectingWhatsApp(false);
                }
            }
        };

        const messageListener = (event: MessageEvent) => {
            if (event.origin !== 'https://www.facebook.com' && event.origin !== 'https://web.facebook.com') return;
            try {
                const data = JSON.parse(event.data);
                let wabaId = '';
                let phone_number_id = '';
                if (data.type === 'WA_EMBEDDED_SIGNUP' && data.event === 'FINISH') {
                    wabaId = data.data?.waba_id || '';
                    phone_number_id = data.data?.phone_number_id || '';
                }
                if (wabaId || phone_number_id) {
                    metadata = { wabaId, phone_number_id };
                    checkAndSubmit();
                }
            } catch {}
        };

        window.addEventListener('message', messageListener);

        (window as any).FB.login((response: any) => {
            if (response.authResponse?.code) {
                code = response.authResponse.code;
                checkAndSubmit();
                setTimeout(() => checkAndSubmit(true), 4000);
            } else {
                window.removeEventListener('message', messageListener);
                setIsConnectingWhatsApp(false);
            }
        }, {
            config_id: process.env.NEXT_PUBLIC_FACEBOOK_LOGIN_CONFIG_ID || '4311232925804423',
            response_type: 'code',
            override_default_response_type: true
        });
    };

    // Quick save WhatsApp phone number
    const handleSaveWhatsappNumber = async () => {
        if (!whatsappNumberInput.trim()) {
            toast.error("Please enter a valid WhatsApp number.");
            return;
        }

        setIsSavingWhatsappNum(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Unauthorized");

            const { error } = await supabase
                .from('profiles')
                .update({
                    whatsapp_phone_number: whatsappNumberInput.trim()
                })
                .eq('id', user.id);

            if (error) throw error;
            setIsWhatsAppConnected(true);
            playChime('success');
            toast.success("WhatsApp number saved for lead alerts! 📱");
        } catch (err: any) {
            toast.error("Failed to save WhatsApp number: " + err.message);
        } finally {
            setIsSavingWhatsappNum(false);
        }
    };

    // --- SUBMIT DETAILS & TRIGGER AI STUDIO ---
    const handleTriggerGenerations = async () => {
        setStep('generating');
        setGeneratingAssets(true);
        setProgressStep(1);
        playChime('beep');

        try {
            await new Promise(r => setTimeout(r, 1200));
            setProgressStep(2);

            await new Promise(r => setTimeout(r, 1200));
            setProgressStep(3);

            const res = await fetch('/api/onboarding/complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    companyName,
                    country,
                    companyDescription,
                    logoUrl,
                    contactNumber,
                    address: businessAddress,
                    websiteUrl,
                    whatsappNumber: whatsappNumberInput,
                    productTitle: projects[0]?.title || productTitle,
                    productDescription: projects[0]?.description || productDescription,
                    productPrice: projects[0]?.price || productPrice,
                    productImageUrl: projects[0]?.imageUrl || productImageUrl,
                    selectedTemplates,
                    projects
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to trigger AI studio generations");

            await new Promise(r => setTimeout(r, 1200));
            setProgressStep(4);
            setGenerationFinished(true);
            playChime('success');
            confetti({
                particleCount: 80,
                spread: 70,
                origin: { y: 0.6 }
            });
            toast.success("AI studio workspace initialized & creatives cooking! 🚀");
        } catch (err: any) {
            console.error("Onboarding submission failed:", err);
            toast.error(err.message || "AI Studio generation failed to start.");
            setStep('product');
        } finally {
            setGeneratingAssets(false);
        }
    };

    // --- SKIP TO PAYMENT / COMPLETE ---
    const handleSkipToPayment = async () => {
        try {
            await fetch('/api/onboarding/complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    companyName: companyName || 'My Business',
                    country,
                    companyDescription,
                    logoUrl,
                    contactNumber,
                    address: businessAddress,
                    websiteUrl,
                    whatsappNumber: whatsappNumberInput,
                    selectedTemplates
                })
            });
        } catch {}
        playChime('beep');
        setStep('payment');
    };

    // --- PAYMENT OR DASHBOARD FINISH ---
    const handlePurchasePlan = (planId: string) => {
        openCheckout({
            planId,
            paymentType,
            onSuccess: () => {
                confetti({
                    particleCount: 120,
                    spread: 90,
                    origin: { y: 0.5 }
                });
                toast.success("🎉 Payment complete! Your Nobogent Pro Workspace is ready.");
                router.push('/dashboard/assets');
            }
        });
    };

    const handleSkipPaymentAndEnterDashboard = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                const { data: existingProfile } = await supabase
                    .from('profiles')
                    .select('client_features, subscription_status')
                    .eq('id', user.id)
                    .single();

                const existingFeatures = existingProfile?.client_features || {};

                await supabase
                    .from('profiles')
                    .update({
                        onboarding_completed: true,
                        subscription_status: existingProfile?.subscription_status || 'free',
                        client_features: {
                            ...existingFeatures,
                            paywall_skipped: true
                        }
                    })
                    .eq('id', user.id);
            }
        } catch (err) {
            console.error("Error setting skip paywall:", err);
        }
        toast.info("Welcome to Nobogent! You can explore the workspace and upgrade anytime in Billing.");
        router.push('/dashboard/assets');
    };

    // Filter templates for the visual selection gallery
    const filteredTemplates = ALL_REFERENCE_TEMPLATES.filter((tmpl) => {
        const matchesCategory = 
            templateCategoryFilter === 'all' || 
            tmpl.libraryCategory === templateCategoryFilter ||
            (templateCategoryFilter === 'waterfront' && tmpl.category.toLowerCase().includes('water')) ||
            (templateCategoryFilter === 'direct_response' && tmpl.category.toLowerCase().includes('direct')) ||
            (templateCategoryFilter === 'dark_mode' && tmpl.category.toLowerCase().includes('dark'));
            
        const matchesSearch = 
            !templateSearchQuery.trim() || 
            tmpl.name.toLowerCase().includes(templateSearchQuery.toLowerCase()) || 
            tmpl.category.toLowerCase().includes(templateSearchQuery.toLowerCase()) || 
            tmpl.badge.toLowerCase().includes(templateSearchQuery.toLowerCase());
            
        return matchesCategory && matchesSearch;
    });

    // Step navigation helpers
    const currentStepNumber = {
        'profile': 1,
        'integrations': 2,
        'product': 3,
        'templates': 4,
        'generating': 5,
        'payment': 6
    }[step];

    const STEPS_NAV = [
        { key: 'profile', label: 'Brand Profile', icon: Building2 },
        { key: 'integrations', label: 'Channels', icon: Megaphone },
        { key: 'product', label: 'Product & Offer', icon: Package },
        { key: 'templates', label: 'Design Styles', icon: Layers },
        { key: 'generating', label: 'AI Studio', icon: Sparkles },
        { key: 'payment', label: 'Activate Plan', icon: Award }
    ] as const;

    return (
        <div className="min-h-screen bg-[#F8FAFC] text-slate-800 flex flex-col justify-between font-sans relative overflow-x-hidden selection:bg-blue-600 selection:text-white">
            
            {/* Ambient background glows */}
            <div className="fixed top-[-10%] left-[-10%] w-[45%] h-[45%] rounded-full bg-blue-100/50 blur-[130px] pointer-events-none" />
            <div className="fixed bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-indigo-100/40 blur-[130px] pointer-events-none" />
            <div className="fixed inset-0 bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:24px_24px] pointer-events-none opacity-50" />

            {/* TOP HEADER */}
            <header className="w-full max-w-6xl mx-auto px-6 py-4 flex items-center justify-between z-30 border-b border-slate-200/80 bg-white/80 backdrop-blur-xl sticky top-0 shadow-xs">
                <div className="flex items-center gap-3">
                    <img src="/logo.png" alt="Nobogent" className="h-7 w-auto object-contain" />
                    <span className="text-base font-extrabold tracking-tight text-slate-900">Nobogent</span>
                    <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />
                        Workspace Setup
                    </span>
                </div>

                <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-slate-400 hidden sm:inline">
                        Step {currentStepNumber} of 6
                    </span>
                    <button
                        type="button"
                        onClick={handleSkipPaymentAndEnterDashboard}
                        className="px-4 py-2 rounded-xl text-xs font-bold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 shadow-xs transition-all cursor-pointer"
                    >
                        Go to Dashboard &rarr;
                    </button>
                </div>
            </header>

            {/* PROGRESS STEPPER (Demo-style interactive floating pill bar) */}
            <div className="w-full max-w-3xl mx-auto px-4 pt-6 pb-2 z-20">
                <div className="relative flex items-center justify-between p-2 rounded-2xl bg-white/90 border border-slate-200/80 backdrop-blur-xl shadow-xs">
                    <div className="absolute top-1/2 left-8 right-8 -translate-y-1/2 h-[2px] bg-slate-100 z-0" />
                    {STEPS_NAV.map((m) => {
                        const stepOrder: OnboardingStep[] = ['profile', 'integrations', 'product', 'templates', 'generating', 'payment'];
                        const currentIdx = stepOrder.indexOf(step);
                        const milestoneIdx = stepOrder.indexOf(m.key);
                        const isDone = currentIdx > milestoneIdx;
                        const isCurrent = currentIdx === milestoneIdx;

                        return (
                            <button
                                key={m.key}
                                type="button"
                                onClick={() => {
                                    if (milestoneIdx < currentIdx || isDone) {
                                        setStep(m.key);
                                        playChime('beep');
                                    }
                                }}
                                disabled={milestoneIdx > currentIdx}
                                className={`relative z-10 flex flex-col items-center gap-1 px-2 sm:px-3 transition-all ${
                                    milestoneIdx <= currentIdx ? 'cursor-pointer hover:scale-105 active:scale-95' : 'cursor-not-allowed opacity-50'
                                }`}
                                title={m.label}
                            >
                                <div className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-300 ${
                                    isDone 
                                        ? 'bg-emerald-600 text-white font-bold shadow-xs ring-2 ring-emerald-200' 
                                        : isCurrent 
                                            ? 'bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold shadow-md shadow-blue-500/20 ring-4 ring-blue-100 scale-105' 
                                            : 'bg-slate-50 border border-slate-200 text-slate-400'
                                }`}>
                                    {isDone ? <Check size={14} strokeWidth={3} /> : <m.icon size={14} />}
                                </div>
                                <span className={`text-[11px] font-bold transition-colors ${
                                    isCurrent ? 'text-blue-700' : isDone ? 'text-emerald-700' : 'text-slate-400'
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
                        STEP 1: BRAND PROFILE INFO & WEBSITE BOOSTER
                    ========================================================================= */}
                    {step === 'profile' && (
                        <motion.div
                            key="step-profile"
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -15 }}
                            transition={{ duration: 0.2 }}
                            className="bg-white/95 border border-slate-200/90 rounded-3xl p-6 sm:p-8 backdrop-blur-xl shadow-xl shadow-slate-200/50"
                        >
                            {/* Header Row */}
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-100">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-[10px] font-extrabold text-blue-700 uppercase tracking-wider bg-blue-100 px-2 py-0.5 rounded-md border border-blue-200">
                                            Step 1 &bull; Identity
                                        </span>
                                        <span className="text-xs text-slate-500 font-semibold hidden sm:inline">
                                            &bull; Brand Persona &amp; Contact Info
                                        </span>
                                    </div>
                                    <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                                        Tell Us About Your Business
                                    </h1>
                                    <p className="text-sm text-slate-500 mt-1 max-w-xl">
                                        Nobogent's AI uses this info to personalize your ad graphics, voiceover commercials, and 24/7 lead responses.
                                    </p>
                                </div>

                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-semibold text-slate-400">Need speed?</span>
                                    <span className="px-3 py-1.5 rounded-xl text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 shadow-2xs">
                                        ⚡ Auto-Fill from Website
                                    </span>
                                </div>
                            </div>

                            {/* Website Auto-Extractor Strip */}
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
                                        className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 shadow-2xs"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleFetchWebsite}
                                        disabled={fetchingWebsite || !websiteUrl}
                                        className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shrink-0 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 active:scale-95 shadow-sm"
                                    >
                                        {fetchingWebsite ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
                                        <span>Auto-Fill with AI</span>
                                    </button>
                                </div>
                            </div>

                            {/* Form Grid */}
                            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6">
                                {/* Left Column: Company & Contact Details (7 cols) */}
                                <div className="lg:col-span-7 space-y-3.5">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 mb-1">
                                            Business / Brand Name <span className="text-rose-500">*</span>
                                        </label>
                                        <input
                                            type="text"
                                            value={companyName}
                                            onChange={(e) => setCompanyName(e.target.value)}
                                            placeholder="e.g. Apex Luxury Real Estate"
                                            className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 text-sm text-slate-900 font-bold focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 shadow-2xs transition-all"
                                        />
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                                        <div className="sm:col-span-4">
                                            <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                                                <Globe size={12} className="text-blue-600" />
                                                <span>Country</span>
                                                <span className="text-[10px] text-amber-600 font-semibold">(Festivals)</span>
                                            </label>
                                            <select
                                                value={country}
                                                onChange={(e) => setCountry(e.target.value)}
                                                className="w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-xs text-slate-900 font-bold focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 shadow-2xs transition-all cursor-pointer"
                                            >
                                                <option value="India">🇮🇳 India</option>
                                                <option value="United States">🇺🇸 United States</option>
                                                <option value="United Arab Emirates">🇦🇪 UAE (Dubai)</option>
                                                <option value="United Kingdom">🇬🇧 United Kingdom</option>
                                                <option value="Canada">🇨🇦 Canada</option>
                                                <option value="Australia">🇦🇺 Australia</option>
                                                <option value="Singapore">🇸🇬 Singapore</option>
                                                <option value="Global">🌐 Other / Global</option>
                                            </select>
                                        </div>

                                        <div className="sm:col-span-4">
                                            <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                                                <Phone size={12} className="text-blue-600" />
                                                <span>Contact Number</span>
                                            </label>
                                            <div className="flex items-center rounded-xl bg-white border border-slate-200 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/10 shadow-2xs overflow-hidden transition-all">
                                                <div className="px-2 py-2 bg-slate-50 border-r border-slate-200 text-slate-700 font-bold text-xs select-none shrink-0 flex items-center gap-1">
                                                    <span>{country === 'United States' ? '🇺🇸 +1' : country === 'United Arab Emirates' ? '🇦🇪 +971' : country === 'United Kingdom' ? '🇬🇧 +44' : '🇮🇳 +91'}</span>
                                                </div>
                                                <input
                                                    type="tel"
                                                    value={contactNumber}
                                                    onChange={(e) => {
                                                        const clean = e.target.value.replace(/\D/g, '').slice(0, 12);
                                                        setContactNumber(clean);
                                                    }}
                                                    placeholder="9876543210"
                                                    className="w-full px-2.5 py-2 bg-transparent text-xs text-slate-900 font-mono font-bold focus:outline-none placeholder:text-slate-400 placeholder:font-mono"
                                                />
                                            </div>
                                        </div>

                                        <div className="sm:col-span-4">
                                            <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                                                <MapPin size={12} className="text-blue-600" />
                                                <span>Address / City</span>
                                            </label>
                                            <input
                                                type="text"
                                                value={businessAddress}
                                                onChange={(e) => setBusinessAddress(e.target.value)}
                                                placeholder="e.g. Gurugram, Delhi NCR"
                                                className="w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 shadow-2xs transition-all font-medium"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 mb-1">
                                            Business Bio &amp; Value Proposition
                                        </label>
                                        <textarea
                                            rows={3}
                                            value={companyDescription}
                                            onChange={(e) => setCompanyDescription(e.target.value)}
                                            placeholder="We specialize in luxury gated communities, high-yield commercial investments, and bespoke architectural living..."
                                            className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 text-xs text-slate-800 leading-relaxed focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 shadow-2xs transition-all resize-none"
                                        />
                                    </div>
                                </div>

                                {/* Right Column: Brand Logo Dropzone (5 cols) */}
                                <div className="lg:col-span-5 space-y-3.5">
                                    <div className="flex flex-col">
                                        <div className="flex items-center justify-between mb-1.5">
                                            <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                                                <Building2 size={14} className="text-blue-600" />
                                                <span>Brand Logo</span>
                                            </label>
                                            {logoUrl ? (
                                                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100/90 px-2 py-0.5 rounded-full border border-emerald-300 flex items-center gap-1">
                                                    <Check size={10} strokeWidth={3} /> Active
                                                </span>
                                            ) : (
                                                <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200">
                                                    PNG / SVG
                                                </span>
                                            )}
                                        </div>

                                        <div className="relative rounded-2xl border border-slate-200 bg-slate-50/70 overflow-hidden group h-[190px] flex items-center justify-center transition-all hover:border-blue-400 hover:shadow-sm">
                                            {uploadingLogo ? (
                                                <div className="flex flex-col items-center justify-center p-6 text-center space-y-2">
                                                    <Loader2 size={24} className="animate-spin text-blue-600" />
                                                    <span className="text-xs font-bold text-slate-700">Uploading logo to CDN...</span>
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
                                                    <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mb-2">
                                                        <Building2 size={18} />
                                                    </div>
                                                    <span className="text-xs font-bold text-slate-700">Upload Brand Logo</span>
                                                    <span className="text-[10px] text-slate-400 mt-0.5">Transparent PNG / SVG / JPG</span>
                                                    <span className="text-[9px] text-blue-600 font-semibold mt-1">Included in ad graphics &amp; video watermark</span>
                                                </div>
                                            )}
                                        </div>
                                        <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                                    </div>

                                    {/* Perks strip */}
                                    <div className="p-3 rounded-2xl bg-blue-50/70 border border-blue-200/80 space-y-1.5 text-xs text-blue-950 font-medium">
                                        <div className="flex items-center gap-2 text-slate-700 font-bold text-[11px]">
                                            <Sparkles size={13} className="text-blue-600" />
                                            <span>Autonomous Branding Sync</span>
                                        </div>
                                        <p className="text-[11px] text-slate-600 leading-relaxed">
                                            Your logo and business name are stamped onto all generated Meta ad banners and landing page headers.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Action Footer */}
                            <div className="mt-8 pt-6 border-t border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                <div className="flex items-center gap-2 text-xs text-slate-500 italic max-w-md">
                                    <Sparkles size={14} className="text-amber-500 shrink-0" />
                                    <span>"{INSPIRATIONAL_QUOTES[quoteIndex]?.quote || ""}"</span>
                                </div>

                                <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            playChime('beep');
                                            setStep('integrations');
                                        }}
                                        className="text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors py-2 px-3 rounded-lg cursor-pointer"
                                    >
                                        Skip this step &rarr;
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => {
                                            playChime('beep');
                                            setStep('integrations');
                                        }}
                                        className="w-full sm:w-auto px-7 py-3 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-700 hover:to-indigo-800 text-white font-extrabold text-xs uppercase tracking-wider transition-all shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/35 active:scale-98 flex items-center justify-center gap-2 cursor-pointer"
                                    >
                                        <span>Next: Channels</span>
                                        <ArrowRight size={15} />
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {/* =========================================================================
                        STEP 2: ACCOUNT CONNECTIONS (META & WHATSAPP)
                    ========================================================================= */}
                    {step === 'integrations' && (
                        <motion.div
                            key="step-integrations"
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -15 }}
                            transition={{ duration: 0.2 }}
                            className="bg-white/95 border border-slate-200/90 rounded-3xl p-6 sm:p-8 backdrop-blur-xl shadow-xl shadow-slate-200/50 space-y-6"
                        >
                            {/* Header */}
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-100">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-[10px] font-extrabold text-blue-700 uppercase tracking-wider bg-blue-100 px-2 py-0.5 rounded-md border border-blue-200">
                                            Step 2 &bull; Distribution
                                        </span>
                                        <span className="text-xs text-slate-500 font-semibold hidden sm:inline">
                                            &bull; 1-Click Omnichannel Integrations
                                        </span>
                                    </div>
                                    <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                                        Connect Your Marketing Channels
                                    </h1>
                                    <p className="text-sm text-slate-500 mt-1 max-w-xl">
                                        Link Meta for instant 1-click ad deployment and WhatsApp for 24/7 autonomous client qualification.
                                    </p>
                                </div>

                                <div className="flex items-center gap-2">
                                    <span className="px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs flex items-center gap-1.5">
                                        <ShieldCheck size={14} /> Official Meta Graph API
                                    </span>
                                </div>
                            </div>

                            {/* Two-Column Cards Grid */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Meta (Facebook & Instagram) Card */}
                                <div className="bg-white border border-slate-200/90 rounded-3xl p-6 shadow-sm hover:border-blue-400 hover:shadow-md transition-all flex flex-col justify-between">
                                    <div>
                                        <div className="flex items-center justify-between mb-4">
                                            <div className="w-12 h-12 rounded-2xl bg-blue-50 text-[#1877F2] flex items-center justify-center border border-blue-100 shadow-2xs">
                                                <Facebook size={26} />
                                            </div>
                                            {isMetaConnected ? (
                                                <span className="inline-flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1 rounded-full">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Connected
                                                </span>
                                            ) : (
                                                <span className="text-[11px] font-bold text-slate-400 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200">
                                                    Not Connected
                                                </span>
                                            )}
                                        </div>

                                        <h3 className="text-lg font-extrabold text-slate-900 mb-1">
                                            Meta Ads &amp; Pages
                                        </h3>
                                        <p className="text-xs text-slate-600 font-medium mb-4 leading-relaxed">
                                            Enables instant ad launch, AI creative sync to your Instagram feed, and automatic Facebook Lead Form data capture.
                                        </p>

                                        <div className="space-y-2 mb-6">
                                            <div className="flex items-center gap-2 text-xs text-slate-700 font-semibold">
                                                <Check size={14} className="text-emerald-500 shrink-0" />
                                                <span>1-Click ad launch from AI templates</span>
                                            </div>
                                            <div className="flex items-center gap-2 text-xs text-slate-700 font-semibold">
                                                <Check size={14} className="text-emerald-500 shrink-0" />
                                                <span>Real-time Meta Lead Form sync to CRM</span>
                                            </div>
                                            <div className="flex items-center gap-2 text-xs text-slate-700 font-semibold">
                                                <Check size={14} className="text-emerald-500 shrink-0" />
                                                <span>Instagram feed &amp; reels automated scheduling</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        {isMetaConnected ? (
                                            <div className="bg-emerald-50/80 border border-emerald-200 rounded-2xl p-3.5 flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <CheckCircle2 size={16} className="text-emerald-600" />
                                                    <span className="text-xs font-bold text-emerald-900">Meta Account Active</span>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={handleConnectMeta}
                                                    className="text-[11px] font-bold text-slate-500 hover:text-slate-800 underline cursor-pointer"
                                                >
                                                    Reconnect
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={handleConnectMeta}
                                                disabled={isConnectingMeta}
                                                className="w-full bg-[#1877F2] hover:bg-[#166fe5] text-white font-extrabold text-xs uppercase tracking-wider py-3.5 px-4 rounded-xl transition-all shadow-sm hover:shadow-md flex items-center justify-center gap-2 cursor-pointer active:scale-98 disabled:opacity-50"
                                            >
                                                {isConnectingMeta ? (
                                                    <>
                                                        <Loader2 size={15} className="animate-spin" /> Authorizing...
                                                    </>
                                                ) : (
                                                    <>
                                                        <Facebook size={16} /> Connect Meta Account
                                                    </>
                                                )}
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* WhatsApp Business Card */}
                                <div className="bg-white border border-slate-200/90 rounded-3xl p-6 shadow-sm hover:border-emerald-400 hover:shadow-md transition-all flex flex-col justify-between">
                                    <div>
                                        <div className="flex items-center justify-between mb-4">
                                            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-[#25D366] flex items-center justify-center border border-emerald-100 shadow-2xs">
                                                <MessageCircle size={26} />
                                            </div>
                                            {isWhatsAppConnected ? (
                                                <span className="inline-flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1 rounded-full">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Active
                                                </span>
                                            ) : (
                                                <span className="text-[11px] font-bold text-slate-400 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200">
                                                    Quick Setup
                                                </span>
                                            )}
                                        </div>

                                        <h3 className="text-lg font-extrabold text-slate-900 mb-1">
                                            WhatsApp Business Automation
                                        </h3>
                                        <p className="text-xs text-slate-600 font-medium mb-4 leading-relaxed">
                                            Instantly reply to incoming ad leads, trigger automated nurturing drip flows, and answer inquiries 24/7 with AI.
                                        </p>

                                        <div className="space-y-2 mb-4">
                                            <div className="flex items-center gap-2 text-xs text-slate-700 font-semibold">
                                                <Check size={14} className="text-emerald-500 shrink-0" />
                                                <span>Instant 2-minute lead greeting</span>
                                            </div>
                                            <div className="flex items-center gap-2 text-xs text-slate-700 font-semibold">
                                                <Check size={14} className="text-emerald-500 shrink-0" />
                                                <span>Automated digital brochure &amp; catalog delivery</span>
                                            </div>
                                            <div className="flex items-center gap-2 text-xs text-slate-700 font-semibold">
                                                <Check size={14} className="text-emerald-500 shrink-0" />
                                                <span>24/7 AI conversational chatbot &amp; CRM sync</span>
                                            </div>
                                        </div>

                                        {/* Direct WhatsApp Alert Number Input */}
                                        <div className="mb-4 p-3 rounded-2xl bg-slate-50 border border-slate-200/80">
                                            <label className="text-[11px] font-bold text-slate-700 block mb-1.5">
                                                Direct Lead Alert Number:
                                            </label>
                                            <div className="flex gap-2">
                                                <input
                                                    type="tel"
                                                    value={whatsappNumberInput}
                                                    onChange={(e) => setWhatsappNumberInput(e.target.value)}
                                                    placeholder="+91 98765 43210"
                                                    className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-800 placeholder-slate-400 focus:outline-none focus:border-emerald-500 shadow-2xs"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={handleSaveWhatsappNumber}
                                                    disabled={isSavingWhatsappNum || !whatsappNumberInput}
                                                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold px-3.5 py-2 rounded-xl transition-all disabled:opacity-50 cursor-pointer shadow-2xs active:scale-95"
                                                >
                                                    {isSavingWhatsappNum ? "Saving..." : "Save"}
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <button
                                            type="button"
                                            onClick={handleConnectWhatsApp}
                                            disabled={isConnectingWhatsApp}
                                            className="w-full bg-[#25D366] hover:bg-[#20ba59] text-white font-extrabold text-xs uppercase tracking-wider py-3.5 px-4 rounded-xl transition-all shadow-sm hover:shadow-md flex items-center justify-center gap-2 cursor-pointer active:scale-98 disabled:opacity-50"
                                        >
                                            {isConnectingWhatsApp ? (
                                                <>
                                                    <Loader2 size={15} className="animate-spin" /> Launching Meta WABA...
                                                </>
                                            ) : (
                                                <>
                                                    <MessageCircle size={16} /> Connect Official WhatsApp Cloud API
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Bottom Navigation */}
                            <div className="mt-8 pt-6 border-t border-slate-200/80 flex flex-col sm:flex-row items-center justify-between gap-4">
                                <button
                                    type="button"
                                    onClick={() => {
                                        playChime('beep');
                                        setStep('profile');
                                    }}
                                    className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 shadow-xs transition-all cursor-pointer"
                                >
                                    &larr; Back to Profile
                                </button>

                                <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            playChime('beep');
                                            setStep('product');
                                        }}
                                        className="text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors py-2 px-3 cursor-pointer"
                                    >
                                        Skip account connection &rarr;
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => {
                                            playChime('beep');
                                            setStep('product');
                                        }}
                                        className="w-full sm:w-auto px-7 py-3 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-700 hover:to-indigo-800 text-white font-extrabold text-xs uppercase tracking-wider transition-all shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/35 active:scale-98 flex items-center justify-center gap-2 cursor-pointer"
                                    >
                                        <span>Next: Add First Product</span>
                                        <ArrowRight size={15} />
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {/* =========================================================================
                        STEP 3: ONE PRODUCT / SERVICE INFO
                    ========================================================================= */}
                    {step === 'product' && (
                        <motion.div
                            key="step-product"
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -15 }}
                            transition={{ duration: 0.2 }}
                            className="bg-white/95 border border-slate-200/90 rounded-3xl p-6 sm:p-8 backdrop-blur-xl shadow-xl shadow-slate-200/50 space-y-6"
                        >
                            {/* Header */}
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-100">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-[10px] font-extrabold text-blue-700 uppercase tracking-wider bg-blue-100 px-2.5 py-0.5 rounded-full border border-blue-200">
                                            Step 3 &bull; Multi-Project Allocation
                                        </span>
                                        <span className="text-xs text-slate-500 font-semibold hidden sm:inline">
                                            &bull; 5-Minute Studio Pool
                                        </span>
                                    </div>
                                    <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
                                        <span>Allocate Creatives &amp; Video Reels</span>
                                        <Sparkles size={20} className="text-blue-600" />
                                    </h1>
                                    <p className="text-sm text-slate-500 mt-1 max-w-xl">
                                        Add your projects and allocate your deliverables. Static creatives will randomly adopt your selected styles, and video reels draw from your free 5-minute duration budget.
                                    </p>
                                </div>

                                <div className="flex items-center gap-2">
                                    <span className="px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-2xs">
                                        ✨ 5 Mins Free Video Duration
                                    </span>
                                </div>
                            </div>

                            {/* 5-MINUTE VIDEO POOL TRACKER */}
                            <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-950 to-indigo-950 text-white shadow-md relative overflow-hidden">
                                <div className="relative z-10 space-y-3">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                            <span className="w-7 h-7 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs">
                                                ⏱️
                                            </span>
                                            <div>
                                                <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-200">
                                                    5-Minute Video Studio Pool (300 Seconds Total)
                                                </h4>
                                                <p className="text-[11px] text-slate-400">
                                                    Distribute video durations across your project(s).
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-3 text-right">
                                            <div>
                                                <span className="text-[10px] text-slate-400 font-bold uppercase block">Remaining</span>
                                                <span className={"text-xs font-mono font-extrabold " + (remainingVideoSeconds > 0 ? "text-emerald-400" : "text-amber-400")}>
                                                    {Math.floor(remainingVideoSeconds / 60)}m {remainingVideoSeconds % 60}s ({remainingVideoSeconds}s)
                                                </span>
                                            </div>
                                            <div className="h-6 w-px bg-slate-800" />
                                            <div>
                                                <span className="text-[10px] text-slate-400 font-bold uppercase block">Allocated</span>
                                                <span className="text-xs font-mono font-extrabold text-blue-400">
                                                    {Math.floor(totalAllocatedVideoSeconds / 60)}m {totalAllocatedVideoSeconds % 60}s / 5m 00s
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Visual Bar */}
                                    <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                                        <div 
                                            className="h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-400 transition-all duration-300"
                                            style={{ width: videoProgressPercent + '%' }}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* PROJECT TABS */}
                            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
                                <div className="flex items-center gap-2 overflow-x-auto scrollbar-none pb-1 sm:pb-0">
                                    {projects.map((p, idx) => (
                                        <button
                                            key={p.id || idx}
                                            type="button"
                                            onClick={() => setActiveProjectIndex(idx)}
                                            className={"px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap " + (
                                                activeProjectIndex === idx
                                                    ? 'bg-slate-900 text-white shadow-sm'
                                                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                                            )}
                                        >
                                            <span>{p.title ? (p.title.length > 15 ? p.title.slice(0, 15) + '...' : p.title) : ('Project ' + (idx + 1))}</span>
                                            <span className={"text-[10px] px-1.5 py-0.2 rounded font-mono " + (activeProjectIndex === idx ? 'bg-white/20' : 'bg-slate-200')}>
                                                {p.creativesCount}C &bull; {p.videos.length}V
                                            </span>
                                        </button>
                                    ))}

                                    <button
                                        type="button"
                                        onClick={handleAddProject}
                                        className="px-3 py-1.5 rounded-xl text-xs font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200/80 transition-colors flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                    >
                                        <Plus size={13} />
                                        <span>Add Project</span>
                                    </button>
                                </div>

                                {projects.length > 1 && (
                                    <button
                                        type="button"
                                        onClick={() => handleRemoveProject(activeProjectIndex)}
                                        className="text-xs text-rose-600 hover:text-rose-700 font-bold flex items-center gap-1 cursor-pointer"
                                    >
                                        <Trash2 size={13} />
                                        <span className="hidden sm:inline">Remove Project</span>
                                    </button>
                                )}
                            </div>

                            {/* Form Grid for Active Project */}
                            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6">
                                {/* Left Column: Project Details & Allocation */}
                                <div className="lg:col-span-7 space-y-4">
                                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                                        <div className="sm:col-span-8">
                                            <label className="block text-xs font-bold text-slate-700 mb-1">
                                                Project / Offering Title <span className="text-rose-500">*</span>
                                            </label>
                                            <input
                                                type="text"
                                                value={projects[activeProjectIndex]?.title || ''}
                                                onChange={(e) => handleUpdateProjectField(activeProjectIndex, 'title', e.target.value)}
                                                placeholder="e.g. 3BHK Luxury Skyline Penthouse"
                                                className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 text-sm text-slate-900 font-bold focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 shadow-2xs transition-all"
                                            />
                                        </div>
                                        <div className="sm:col-span-4">
                                            <label className="block text-xs font-bold text-slate-700 mb-1">
                                                Price / Tagline (Optional)
                                            </label>
                                            <input
                                                type="text"
                                                value={projects[activeProjectIndex]?.price || ''}
                                                onChange={(e) => handleUpdateProjectField(activeProjectIndex, 'price', e.target.value)}
                                                placeholder="e.g. ₹1.85 Cr"
                                                className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 text-sm text-slate-900 font-bold focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 shadow-2xs transition-all"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 mb-1">
                                            Core Features &amp; Unique Benefits <span className="text-rose-500">*</span>
                                        </label>
                                        <textarea
                                            rows={3}
                                            value={projects[activeProjectIndex]?.description || ''}
                                            onChange={(e) => handleUpdateProjectField(activeProjectIndex, 'description', e.target.value)}
                                            placeholder="Describe key highlights (e.g. Private infinity plunge pool, double-height ceilings, 5 mins from metro corridor, zero brokerage, booking bonus...)"
                                            className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm text-slate-800 leading-relaxed focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 shadow-2xs transition-all resize-none"
                                        />
                                    </div>

                                    {/* Static Creatives Slider */}
                                    <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                                                <ImageIcon size={14} className="text-blue-600" />
                                                <span>Static Ad Creatives for this Project</span>
                                            </label>
                                            <span className="px-2 py-0.5 rounded-full text-xs font-extrabold bg-blue-100 text-blue-700 border border-blue-200 font-mono">
                                                {projects[activeProjectIndex]?.creativesCount || 3} Creatives
                                            </span>
                                        </div>
                                        <input
                                            type="range"
                                            min={1}
                                            max={10}
                                            value={projects[activeProjectIndex]?.creativesCount || 3}
                                            onChange={(e) => handleUpdateProjectField(activeProjectIndex, 'creativesCount', Number(e.target.value))}
                                            className="w-full accent-blue-600 cursor-pointer"
                                        />
                                        <p className="text-[11px] text-slate-500 flex items-center gap-1">
                                            <span>🎨 Each creative will randomly adopt a style from your selected design templates.</span>
                                        </p>
                                    </div>

                                    {/* Video Allocation */}
                                    <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2.5">
                                        <div className="flex items-center justify-between">
                                            <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                                                <Megaphone size={14} className="text-indigo-600" />
                                                <span>Video Reels for this Project</span>
                                            </label>
                                            <button
                                                type="button"
                                                onClick={() => handleAddVideoToProject(activeProjectIndex)}
                                                disabled={remainingVideoSeconds < 15}
                                                className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[11px] transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                                            >
                                                <Plus size={12} />
                                                <span>Add Video ({remainingVideoSeconds}s available)</span>
                                            </button>
                                        </div>

                                        {(projects[activeProjectIndex]?.videos || []).length === 0 ? (
                                            <div className="p-3 rounded-xl border border-dashed border-slate-300 text-center text-xs text-slate-400">
                                                No video assigned to this project. Tap "+ Add Video" above.
                                            </div>
                                        ) : (
                                            <div className="space-y-2">
                                                {(projects[activeProjectIndex]?.videos || []).map((vid, vIdx) => (
                                                    <div key={vid.id || vIdx} className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-2">
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-xs font-bold text-slate-800">
                                                                Reel #{vIdx + 1}
                                                            </span>

                                                            <div className="flex items-center gap-2">
                                                                <select
                                                                    value={vid.duration}
                                                                    onChange={(e) => handleUpdateVideoDuration(activeProjectIndex, vIdx, Number(e.target.value))}
                                                                    className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-800 text-xs font-bold border border-slate-200 focus:outline-none"
                                                                >
                                                                    <option value={15}>15s Reel</option>
                                                                    <option value={30}>30s Reel</option>
                                                                    <option value={45}>45s Reel</option>
                                                                    <option value={60}>60s Reel</option>
                                                                    <option value={90}>90s Commercial</option>
                                                                </select>

                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleRemoveVideoFromProject(activeProjectIndex, vIdx)}
                                                                    className="p-1 rounded text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                                                                >
                                                                    <Trash2 size={13} />
                                                                </button>
                                                            </div>
                                                        </div>

                                                        <input
                                                            type="text"
                                                            value={vid.customInstructions}
                                                            onChange={(e) => handleUpdateVideoInstruction(activeProjectIndex, vIdx, e.target.value)}
                                                            placeholder="Optional: Specific note for this reel (e.g. Highlight clubhouse, Hinglish Devanagari script)"
                                                            className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700 placeholder-slate-400 focus:outline-none"
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    {/* Project Custom Instructions */}
                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 mb-1">
                                            Optional Project Custom Instructions
                                        </label>
                                        <textarea
                                            rows={2}
                                            value={projects[activeProjectIndex]?.customInstructions || ''}
                                            onChange={(e) => handleUpdateProjectField(activeProjectIndex, 'customInstructions', e.target.value)}
                                            placeholder="Any particular instructions (e.g. Always highlight 10:90 payment plan, emphasize night pool view, use warm golden hour lighting...)"
                                            className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 shadow-2xs resize-none"
                                        />
                                    </div>
                                </div>

                                {/* Right Column: Product Image Dropzone */}
                                <div className="lg:col-span-5 space-y-3.5">
                                    <div className="flex flex-col">
                                        <div className="flex items-center justify-between mb-1.5">
                                            <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                                                <ImageIcon size={14} className="text-blue-600" />
                                                <span>Product / Property Photo</span>
                                            </label>
                                            {projects[activeProjectIndex]?.imageUrl ? (
                                                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100/90 px-2 py-0.5 rounded-full border border-emerald-300 flex items-center gap-1">
                                                    <Check size={10} strokeWidth={3} /> Uploaded
                                                </span>
                                            ) : (
                                                <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200">
                                                    Hero Image
                                                </span>
                                            )}
                                        </div>

                                        <div className="relative rounded-2xl border border-slate-200 bg-slate-950 overflow-hidden group h-[190px] flex items-center justify-center transition-all hover:border-blue-400 hover:shadow-sm">
                                            {uploadingProductImage ? (
                                                <div className="flex flex-col items-center justify-center p-6 text-center space-y-2">
                                                    <Loader2 size={24} className="animate-spin text-blue-400" />
                                                    <span className="text-xs font-bold text-slate-200">Uploading photo to CDN...</span>
                                                </div>
                                            ) : projects[activeProjectIndex]?.imageUrl ? (
                                                <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
                                                    <img
                                                        src={projects[activeProjectIndex]?.imageUrl || ''}
                                                        alt=""
                                                        className="absolute inset-0 w-full h-full object-cover blur-md opacity-35 scale-110 pointer-events-none"
                                                    />
                                                    <img
                                                        src={projects[activeProjectIndex]?.imageUrl || ''}
                                                        alt="Product Preview"
                                                        className="relative z-10 max-h-full max-w-full object-contain p-2 rounded-xl transition-transform duration-300 group-hover:scale-102"
                                                    />

                                                    <div className="absolute inset-0 z-20 bg-slate-950/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 backdrop-blur-[2px]">
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setImageLightboxUrl(projects[activeProjectIndex]?.imageUrl || '');
                                                            }}
                                                            className="px-2.5 py-1.5 rounded-xl bg-white/95 hover:bg-white text-slate-800 text-xs font-bold shadow-md flex items-center gap-1 cursor-pointer transition-transform hover:scale-105"
                                                        >
                                                            <Maximize2 size={12} />
                                                            <span>Preview</span>
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                productInputRef.current?.click();
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
                                                                handleUpdateProjectField(activeProjectIndex, 'imageUrl', '');
                                                            }}
                                                            className="px-2 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold shadow-md flex items-center gap-1 cursor-pointer transition-transform hover:scale-105"
                                                        >
                                                            <Trash2 size={12} />
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div
                                                    onClick={() => productInputRef.current?.click()}
                                                    className="w-full h-full border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-2xl flex flex-col items-center justify-center cursor-pointer p-4 text-center transition-colors bg-white hover:bg-blue-50/20"
                                                >
                                                    <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mb-2">
                                                        <Package size={18} />
                                                    </div>
                                                    <span className="text-xs font-bold text-slate-700">Upload Project Image</span>
                                                    <span className="text-[10px] text-slate-400 mt-0.5">JPG, PNG, WebP</span>
                                                    <span className="text-[9px] text-blue-600 font-semibold mt-1">Used as base visual for AI ad graphic</span>
                                                </div>
                                            )}
                                        </div>
                                        <input 
                                            ref={productInputRef} 
                                            type="file" 
                                            accept="image/*" 
                                            onChange={async (e) => {
                                                const file = e.target.files?.[0];
                                                if (!file) return;
                                                setUploadingProductImage(true);
                                                try {
                                                    const publicUrl = await uploadToR2(file, 'properties');
                                                    handleUpdateProjectField(activeProjectIndex, 'imageUrl', publicUrl);
                                                    playChime('success');
                                                    toast.success("Project photo uploaded! 📸");
                                                } catch (err: any) {
                                                    toast.error("Upload failed: " + err.message);
                                                } finally {
                                                    setUploadingProductImage(false);
                                                    if (productInputRef.current) productInputRef.current.value = '';
                                                }
                                            }} 
                                            className="hidden" 
                                        />
                                    </div>

                                    {/* WhatsApp Revision Explainer */}
                                    <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200/80 space-y-1.5">
                                        <div className="flex items-center gap-2 text-emerald-800 font-bold text-xs">
                                            <MessageCircle size={15} className="text-emerald-600" />
                                            <span>WhatsApp Delivery &amp; Revisions</span>
                                        </div>
                                        <p className="text-[11px] text-emerald-950 leading-relaxed">
                                            Finished creatives &amp; WhatsApp template copy are sent directly to your WhatsApp. You can tap <strong>[Approve]</strong> to post, or reply with edits (e.g. <em>"Change price to ₹2.1 Cr"</em>) to get auto-revisions!
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Action Footer */}
                            <div className="mt-8 pt-6 border-t border-slate-200/80 flex flex-col sm:flex-row items-center justify-between gap-4">
                                <button
                                    type="button"
                                    onClick={() => {
                                        playChime('beep');
                                        setStep('integrations');
                                    }}
                                    className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 shadow-xs transition-all cursor-pointer"
                                >
                                    &larr; Back to Channels
                                </button>

                                <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            playChime('beep');
                                            setStep('templates');
                                        }}
                                        className="text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors py-2 px-3 cursor-pointer"
                                    >
                                        Skip project setup &rarr;
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => {
                                            const hasValidProject = projects.some(p => ((p?.title || '').trim()) && ((p?.description || '').trim()));
                                            if (!hasValidProject) {
                                                toast.error("Please enter a title and description for at least one project, or click 'Skip project setup'.");
                                                return;
                                            }
                                            if (totalAllocatedVideoSeconds > MAX_VIDEO_POOL_SECONDS) {
                                                toast.error("Total video duration exceeds 5 minutes (300s). Please reduce video duration.");
                                                return;
                                            }
                                            playChime('beep');
                                            setStep('templates');
                                        }}
                                        className="w-full sm:w-auto px-7 py-3 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-700 hover:to-indigo-800 text-white font-extrabold text-xs uppercase tracking-wider transition-all shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/35 active:scale-98 flex items-center justify-center gap-2 cursor-pointer"
                                    >
                                        <span>Next: Choose Design Styles</span>
                                        <ArrowRight size={15} />
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {/* =========================================================================
                        STEP 4: SELECT REFERENCE DESIGN BLUEPRINTS (UP TO 10 TEMPLATES)
                    ========================================================================= */}
                    {step === 'templates' && (
                        <motion.div
                            key="step-templates"
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -15 }}
                            transition={{ duration: 0.2 }}
                            className="bg-white/95 border border-slate-200/90 rounded-3xl p-6 sm:p-8 backdrop-blur-xl shadow-xl shadow-slate-200/50 space-y-6"
                        >
                            {/* Header */}
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-100">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-[10px] font-extrabold text-blue-700 uppercase tracking-wider bg-blue-100 px-2 py-0.5 rounded-md border border-blue-200">
                                            Step 4 &bull; Aesthetics
                                        </span>
                                        <span className="text-xs text-slate-500 font-semibold hidden sm:inline">
                                            &bull; Choose Up to 10 Visual Blueprints
                                        </span>
                                    </div>
                                    <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                                        Pick Your Favorite Design Styles
                                    </h1>
                                    <p className="text-sm text-slate-500 mt-1 max-w-2xl leading-relaxed">
                                        Select up to 10 reference design layouts from our luxury bank. Your daily automated creatives in 3:4 dimension, batch generation, and new ad designs will randomly rotate across these chosen styles.
                                    </p>
                                </div>

                                {/* Counter pill */}
                                <div className="flex items-center gap-2 shrink-0">
                                    <div className={`px-3.5 py-1.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 border shadow-2xs transition-all ${
                                        selectedTemplates.length > 0 
                                            ? 'bg-blue-50 text-blue-700 border-blue-200' 
                                            : 'bg-amber-50 text-amber-800 border-amber-200'
                                    }`}>
                                        <Layers size={14} className="text-blue-600" />
                                        <span>{selectedTemplates.length} of 10 Selected</span>
                                    </div>
                                </div>
                            </div>

                            {/* Filter Bar & Quick Select */}
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 rounded-2xl bg-slate-50/80 border border-slate-200/70">
                                {/* Category tabs */}
                                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
                                    {[
                                        { key: 'all', label: 'All Designs (35)' },
                                        { key: 'high_converting', label: '🔥 High Converting' },
                                        { key: 'premium', label: '✨ Ultra Luxury' },
                                        { key: 'waterfront', label: '🌊 Waterfront' },
                                        { key: 'direct_response', label: '⚡ Direct Response' },
                                        { key: 'dark_mode', label: '🌙 Dark Mode' }
                                    ].map((tab) => (
                                        <button
                                            key={tab.key}
                                            type="button"
                                            onClick={() => {
                                                setTemplateCategoryFilter(tab.key as any);
                                                playChime('beep');
                                            }}
                                            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer shrink-0 ${
                                                templateCategoryFilter === tab.key
                                                    ? 'bg-blue-600 text-white shadow-xs'
                                                    : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200 hover:bg-slate-100/60'
                                            }`}
                                        >
                                            {tab.label}
                                        </button>
                                    ))}
                                </div>

                                {/* Search & Bulk Helpers */}
                                <div className="flex items-center gap-2">
                                    <div className="relative flex-1 sm:w-48">
                                        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                        <input
                                            type="text"
                                            value={templateSearchQuery}
                                            onChange={(e) => setTemplateSearchQuery(e.target.value)}
                                            placeholder="Search style..."
                                            className="w-full pl-8 pr-7 py-1.5 text-xs bg-white border border-slate-200 rounded-xl text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 shadow-2xs"
                                        />
                                        {templateSearchQuery && (
                                            <button
                                                type="button"
                                                onClick={() => setTemplateSearchQuery('')}
                                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                                            >
                                                <X size={12} />
                                            </button>
                                        )}
                                    </div>

                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSelectedTemplates(['pinterest_pin_0', 'pinterest_pin_1', 'pinterest_pin_2', 'pinterest_pin_3', 'pinterest_pin_4']);
                                            playChime('beep');
                                            toast.success("Loaded top 5 high-converting blueprints!");
                                        }}
                                        className="px-2.5 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-600 hover:text-blue-700 hover:border-blue-300 transition-all shrink-0 cursor-pointer"
                                    >
                                        Top 5
                                    </button>

                                    {selectedTemplates.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSelectedTemplates([]);
                                                playChime('beep');
                                                toast.info("Cleared selection");
                                            }}
                                            className="px-2.5 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-rose-600 hover:bg-rose-50 hover:border-rose-300 transition-all shrink-0 cursor-pointer"
                                        >
                                            Clear
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Template Grid (35 items) */}
                            <div className="max-h-[520px] overflow-y-auto pr-1">
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
                                    {filteredTemplates.map((tmpl) => {
                                        const isSelected = selectedTemplates.includes(tmpl.id);
                                        return (
                                            <div
                                                key={tmpl.id}
                                                onClick={() => handleToggleTemplate(tmpl.id)}
                                                className={`group relative rounded-2xl overflow-hidden bg-slate-950 border transition-all duration-200 flex flex-col justify-between cursor-pointer select-none ${
                                                    isSelected
                                                        ? 'border-blue-600 ring-4 ring-blue-500/20 shadow-md scale-[1.01]'
                                                        : 'border-slate-200/90 hover:border-blue-400 hover:shadow-sm'
                                                }`}
                                            >
                                                {/* 3:4 Preview Container */}
                                                <div className="relative aspect-[3/4] w-full overflow-hidden bg-slate-950">
                                                    <img
                                                        src={tmpl.url}
                                                        alt={tmpl.name}
                                                        loading="lazy"
                                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                                    />

                                                    {/* Top-left Category Badge */}
                                                    <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded-md bg-slate-950/85 backdrop-blur-xs text-[8px] font-extrabold text-amber-300 uppercase tracking-wider shadow-xs line-clamp-1 max-w-[70%]">
                                                        {tmpl.badge}
                                                    </span>

                                                    {/* Top-right Selection Checkbox */}
                                                    <div className={`absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                                                        isSelected 
                                                            ? 'bg-blue-600 text-white shadow-md ring-2 ring-white scale-110' 
                                                            : 'bg-slate-950/60 border border-white/60 text-transparent group-hover:border-white'
                                                    }`}>
                                                        <Check size={12} strokeWidth={3} className={isSelected ? 'opacity-100' : 'opacity-0'} />
                                                    </div>

                                                    {/* Lightbox Zoom Overlay on hover */}
                                                    <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setImageLightboxUrl(tmpl.url);
                                                            }}
                                                            className="p-2 rounded-full bg-white/95 text-slate-800 shadow-md hover:scale-110 transition-transform cursor-pointer"
                                                            title="View high resolution preview"
                                                        >
                                                            <Maximize2 size={13} />
                                                        </button>
                                                    </div>

                                                    {/* Bottom Title Overlay */}
                                                    <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-slate-950 via-slate-950/80 to-transparent">
                                                        <p className="text-[11px] font-bold text-white truncate leading-tight drop-shadow">
                                                            {tmpl.name}
                                                        </p>
                                                        <p className="text-[9px] text-slate-300 truncate">
                                                            {tmpl.category}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Footer Navigation */}
                            <div className="mt-8 pt-6 border-t border-slate-200/80 flex flex-col sm:flex-row items-center justify-between gap-4">
                                <button
                                    type="button"
                                    onClick={() => {
                                        playChime('beep');
                                        setStep('product');
                                    }}
                                    className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 shadow-xs transition-all cursor-pointer"
                                >
                                    &larr; Back to Product
                                </button>

                                <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                                    {productTitle.trim() && productDescription.trim() ? (
                                        <button
                                            type="button"
                                            onClick={handleTriggerGenerations}
                                            disabled={selectedTemplates.length === 0}
                                            className="w-full sm:w-auto px-7 py-3 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-700 hover:to-indigo-800 disabled:opacity-40 disabled:pointer-events-none text-white font-extrabold text-xs uppercase tracking-wider transition-all shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/35 active:scale-98 flex items-center justify-center gap-2 cursor-pointer"
                                        >
                                            <span>Launch AI Studio ({selectedTemplates.length} Styles)</span>
                                            <Sparkles size={15} />
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={handleSkipToPayment}
                                            className="w-full sm:w-auto px-7 py-3 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-700 hover:to-indigo-800 text-white font-extrabold text-xs uppercase tracking-wider transition-all shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/35 active:scale-98 flex items-center justify-center gap-2 cursor-pointer"
                                        >
                                            <span>Save &amp; Continue to Plans</span>
                                            <ArrowRight size={15} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {/* =========================================================================
                        STEP 5: AI STUDIO SETUP & DELIGHT ANIMATIONS
                    ========================================================================= */}
                    {step === 'generating' && (
                        <motion.div
                            key="step-generating"
                            initial={{ opacity: 0, scale: 0.98 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.98 }}
                            transition={{ duration: 0.2 }}
                            className="w-full grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch"
                        >
                            {/* Left: Interactive Video Walkthrough */}
                            <div className="lg:col-span-7 bg-white/95 border border-slate-200/90 rounded-3xl p-6 sm:p-7 shadow-xl shadow-slate-200/50 backdrop-blur-xl flex flex-col justify-between space-y-4">
                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-[10px] font-extrabold uppercase tracking-wider bg-blue-100 text-blue-700 px-2 py-0.5 rounded-md border border-blue-200">
                                            Live Walkthrough
                                        </span>
                                        <span className="text-xs text-slate-400 font-semibold">
                                            While creatives cook
                                        </span>
                                    </div>
                                    <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 mt-1">
                                        Watch How Nobogent Automates Sales
                                    </h2>
                                    <p className="text-xs text-slate-500 mt-0.5">
                                        See how AI creates ad creatives, qualifies leads on WhatsApp, and schedules appointments.
                                    </p>
                                </div>

                                <div className="relative aspect-video w-full rounded-2xl border border-slate-200 bg-slate-950 overflow-hidden shadow-md group">
                                    <video 
                                        ref={videoRef}
                                        src="https://assets.mixkit.co/videos/preview/mixkit-man-working-on-a-laptop-at-his-desk-40346-large.mp4"
                                        autoPlay
                                        loop
                                        muted={isVideoMuted}
                                        playsInline
                                        className="w-full h-full object-cover"
                                    />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent flex items-end justify-between p-4 sm:p-5">
                                        <div className="text-white text-xs font-semibold drop-shadow">
                                            Generating: 3 Meta Ad Creatives + 1 AI Video Commercial
                                        </div>
                                        <button 
                                            type="button"
                                            onClick={() => {
                                                if (videoRef.current) {
                                                    videoRef.current.muted = !videoRef.current.muted;
                                                    setIsVideoMuted(videoRef.current.muted);
                                                }
                                            }}
                                            className="w-8 h-8 rounded-full bg-white/30 hover:bg-white/50 backdrop-blur-md flex items-center justify-center text-white transition-all active:scale-95 cursor-pointer shadow-xs"
                                        >
                                            {isVideoMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                                        </button>
                                    </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                                    <span className="font-bold text-slate-700">Autonomous Stack:</span>
                                    <span className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 font-semibold border border-slate-200">✓ Meta Graph API</span>
                                    <span className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 font-semibold border border-slate-200">✓ WhatsApp Cloud WABA</span>
                                    <span className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 font-semibold border border-slate-200">✓ AI Voice Engine</span>
                                </div>
                            </div>

                            {/* Right: Radar Loader & Checklist Card */}
                            <div className="lg:col-span-5 bg-white/95 border border-slate-200/90 rounded-3xl p-6 sm:p-7 shadow-xl shadow-slate-200/50 backdrop-blur-xl flex flex-col justify-between">
                                <div>
                                    <div className="flex items-center justify-between mb-5">
                                        <div className="flex items-center gap-2.5">
                                            <div className="relative w-9 h-9 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
                                                <Sparkles size={18} className="animate-pulse" />
                                            </div>
                                            <div>
                                                <h3 className="text-base font-extrabold text-slate-900 tracking-tight">
                                                    Building Workspace
                                                </h3>
                                                <span className="text-[10px] text-slate-500 font-semibold">
                                                    Automated Creative Synthesis
                                                </span>
                                            </div>
                                        </div>
                                        <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1">
                                            <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" /> Live AI
                                        </span>
                                    </div>

                                    {/* Progress Bar */}
                                    <div className="mb-6 w-full bg-slate-100 rounded-full h-2 p-0.5 border border-slate-200 overflow-hidden">
                                        <motion.div 
                                            className="h-full rounded-full bg-gradient-to-r from-blue-600 to-indigo-600"
                                            initial={{ width: "20%" }}
                                            animate={{ width: `${Math.min(100, progressStep * 25 + 20)}%` }}
                                            transition={{ duration: 0.5 }}
                                        />
                                    </div>

                                    {/* Checklist */}
                                    <div className="space-y-3.5">
                                        {/* Status 1 */}
                                        <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50/70 border border-slate-200/60">
                                            {progressStep > 1 ? (
                                                <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
                                            ) : progressStep === 1 ? (
                                                <Loader2 size={18} className="text-blue-600 animate-spin shrink-0" />
                                            ) : (
                                                <div className="w-[18px] h-[18px] rounded-full border-2 border-slate-200 shrink-0 bg-white" />
                                            )}
                                            <span className={`text-xs font-bold ${progressStep >= 1 ? 'text-slate-800' : 'text-slate-400'}`}>
                                                Saving brand profile &amp; contact info...
                                            </span>
                                        </div>

                                        {/* Status 2 */}
                                        <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50/70 border border-slate-200/60">
                                            {progressStep > 2 ? (
                                                <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
                                            ) : progressStep === 2 ? (
                                                <Loader2 size={18} className="text-blue-600 animate-spin shrink-0" />
                                            ) : (
                                                <div className="w-[18px] h-[18px] rounded-full border-2 border-slate-200 shrink-0 bg-white" />
                                            )}
                                            <span className={`text-xs font-bold ${progressStep >= 2 ? 'text-slate-800' : 'text-slate-400'}`}>
                                                Indexing product &amp; chosen designs...
                                            </span>
                                        </div>

                                        {/* Status 3 */}
                                        <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50/70 border border-slate-200/60">
                                            {progressStep > 3 ? (
                                                <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
                                            ) : progressStep === 3 ? (
                                                <Loader2 size={18} className="text-blue-600 animate-spin shrink-0" />
                                            ) : (
                                                <div className="w-[18px] h-[18px] rounded-full border-2 border-slate-200 shrink-0 bg-white" />
                                            )}
                                            <span className={`text-xs font-bold ${progressStep >= 3 ? 'text-slate-800' : 'text-slate-400'}`}>
                                                Generating 3 Meta Ads &amp; Video Commercial...
                                            </span>
                                        </div>
                                    </div>

                                    {/* Quote Callout */}
                                    <div className="mt-5 p-3 rounded-2xl bg-amber-50/80 border border-amber-200/70 text-[11px] text-amber-900 font-medium flex items-start gap-2">
                                        <Sparkles size={14} className="text-amber-600 shrink-0 mt-0.5" />
                                        <span>"{INSPIRATIONAL_QUOTES[quoteIndex]?.quote || ""}"</span>
                                    </div>
                                </div>

                                <div className="mt-6 pt-5 border-t border-slate-100">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            playChime('beep');
                                            setStep('payment');
                                        }}
                                        disabled={!generationFinished}
                                        className="w-full bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-700 hover:to-indigo-800 disabled:opacity-50 text-white font-extrabold text-xs uppercase tracking-wider py-3.5 rounded-2xl transition-all shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                                    >
                                        {generationFinished ? (
                                            <>
                                                <span>Continue to Plans &amp; Payment</span>
                                                <ArrowRight size={15} />
                                            </>
                                        ) : (
                                            <>
                                                <Loader2 size={16} className="animate-spin" />
                                                <span>Cooking your creatives...</span>
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {/* =========================================================================
                        STEP 6: CHOOSE YOUR PLAN & PAYMENT (OR SKIP)
                    ========================================================================= */}
                    {step === 'payment' && (
                        <motion.div
                            key="step-payment"
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -15 }}
                            transition={{ duration: 0.2 }}
                            className="bg-white/95 border border-slate-200/90 rounded-3xl p-6 sm:p-8 backdrop-blur-xl shadow-xl shadow-slate-200/50 space-y-6"
                        >
                            {/* Header */}
                            <div className="text-center max-w-2xl mx-auto">
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold bg-emerald-50 text-emerald-800 border border-emerald-200/80 mb-2">
                                    <Crown size={14} className="text-emerald-600" /> Final Step: Choose Your Plan
                                </span>
                                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
                                    Activate Your Growth Workspace
                                </h1>
                                <p className="text-xs sm:text-sm text-slate-500 mt-1.5 leading-relaxed">
                                    Select a plan to unlock all AI creative generations, WhatsApp chatbot flows, and Meta Ads management. You can also skip now and explore your generated creatives.
                                </p>
                            </div>

                            {/* Payment Frequency Switcher (One-Time vs Recurring) */}
                            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 bg-slate-50/90 rounded-3xl border border-slate-200">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                                        <RefreshCw size={18} />
                                    </div>
                                    <div>
                                        <div className="text-xs font-black text-slate-900 uppercase tracking-wide">
                                            Payment Option
                                        </div>
                                        <div className="text-[11px] text-slate-500 font-medium">
                                            {paymentType === 'one_time'
                                                ? "Pay once for your selected plan. No auto-debit or recurring surprises."
                                                : "Hassle-free recurring auto-debit. Cancel or change plan anytime."}
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-white p-1 rounded-2xl border border-slate-200 shadow-sm flex items-center shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => setPaymentType('one_time')}
                                        className={`px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
                                            paymentType === 'one_time'
                                                ? 'bg-slate-900 text-white shadow-sm'
                                                : 'text-slate-600 hover:text-slate-900'
                                        }`}
                                    >
                                        One-Time Payment
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setPaymentType('recurring')}
                                        className={`px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                                            paymentType === 'recurring'
                                                ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-sm'
                                                : 'text-slate-600 hover:text-slate-900'
                                        }`}
                                    >
                                        <span>Recurring Payment</span>
                                        <span className="text-[9px] bg-white/20 text-white px-2 py-0.5 rounded-full uppercase tracking-wider font-extrabold">Auto-Renew</span>
                                    </button>
                                </div>
                            </div>

                            {/* 7-Days Trial Package (₹999 + 18% GST - Purchased Only Once Per User) */}
                            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-900 via-indigo-950 to-slate-950 p-6 sm:p-7 text-white shadow-xl border-2 border-indigo-400/40">
                                <div className="absolute top-0 right-0 w-72 h-72 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
                                <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                                    <div className="space-y-2.5 max-w-xl">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="bg-amber-400 text-slate-950 text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-full shadow-sm">
                                                Special 7-Day Trial Package
                                            </span>
                                            <span className="bg-indigo-500/30 text-indigo-200 border border-indigo-400/30 text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-full">
                                                Only Once Per User
                                            </span>
                                            {hasPurchasedTrial && (
                                                <span className="bg-red-500/20 text-red-300 border border-red-500/30 text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-full">
                                                    Already Claimed
                                                </span>
                                            )}
                                        </div>
                                        <h3 className="text-xl sm:text-2xl font-black tracking-tight text-white">
                                            7 Days All-Access Growth Trial
                                        </h3>
                                        <p className="text-xs text-indigo-200 leading-relaxed font-medium">
                                            Experience the full power of Nobogent AI for 7 full days with 2,500 platform credits, AI videos, creatives, and chatbot.
                                        </p>
                                        <div className="flex flex-wrap gap-x-5 gap-y-1.5 pt-1 text-[11px] text-indigo-100 font-semibold">
                                            <span className="flex items-center gap-1.5"><Check size={14} className="text-amber-400" /> 7 Full Days Access</span>
                                            <span className="flex items-center gap-1.5"><Check size={14} className="text-amber-400" /> 2,500 Credits</span>
                                            <span className="flex items-center gap-1.5"><Check size={14} className="text-amber-400" /> 15 AI Creatives + 2 AI Videos</span>
                                            <span className="flex items-center gap-1.5"><Check size={14} className="text-amber-400" /> Full WhatsApp &amp; Meta Ads</span>
                                        </div>
                                    </div>

                                    <div className="shrink-0 bg-white/10 backdrop-blur-md rounded-2xl p-4 sm:p-5 border border-white/15 flex flex-col items-center justify-center min-w-[220px] text-center">
                                        <div className="text-[10px] font-bold text-indigo-200 uppercase tracking-wider">
                                            Trial Package
                                        </div>
                                        <div className="text-3xl font-black text-white mt-1">
                                            ₹999
                                        </div>
                                        <div className="text-[11px] font-semibold text-indigo-200 mt-0.5">
                                            + 18% GST (Total: ₹1,179)
                                        </div>
                                        <div className="text-[9px] text-amber-300 font-bold mt-1">
                                            7 days access • 1 per user
                                        </div>

                                        <button
                                            type="button"
                                            onClick={() => handlePurchasePlan('trial')}
                                            disabled={isPaymentProcessing || hasPurchasedTrial}
                                            className={`w-full mt-3.5 py-3 px-4 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg active:scale-95 ${
                                                hasPurchasedTrial
                                                    ? 'bg-white/20 text-white/50 cursor-not-allowed border border-white/10'
                                                    : 'bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 text-slate-950 hover:shadow-amber-500/20'
                                            }`}
                                        >
                                            <Crown size={14} />
                                            {hasPurchasedTrial ? 'Trial Already Used' : (isPaymentProcessing ? 'Connecting...' : 'Claim 7-Day Trial (₹1,179)')}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Plan Cards Grid */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
                                {/* 1 Month Plan */}
                                <div className="bg-white rounded-3xl border border-slate-200 p-6 flex flex-col justify-between shadow-xs hover:border-blue-400 hover:shadow-md transition-all">
                                    <div>
                                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                                            Monthly Starter
                                        </span>
                                        <h3 className="text-xl font-extrabold text-slate-900 mt-0.5">1 Month</h3>
                                        <div className="mt-3 mb-4">
                                            <span className="text-3xl font-extrabold text-slate-900">₹9,999</span>
                                            <span className="text-[11px] text-slate-400 font-semibold block mt-0.5">+ 18% GST</span>
                                            <span className="text-[10px] text-indigo-600 font-bold block mt-1">
                                                {paymentType === 'recurring' ? 'Auto-renews monthly • Cancel anytime' : '1-time payment • No auto-renewal'}
                                            </span>
                                        </div>
                                        <ul className="space-y-2 text-xs text-slate-600 font-medium mb-6">
                                            <li className="flex items-center gap-2"><Check size={14} className="text-emerald-600 shrink-0" /> 50 AI Ad Creatives</li>
                                            <li className="flex items-center gap-2"><Check size={14} className="text-emerald-600 shrink-0" /> 10 Cinematic AI Videos</li>
                                            <li className="flex items-center gap-2"><Check size={14} className="text-emerald-600 shrink-0" /> WhatsApp AI Chatbot &amp; API</li>
                                            <li className="flex items-center gap-2"><Check size={14} className="text-emerald-600 shrink-0" /> Meta Ads Automation</li>
                                            <li className="flex items-center gap-2"><Check size={14} className="text-emerald-600 shrink-0" /> CRM &amp; Lead Manager</li>
                                        </ul>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handlePurchasePlan('1-month')}
                                        disabled={isPaymentProcessing}
                                        className="w-full bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs uppercase tracking-wider py-3.5 rounded-xl transition-all cursor-pointer active:scale-95 shadow-sm"
                                    >
                                        {paymentType === 'recurring' ? 'Subscribe Recurring (₹9,999)' : 'Choose 1 Month (₹9,999)'}
                                    </button>
                                </div>

                                {/* 6 Months Plan (Featured / Most Popular) */}
                                <div className="bg-gradient-to-b from-slate-900 via-slate-900 to-indigo-950 text-white rounded-3xl border-2 border-indigo-400 p-6 flex flex-col justify-between shadow-2xl relative overflow-hidden transform md:-translate-y-2 ring-4 ring-indigo-500/10">
                                    <div className="absolute top-4 right-4 bg-gradient-to-r from-amber-400 to-amber-500 text-slate-950 text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full shadow-sm">
                                        Most Popular
                                    </div>
                                    <div>
                                        <span className="text-[10px] font-black uppercase tracking-wider text-amber-300">
                                            Save ₹5,001 (8% Off)
                                        </span>
                                        <h3 className="text-xl font-extrabold text-white mt-0.5">6 Months</h3>
                                        <div className="mt-3 mb-4">
                                            <span className="text-3xl font-extrabold text-white">₹54,999</span>
                                            <span className="text-[11px] text-indigo-200 font-semibold block mt-0.5">+ 18% GST</span>
                                            <span className="text-[10px] text-amber-300 font-bold block mt-1">
                                                {paymentType === 'recurring' ? 'Auto-renews every 6 months • Cancel anytime' : '1-time payment • No auto-renewal'}
                                            </span>
                                        </div>
                                        <ul className="space-y-2 text-xs text-indigo-100 font-medium mb-6">
                                            <li className="flex items-center gap-2"><Check size={14} className="text-amber-400 shrink-0" /> 300 AI Ad Creatives</li>
                                            <li className="flex items-center gap-2"><Check size={14} className="text-amber-400 shrink-0" /> 60 Cinematic AI Videos</li>
                                            <li className="flex items-center gap-2"><Check size={14} className="text-amber-400 shrink-0" /> Dedicated Account Manager</li>
                                            <li className="flex items-center gap-2"><Check size={14} className="text-amber-400 shrink-0" /> Full WhatsApp Automation Suite</li>
                                            <li className="flex items-center gap-2"><Check size={14} className="text-amber-400 shrink-0" /> Priority Meta Ad Approval</li>
                                        </ul>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handlePurchasePlan('6-months')}
                                        disabled={isPaymentProcessing}
                                        className="w-full bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 text-slate-950 font-black text-xs uppercase tracking-wider py-3.5 rounded-xl transition-all cursor-pointer active:scale-95 shadow-md"
                                    >
                                        {paymentType === 'recurring' ? 'Subscribe Recurring (₹54,999)' : 'Choose 6 Months (Save 8%)'}
                                    </button>
                                </div>

                                {/* 12 Months Plan */}
                                <div className="bg-white rounded-3xl border border-slate-200 p-6 flex flex-col justify-between shadow-xs hover:border-blue-400 hover:shadow-md transition-all">
                                    <div>
                                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-600">
                                            Save ₹20,001 (17% Off)
                                        </span>
                                        <h3 className="text-xl font-extrabold text-slate-900 mt-0.5">12 Months</h3>
                                        <div className="mt-3 mb-4">
                                            <span className="text-3xl font-extrabold text-slate-900">₹99,999</span>
                                            <span className="text-[11px] text-slate-400 font-semibold block mt-0.5">+ 18% GST</span>
                                            <span className="text-[10px] text-emerald-600 font-bold block mt-1">
                                                {paymentType === 'recurring' ? 'Auto-renews annually • Cancel anytime' : '1-time payment • No auto-renewal'}
                                            </span>
                                        </div>
                                        <ul className="space-y-2 text-xs text-slate-600 font-medium mb-6">
                                            <li className="flex items-center gap-2"><Check size={14} className="text-emerald-600 shrink-0" /> 600 AI Ad Creatives</li>
                                            <li className="flex items-center gap-2"><Check size={14} className="text-emerald-600 shrink-0" /> 120 Cinematic AI Videos</li>
                                            <li className="flex items-center gap-2"><Check size={14} className="text-emerald-600 shrink-0" /> Unlimited Team Members</li>
                                            <li className="flex items-center gap-2"><Check size={14} className="text-emerald-600 shrink-0" /> Custom Landing Pages &amp; Domain</li>
                                            <li className="flex items-center gap-2"><Check size={14} className="text-emerald-600 shrink-0" /> AI Voice Calling Minutes</li>
                                        </ul>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handlePurchasePlan('12-months')}
                                        disabled={isPaymentProcessing}
                                        className="w-full bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs uppercase tracking-wider py-3.5 rounded-xl transition-all cursor-pointer active:scale-95 shadow-sm"
                                    >
                                        {paymentType === 'recurring' ? 'Subscribe Recurring (₹99,999)' : 'Choose 12 Months (Best Value)'}
                                    </button>
                                </div>
                            </div>

                            {/* Skip Payment Option Banner */}
                            <div className="pt-6 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-50/70 p-4 rounded-2xl border border-slate-100">
                                <span className="text-xs text-slate-500 font-medium flex items-center gap-1.5">
                                    <ShieldCheck size={15} className="text-emerald-600" />
                                    Secure payments encrypted by Razorpay (UPI, Credit/Debit Cards, NetBanking).
                                </span>

                                <button
                                    type="button"
                                    onClick={handleSkipPaymentAndEnterDashboard}
                                    className="w-full sm:w-auto px-5 py-2.5 rounded-xl text-xs font-black text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-300 shadow-sm transition-all cursor-pointer flex items-center justify-center gap-1.5 active:scale-98"
                                >
                                    <span>Skip for now &amp; explore dashboard</span>
                                    <ArrowRight size={14} />
                                </button>
                            </div>
                        </motion.div>
                    )}

                </AnimatePresence>
            </main>

            {/* FOOTER */}
            <footer className="w-full max-w-6xl mx-auto px-6 py-4 border-t border-slate-200 text-center text-xs text-slate-500 z-20 flex flex-col sm:flex-row items-center justify-between gap-2">
                <span>&copy; 2026 Nobogent Technologies Inc. All rights reserved.</span>
                <span className="text-slate-400">
                    AI Marketing Engine &bull; Meta Graph API &bull; Cloudflare R2
                </span>
            </footer>

            {/* LIGHTBOX MODAL */}
            <AnimatePresence>
                {imageLightboxUrl && (
                    <div 
                        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md"
                        onClick={() => setImageLightboxUrl('')}
                    >
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            onClick={(e) => e.stopPropagation()}
                            className="relative max-w-3xl max-h-[85vh] bg-white rounded-3xl p-3 shadow-2xl overflow-hidden flex flex-col items-center border border-slate-200"
                        >
                            <img src={imageLightboxUrl} alt="Preview" className="max-h-[75vh] w-auto object-contain rounded-2xl" />
                            <button
                                onClick={() => setImageLightboxUrl('')}
                                className="absolute top-4 right-4 p-2 rounded-full bg-slate-900/80 hover:bg-slate-900 text-white transition-colors cursor-pointer shadow-md"
                            >
                                <X size={16} />
                            </button>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
