// Verify the .env AWS credentials can reach the bucket.
// Usage: node scripts/check.mjs
import { HeadBucketCommand } from '@aws-sdk/client-s3'
import { loadEnv, s3Client } from './lib.mjs'

const env = loadEnv()
try {
  await s3Client(env).send(new HeadBucketCommand({ Bucket: env.VITE_S3_BUCKET }))
  console.log(`✅ Credentials OK — bucket "${env.VITE_S3_BUCKET}" is reachable.`)
} catch (e) {
  console.error(`❌ ${e.name}: ${e.message}`)
  console.error('Check .env — key ID starts with:', (env.VITE_S3_ACCESS_KEY_ID || '').slice(0, 8) + '…')
  process.exit(1)
}
