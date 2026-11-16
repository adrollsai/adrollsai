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
 * Verifies Razorpay subscription checkout signature:
 * generated_signature = hmac_sha256(payment_id + "|" + subscription_id, secret)
 */
export function verifyRazorpaySubscriptionSignature(
    subscriptionId: string,
    paymentId: string,
    razorpaySignature: string,
    secret: string = RAZORPAY_KEY_SECRET
): boolean {
    if (!subscriptionId || !paymentId || !razorpaySignature || !secret) {
        return false;
    }
    const body = `${paymentId}|${subscriptionId}`;
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
    durationMonths?: number;
    durationDays?: number;
    basePrice: number;
    gstRate: number; // 0.18 for 18% GST
    totalPrice: number;
    creditsIncluded: number;
    description: string;
    oncePerUser?: boolean;
    razorpayPlanId?: string;
}

export const RAZORPAY_PLANS: Record<string, RazorpayPlanConfig> = {
    'trial': {
        id: 'trial',
        title: '7 DAYS TRIAL PASS',
        durationDays: 7,
        durationMonths: 0.23,
        basePrice: 999,
        gstRate: 0.18,
        totalPrice: Math.round(999 * 1.18), // ₹1,179
        creditsIncluded: 1000,
        description: 'Nobogent 7-Day Trial Pass (₹999 + 18% GST - One-time purchase per user)',
        oncePerUser: true
    },
    '7-days-trial': {
        id: 'trial',
        title: '7 DAYS TRIAL PASS',
        durationDays: 7,
        durationMonths: 0.23,
        basePrice: 999,
        gstRate: 0.18,
        totalPrice: Math.round(999 * 1.18), // ₹1,179
        creditsIncluded: 1000,
        description: 'Nobogent 7-Day Trial Pass (₹999 + 18% GST - One-time purchase per user)',
        oncePerUser: true
    },
    '1-month': {
        id: '1-month',
        title: '1 MONTH PLAN',
        durationMonths: 1,
        basePrice: 9999,
        gstRate: 0.18,
        totalPrice: Math.round(9999 * 1.18), // ₹11,799
        creditsIncluded: 5000,
        description: 'Nobogent Pro Plan (1 Month)',
        razorpayPlanId: 'plan_TuTputefIk9tWN'
    },
    '6-months': {
        id: '6-months',
        title: '6 MONTHS PLAN',
        durationMonths: 6,
        basePrice: 54999,
        gstRate: 0.18,
        totalPrice: Math.round(54999 * 1.18), // ₹64,899
        creditsIncluded: 25000,
        description: 'Nobogent Pro Plan (6 Months Subscription)',
        razorpayPlanId: 'plan_TuTpv3jSGlLs5M'
    },
    '12-months': {
        id: '12-months',
        title: '12 MONTHS PLAN',
        durationMonths: 12,
        basePrice: 99999,
        gstRate: 0.18,
        totalPrice: Math.round(99999 * 1.18), // ₹117,999
        creditsIncluded: 100000,
        description: 'Nobogent Pro Plan (12 Months Subscription)',
        razorpayPlanId: 'plan_TuTpvD3xeQfcGm'
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
    // One credit per rupee, at three sizes. GST is added on top, exactly as the rest of the app
    // charges it. Custom amounts create the same shape at checkout (see 'custom' below).
    'p500': {
        id: 'p500',
        name: '₹500 Pack',
        basePrice: 500,
        amount: Math.round(500 * 1.18),
        credits: 500,
        description: '500 Nobo Credits (₹500 + 18% GST)'
    },
    'p1000': {
        id: 'p1000',
        name: '₹1,000 Pack',
        basePrice: 1000,
        amount: Math.round(1000 * 1.18),
        credits: 1000,
        description: '1,000 Nobo Credits (₹1,000 + 18% GST)'
    },
    'p2000': {
        id: 'p2000',
        name: '₹2,000 Pack',
        basePrice: 2000,
        amount: Math.round(2000 * 1.18),
        credits: 2000,
        description: '2,000 Nobo Credits (₹2,000 + 18% GST)'
    },
    'custom': {
        id: 'custom',
        name: 'Custom Amount',
        basePrice: 0,
        amount: 0,
        credits: 0,
        description: 'Any amount from ₹100 — one credit per rupee, plus 18% GST'
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


