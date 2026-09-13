import crypto from 'crypto';

interface CreativeTokenPayload {
  userId: string;
  campaignId?: string;
  phone: string;
  exp: number; // timestamp in ms
}

const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXTAUTH_SECRET || 'nobogent_creative_session_secret_key_2026';

export function createCreativeSessionToken(payload: { userId: string; campaignId?: string; phone: string }): string {
  const fullPayload: CreativeTokenPayload = {
    ...payload,
    exp: Date.now() + 48 * 60 * 60 * 1000 // 48 hours
  };

  const payloadStr = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', SECRET)
    .update(payloadStr)
    .digest('base64url');

  return `${payloadStr}.${signature}`;
}

export function verifyCreativeSessionToken(token: string): CreativeTokenPayload | null {
  if (!token || !token.includes('.')) return null;

  try {
    const [payloadStr, signature] = token.split('.');
    const expectedSig = crypto
      .createHmac('sha256', SECRET)
      .update(payloadStr)
      .digest('base64url');

    if (signature !== expectedSig) {
      console.warn('[verifyCreativeSessionToken] Invalid signature');
      return null;
    }

    const payload: CreativeTokenPayload = JSON.parse(Buffer.from(payloadStr, 'base64url').toString('utf8'));

    if (Date.now() > payload.exp) {
      console.warn('[verifyCreativeSessionToken] Token expired');
      return null;
    }

    return payload;
  } catch (err) {
    console.error('[verifyCreativeSessionToken] Parsing error:', err);
    return null;
  }
}
