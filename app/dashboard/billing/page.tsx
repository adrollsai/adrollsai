'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Check, Loader2, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';

const PLANS = [
    {
        id: 'starter',
        name: 'Starter',
        price: 4999,
        description: 'Perfect for independent agents starting out.',
        features: [
            'Basic CRM Access',
            'Up to 500 Leads/month',
            'Standard Email Support',
            'Basic Analytics'
        ],
        isPopular: false
    },
    {
        id: 'professional',
        name: 'Professional',
        price: 9999,
        description: 'Everything you need to scale your real estate business.',
        features: [
            'Advanced CRM Features',
            'Unlimited Leads',
            'Meta Ads Integration',
            'Automated Lead Distribution',
            'Priority WhatsApp Support'
        ],
        isPopular: true
    },
    {
        id: 'enterprise',
        name: 'Enterprise',
        price: 14999,
        description: 'Advanced tools for large agencies and teams.',
        features: [
            'White-label CRM Options',
            'Custom API Integrations',
            'Multi-Agent Management',
            'Dedicated Account Manager',
            '24/7 Phone Support'
        ],
        isPopular: false
    }
];

function BillingContent() {
    const searchParams = useSearchParams();
    const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
    const [verifying, setVerifying] = useState(false);
    const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'loading', text: string } | null>(null);

    useEffect(() => {
        const verifyPayment = async () => {
            const paymentStatus = searchParams.get('payment');
            const txnId = searchParams.get('txnId');
            const planId = searchParams.get('planId');

            if (paymentStatus === 'success' && txnId) {
                setVerifying(true);
                setStatusMessage({ type: 'loading', text: 'Verifying your payment securely with PhonePe...' });

                try {
                    const response = await fetch('/api/payment/verify', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ transactionId: txnId, planId: planId })
                    });
                    
                    const data = await response.json();

                    if (data.success) {
                        setStatusMessage({ type: 'success', text: 'Payment successful! Redirecting to your dashboard...' });
                        
                        // Clean the URL so a page refresh doesn't re-trigger the check
                        window.history.replaceState(null, '', '/dashboard/billing');
                        
                        // Redirect to dashboard after a brief delay
                        setTimeout(() => {
                            window.location.href = '/dashboard';
                        }, 1500);
                    } else {
                        setStatusMessage({ type: 'error', text: 'Payment verification failed or is pending. Please contact support if amount was deducted.' });
                    }
                } catch (error) {
                    setStatusMessage({ type: 'error', text: 'Network error during verification. Please contact support.' });
                } finally {
                    setVerifying(false);
                }
            }
        };

        verifyPayment();
    }, [searchParams]);

    const handleCheckout = async (planId: string) => {
        setLoadingPlan(planId);
        setStatusMessage(null);
        
        try {
            const response = await fetch('/api/payment/initiate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ planId })
            });

            const data = await response.json();
            
            if (data.url) {
                // Redirect user to PhonePe's secure payment page
                window.location.href = data.url; 
            } else {
                setStatusMessage({
                    type: 'error',
                    text: data.error || 'Payment initiation failed. Please try again.'
                });
            }
        } catch (error) {
            console.error("Checkout error:", error);
            setStatusMessage({
                type: 'error',
                text: 'A network error occurred. Please try again.'
            });
        } finally {
            setLoadingPlan(null);
        }
    };

    return (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="text-center mb-12">
                <h1 className="text-3xl font-bold text-gray-900 sm:text-4xl">
                    Simple, transparent pricing
                </h1>
                <p className="mt-4 text-xl text-gray-600">
                    Choose the perfect plan to accelerate your real estate growth.
                </p>
            </div>

            {/* Status Messages */}
            {statusMessage && (
                <div className={`mb-8 p-4 rounded-lg flex items-center justify-center max-w-3xl mx-auto ${
                    statusMessage.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 
                    statusMessage.type === 'error' ? 'bg-red-50 text-red-800 border border-red-200' :
                    'bg-blue-50 text-blue-800 border border-blue-200'
                }`}>
                    {statusMessage.type === 'success' && <CheckCircle2 className="w-5 h-5 mr-2 text-green-600" />}
                    {statusMessage.type === 'error' && <AlertCircle className="w-5 h-5 mr-2 text-red-600" />}
                    {statusMessage.type === 'loading' && <RefreshCw className="w-5 h-5 mr-2 text-blue-600 animate-spin" />}
                    <span className="font-medium">{statusMessage.text}</span>
                </div>
            )}

            {/* Pricing Cards */}
            <div className={`grid grid-cols-1 md:grid-cols-3 gap-8 max-w-7xl mx-auto transition-opacity duration-300 ${verifying ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
                {PLANS.map((plan) => (
                    <div 
                        key={plan.id}
                        className={`relative flex flex-col p-8 bg-white rounded-2xl border ${
                            plan.isPopular ? 'border-blue-600 shadow-xl scale-105 z-10' : 'border-gray-200 shadow-sm'
                        }`}
                    >
                        {plan.isPopular && (
                            <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                                <span className="bg-blue-600 text-white px-3 py-1 rounded-full text-sm font-semibold tracking-wide">
                                    Most Popular
                                </span>
                            </div>
                        )}

                        <div className="mb-8">
                            <h3 className="text-2xl font-semibold text-gray-900">{plan.name}</h3>
                            <p className="mt-2 text-gray-500 h-12">{plan.description}</p>
                            <div className="mt-6 flex items-baseline text-5xl font-extrabold text-gray-900">
                                ₹{plan.price.toLocaleString('en-IN')}
                                <span className="ml-1 text-xl font-medium text-gray-500">/mo</span>
                            </div>
                            <p className="mt-2 text-sm text-gray-400">+ 18% GST applied at checkout</p>
                        </div>

                        <ul className="flex-1 space-y-4 mb-8">
                            {plan.features.map((feature, index) => (
                                <li key={index} className="flex items-start">
                                    <Check className="flex-shrink-0 w-5 h-5 text-green-500 mr-3" />
                                    <span className="text-gray-600">{feature}</span>
                                </li>
                            ))}
                        </ul>

                        <button
                            onClick={() => handleCheckout(plan.id)}
                            disabled={loadingPlan !== null || verifying}
                            className={`w-full py-4 px-6 rounded-xl font-semibold text-lg transition-all duration-200 flex items-center justify-center ${
                                plan.isPopular
                                    ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-md'
                                    : 'bg-gray-100 hover:bg-gray-200 text-gray-900'
                            } ${loadingPlan !== null ? 'opacity-70 cursor-not-allowed' : ''}`}
                        >
                            {loadingPlan === plan.id ? (
                                <>
                                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                                    Processing...
                                </>
                            ) : (
                                `Get ${plan.name}`
                            )}
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}

// Wrapping in Suspense to prevent Next.js build errors related to useSearchParams
export default function BillingPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        }>
            <BillingContent />
        </Suspense>
    );
}