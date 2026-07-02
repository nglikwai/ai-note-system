// Sync pipeline, per user: users/<u>/notes/*.md → SQLite (db/notes.db) → S3 under
// users/<u>/. Uploads notes, attachments and a rebuilt index.json per user; removes
// S3 notes deleted locally and expired share pages. Usage: node scripts/sync.mjs
import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { loadEnv, s3Client, contentTypeFor, walk, listUsers, notesDir } from './lib.mjs'
import { db, upsertNote, userNotes, deleteNote } from './db.mjs'
import { extractUrls, buildPreviews } from './previews.mjs'

const env = loadEnv()
const s3 = s3Client(env)
const bucket = env.VITE_S3_BUCKET

async function put(key, body, contentType) {
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }))
  console.log(`  ✓ s3://${bucket}/${key}`)
}

async function listAll(prefix) {
  const out = []
  let token
  do {
    const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }))
    out.push(...(res.Contents || []))
    token = res.NextContinuationToken
  } while (token)
  return out
}

for (const user of listUsers()) {
  const NOTES_DIR = notesDir(user)
  const prefix = `users/${user}/`

  // ---- 1. Import markdown files into the database ----
  const noteFiles = walk(NOTES_DIR, '.md').filter((f) => !f.includes(`${path.sep}attachments${path.sep}`))
  const fileIds = new Set()

  for (const file of noteFiles) {
    const rel = path.relative(NOTES_DIR, file).split(path.sep).join('/')
    const id = rel.replace(/\.md$/, '')
    const { data, content } = matter(fs.readFileSync(file, 'utf8'))
    const stat = fs.statSync(file)

    // archived notes are purged permanently 30 days after archiving
    const archived = data.archived
      ? (data.archived instanceof Date ? data.archived.toISOString() : String(data.archived))
      : null
    if (archived && Date.now() - new Date(archived).getTime() > 30 * 24 * 3600 * 1000) {
      fs.unlinkSync(file)
      console.log(`  ✗ purged (archived > 30 days): users/${user}/notes/${rel}`)
      continue // absent from fileIds → database row + S3 copy removed below
    }
    fileIds.add(id)
    // Frontmatter dates are day-precision; when they match the file's own timestamp we
    // use the precise file time so the web can show "5 min ago" instead of just a date.
    const toTs = (v, fileTime) => {
      if (!v) return fileTime.toISOString()
      const s = v instanceof Date ? v.toISOString() : String(v)
      const dateOnly = s.length <= 10 || s.endsWith('T00:00:00.000Z')
      if (!dateOnly) return new Date(s).toISOString()
      const day = s.slice(0, 10)
      return fileTime.toISOString().slice(0, 10) === day ? fileTime.toISOString() : day
    }
    upsertNote.run({
      user,
      id,
      title: data.title || id,
      category: data.category || (id.includes('/') ? id.split('/')[0] : 'general'),
      tags: JSON.stringify(data.tags || []),
      content: content.trim(),
      created: toTs(data.created, stat.birthtime),
      updated: toTs(data.updated, stat.mtime),
      archived,
    })
  }

  // a note whose file was deleted is deleted from the database too
  const removed = userNotes.all(user).map((n) => n.id).filter((id) => !fileIds.has(id))
  for (const id of removed) deleteNote.run(user, id)

  const notes = userNotes.all(user)
  console.log(`[${user}] database: ${notes.length} note(s)${removed.length ? `, ${removed.length} removed` : ''}`)

  // ---- 2. Build index + publish to S3 ----
  const index = notes.map((n) => ({
    id: n.id,
    key: `notes/${n.id}.md`, // relative to users/<user>/ — the web app adds the prefix
    title: n.title,
    category: n.category,
    tags: JSON.parse(n.tags),
    created: n.created,
    updated: n.updated,
    archived: n.archived || undefined,
    excerpt: n.content.replace(/[#*_>`\[\]!()]/g, '').replace(/\s+/g, ' ').slice(0, 120),
  }))

  for (const n of notes) {
    const archLine = n.archived ? `archived: ${n.archived}\n` : ''
    const md = `---\ntitle: ${JSON.stringify(n.title)}\ncategory: ${n.category}\ntags: ${n.tags}\ncreated: ${n.created}\nupdated: ${n.updated}\n${archLine}---\n\n${n.content}\n`
    await put(`${prefix}notes/${n.id}.md`, md, 'text/markdown; charset=utf-8')
  }

  const attachmentsDir = path.join(NOTES_DIR, 'attachments')
  for (const file of walk(attachmentsDir)) {
    const rel = path.relative(attachmentsDir, file).split(path.sep).join('/')
    await put(`${prefix}attachments/${rel}`, fs.readFileSync(file), contentTypeFor(file))
  }

  await put(`${prefix}notes/index.json`, JSON.stringify(index, null, 2), 'application/json; charset=utf-8')

  // link previews for all URLs in this user's notes (cached; only new links hit the network)
  const urls = [...new Set(notes.flatMap((n) => extractUrls(n.content)))]
    .filter((u) => !u.includes('.amazonaws.com/')) // skip our own attachment links
  const previews = await buildPreviews(urls)
  await put(`${prefix}notes/previews.json`, JSON.stringify(previews, null, 2), 'application/json; charset=utf-8')

  // ---- 3. Remove S3 notes that no longer exist locally ----
  const validKeys = new Set([
    ...index.map((n) => `${prefix}${n.key}`),
    `${prefix}notes/index.json`,
    `${prefix}notes/previews.json`,
  ])
  for (const obj of await listAll(`${prefix}notes/`)) {
    if (!validKeys.has(obj.Key)) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }))
      console.log(`  ✗ removed s3://${bucket}/${obj.Key}`)
    }
  }
}

// ---- 4. Clean up expired share pages (links die after 7 days) ----
const weekAgo = Date.now() - 7 * 24 * 3600 * 1000
for (const obj of await listAll('users/')) {
  if (obj.Key.includes('/share/') && obj.LastModified.getTime() < weekAgo) {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }))
    console.log(`  ✗ expired share page removed: ${obj.Key}`)
  }
}

db.close()
console.log('Done.')
