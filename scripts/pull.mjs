// Pull jots created on the web (s3://bucket/users/<u>/inbox/) down to local
// inbox/<user>/ for AI processing, and mirror photos into users/<u>/notes/attachments/.
// Web edit/delete markers are applied to local files automatically. Downloaded items
// are removed from S3 (the local copy becomes the pending queue).
// Usage: node scripts/pull.mjs
import fs from 'node:fs'
import path from 'node:path'
import { ListObjectsV2Command, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { ROOT, loadEnv, s3Client, notesDir } from './lib.mjs'

const env = loadEnv()
const s3 = s3Client(env)
const bucket = env.VITE_S3_BUCKET
const INBOX_DIR = path.join(ROOT, 'inbox')

async function getBytes(Key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key }))
  return Buffer.from(await res.Body.transformToByteArray())
}

const listed = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'users/' }))
const items = (listed.Contents || []).filter((o) => /^users\/[^/]+\/inbox\/.+\.json$/.test(o.Key))

if (items.length === 0) {
  console.log('All inboxes empty — nothing to pull.')
  process.exit(0)
}

let jots = 0
for (const obj of items) {
  const user = obj.Key.split('/')[1]
  const body = await getBytes(obj.Key)
  const jot = { user, ...JSON.parse(body.toString('utf8')) }

  // tombstone from the web's delete button: remove the local file, no AI needed
  if (jot.action === 'delete') {
    const file = path.join(notesDir(user), `${jot.noteId}.md`)
    if (fs.existsSync(file)) {
      fs.unlinkSync(file)
      console.log(`  ✗ deleted users/${user}/notes/${jot.noteId}.md (removed on web)`)
    }
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }))
    continue
  }

  // marker from the web's edit button: S3 has the newest version, mirror it locally
  if (jot.action === 'edit') {
    const file = path.join(notesDir(user), `${jot.noteId}.md`)
    try {
      const latest = await getBytes(`users/${user}/notes/${jot.noteId}.md`)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, latest)
      console.log(`  ✓ updated users/${user}/notes/${jot.noteId}.md (edited on web)`)
    } catch {
      console.log(`  ! users/${user}/notes/${jot.noteId}.md no longer on S3, skipping edit marker`)
    }
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }))
    continue
  }

  // mirror the photo locally so the user's attachments stay a complete copy
  if (jot.photo) {
    const dest = path.join(notesDir(user), 'attachments', path.basename(jot.photo))
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, await getBytes(`users/${user}/${jot.photo}`))
      console.log(`  ✓ photo → users/${user}/notes/attachments/${path.basename(jot.photo)}`)
    }
  }

  const dir = path.join(INBOX_DIR, user)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, path.basename(obj.Key)), JSON.stringify(jot, null, 2))
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }))
  console.log(`  ✓ jot → inbox/${user}/${path.basename(obj.Key)}`)
  jots++
}

if (jots > 0) {
  console.log(`Pulled ${jots} jot(s). Organize each inbox/<user>/*.json into users/<user>/notes/, delete the jot files, then run: node scripts/sync.mjs`)
} else {
  console.log('Applied web changes. Run: node scripts/sync.mjs')
}
