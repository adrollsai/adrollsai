'use client';

import { useState } from 'react';
import { toast } from 'sonner';

interface RazorpayCheckoutOptions {
    planId?: string;
    packageId?: string;
    addonId?: string;
    customAmount?: number;
    customCredits?: number;
    onSuccess?: (data: any) => void;
    onError?: (error: any) => void;
    onDismiss?: () => void;
}

declare global {
    interface Window {
        Razorpay: any;
    }
}

/**
 * Dynamically loads the official Razorpay Checkout v1 script
 */
export function loadRazorpayScript(): Promise<boolean> {
    return new Promise((resolve) => {
        if (typeof window === 'undefined') {
            resolve(false);
            return;
        }

        if (window.Razorpay) {
            resolve(true);
            return;
        }

        const existingScript = document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
        if (existingScript) {
            existingScript.addEventListener('load', () => resolve(true));
            existingScript.addEventListener('error', () => resolve(false));
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.async = true;
        script.onload = () => resolve(true);
        script.onerror = () => {
            console.error('Failed to load Razorpay SDK');
            resolve(false);
        };
        document.body.appendChild(script);
    });
}

export function useRazorpay() {
    const [isProcessing, setIsProcessing] = useState(false);

    const openCheckout = async (options: RazorpayCheckoutOptions) => {
        setIsProcessing(true);
        const toastId = toast.loading('Initializing secure payment desk...');

        try {
            // 1. Ensure Razorpay script is loaded
            const isLoaded = await loadRazorpayScript();
            if (!isLoaded) {
                toast.dismiss(toastId);
                toast.error('Unable to connect to Razorpay. Please check your internet connection.');
                setIsProcessing(false);
                options.onError?.(new Error('Razorpay SDK failed to load'));
                return;
            }

            // 2. Create Order on Backend
            const orderRes = await fetch('/api/payment/razorpay/create-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    planId: options.planId,
                    packageId: options.packageId,
                    addonId: options.addonId,
                    customAmount: options.customAmount,
                    customCredits: options.customCredits
                })
            });

            const orderData = await orderRes.json();

            if (!orderRes.ok || !orderData.orderId) {
                toast.dismiss(toastId);
                const errMsg = orderData.error || 'Failed to initialize payment order.';
                toast.error(errMsg);
                setIsProcessing(false);
                options.onError?.(new Error(errMsg));
                return;
            }

            toast.dismiss(toastId);

            // 3. Open Razorpay Checkout Modal
            const rzpOptions = {
                key: orderData.keyId,
                amount: orderData.amount,
                currency: orderData.currency || 'INR',
                name: 'Nobogent AI',
                description: orderData.itemName || 'Nobogent Subscription / Credits',
                image: 'https://app.nobogent.com/favicon.ico',
                order_id: orderData.orderId,
                prefill: {
                    name: orderData.prefill?.name || '',
                    email: orderData.prefill?.email || '',
                    contact: orderData.prefill?.contact || ''
                },
                notes: orderData.notes,
                theme: {
                    color: '#4F46E5', // Indigo-600 to match Nobogent theme
                    backdrop_color: 'rgba(15, 23, 42, 0.75)'
                },
                modal: {
                    ondismiss: () => {
                        setIsProcessing(false);
                        options.onDismiss?.();
                    },
                    confirm_close: true,
                    animation: true
                },
                handler: async (response: {
                    razorpay_payment_id: string;
                    razorpay_order_id: string;
                    razorpay_signature: string;
                }) => {
                    const verifyToastId = toast.loading('Verifying payment and activating features...');
                    try {
                        const verifyRes = await fetch('/api/payment/razorpay/verify', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                razorpay_order_id: response.razorpay_order_id,
                                razorpay_payment_id: response.razorpay_payment_id,
                                razorpay_signature: response.razorpay_signature,
                                planId: options.planId,
                                packageId: options.packageId,
                                addonId: options.addonId,
                                customCredits: options.customCredits
                            })
                        });

                        const verifyData = await verifyRes.json();

                        if (!verifyRes.ok || !verifyData.success) {
                            toast.dismiss(verifyToastId);
                            toast.error(verifyData.error || 'Payment verification failed. Please reach out to support.');
                            options.onError?.(new Error(verifyData.error));
                            return;
                        }

                        toast.dismiss(verifyToastId);
                        toast.success(verifyData.message || 'Payment successful! Your account has been upgraded.', {
                            duration: 6000
                        });

                        options.onSuccess?.(verifyData);
                    } catch (verifyError: any) {
                        toast.dismiss(verifyToastId);
                        toast.error('Network error while verifying payment.');
                        options.onError?.(verifyError);
                    } finally {
                        setIsProcessing(false);
                    }
                }
            };

            const paymentInstance = new window.Razorpay(rzpOptions);

            paymentInstance.on('payment.failed', function (response: any) {
                console.error('[Razorpay Payment Failed]', response.error);
                toast.error(`Payment failed: ${response.error.description || 'Transaction declined'}`);
                setIsProcessing(false);
                options.onError?.(response.error);
            });

            paymentInstance.open();

        } catch (err: any) {
            toast.dismiss(toastId);
            toast.error(err?.message || 'An unexpected error occurred.');
            setIsProcessing(false);
            options.onError?.(err);
        }
    };

    return {
        openCheckout,
        isProcessing
    };
}
