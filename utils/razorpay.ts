import Razorpay from 'razorpay';
import crypto from 'crypto';

export const RAZORPAY_KEY_ID = (process.env.RAZORPAY_KEY_ID || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || '').trim();
export const RAZORPAY_KEY_SECRET = (process.env.RAZORPAY_KEY_SECRET || '').trim();
export const RAZORPAY_WEBHOOK_SECRET = (process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();
export const RAZORPAY_ENV = (process.env.RAZORPAY_ENV || 'test').trim();

let razorpayInstance: Razorpay | null = null;

export function getRazorpayClient(): Razorpay {
    if (!razorpayInstance) {
        if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
            console.warn('[Razorpay] Warning: RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is not configured.');
        }
        razorpayInstance = new Razorpay({
            key_id: RAZORPAY_KEY_ID,
            key_secret: RAZORPAY_KEY_SECRET,
        });
    }
    return razorpayInstance;
}

/**
 * Verifies Razorpay checkout signature:
 * generated_signature = hmac_sha256(order_id + "|" + razorpay_payment_id, secret)
 */
export function verifyRazorpaySignature(
    orderId: string,
    paymentId: string,
    razorpaySignature: string,
    secret: string = RAZORPAY_KEY_SECRET
): boolean {
    if (!orderId || !paymentId || !razorpaySignature || !secret) {
        return false;
    }
    const body = `${orderId}|${paymentId}`;
    const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex');

    return expectedSignature === razorpaySignature;
}

/**
 * Verifies Razorpay webhook signature (X-Razorpay-Signature)
 */
export function verifyRazorpayWebhookSignature(
    bodyText: string,
    receivedSignature: string,
    webhookSecret: string = RAZORPAY_WEBHOOK_SECRET
): boolean {
    if (!bodyText || !receivedSignature || !webhookSecret) {
        return false;
    }
    const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(bodyText)
        .digest('hex');

    return expectedSignature === receivedSignature;
}

export interface RazorpayPlanConfig {
    id: string;
    title: string;
    durationMonths: number;
    basePrice: number;
    gstRate: number; // 0.18 for 18% GST
    totalPrice: number;
    creditsIncluded: number;
    description: string;
}

export const RAZORPAY_PLANS: Record<string, RazorpayPlanConfig> = {
    '1-month': {
        id: '1-month',
        title: '1 MONTH PLAN',
        durationMonths: 1,
        basePrice: 9999,
        gstRate: 0.18,
        totalPrice: Math.round(9999 * 1.18), // ₹11,799
        creditsIncluded: 10000,
        description: 'Nobogent Pro Plan (1 Month Subscription)'
    },
    '6-months': {
        id: '6-months',
        title: '6 MONTHS PLAN',
        durationMonths: 6,
        basePrice: 54999,
        gstRate: 0.18,
        totalPrice: Math.round(54999 * 1.18), // ₹64,899
        creditsIncluded: 25000,
        description: 'Nobogent Pro Plan (6 Months Subscription)'
    },
    '12-months': {
        id: '12-months',
        title: '12 MONTHS PLAN',
        durationMonths: 12,
        basePrice: 99999,
        gstRate: 0.18,
        totalPrice: Math.round(99999 * 1.18), // ₹117,999
        creditsIncluded: 100000,
        description: 'Nobogent Pro Plan (12 Months Subscription)'
    }
};

export interface RazorpayCreditPackageConfig {
    id: string;
    name: string;
    basePrice: number;
    amount: number; // in INR including 18% GST
    credits: number;
    description: string;
}

export const RAZORPAY_CREDIT_PACKAGES: Record<string, RazorpayCreditPackageConfig> = {
    'starter': {
        id: 'starter',
        name: 'Starter Pack',
        basePrice: 2000,
        amount: Math.round(2000 * 1.18), // ₹2,360
        credits: 2000,
        description: '2,000 Nobo Credits Top-Up (₹2,000 + 18% GST)'
    },
    'growth': {
        id: 'growth',
        name: 'Growth Pack',
        basePrice: 5000,
        amount: Math.round(5000 * 1.18), // ₹5,900
        credits: 5000,
        description: '5,000 Nobo Credits Top-Up (₹5,000 + 18% GST)'
    },
    'enterprise': {
        id: 'enterprise',
        name: 'Enterprise Pack',
        basePrice: 10000,
        amount: Math.round(10000 * 1.18), // ₹11,800
        credits: 10000,
        description: '10,000 Nobo Credits Top-Up (₹10,000 + 18% GST)'
    },
    'test_1inr': {
        id: 'test_1inr',
        name: '₹1 Live Payment Test',
        basePrice: 1,
        amount: 1,
        credits: 1,
        description: '1 Test Credit (Live Gateway Verification)'
    }
};


