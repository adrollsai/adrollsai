import { S3Client } from '@aws-sdk/client-s3'

const endpoint = (process.env.R2_ENDPOINT || '').replace(/\/adrolls-storage\/?$/, '')

export const r2 = new S3Client({
  region: 'auto',
  endpoint,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
})

export const R2_BUCKET = process.env.R2_BUCKET_NAME!
export const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL!