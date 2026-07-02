import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { S3Client } from '@aws-sdk/client-s3'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const USERS_DIR = path.join(ROOT, 'users')

// local layout: users/<name>/notes/... — one folder per user, mirroring s3://bucket/users/<name>/
export function listUsers() {
  if (!fs.existsSync(USERS_DIR)) return []
  return fs.readdirSync(USERS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
}

export function notesDir(user) {
  return path.join(USERS_DIR, user, 'notes')
}

export function loadEnv() {
  const env = {}
  const file = fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
  for (const line of file.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim()
  }
  return env
}

export function s3Client(env) {
  return new S3Client({
    region: env.VITE_S3_REGION,
    credentials: {
      accessKeyId: env.VITE_S3_ACCESS_KEY_ID,
      secretAccessKey: env.VITE_S3_SECRET_ACCESS_KEY,
    },
  })
}

export const CONTENT_TYPES = {
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.heic': 'image/heic',
  '.pdf': 'application/pdf',
}

export function contentTypeFor(file) {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream'
}

export function walk(dir, ext) {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.name.startsWith('.')) continue
    if (entry.isDirectory()) out.push(...walk(full, ext))
    else if (!ext || entry.name.toLowerCase().endsWith(ext)) out.push(full)
  }
  return out
}
