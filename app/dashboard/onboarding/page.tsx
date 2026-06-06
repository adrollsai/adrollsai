'use client'

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { 
    Sparkles, 
    Building2, 
    Package, 
    Upload, 
    ArrowRight, 
    CheckCircle2, 
    Loader2, 
    Video, 
    Image as ImageIcon,
    Volume2,
    VolumeX,
    Play
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { uploadToR2 } from '@/utils/upload-helper';
import { toast } from 'sonner';

export default function OnboardingPage() {
    const router = useRouter();
    
    // Steps: 'company' | 'product' | 'generating'
    const [step, setStep] = useState<'company' | 'product' | 'generating'>('company');
    
    // Company profile state
    const [companyName, setCompanyName] = useState('');
    const [companyDescription, setCompanyDescription] = useState('');
    const [logoUrl, setLogoUrl] = useState('');
    const [uploadingLogo, setUploadingLogo] = useState(false);
    const logoInputRef = useRef<HTMLInputElement>(null);

    // Product state
    const [productTitle, setProductTitle] = useState('');
    const [productDescription, setProductDescription] = useState('');
    const [productPrice, setProductPrice] = useState('');
    const [productImageUrl, setProductImageUrl] = useState('');
    const [uploadingProductImage, setUploadingProductImage] = useState(false);
    const productInputRef = useRef<HTMLInputElement>(null);

    // Generation states
    const [generatingAssets, setGeneratingAssets] = useState(false);
    const [generationFinished, setGenerationFinished] = useState(false);
    const [progressStep, setProgressStep] = useState(0); // 0: Idle, 1: Profile, 2: Product, 3: Generation triggers

    // Walkthrough video states
    const [isVideoMuted, setIsVideoMuted] = useState(true);
    const [videoPlaying, setVideoPlaying] = useState(true);
    const videoRef = useRef<HTMLVideoElement>(null);

    // Handle File Uploads
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

    // Submit Onboarding details and trigger generations
    const handleOnboardingSubmit = async () => {
        setStep('generating');
        setGeneratingAssets(true);
        setProgressStep(1);

        try {
            // Step 1: Simulating saving profile
            await new Promise(r => setTimeout(r, 1500));
            setProgressStep(2);

            // Step 2: Simulating saving product details
            await new Promise(r => setTimeout(r, 1500));
            setProgressStep(3);

            // Step 3: Trigger backend API
            const res = await fetch('/api/onboarding/complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    companyName,
                    companyDescription,
                    logoUrl,
                    productTitle,
                    productDescription,
                    productPrice,
                    productImageUrl
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to trigger creative generations");

            await new Promise(r => setTimeout(r, 1000));
            setProgressStep(4);
            setGenerationFinished(true);
            toast.success("AI creative generation started in production! 🚀");

        } catch (err: any) {
            console.error("Onboarding execution failed:", err);
            toast.error("Creative generation failed to start: " + err.message);
            setStep('product');
        } finally {
            setGeneratingAssets(false);
        }
    };

    const toggleVideoMute = () => {
        if (videoRef.current) {
            videoRef.current.muted = !videoRef.current.muted;
            setIsVideoMuted(videoRef.current.muted);
        }
    };

    const togglePlayPause = () => {
        if (videoRef.current) {
            if (videoPlaying) {
                videoRef.current.pause();
            } else {
                videoRef.current.play();
            }
            setVideoPlaying(!videoPlaying);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col justify-between font-sans relative overflow-hidden">
            {/* Background decorative glows */}
            <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-[#00487c]/5 blur-[120px] pointer-events-none" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-[#a81d33]/5 blur-[120px] pointer-events-none" />
            <div className="absolute top-[30%] right-[10%] w-[35%] h-[35%] rounded-full bg-[#e5a92a]/5 blur-[120px] pointer-events-none" />

            {/* Header */}
            <header className="w-full max-w-7xl mx-auto px-6 py-5 flex items-center justify-between z-10 border-b border-slate-100 bg-white/40 backdrop-blur-md">
                <div className="flex items-center gap-2">
                    <img src="/logo.png" alt="adRolls" className="h-9 sm:h-11 w-auto object-contain" />
                </div>
                {step !== 'generating' && (
                    <div className="flex gap-3 items-center">
                        <span className="text-xs font-bold text-[#00487c] uppercase tracking-wider">Step {step === 'company' ? '1 of 2' : '2 of 2'}</span>
                        <div className="flex gap-1.5">
                            <div className={`h-2 w-6 rounded-full transition-all duration-300 ${step === 'company' ? 'bg-[#a81d33]' : 'bg-slate-200'}`} />
                            <div className={`h-2 w-6 rounded-full transition-all duration-300 ${step === 'product' ? 'bg-[#a81d33]' : 'bg-slate-200'}`} />
                        </div>
                    </div>
                )}
            </header>

            {/* Main Content container */}
            <main className="flex-1 w-full max-w-4xl mx-auto px-6 py-10 flex flex-col justify-center z-10">
                <AnimatePresence mode="wait">
                    {step === 'company' && (
                        <motion.div
                            key="company-step"
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -15 }}
                            transition={{ duration: 0.3 }}
                            className="w-full"
                        >
                            <div className="mb-8 text-center md:text-left">
                                <h1 className="text-3xl sm:text-4xl font-black tracking-tight leading-none text-[#00487c]">
                                    Tell us about your brand
                                </h1>
                                <p className="text-sm text-slate-600 font-medium mt-2 leading-relaxed">
                                    We need your business info and brand logo to formulate personalized high-converting ad assets.
                                </p>
                            </div>

                            <div className="bg-white/90 backdrop-blur-xl border border-slate-200/80 rounded-[2.5rem] p-6 sm:p-10 space-y-6 shadow-[0_8px_30px_rgb(0,0,0,0.03)] shadow-slate-200/50">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                                    {/* Logo Upload Section */}
                                    <div className="md:col-span-1 flex flex-col items-center justify-center">
                                        <label className="text-xs font-black uppercase tracking-wider text-[#00487c] mb-3 block self-start">Company Logo</label>
                                        <div 
                                            onClick={() => logoInputRef.current?.click()}
                                            className="w-40 h-40 rounded-[2rem] border-2 border-dashed border-slate-200 hover:border-[#a81d33] hover:bg-slate-50 transition-all cursor-pointer flex flex-col items-center justify-center overflow-hidden group relative bg-slate-50/50"
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
                                                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 group-hover:text-[#a81d33]">Upload Logo</span>
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
                                    </div>

                                    {/* Company Details fields */}
                                    <div className="md:col-span-2 space-y-5">
                                        <div>
                                            <label htmlFor="company-name" className="text-xs font-black uppercase tracking-wider text-[#00487c] block mb-2">Company Name</label>
                                            <input 
                                                id="company-name"
                                                type="text"
                                                value={companyName}
                                                onChange={(e) => setCompanyName(e.target.value)}
                                                placeholder="e.g. Acme Corporation"
                                                className="w-full bg-slate-50/50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#00487c] focus:ring-1 focus:ring-[#00487c]/25 transition-all shadow-sm"
                                            />
                                        </div>

                                        <div>
                                            <label htmlFor="company-desc" className="text-xs font-black uppercase tracking-wider text-[#00487c] block mb-2">Company Description / Mission</label>
                                            <textarea 
                                                id="company-desc"
                                                rows={4}
                                                value={companyDescription}
                                                onChange={(e) => setCompanyDescription(e.target.value)}
                                                placeholder="What does your company do? (e.g. We provide organic, farm-fresh ingredients to health-conscious families...)"
                                                className="w-full bg-slate-50/50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#00487c] focus:ring-1 focus:ring-[#00487c]/25 transition-all resize-none shadow-sm"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="flex justify-end pt-4 border-t border-slate-100">
                                    <button
                                        onClick={() => setStep('product')}
                                        disabled={!companyName || !companyDescription}
                                        className="bg-gradient-to-r from-[#00487c] to-[#a81d33] hover:opacity-95 active:scale-[0.98] disabled:opacity-30 disabled:pointer-events-none text-white font-black text-sm uppercase tracking-wider px-8 py-4 rounded-2xl transition-all shadow-md flex items-center gap-2"
                                    >
                                        Next Step <ArrowRight size={16} />
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {step === 'product' && (
                        <motion.div
                            key="product-step"
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -15 }}
                            transition={{ duration: 0.3 }}
                            className="w-full"
                        >
                            <div className="mb-8 text-center md:text-left">
                                <h1 className="text-3xl sm:text-4xl font-black tracking-tight leading-none text-[#00487c]">
                                    Add your first product
                                </h1>
                                <p className="text-sm text-slate-600 font-medium mt-2 leading-relaxed">
                                    Provide details of a product or service you want to create ad creatives and video templates for.
                                </p>
                            </div>

                            <div className="bg-white/90 backdrop-blur-xl border border-slate-200/80 rounded-[2.5rem] p-6 sm:p-10 space-y-6 shadow-[0_8px_30px_rgb(0,0,0,0.03)] shadow-slate-200/50">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                                    {/* Product Image Section */}
                                    <div className="md:col-span-1 flex flex-col items-center justify-center">
                                        <label className="text-xs font-black uppercase tracking-wider text-[#00487c] mb-3 block self-start">Product Image</label>
                                        <div 
                                            onClick={() => productInputRef.current?.click()}
                                            className="w-40 h-40 rounded-[2rem] border-2 border-dashed border-slate-200 hover:border-[#a81d33] hover:bg-slate-50 transition-all cursor-pointer flex flex-col items-center justify-center overflow-hidden group relative bg-slate-50/50"
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
                                                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 group-hover:text-[#a81d33]">Upload Image</span>
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
                                    </div>

                                    {/* Product details fields */}
                                    <div className="md:col-span-2 space-y-5">
                                        <div className="grid grid-cols-3 gap-4">
                                            <div className="col-span-2">
                                                <label htmlFor="product-title" className="text-xs font-black uppercase tracking-wider text-[#00487c] block mb-2">Product Name</label>
                                                <input 
                                                    id="product-title"
                                                    type="text"
                                                    value={productTitle}
                                                    onChange={(e) => setProductTitle(e.target.value)}
                                                    placeholder="e.g. Premium Wireless Headphones"
                                                    className="w-full bg-slate-50/50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#00487c] focus:ring-1 focus:ring-[#00487c]/25 transition-all shadow-sm"
                                                />
                                            </div>
                                            <div className="col-span-1">
                                                <label htmlFor="product-price" className="text-xs font-black uppercase tracking-wider text-[#00487c] block mb-2">Price (Optional)</label>
                                                <input 
                                                    id="product-price"
                                                    type="text"
                                                    value={productPrice}
                                                    onChange={(e) => setProductPrice(e.target.value)}
                                                    placeholder="e.g. ₹4,999"
                                                    className="w-full bg-slate-50/50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#00487c] focus:ring-1 focus:ring-[#00487c]/25 transition-all shadow-sm"
                                                />
                                            </div>
                                        </div>

                                        <div>
                                            <label htmlFor="product-desc" className="text-xs font-black uppercase tracking-wider text-[#00487c] block mb-2">Product Description / Core Features</label>
                                            <textarea 
                                                id="product-desc"
                                                rows={4}
                                                value={productDescription}
                                                onChange={(e) => setProductDescription(e.target.value)}
                                                placeholder="Provide details about the product's value proposition, features, and advantages..."
                                                className="w-full bg-slate-50/50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#00487c] focus:ring-1 focus:ring-[#00487c]/25 transition-all resize-none shadow-sm"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="flex justify-between pt-4 border-t border-slate-100">
                                    <button
                                        onClick={() => setStep('company')}
                                        className="text-slate-500 hover:text-[#00487c] font-black text-sm uppercase tracking-wider px-6 py-4 rounded-2xl transition-all"
                                    >
                                        Back
                                    </button>
                                    <button
                                        onClick={handleOnboardingSubmit}
                                        disabled={!productTitle || !productDescription}
                                        className="bg-gradient-to-r from-[#00487c] to-[#a81d33] hover:opacity-95 active:scale-[0.98] disabled:opacity-30 disabled:pointer-events-none text-white font-black text-sm uppercase tracking-wider px-8 py-4 rounded-2xl transition-all shadow-md flex items-center gap-2"
                                    >
                                        Generate Creatives <Sparkles size={16} />
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {step === 'generating' && (
                        <motion.div
                            key="generating-step"
                            initial={{ opacity: 0, scale: 0.98 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.3 }}
                            className="w-full grid grid-cols-1 md:grid-cols-12 gap-8 items-center"
                        >
                            {/* Left: Product Walkthrough Video Player */}
                            <div className="md:col-span-7 flex flex-col gap-3">
                                <span className="text-xs font-black uppercase tracking-widest text-[#a81d33]">Walkthrough Preview</span>
                                <h2 className="text-xl font-bold tracking-tight mb-1 text-[#00487c]">Learn how to maximize your campaigns in AdRolls</h2>
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
                                    {/* Custom Controls overlays */}
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end justify-between p-6">
                                        <button 
                                            onClick={togglePlayPause}
                                            className="w-10 h-10 rounded-full bg-white/25 hover:bg-white/35 backdrop-blur-md flex items-center justify-center text-white transition-all active:scale-95"
                                        >
                                            {videoPlaying ? <Square size={16} fill="white" /> : <Play size={16} fill="white" className="ml-0.5" />}
                                        </button>
                                        
                                        <button 
                                            onClick={toggleVideoMute}
                                            className="w-10 h-10 rounded-full bg-white/25 hover:bg-white/35 backdrop-blur-md flex items-center justify-center text-white transition-all active:scale-95"
                                        >
                                            {isVideoMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Right: Step Status Check list */}
                            <div className="md:col-span-5 bg-white/80 backdrop-blur-xl border border-slate-200/80 rounded-[2.5rem] p-8 shadow-xl shadow-slate-100/50 flex flex-col justify-between self-stretch min-h-[320px]">
                                <div>
                                    <h3 className="text-lg font-black tracking-tight text-[#00487c] mb-6">Setting Up Workspace</h3>
                                    
                                    <div className="space-y-5">
                                        {/* Status Row 1 */}
                                        <div className="flex items-center gap-3.5">
                                            {progressStep > 1 ? (
                                                <CheckCircle2 size={18} className="text-[#e5a92a] shrink-0" />
                                            ) : progressStep === 1 ? (
                                                <Loader2 size={18} className="text-[#a81d33] animate-spin shrink-0" />
                                            ) : (
                                                <div className="w-[18px] h-[18px] rounded-full border-2 border-slate-200 shrink-0 bg-slate-50" />
                                            )}
                                            <span className={`text-xs font-semibold ${progressStep >= 1 ? 'text-slate-800' : 'text-slate-400'}`}>Saving company details...</span>
                                        </div>

                                        {/* Status Row 2 */}
                                        <div className="flex items-center gap-3.5">
                                            {progressStep > 2 ? (
                                                <CheckCircle2 size={18} className="text-[#e5a92a] shrink-0" />
                                            ) : progressStep === 2 ? (
                                                <Loader2 size={18} className="text-[#a81d33] animate-spin shrink-0" />
                                            ) : (
                                                <div className="w-[18px] h-[18px] rounded-full border-2 border-slate-200 shrink-0 bg-slate-50" />
                                            )}
                                            <span className={`text-xs font-semibold ${progressStep >= 2 ? 'text-slate-800' : 'text-slate-400'}`}>Adding product listing...</span>
                                        </div>

                                        {/* Status Row 3 */}
                                        <div className="flex items-center gap-3.5">
                                            {progressStep > 3 ? (
                                                <CheckCircle2 size={18} className="text-[#e5a92a] shrink-0" />
                                            ) : progressStep === 3 ? (
                                                <Loader2 size={18} className="text-[#a81d33] animate-spin shrink-0" />
                                            ) : (
                                                <div className="w-[18px] h-[18px] rounded-full border-2 border-slate-200 shrink-0 bg-slate-50" />
                                            )}
                                            <span className={`text-xs font-semibold ${progressStep >= 3 ? 'text-slate-800' : 'text-slate-400'}`}>Triggering AI creations (3 Creatives, 1 Video)...</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-8 pt-6 border-t border-slate-100">
                                    <button
                                        onClick={() => router.push('/dashboard/assets')}
                                        disabled={!generationFinished}
                                        className="w-full bg-gradient-to-r from-[#00487c] to-[#a81d33] hover:opacity-95 active:scale-[0.98] disabled:opacity-30 disabled:pointer-events-none text-white font-black text-sm uppercase tracking-wider py-4 rounded-2xl transition-all shadow-md flex items-center justify-center gap-2"
                                    >
                                        {generationFinished ? (
                                            <>
                                                Enter Dashboard <ArrowRight size={16} />
                                            </>
                                        ) : (
                                            <>
                                                <Loader2 size={16} className="animate-spin" /> Cooking your assets...
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </main>

            {/* Footer */}
            <footer className="w-full max-w-7xl mx-auto px-6 py-6 text-center z-10">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">&copy; 2026 AdRolls Professional, Inc. All rights reserved.</p>
            </footer>
        </div>
    );
}

// Simple placeholder controls helper definitions
const Square = ({ size, fill, className }: { size: number, fill?: string, className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill={fill || "none"} stroke="currentColor" strokeWidth="2" className={className}>
        <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
);
