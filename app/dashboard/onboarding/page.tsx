'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
    Sparkles, 
    Building2, 
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
    Zap, 
    Maximize2, 
    Trash2, 
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


type OnboardingStep = 'profile' | 'integrations' | 'templates' | 'payment';

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
    // PAYMENT FIRST. The paywall is the first thing a new customer meets and it cannot be skipped,
  // so the product's first step is choosing a plan. Everything else is collected after the sale,
  // because the details we ask for only matter once someone has actually bought the service.
  const [step, setStep] = useState<OnboardingStep>('payment');
    // The monthly plan auto-renews through the gateway mandate. The customer is told once, in small
  // print; the product copy does not label it. `paymentType` therefore defaults to recurring so the
  // ₹9,999 plan actually renews rather than quietly expiring after one month.
  const [paymentType, setPaymentType] = useState<'one_time' | 'recurring'>('recurring');
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

    /**
     * NO BUILT-IN DESIGN SELECTION.
     *
     * This state used to start with the first five built-in Dubai property designs pre-selected, and the
     * gallery let a new account pick up to ten more. The operator's rule is that those designs are for no
     * other account, and every generation path now ignores `selected_templates` entirely — so the value is
     * kept only because the save call still sends it, and it is always empty.
     */
    const [selectedTemplates] = useState<string[]>([]);
    const [isSavingTemplates, setIsSavingTemplates] = useState(false);

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
                // `profile.selected_templates` is deliberately NOT loaded: it held built-in catalogue ids, and
                // no generation path reads it any more (see lib/automation/reference-selection).
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

            setWebsiteFetched(true);
            playChime('success');
            toast.dismiss(toastId);
            toast.success("✨ Brand profile extracted from your website!");
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
            override_default_response_type: true,
            // REQUIRED for WhatsApp Embedded Signup: without `extras` Meta never posts the
            // WA_EMBEDDED_SIGNUP session info (waba_id + phone_number_id) back to this page.
            extras: {
                feature: 'whatsapp_embedded_signup',
                sessionInfoVersion: 3,
                setup: {}
            }
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

    // --- SAVE BRAND PROFILE & TEMPLATES, PROCEED TO PLAN ACTIVATION ---
    const handleSaveTemplatesAndContinue = async () => {
        setIsSavingTemplates(true);
        playChime('beep');
        try {
            const res = await fetch('/api/onboarding/complete', {
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

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                console.warn("Could not save onboarding profile:", data);
            }
            playChime('success');
            setStep('payment');
        } catch (err: any) {
            console.error("Error saving onboarding details:", err);
            setStep('payment');
        } finally {
            setIsSavingTemplates(false);
        }
    };

    // --- PAYMENT OR DASHBOARD FINISH ---
    const handlePurchasePlan = (planId: string) => {
        // 7-day trial is strictly a one-time purchase pass
        const effectiveType = planId === 'trial' || planId === '7-days-trial' ? 'one_time' : paymentType;
        openCheckout({
            planId,
            paymentType: effectiveType,
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

    // THE PAYWALL CANNOT BE SKIPPED.
    //
    // This used to write `client_features.paywall_skipped = true` and mark onboarding complete, and
    // layout.tsx then treated that flag as "paid" — so a new signup could enter the whole product
    // without buying anything. Payment is now the first step and there is no route past it: this
    // function only sends the user back to the plans, and the flag is no longer written anywhere.
    const handleSkipPaymentAndEnterDashboard = async () => {
        setStep('payment');
    };


    // Step navigation helpers
    const currentStepNumber = {
        'profile': 1,
        'integrations': 2,
        'templates': 3,
        'payment': 4
    }[step];

    const STEPS_NAV = [
        { key: 'profile', label: 'Brand Profile', icon: Building2 },
        { key: 'integrations', label: 'Channels', icon: Megaphone },
        { key: 'templates', label: 'Design Styles', icon: Layers },
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
                        Step {currentStepNumber} of 4
                    </span>
                </div>
            </header>

            {/* PROGRESS STEPPER (Demo-style interactive floating pill bar) */}
            <div className="w-full max-w-3xl mx-auto px-4 pt-6 pb-2 z-20">
                <div className="relative flex items-center justify-between p-2 rounded-2xl bg-white/90 border border-slate-200/80 backdrop-blur-xl shadow-xs">
                    <div className="absolute top-1/2 left-8 right-8 -translate-y-1/2 h-[2px] bg-slate-100 z-0" />
                    {STEPS_NAV.map((m) => {
                        const stepOrder: OnboardingStep[] = ['payment', 'profile', 'integrations', 'templates'];
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
                                            setStep('templates');
                                        }}
                                        className="text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors py-2 px-3 cursor-pointer"
                                    >
                                        Skip account connection &rarr;
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => {
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
                        STEP 3: SELECT REFERENCE DESIGN BLUEPRINTS (UP TO 10 TEMPLATES) (UP TO 10 TEMPLATES)
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
                                            Step 3 &bull; Your Brand
                                        </span>
                                    </div>
                                    {/*
                                      This step used to be a gallery of the 35 built-in Dubai property designs, pre-selected
                                      with the first five, and the choice was saved as `selected_templates`. The operator's
                                      rule is that those designs are for no other account, so the gallery is gone — and with
                                      every reader removed from the generation paths, the stored preference no longer means
                                      anything either. What is left is the truth: upload your own references, set your brand.
                                    */}
                                    <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                                        How your creatives get their look
                                    </h1>
                                    <p className="text-sm text-slate-500 mt-1 max-w-2xl leading-relaxed">
                                        Two things decide it — the reference designs you upload, and the brand kit you set. Nothing else.
                                    </p>
                                </div>
                            </div>

                            {/* Designs come from this account, never from the built-in bank */}
                            <div className="rounded-2xl border border-blue-200/80 bg-gradient-to-br from-blue-50 to-indigo-50 p-5 sm:p-6 space-y-3">
                                <div className="flex items-center gap-2">
                                    <Layers size={16} className="text-blue-600" />
                                    <h2 className="text-sm sm:text-base font-extrabold text-slate-900">Your creatives are built from your own designs</h2>
                                </div>
                                <p className="text-xs sm:text-sm text-slate-600 font-medium leading-relaxed">
                                    There is no style bank to pick from here. Every creative is made from the reference designs
                                    <strong> you </strong> upload, from your brand kit, and from the product data in your account.
                                    Nothing is borrowed from another business, and nothing comes from another industry.
                                </p>
                                <ul className="space-y-1.5 text-xs text-slate-600 font-medium">
                                    <li className="flex items-start gap-2">
                                        <Check size={13} className="text-emerald-600 mt-0.5 shrink-0" />
                                        Upload the designs you like in your Reference Library — they rotate automatically.
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <Check size={13} className="text-emerald-600 mt-0.5 shrink-0" />
                                        Set your colours and standing rules in Profile &rarr; Brand Kit, and every creative follows them.
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <Check size={13} className="text-emerald-600 mt-0.5 shrink-0" />
                                        With neither on file, the AI writes its own layout from your business data.
                                    </li>
                                </ul>
                                <div className="flex flex-wrap items-center gap-2 pt-1">
                                    <a
                                        href="/dashboard/reference-library"
                                        className="inline-flex items-center gap-1.5 rounded-xl bg-white border border-blue-200 px-3.5 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50 transition-colors"
                                    >
                                        Open Reference Library
                                    </a>
                                    <a
                                        href="/dashboard/profile/brand"
                                        className="inline-flex items-center gap-1.5 rounded-xl bg-white border border-slate-200 px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                                    >
                                        Set up Brand Kit
                                    </a>
                                </div>
                            </div>
                            {/* Footer Navigation */}
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
                                        onClick={handleSaveTemplatesAndContinue}
                                        disabled={isSavingTemplates}
                                        className="w-full sm:w-auto px-7 py-3 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-700 hover:to-indigo-800 disabled:opacity-50 text-white font-extrabold text-xs uppercase tracking-wider transition-all shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/35 active:scale-98 flex items-center justify-center gap-2 cursor-pointer"
                                    >
                                        {isSavingTemplates ? (
                                            <>
                                                <Loader2 size={15} className="animate-spin" />
                                                <span>Saving Preferences...</span>
                                            </>
                                        ) : (
                                            <>
                                                <span>Next: Activate Plan</span>
                                                <ArrowRight size={15} />
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {/* =========================================================================
                        STEP 4: CHOOSE YOUR PLAN & PAYMENT (OR SKIP)
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
                                    <Crown size={14} className="text-emerald-600" /> Step 1 &bull; Activate Plan
                                </span>
                                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
                                    Activate Your Growth Workspace
                                </h1>
                                <p className="text-xs sm:text-sm text-slate-500 mt-1.5 leading-relaxed">
                                    Choose a plan to unlock AI creative generation, WhatsApp chatbot flows and Meta Ads
                                    management. Setup takes a few minutes once your plan is active.
                                </p>
                            </div>

                            {/* Renewal disclosure — the one place it is stated. The plan label is simply
                                "1 Month (₹9,999)"; this line is what keeps the auto-renewal honest for
                                Razorpay's mandate rules and for the customer. */}
                            <p className="text-[10px] leading-relaxed text-slate-400 text-center max-w-2xl mx-auto">
                                The 1 Month plan renews every month at ₹9,999 until you cancel. Cancel any time from
                                Billing — access continues to the end of the paid month. Prices exclude 18% GST.
                            </p>

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
                                            Experience the full power of Nobogent AI for 7 full days with 1,000 platform credits, AI videos, creatives, and chatbot.
                                        </p>
                                        <div className="flex flex-wrap gap-x-5 gap-y-1.5 pt-1 text-[11px] text-indigo-100 font-semibold">
                                            <span className="flex items-center gap-1.5"><Check size={14} className="text-amber-400" /> 7 Full Days Access</span>
                                            <span className="flex items-center gap-1.5"><Check size={14} className="text-amber-400" /> 1,000 Credits</span>
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
                            <div className="grid grid-cols-1 gap-6 pt-2 max-w-md mx-auto">
                                {/* One plan, by design: 1 Month / ₹9,999 / 5,000 credits. */}
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
                                                Cancel anytime
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
                                        Choose 1 Month (₹9,999)
                                    </button>
                                </div>

                                {/* 6-month and 12-month plans were removed from the offer: the product is
                                    one plan (1 Month, 5,000 credits) plus the one-off 7-day trial. Their
                                    cards advertised 25,000 / 100,000 credits at per-credit rates that no
                                    longer matched the monthly plan. The configs remain in
                                    utils/razorpay.ts so an existing subscriber's renewal still resolves. */}

                            </div>

                            {/* Skip Payment Option Banner */}
                            <div className="pt-6 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-50/70 p-4 rounded-2xl border border-slate-100">
                                <button
                                    type="button"
                                    onClick={() => {
                                        playChime('beep');
                                        setStep('templates');
                                    }}
                                    className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 shadow-2xs transition-all cursor-pointer"
                                >
                                    &larr; Back to Design Styles
                                </button>
                                <span className="text-xs text-slate-500 font-medium flex items-center gap-1.5">
                                    <ShieldCheck size={15} className="text-emerald-600" />
                                    Secure payments encrypted by Razorpay (UPI, Credit/Debit Cards, NetBanking).
                                </span>

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
