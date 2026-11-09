import { S3Client } from '@aws-sdk/client-s3';

function getR2Client(): S3Client {
  const endpoint = (process.env.R2_ENDPOINT || '').replace(/\/adrolls-storage\/?$/, '');
  const accessKeyId = (process.env.R2_ACCESS_KEY_ID || '').replace(/^["']|["']$/g, '').trim();
  const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || '').replace(/^["']|["']$/g, '').trim();

  return new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

// Lazy proxy so credentials are read at call time
export const r2 = new Proxy({} as S3Client, {
  get(target, prop, receiver) {
    const client = getR2Client();
    const val = (client as any)[prop];
    if (typeof val === 'function') {
      return val.bind(client);
    }
    return val;
  },
});

export const R2_BUCKET = process.env.R2_BUCKET_NAME || 'adrolls-storage';
export const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev';
