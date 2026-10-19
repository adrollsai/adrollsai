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
    Loader2, 
    Globe,
    Phone,
    MapPin,
    Facebook,
    MessageCircle,
    Check,
    Coins,
    Crown,
    ExternalLink,
    AlertCircle,
    RefreshCw,
    ShieldCheck,
    Layers,
    Bot,
    Megaphone,
    Video,
    Volume2,
    VolumeX,
    Play,
    Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { uploadToR2 } from '@/utils/upload-helper';
import { toast } from 'sonner';
import { createClient } from '@/utils/supabase/client';
import { useRazorpay } from '@/utils/useRazorpay';

type OnboardingStep = 'profile' | 'integrations' | 'product' | 'generating' | 'payment';

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

export default function OnboardingPage() {
    const router = useRouter();
    const supabase = createClient();
    const { openCheckout, isProcessing: isPaymentProcessing } = useRazorpay();

    // Active Step
    const [step, setStep] = useState<OnboardingStep>('profile');

    // Quote rotation
    const [quoteIndex, setQuoteIndex] = useState(0);

    // Website Fetch State
    const [websiteUrl, setWebsiteUrl] = useState('');
    const [fetchingWebsite, setFetchingWebsite] = useState(false);
    const [websiteFetched, setWebsiteFetched] = useState(false);

    // Profile Details
    const [companyName, setCompanyName] = useState('');
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

    // Product Details
    const [productTitle, setProductTitle] = useState('');
    const [productDescription, setProductDescription] = useState('');
    const [productPrice, setProductPrice] = useState('');
    const [productImageUrl, setProductImageUrl] = useState('');
    const [uploadingProductImage, setUploadingProductImage] = useState(false);
    const productInputRef = useRef<HTMLInputElement>(null);

    // Generation State
    const [generatingAssets, setGeneratingAssets] = useState(false);
    const [generationFinished, setGenerationFinished] = useState(false);
    const [progressStep, setProgressStep] = useState(0);

    // Walkthrough video states
    const [isVideoMuted, setIsVideoMuted] = useState(true);
    const [videoPlaying, setVideoPlaying] = useState(true);
    const videoRef = useRef<HTMLVideoElement>(null);

    // Initial Load - Fetch profile to prefill any existing data & connection status
    useEffect(() => {
        const loadInitialData = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const { data: profile } = await supabase
                .from('profiles')
                .select('business_name, business_info, logo_url, contact_number, address, custom_domain, facebook_token, whatsapp_phone_number_id, whatsapp_phone_number')
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
            }

            setWebsiteFetched(true);
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
            toast.success("Logo uploaded successfully! 🎨");
        } catch (err: any) {
            toast.error("Failed to upload logo: " + err.message);
        } finally {
            setUploadingLogo(false);
        }
    };

    // --- PRODUCT IMAGE UPLOAD ---
    const handleProductImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploadingProductImage(true);
        try {
            const publicUrl = await uploadToR2(file, 'properties');
            setProductImageUrl(publicUrl);
            toast.success("Product image uploaded! 📸");
        } catch (err: any) {
            toast.error("Failed to upload product image: " + err.message);
        } finally {
            setUploadingProductImage(false);
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
            // Popup blocked: redirect directly
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
                    companyDescription,
                    logoUrl,
                    contactNumber,
                    address: businessAddress,
                    websiteUrl,
                    whatsappNumber: whatsappNumberInput,
                    productTitle,
                    productDescription,
                    productPrice,
                    productImageUrl
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to trigger AI studio generations");

            await new Promise(r => setTimeout(r, 1200));
            setProgressStep(4);
            setGenerationFinished(true);
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
        // Save current progress in profiles and mark complete
        try {
            await fetch('/api/onboarding/complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    companyName: companyName || 'My Business',
                    companyDescription,
                    logoUrl,
                    contactNumber,
                    address: businessAddress,
                    websiteUrl,
                    whatsappNumber: whatsappNumberInput
                })
            });
        } catch {}
        setStep('payment');
    };

    // --- PAYMENT OR DASHBOARD FINISH ---
    const handlePurchasePlan = (planId: string) => {
        openCheckout({
            planId,
            onSuccess: () => {
                toast.success("🎉 Payment complete! Your Nobogent Pro Workspace is ready.");
                router.push('/dashboard/assets');
            }
        });
    };

    const handleSkipPaymentAndEnterDashboard = async () => {
        toast.info("Welcome to Nobogent! You can upgrade anytime in Billing.");
        router.push('/dashboard');
    };

    // Step navigation helpers
    const currentStepNumber = {
        'profile': 1,
        'integrations': 2,
        'product': 3,
        'generating': 4,
        'payment': 5
    }[step];

    return (
        <div className="min-h-screen bg-[#F8FAFC] text-slate-800 flex flex-col justify-between font-sans relative overflow-x-hidden">
            {/* Ambient background glows */}
            <div className="absolute top-[-10%] left-[-10%] w-[55%] h-[55%] rounded-full bg-[#00487c]/6 blur-[140px] pointer-events-none" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-[#a81d33]/6 blur-[140px] pointer-events-none" />
            <div className="absolute top-[40%] right-[10%] w-[35%] h-[35%] rounded-full bg-[#e5a92a]/8 blur-[120px] pointer-events-none" />

            {/* Header */}
            <header className="w-full max-w-7xl mx-auto px-6 py-5 flex items-center justify-between z-10 border-b border-slate-200/60 bg-white/70 backdrop-blur-md sticky top-0">
                <div className="flex items-center gap-3">
                    <img src="/logo.png" alt="Nobogent" className="h-9 w-auto object-contain" />
                    <span className="hidden sm:inline-block text-[11px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-blue-50 text-[#00487c] border border-blue-100">
                        Workspace Setup
                    </span>
                </div>

                {/* Step Progress Indicators */}
                {step !== 'generating' && (
                    <div className="flex items-center gap-4">
                        <span className="text-xs font-black text-[#00487c] uppercase tracking-wider hidden sm:inline-block">
                            Step {currentStepNumber} of 5
                        </span>
                        <div className="flex gap-1.5 items-center">
                            {[1, 2, 3, 4, 5].map((idx) => (
                                <div
                                    key={idx}
                                    className={`h-2 rounded-full transition-all duration-300 ${
                                        idx === currentStepNumber 
                                            ? 'w-7 bg-gradient-to-r from-[#00487c] to-[#a81d33]' 
                                            : idx < currentStepNumber 
                                                ? 'w-4 bg-[#00487c]' 
                                                : 'w-3 bg-slate-200'
                                    }`}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </header>

            {/* Main Content Area */}
            <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 py-8 flex flex-col justify-center z-10">
                <AnimatePresence mode="wait">
                    {/* ================= STEP 1: BRAND PROFILE INFO & WEBSITE BOOSTER ================= */}
                    {step === 'profile' && (
                        <motion.div
                            key="step-profile"
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -15 }}
                            transition={{ duration: 0.3 }}
                            className="w-full space-y-6"
                        >
                            {/* Title & Tagline */}
                            <div className="text-center sm:text-left">
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200/60 mb-2">
                                    <Sparkles size={13} className="text-amber-600 animate-spin" /> Step 1: Your Brand Identity
                                </span>
                                <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-[#00487c]">
                                    Tell us about your business
                                </h1>
                                <p className="text-sm text-slate-600 font-medium mt-1.5 leading-relaxed">
                                    Nobogent's AI uses this information to personalize your ad creatives, automated messages, and video scripts.
                                </p>
                            </div>

                            {/* Optional Website Fetcher Booster Card */}
                            <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white rounded-3xl p-5 sm:p-6 shadow-xl relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
                                <div className="relative z-10">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Globe size={18} className="text-blue-300" />
                                        <h3 className="text-sm sm:text-base font-bold text-white">
                                            Have an existing website?
                                        </h3>
                                        <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                                            Recommended
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-300 mb-3 max-w-xl">
                                        Paste your website link below and our AI will automatically extract your business name, bio, logo, contact number, and flagship product in 3 seconds!
                                    </p>
                                    <div className="flex flex-col sm:flex-row gap-2.5">
                                        <div className="relative flex-1">
                                            <input
                                                type="text"
                                                value={websiteUrl}
                                                onChange={(e) => setWebsiteUrl(e.target.value)}
                                                placeholder="https://yourbusiness.com"
                                                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:bg-white/15 transition-all"
                                            />
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleFetchWebsite}
                                            disabled={fetchingWebsite || !websiteUrl}
                                            className="bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider px-5 py-3 rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer active:scale-95 shrink-0"
                                        >
                                            {fetchingWebsite ? (
                                                <>
                                                    <Loader2 size={15} className="animate-spin" /> Scanning site...
                                                </>
                                            ) : (
                                                <>
                                                    <Sparkles size={15} /> Auto-Fill with AI
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Profile Info Form Card */}
                            <div className="bg-white/90 backdrop-blur-xl border border-slate-200/80 rounded-[2.5rem] p-6 sm:p-10 space-y-6 shadow-sm shadow-slate-200/50">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                                    {/* Logo Upload Section */}
                                    <div className="md:col-span-1 flex flex-col items-center">
                                        <label className="text-xs font-black uppercase tracking-wider text-[#00487c] mb-3 block self-start">
                                            Business Logo
                                        </label>
                                        <div 
                                            onClick={() => logoInputRef.current?.click()}
                                            className="w-40 h-40 rounded-[2rem] border-2 border-dashed border-slate-200 hover:border-[#a81d33] hover:bg-slate-50 transition-all cursor-pointer flex flex-col items-center justify-center overflow-hidden group relative bg-slate-50/60 shadow-xs"
                                        >
                                            {logoUrl ? (
                                                <>
                                                    <img src={logoUrl} alt="Logo" className="w-full h-full object-contain p-4 transition-transform duration-500 group-hover:scale-105" />
                                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                        <Upload size={20} className="text-white animate-bounce" />
                                                    </div>
                                                </>
                                            ) : uploadingLogo ? (
                                                <div className="flex flex-col items-center gap-2">
                                                    <Loader2 size={24} className="text-[#a81d33] animate-spin" />
                                                    <span className="text-[10px] font-bold text-slate-400">Uploading...</span>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col items-center text-center px-4 gap-2">
                                                    <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 group-hover:text-[#a81d33] group-hover:bg-[#a81d33]/5 transition-all">
                                                        <Building2 size={20} />
                                                    </div>
                                                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 group-hover:text-[#a81d33]">
                                                        Upload Logo
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                        <input 
                                            type="file" 
                                            ref={logoInputRef}
                                            onChange={handleLogoUpload}
                                            accept="image/*"
                                            className="hidden" 
                                        />
                                        <span className="text-[11px] text-slate-400 mt-2 text-center">PNG, JPG, or SVG</span>
                                    </div>

                                    {/* Company Details fields */}
                                    <div className="md:col-span-2 space-y-4">
                                        <div>
                                            <label className="text-xs font-black uppercase tracking-wider text-[#00487c] block mb-1.5">
                                                Business Name <span className="text-[#a81d33]">*</span>
                                            </label>
                                            <input 
                                                type="text"
                                                value={companyName}
                                                onChange={(e) => setCompanyName(e.target.value)}
                                                placeholder="e.g. Apex Living Real Estate"
                                                className="w-full bg-slate-50/60 border border-slate-200 rounded-2xl px-4 py-3.5 text-sm font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#00487c] focus:bg-white transition-all shadow-xs"
                                            />
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <label className="text-xs font-black uppercase tracking-wider text-[#00487c] block mb-1.5 flex items-center gap-1">
                                                    <Phone size={12} /> Contact Number
                                                </label>
                                                <input 
                                                    type="tel"
                                                    value={contactNumber}
                                                    onChange={(e) => setContactNumber(e.target.value)}
                                                    placeholder="+91 98765 43210"
                                                    className="w-full bg-slate-50/60 border border-slate-200 rounded-2xl px-4 py-3.5 text-sm font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#00487c] focus:bg-white transition-all shadow-xs"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-xs font-black uppercase tracking-wider text-[#00487c] block mb-1.5 flex items-center gap-1">
                                                    <MapPin size={12} /> Business Address
                                                </label>
                                                <input 
                                                    type="text"
                                                    value={businessAddress}
                                                    onChange={(e) => setBusinessAddress(e.target.value)}
                                                    placeholder="e.g. Bandra West, Mumbai"
                                                    className="w-full bg-slate-50/60 border border-slate-200 rounded-2xl px-4 py-3.5 text-sm font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#00487c] focus:bg-white transition-all shadow-xs"
                                                />
                                            </div>
                                        </div>

                                        <div>
                                            <label className="text-xs font-black uppercase tracking-wider text-[#00487c] block mb-1.5">
                                                Business Bio & Mission
                                            </label>
                                            <textarea 
                                                rows={3}
                                                value={companyDescription}
                                                onChange={(e) => setCompanyDescription(e.target.value)}
                                                placeholder="What does your company do? (e.g. We provide luxury apartments and strategic property investments in prime metropolitan locations...)"
                                                className="w-full bg-slate-50/60 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#00487c] focus:bg-white transition-all resize-none shadow-xs"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Bottom Inspiring Quote & Actions */}
                                <div className="pt-5 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
                                    <div className="flex items-center gap-2 text-xs text-slate-500 italic max-w-md text-center sm:text-left">
                                        <Sparkles size={14} className="text-amber-500 shrink-0" />
                                        <span>"{INSPIRATIONAL_QUOTES[quoteIndex].quote}"</span>
                                    </div>

                                    <div className="flex items-center gap-4 w-full sm:w-auto justify-end">
                                        {/* Skippable link (Subtle and not highlighted) */}
                                        <button
                                            type="button"
                                            onClick={() => setStep('integrations')}
                                            className="text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors py-2 px-3 rounded-lg"
                                        >
                                            Skip this step →
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => setStep('integrations')}
                                            className="bg-gradient-to-r from-[#00487c] to-[#a81d33] hover:opacity-95 active:scale-[0.98] text-white font-black text-xs uppercase tracking-wider px-6 py-3.5 rounded-2xl transition-all shadow-md flex items-center gap-2 cursor-pointer"
                                        >
                                            Next: Accounts <ArrowRight size={15} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {/* ================= STEP 2: ACCOUNT CONNECTIONS (META & WHATSAPP) ================= */}
                    {step === 'integrations' && (
                        <motion.div
                            key="step-integrations"
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -15 }}
                            transition={{ duration: 0.3 }}
                            className="w-full space-y-6"
                        >
                            <div className="text-center sm:text-left">
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-800 border border-blue-200/60 mb-2">
                                    <Megaphone size={13} className="text-blue-600" /> Step 2: Supercharge Your Reach
                                </span>
                                <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-[#00487c]">
                                    Connect your marketing channels
                                </h1>
                                <p className="text-sm text-slate-600 font-medium mt-1.5 leading-relaxed">
                                    Link Meta for 1-click ad deployment and WhatsApp for 24/7 autonomous client qualification.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Meta (Facebook & Instagram) Card */}
                                <div className="bg-white/95 backdrop-blur-xl border border-slate-200 rounded-3xl p-6 sm:p-7 shadow-xs flex flex-col justify-between hover:shadow-md transition-all">
                                    <div>
                                        <div className="flex items-center justify-between mb-4">
                                            <div className="w-12 h-12 rounded-2xl bg-[#1877F2]/10 text-[#1877F2] flex items-center justify-center">
                                                <Facebook size={26} />
                                            </div>
                                            {isMetaConnected ? (
                                                <span className="inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1 rounded-full">
                                                    <CheckCircle2 size={13} /> Connected
                                                </span>
                                            ) : (
                                                <span className="text-[11px] font-bold text-slate-400 bg-slate-100 px-2.5 py-0.5 rounded-full">
                                                    Not Connected
                                                </span>
                                            )}
                                        </div>

                                        <h3 className="text-lg font-black text-slate-900 mb-1">
                                            Meta Ads & Pages
                                        </h3>
                                        <p className="text-xs text-slate-600 font-medium mb-4 leading-relaxed">
                                            Enables instant ad launch, AI creative sync to your Instagram feed, and automatic Facebook Lead Form data capture.
                                        </p>

                                        <div className="space-y-2 mb-6">
                                            <div className="flex items-center gap-2 text-xs text-slate-700 font-semibold">
                                                <Check size={14} className="text-emerald-500" /> 1-Click ad launch from AI templates
                                            </div>
                                            <div className="flex items-center gap-2 text-xs text-slate-700 font-semibold">
                                                <Check size={14} className="text-emerald-500" /> Real-time Meta Lead Form sync to CRM
                                            </div>
                                            <div className="flex items-center gap-2 text-xs text-slate-700 font-semibold">
                                                <Check size={14} className="text-emerald-500" /> Instagram feed & reels integration
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
                                                    className="text-[11px] font-bold text-slate-500 hover:text-slate-800 underline"
                                                >
                                                    Reconnect
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={handleConnectMeta}
                                                disabled={isConnectingMeta}
                                                className="w-full bg-[#1877F2] hover:bg-[#166fe5] text-white font-black text-xs uppercase tracking-wider py-3.5 px-4 rounded-2xl transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer active:scale-95"
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
                                <div className="bg-white/95 backdrop-blur-xl border border-slate-200 rounded-3xl p-6 sm:p-7 shadow-xs flex flex-col justify-between hover:shadow-md transition-all">
                                    <div>
                                        <div className="flex items-center justify-between mb-4">
                                            <div className="w-12 h-12 rounded-2xl bg-[#25D366]/10 text-[#25D366] flex items-center justify-center">
                                                <MessageCircle size={26} />
                                            </div>
                                            {isWhatsAppConnected ? (
                                                <span className="inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1 rounded-full">
                                                    <CheckCircle2 size={13} /> Active
                                                </span>
                                            ) : (
                                                <span className="text-[11px] font-bold text-slate-400 bg-slate-100 px-2.5 py-0.5 rounded-full">
                                                    Quick Setup
                                                </span>
                                            )}
                                        </div>

                                        <h3 className="text-lg font-black text-slate-900 mb-1">
                                            WhatsApp Business Automation
                                        </h3>
                                        <p className="text-xs text-slate-600 font-medium mb-4 leading-relaxed">
                                            Instantly reply to incoming ad leads, trigger automated nurturing drip flows, and answer inquiries 24/7 with AI.
                                        </p>

                                        <div className="space-y-2 mb-4">
                                            <div className="flex items-center gap-2 text-xs text-slate-700 font-semibold">
                                                <Check size={14} className="text-emerald-500" /> Instant 2-minute lead greeting
                                            </div>
                                            <div className="flex items-center gap-2 text-xs text-slate-700 font-semibold">
                                                <Check size={14} className="text-emerald-500" /> Automated digital brochure & catalog delivery
                                            </div>
                                            <div className="flex items-center gap-2 text-xs text-slate-700 font-semibold">
                                                <Check size={14} className="text-emerald-500" /> 24/7 AI conversational chatbot
                                            </div>
                                        </div>

                                        {/* Quick WhatsApp Number input */}
                                        <div className="mb-4">
                                            <label className="text-[11px] font-bold text-slate-600 block mb-1">
                                                WhatsApp Business or Alert Number:
                                            </label>
                                            <div className="flex gap-2">
                                                <input
                                                    type="tel"
                                                    value={whatsappNumberInput}
                                                    onChange={(e) => setWhatsappNumberInput(e.target.value)}
                                                    placeholder="+91 98765 43210"
                                                    className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:border-emerald-500"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={handleSaveWhatsappNumber}
                                                    disabled={isSavingWhatsappNum || !whatsappNumberInput}
                                                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold px-3 py-2 rounded-xl transition-all disabled:opacity-50"
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
                                            className="w-full bg-[#25D366] hover:bg-[#20ba59] text-white font-black text-xs uppercase tracking-wider py-3.5 px-4 rounded-2xl transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer active:scale-95"
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
                            <div className="bg-white/80 border border-slate-200 rounded-3xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
                                <button
                                    type="button"
                                    onClick={() => setStep('profile')}
                                    className="text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors"
                                >
                                    ← Back to Profile
                                </button>

                                <div className="flex items-center gap-4 w-full sm:w-auto justify-end">
                                    <button
                                        type="button"
                                        onClick={() => setStep('product')}
                                        className="text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors py-2 px-3"
                                    >
                                        Skip account connection →
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => setStep('product')}
                                        className="bg-gradient-to-r from-[#00487c] to-[#a81d33] hover:opacity-95 text-white font-black text-xs uppercase tracking-wider px-6 py-3.5 rounded-2xl transition-all shadow-md flex items-center gap-2 cursor-pointer"
                                    >
                                        Next: Add First Product <ArrowRight size={15} />
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {/* ================= STEP 3: ONE PRODUCT / SERVICE INFO ================= */}
                    {step === 'product' && (
                        <motion.div
                            key="step-product"
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -15 }}
                            transition={{ duration: 0.3 }}
                            className="w-full space-y-6"
                        >
                            <div className="text-center sm:text-left">
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-purple-50 text-purple-800 border border-purple-200/60 mb-2">
                                    <Package size={13} className="text-purple-600" /> Step 3: Flagship Product or Offering
                                </span>
                                <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-[#00487c]">
                                    Add your first product or service
                                </h1>
                                <p className="text-sm text-slate-600 font-medium mt-1.5 leading-relaxed">
                                    Nobogent will automatically produce 3 high-converting Meta ad images and 1 cinematic AI video commercial for this item.
                                </p>
                            </div>

                            <div className="bg-white/90 backdrop-blur-xl border border-slate-200/80 rounded-[2.5rem] p-6 sm:p-10 space-y-6 shadow-sm shadow-slate-200/50">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                                    {/* Product Image Section */}
                                    <div className="md:col-span-1 flex flex-col items-center">
                                        <label className="text-xs font-black uppercase tracking-wider text-[#00487c] mb-3 block self-start">
                                            Product Photo
                                        </label>
                                        <div 
                                            onClick={() => productInputRef.current?.click()}
                                            className="w-40 h-40 rounded-[2rem] border-2 border-dashed border-slate-200 hover:border-[#a81d33] hover:bg-slate-50 transition-all cursor-pointer flex flex-col items-center justify-center overflow-hidden group relative bg-slate-50/60 shadow-xs"
                                        >
                                            {productImageUrl ? (
                                                <>
                                                    <img src={productImageUrl} alt="Product" className="w-full h-full object-contain p-2 transition-transform duration-500 group-hover:scale-105" />
                                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                        <Upload size={20} className="text-white animate-bounce" />
                                                    </div>
                                                </>
                                            ) : uploadingProductImage ? (
                                                <div className="flex flex-col items-center gap-2">
                                                    <Loader2 size={24} className="text-[#a81d33] animate-spin" />
                                                    <span className="text-[10px] font-bold text-slate-400">Uploading...</span>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col items-center text-center px-4 gap-2">
                                                    <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 group-hover:text-[#a81d33] group-hover:bg-[#a81d33]/5 transition-all">
                                                        <Package size={20} />
                                                    </div>
                                                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 group-hover:text-[#a81d33]">
                                                        Upload Image
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                        <input 
                                            type="file" 
                                            ref={productInputRef}
                                            onChange={handleProductImageUpload}
                                            accept="image/*"
                                            className="hidden" 
                                        />
                                        <span className="text-[11px] text-slate-400 mt-2 text-center">Clear product shot</span>
                                    </div>

                                    {/* Product details fields */}
                                    <div className="md:col-span-2 space-y-4">
                                        <div className="grid grid-cols-3 gap-3">
                                            <div className="col-span-2">
                                                <label className="text-xs font-black uppercase tracking-wider text-[#00487c] block mb-1.5">
                                                    Product / Service Title <span className="text-[#a81d33]">*</span>
                                                </label>
                                                <input 
                                                    type="text"
                                                    value={productTitle}
                                                    onChange={(e) => setProductTitle(e.target.value)}
                                                    placeholder="e.g. 3BHK Luxury Skyline Apartment"
                                                    className="w-full bg-slate-50/60 border border-slate-200 rounded-2xl px-4 py-3.5 text-sm font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#00487c] focus:bg-white transition-all shadow-xs"
                                                />
                                            </div>
                                            <div className="col-span-1">
                                                <label className="text-xs font-black uppercase tracking-wider text-[#00487c] block mb-1.5">
                                                    Price (Optional)
                                                </label>
                                                <input 
                                                    type="text"
                                                    value={productPrice}
                                                    onChange={(e) => setProductPrice(e.target.value)}
                                                    placeholder="e.g. ₹1.45 Cr"
                                                    className="w-full bg-slate-50/60 border border-slate-200 rounded-2xl px-4 py-3.5 text-sm font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#00487c] focus:bg-white transition-all shadow-xs"
                                                />
                                            </div>
                                        </div>

                                        <div>
                                            <label className="text-xs font-black uppercase tracking-wider text-[#00487c] block mb-1.5">
                                                Core Features & Unique Benefits
                                            </label>
                                            <textarea 
                                                rows={4}
                                                value={productDescription}
                                                onChange={(e) => setProductDescription(e.target.value)}
                                                placeholder="Describe the standout features, amenities, or reasons customers love this... (e.g. Panoramic sea view, infinity pool, 5 mins from financial district, zero brokerage...)"
                                                className="w-full bg-slate-50/60 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#00487c] focus:bg-white transition-all resize-none shadow-xs"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Bottom navigation */}
                                <div className="pt-5 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
                                    <button
                                        type="button"
                                        onClick={() => setStep('integrations')}
                                        className="text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors"
                                    >
                                        ← Back to Accounts
                                    </button>

                                    <div className="flex items-center gap-4 w-full sm:w-auto justify-end">
                                        {/* Skippable link (Subtle and not highlighted) */}
                                        <button
                                            type="button"
                                            onClick={handleSkipToPayment}
                                            className="text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors py-2 px-3"
                                        >
                                            Skip product setup →
                                        </button>

                                        <button
                                            type="button"
                                            onClick={handleTriggerGenerations}
                                            disabled={!productTitle.trim() || !productDescription.trim()}
                                            className="bg-gradient-to-r from-[#00487c] to-[#a81d33] hover:opacity-95 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none text-white font-black text-xs uppercase tracking-wider px-7 py-3.5 rounded-2xl transition-all shadow-md flex items-center gap-2 cursor-pointer"
                                        >
                                            Launch AI Studio <Sparkles size={15} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {/* ================= STEP 4: AI STUDIO SETUP & DELIGHT ANIMATIONS ================= */}
                    {step === 'generating' && (
                        <motion.div
                            key="step-generating"
                            initial={{ opacity: 0, scale: 0.98 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.3 }}
                            className="w-full grid grid-cols-1 md:grid-cols-12 gap-8 items-center"
                        >
                            {/* Left: Interactive Video Walkthrough */}
                            <div className="md:col-span-7 flex flex-col gap-3">
                                <span className="text-[11px] font-black uppercase tracking-widest text-[#a81d33]">
                                    AI Studio Preview
                                </span>
                                <h2 className="text-xl sm:text-2xl font-black tracking-tight text-[#00487c]">
                                    Watch how Nobogent automates your sales
                                </h2>
                                <div className="relative aspect-video w-full rounded-[2rem] border border-slate-200 bg-slate-900 overflow-hidden shadow-xl group">
                                    <video 
                                        ref={videoRef}
                                        src="https://assets.mixkit.co/videos/preview/mixkit-man-working-on-a-laptop-at-his-desk-40346-large.mp4"
                                        autoPlay
                                        loop
                                        muted={isVideoMuted}
                                        playsInline
                                        className="w-full h-full object-cover"
                                    />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent flex items-end justify-between p-6">
                                        <div className="text-white text-xs font-semibold">
                                            Generating: 3 Meta Ad Creatives + 1 UGC AI Video
                                        </div>
                                        <button 
                                            type="button"
                                            onClick={() => {
                                                if (videoRef.current) {
                                                    videoRef.current.muted = !videoRef.current.muted;
                                                    setIsVideoMuted(videoRef.current.muted);
                                                }
                                            }}
                                            className="w-9 h-9 rounded-full bg-white/25 hover:bg-white/40 backdrop-blur-md flex items-center justify-center text-white transition-all active:scale-95"
                                        >
                                            {isVideoMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Right: Real-time generation progress checklist */}
                            <div className="md:col-span-5 bg-white/95 backdrop-blur-xl border border-slate-200 rounded-[2.5rem] p-7 sm:p-8 shadow-xl shadow-slate-200/50 flex flex-col justify-between self-stretch min-h-[340px]">
                                <div>
                                    <div className="flex items-center justify-between mb-6">
                                        <h3 className="text-lg font-black tracking-tight text-[#00487c]">
                                            Building Workspace
                                        </h3>
                                        <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                                            Live AI
                                        </span>
                                    </div>

                                    <div className="space-y-4">
                                        {/* Status 1 */}
                                        <div className="flex items-center gap-3">
                                            {progressStep > 1 ? (
                                                <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
                                            ) : progressStep === 1 ? (
                                                <Loader2 size={18} className="text-[#a81d33] animate-spin shrink-0" />
                                            ) : (
                                                <div className="w-[18px] h-[18px] rounded-full border-2 border-slate-200 shrink-0 bg-slate-50" />
                                            )}
                                            <span className={`text-xs font-semibold ${progressStep >= 1 ? 'text-slate-800' : 'text-slate-400'}`}>
                                                Saving brand profile & contact info...
                                            </span>
                                        </div>

                                        {/* Status 2 */}
                                        <div className="flex items-center gap-3">
                                            {progressStep > 2 ? (
                                                <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
                                            ) : progressStep === 2 ? (
                                                <Loader2 size={18} className="text-[#a81d33] animate-spin shrink-0" />
                                            ) : (
                                                <div className="w-[18px] h-[18px] rounded-full border-2 border-slate-200 shrink-0 bg-slate-50" />
                                            )}
                                            <span className={`text-xs font-semibold ${progressStep >= 2 ? 'text-slate-800' : 'text-slate-400'}`}>
                                                Indexing product & value proposition...
                                            </span>
                                        </div>

                                        {/* Status 3 */}
                                        <div className="flex items-center gap-3">
                                            {progressStep > 3 ? (
                                                <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
                                            ) : progressStep === 3 ? (
                                                <Loader2 size={18} className="text-[#a81d33] animate-spin shrink-0" />
                                            ) : (
                                                <div className="w-[18px] h-[18px] rounded-full border-2 border-slate-200 shrink-0 bg-slate-50" />
                                            )}
                                            <span className={`text-xs font-semibold ${progressStep >= 3 ? 'text-slate-800' : 'text-slate-400'}`}>
                                                Generating 3 Meta Ads & AI Video Script...
                                            </span>
                                        </div>
                                    </div>

                                    {/* Quote callout */}
                                    <div className="mt-6 p-3.5 rounded-2xl bg-amber-50/80 border border-amber-200/60 text-[11px] text-amber-900 font-medium flex items-start gap-2">
                                        <Sparkles size={14} className="text-amber-600 shrink-0 mt-0.5" />
                                        <span>"{INSPIRATIONAL_QUOTES[quoteIndex].quote}"</span>
                                    </div>
                                </div>

                                <div className="mt-6 pt-5 border-t border-slate-100">
                                    <button
                                        type="button"
                                        onClick={() => setStep('payment')}
                                        disabled={!generationFinished}
                                        className="w-full bg-gradient-to-r from-[#00487c] to-[#a81d33] hover:opacity-95 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none text-white font-black text-xs uppercase tracking-wider py-4 rounded-2xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
                                    >
                                        {generationFinished ? (
                                            <>
                                                Continue to Plans & Payment <ArrowRight size={15} />
                                            </>
                                        ) : (
                                            <>
                                                <Loader2 size={16} className="animate-spin" /> Cooking your creatives...
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {/* ================= STEP 5: CHOOSE YOUR PLAN & PAYMENT (OR SKIP) ================= */}
                    {step === 'payment' && (
                        <motion.div
                            key="step-payment"
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -15 }}
                            transition={{ duration: 0.3 }}
                            className="w-full space-y-6"
                        >
                            <div className="text-center">
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200/60 mb-2">
                                    <Crown size={13} className="text-emerald-600" /> Final Step: Choose Your Plan
                                </span>
                                <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-[#00487c]">
                                    Activate your growth workspace
                                </h1>
                                <p className="text-sm text-slate-600 font-medium mt-1.5 max-w-xl mx-auto">
                                    Select a plan to unlock all AI creative generations, WhatsApp chatbot flows, and Meta Ads management. You can also pay later anytime.
                                </p>
                            </div>

                            {/* Plan Cards */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                {/* 1 Month Plan */}
                                <div className="bg-white rounded-3xl border border-slate-200 p-6 flex flex-col justify-between shadow-xs hover:border-slate-300 transition-all">
                                    <div>
                                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                                            Monthly Starter
                                        </span>
                                        <h3 className="text-xl font-black text-slate-900 mt-0.5">1 Month</h3>
                                        <div className="mt-3 mb-4">
                                            <span className="text-3xl font-black text-[#00487c]">₹9,999</span>
                                            <span className="text-[11px] text-slate-500 font-semibold block">+ 18% GST</span>
                                        </div>
                                        <ul className="space-y-2 text-xs text-slate-600 font-medium mb-6">
                                            <li className="flex items-center gap-2"><Check size={14} className="text-emerald-600" /> 50 AI Ad Creatives</li>
                                            <li className="flex items-center gap-2"><Check size={14} className="text-emerald-600" /> 10 Cinematic AI Videos</li>
                                            <li className="flex items-center gap-2"><Check size={14} className="text-emerald-600" /> WhatsApp AI Chatbot & API</li>
                                            <li className="flex items-center gap-2"><Check size={14} className="text-emerald-600" /> Meta Ads Automation</li>
                                            <li className="flex items-center gap-2"><Check size={14} className="text-emerald-600" /> CRM & Lead Manager</li>
                                        </ul>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handlePurchasePlan('1-month')}
                                        disabled={isPaymentProcessing}
                                        className="w-full bg-slate-900 hover:bg-slate-800 text-white font-black text-xs uppercase tracking-wider py-3.5 rounded-2xl transition-all cursor-pointer active:scale-95 shadow-sm"
                                    >
                                        Choose 1 Month
                                    </button>
                                </div>

                                {/* 6 Months Plan (Featured) */}
                                <div className="bg-gradient-to-b from-indigo-900 to-slate-900 text-white rounded-3xl border-2 border-indigo-500 p-6 flex flex-col justify-between shadow-xl relative overflow-hidden transform md:-translate-y-2">
                                    <div className="absolute top-4 right-4 bg-gradient-to-r from-amber-400 to-amber-500 text-slate-900 text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full shadow-sm">
                                        Most Popular
                                    </div>
                                    <div>
                                        <span className="text-[10px] font-black uppercase tracking-wider text-indigo-300">
                                            Save ₹5,001 (8% Off)
                                        </span>
                                        <h3 className="text-xl font-black text-white mt-0.5">6 Months</h3>
                                        <div className="mt-3 mb-4">
                                            <span className="text-3xl font-black text-white">₹54,999</span>
                                            <span className="text-[11px] text-indigo-200 font-semibold block">+ 18% GST</span>
                                        </div>
                                        <ul className="space-y-2 text-xs text-indigo-100 font-medium mb-6">
                                            <li className="flex items-center gap-2"><Check size={14} className="text-amber-400" /> 300 AI Ad Creatives</li>
                                            <li className="flex items-center gap-2"><Check size={14} className="text-amber-400" /> 60 Cinematic AI Videos</li>
                                            <li className="flex items-center gap-2"><Check size={14} className="text-amber-400" /> Dedicated Account Manager</li>
                                            <li className="flex items-center gap-2"><Check size={14} className="text-amber-400" /> Full WhatsApp Automation Suite</li>
                                            <li className="flex items-center gap-2"><Check size={14} className="text-amber-400" /> Priority Meta Ad Approval</li>
                                        </ul>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handlePurchasePlan('6-months')}
                                        disabled={isPaymentProcessing}
                                        className="w-full bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 text-slate-950 font-black text-xs uppercase tracking-wider py-3.5 rounded-2xl transition-all cursor-pointer active:scale-95 shadow-md"
                                    >
                                        Choose 6 Months (Save 8%)
                                    </button>
                                </div>

                                {/* 12 Months Plan */}
                                <div className="bg-white rounded-3xl border border-slate-200 p-6 flex flex-col justify-between shadow-xs hover:border-slate-300 transition-all">
                                    <div>
                                        <span className="text-[10px] font-black uppercase tracking-wider text-emerald-600">
                                            Save ₹20,001 (17% Off)
                                        </span>
                                        <h3 className="text-xl font-black text-slate-900 mt-0.5">12 Months</h3>
                                        <div className="mt-3 mb-4">
                                            <span className="text-3xl font-black text-[#00487c]">₹99,999</span>
                                            <span className="text-[11px] text-slate-500 font-semibold block">+ 18% GST</span>
                                        </div>
                                        <ul className="space-y-2 text-xs text-slate-600 font-medium mb-6">
                                            <li className="flex items-center gap-2"><Check size={14} className="text-emerald-600" /> 600 AI Ad Creatives</li>
                                            <li className="flex items-center gap-2"><Check size={14} className="text-emerald-600" /> 120 Cinematic AI Videos</li>
                                            <li className="flex items-center gap-2"><Check size={14} className="text-emerald-600" /> Unlimited Team Members</li>
                                            <li className="flex items-center gap-2"><Check size={14} className="text-emerald-600" /> Custom Landing Pages & Domain</li>
                                            <li className="flex items-center gap-2"><Check size={14} className="text-emerald-600" /> AI Voice Calling Minutes</li>
                                        </ul>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handlePurchasePlan('12-months')}
                                        disabled={isPaymentProcessing}
                                        className="w-full bg-slate-900 hover:bg-slate-800 text-white font-black text-xs uppercase tracking-wider py-3.5 rounded-2xl transition-all cursor-pointer active:scale-95 shadow-sm"
                                    >
                                        Choose 12 Months (Best Value)
                                    </button>
                                </div>
                            </div>

                            {/* Skip Payment Option (Subtle, neutral text button as requested) */}
                            <div className="pt-6 border-t border-slate-200 text-center flex flex-col sm:flex-row items-center justify-between gap-4">
                                <span className="text-xs text-slate-500">
                                    Secure payments encrypted by Razorpay (UPI, Credit/Debit Cards, NetBanking).
                                </span>

                                <button
                                    type="button"
                                    onClick={handleSkipPaymentAndEnterDashboard}
                                    className="text-xs font-bold text-slate-400 hover:text-slate-700 transition-colors py-2 px-4 rounded-xl cursor-pointer"
                                >
                                    Skip for now, I'll pay later in Billing section →
                                </button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </main>

            {/* Footer */}
            <footer className="w-full max-w-7xl mx-auto px-6 py-5 text-center z-10 border-t border-slate-200/50">
                <p className="text-[11px] font-semibold text-slate-400 tracking-wide">
                    &copy; 2026 Nobogent AI Technologies. All rights reserved.
                </p>
            </footer>
        </div>
    );
}
