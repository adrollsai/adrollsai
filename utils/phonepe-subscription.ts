import crypto from 'crypto';

const CLIENT_ID = (process.env.PHONEPE_CLIENT_ID || "").replace(/['"]/g, '').trim();
const CLIENT_SECRET = (process.env.PHONEPE_CLIENT_SECRET || "").replace(/['"]/g, '').trim();
const MERCHANT_ID = (process.env.PHONEPE_MERCHANT_ID || "").replace(/['"]/g, '').trim();

// Determine if we are running in production/live mode
const isLive = process.env.PHONEPE_ENV === 'production';

// Endpoint URLs from the PhonePe Standard Checkout V2 Documentation
const AUTH_URL = isLive 
    ? "https://api.phonepe.com/apis/identity-manager/v1/oauth/token"
    : "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token";

const OTHER_BASE_URL = isLive 
    ? "https://api.phonepe.com/apis/pg"
    : "https://api-preprod.phonepe.com/apis/pg-sandbox";

let cachedToken: { token: string; expires: number } | null = null;

/**
 * Fetches or returns a cached OAuth2 Bearer token for PhonePe APIs.
 */
export async function getPhonePeAuthToken() {
    if (cachedToken && Date.now() < cachedToken.expires) {
        return cachedToken.token;
    }

    console.log("--- PhonePe OAuth2 Auth ---");
    console.log("Merchant ID:", MERCHANT_ID);
    console.log("Environment:", isLive ? "Production (Live)" : "Sandbox / UAT");
    console.log("Authorization URL:", AUTH_URL);
    
    // Body is x-www-form-urlencoded
    const params = new URLSearchParams();
    params.append('client_id', CLIENT_ID);
    params.append('client_secret', CLIENT_SECRET);
    params.append('grant_type', 'client_credentials');
    params.append('client_version', '1');

    const response = await fetch(AUTH_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
    });

    const data = await response.json();

    if (!response.ok) {
        console.error("PhonePe OAuth Handshake Failure:", JSON.stringify(data, null, 2));
        throw new Error(`PhonePe Auth Failed: ${data.message || data.error || 'Unknown auth error'}`);
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
    const url = `${OTHER_BASE_URL}${path}`;

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
    
    // --- CRITICAL FIX: Ensure merchantId is in body for V2 Enterprise ---
    const finalPayload = {
        merchantId: MERCHANT_ID,
        ...payload
    };
    console.log("Payload Sent to PhonePe:", JSON.stringify(finalPayload, null, 2));

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(finalPayload)
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
    const url = `${OTHER_BASE_URL}/subscriptions/v2/execute`;

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
        body: JSON.stringify(fullPayload)
    });

    const data = await response.json();
    return data;
}

/**
 * Initiates a standard, one-time payment using PhonePe V2 website checkout pay page API.
 * Uses OAuth client credentials to retrieve a token dynamically.
 */
export async function setupStandardCheckoutV2(payload: {
    transactionId: string;
    userId: string;
    amountInPaise: number;
    redirectUrl: string;
    callbackUrl: string;
}) {
    const token = await getPhonePeAuthToken();
    const url = `${OTHER_BASE_URL}/checkout/v2/pay`;

    // Standard V2 Pay Page Payload
    const payPayload = {
        merchantId: MERCHANT_ID,
        merchantOrderId: payload.transactionId,
        merchantUserId: payload.userId,
        amount: payload.amountInPaise,
        redirectUrl: payload.redirectUrl,
        redirectMode: "GET",
        callbackUrl: payload.callbackUrl,
        paymentInstrument: {
            type: "PAY_PAGE"
        }
    };

    console.log(`[PhonePe V2 Standard] Initiating pay page for transaction: ${payload.transactionId}...`);
    console.log(`[PhonePe V2 Standard] Endpoint URL: ${url}`);
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `O-Bearer ${token}`,
            'Content-Type': 'application/json',
            'accept': 'application/json',
            'X-MERCHANT-ID': MERCHANT_ID
        },
        body: JSON.stringify(payPayload)
    });

    const data = await response.json();
    console.log(`[PhonePe V2 Standard] HTTP Status: ${response.status}`);
    console.log(`[PhonePe V2 Standard] Response Body:`, JSON.stringify(data, null, 2));

    const isActuallySuccessful = response.ok && (data.success || data.redirectUrl || data.state === 'PENDING' || data.code === 'PAYMENT_INITIATED');

    if (!isActuallySuccessful) {
        return { ...data, success: false };
    }

    const redirectUrl = data.redirectUrl || data.data?.instrumentResponse?.redirectInfo?.url;
    if (!redirectUrl) {
        throw new Error(data.message || "PhonePe V2 response did not contain a redirect checkout URL");
    }

    return { success: true, redirectUrl };
}

/**
 * Checks the status of a V2 Checkout order using the Order Status API.
 */
export async function getV2OrderStatus(merchantOrderId: string) {
    const token = await getPhonePeAuthToken();
    const url = `${OTHER_BASE_URL}/checkout/v2/order/${merchantOrderId}/status`;

    console.log(`[PhonePe V2 Status] Querying order status: ${merchantOrderId}...`);
    console.log(`[PhonePe V2 Status] Endpoint URL: ${url}`);

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
    console.log(`[PhonePe V2 Status] HTTP Status: ${response.status}`);
    console.log(`[PhonePe V2 Status] Response Body:`, JSON.stringify(data, null, 2));

    return data;
}
