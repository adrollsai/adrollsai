import crypto from 'crypto';

const CLIENT_ID = process.env.PHONEPE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.PHONEPE_CLIENT_SECRET || "";
const MERCHANT_ID = process.env.PHONEPE_MERCHANT_ID || "";
const BASE_URL = process.env.PHONEPE_BASE_URL || "https://api-preprod.phonepe.com/apis/pg-sandbox";

let cachedToken: { token: string; expires: number } | null = null;

/**
 * Fetches or returns a cached OAuth2 Bearer token for PhonePe APIs.
 */
export async function getPhonePeAuthToken() {
    if (cachedToken && Date.now() < cachedToken.expires) {
        return cachedToken.token;
    }

    // --- CRITICAL FIX: Live vs Sandbox Auth URLs differ ---
    const isLive = BASE_URL.includes('api.phonepe.com') && !BASE_URL.includes('preprod');
    const authUrl = isLive 
        ? `https://api.phonepe.com/apis/identity-manager/v1/oauth/token`
        : `${BASE_URL}/v1/oauth/token`;
    
    console.log("Attempting Auth at:", authUrl);
    
    // Body is x-www-form-urlencoded
    const params = new URLSearchParams();
    params.append('client_id', CLIENT_ID);
    params.append('client_secret', CLIENT_SECRET);
    params.append('grant_type', 'client_credentials');
    params.append('client_version', '1');

    const response = await fetch(authUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(`PhonePe Auth Failed: ${data.message || 'Unknown error'}`);
    }

    // Cache the token (subtract 5 mins buffer)
    cachedToken = {
        token: data.access_token,
        expires: Date.now() + (data.expires_in - 300) * 1000
    };

    return data.access_token;
}

/**
 * Initiates a Subscription Setup (Mandate creation).
 */
export async function setupSubscription(payload: any, customPath?: string) {
    const token = await getPhonePeAuthToken();
    const path = customPath || "/subscriptions/v2/setup";
    const url = `${BASE_URL}${path}`;

    const headers: any = {
        'Authorization': `O-Bearer ${token}`,
        'Content-Type': 'application/json',
        'accept': 'application/json',
        'X-MERCHANT-ID': MERCHANT_ID
    };

    // --- V2 ENTERPRISE: Dynamic Callback URL via Header ---
    if (payload.paymentFlow?.merchantUrls?.callbackUrl) {
        headers['X-CALLBACK-URL'] = payload.paymentFlow.merchantUrls.callbackUrl;
    }

    console.log("--- PhonePe Setup Request ---");
    console.log("URL:", url);
    console.log("Method: POST");
    console.log("Headers:", JSON.stringify({ ...headers, 'Authorization': 'O-Bearer [MASKED]' }, null, 2));
    console.log("Payload:", JSON.stringify(payload, null, 2));

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
    });

    const data = await response.json();
    
    console.log("--- PhonePe Setup Response ---");
    console.log("Status:", response.status);
    console.log("Body:", JSON.stringify(data, null, 2));

    // V2 Enterprise API might not have data.success, it uses HTTP status
    const isActuallySuccessful = response.ok && (data.success || data.redirectUrl || data.state === 'PENDING');

    if (!isActuallySuccessful) {
        console.error("PhonePe Subscription Setup Error Logged.");
        return { ...data, success: false };
    }
    
    return { ...data, success: true };
}

/**
 * Executes a recurring debit for an existing subscription.
 */
export async function executeRecurringDebit(payload: {
    merchantOrderId: string;
    amount: number;
    merchantSubscriptionId: string;
}) {
    const token = await getPhonePeAuthToken();
    const url = `${BASE_URL}/subscriptions/v2/execute`;

    const fullPayload = {
        merchantId: MERCHANT_ID,
        ...payload
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `O-Bearer ${token}`,
            'Content-Type': 'application/json',
            'accept': 'application/json',
            'X-MERCHANT-ID': MERCHANT_ID
        },
        body: JSON.stringify(payload)
    });

    const data = await response.json();
    return data;
}

/**
 * Checks the status of a subscription.
 */
export async function getSubscriptionStatus(merchantSubscriptionId: string) {
    const token = await getPhonePeAuthToken();
    const url = `${BASE_URL}/subscriptions/v2/${merchantSubscriptionId}/status`;

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `O-Bearer ${token}`,
            'Content-Type': 'application/json',
            'accept': 'application/json',
            'X-MERCHANT-ID': MERCHANT_ID
        },
    });

    const data = await response.json();
    return data;
}
