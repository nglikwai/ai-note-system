// One-time bucket setup: CORS so the web app (browser) can read notes from S3.
// Usage: node scripts/setup-bucket.mjs
import { PutBucketCorsCommand } from '@aws-sdk/client-s3'
import { loadEnv, s3Client } from './lib.mjs'

const env = loadEnv()
const s3 = s3Client(env)

await s3.send(new PutBucketCorsCommand({
  Bucket: env.VITE_S3_BUCKET,
  CORSConfiguration: {
    CORSRules: [
      {
        AllowedMethods: ['GET', 'HEAD', 'PUT', 'POST'],
        AllowedOrigins: ['*'],
        AllowedHeaders: ['*'],
        MaxAgeSeconds: 3600,
      },
    ],
  },
}))
console.log(`CORS configured on bucket "${env.VITE_S3_BUCKET}".`)
