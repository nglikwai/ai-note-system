import path from 'node:path'
import fs from 'node:fs'
import Database from 'better-sqlite3'
import { ROOT } from './lib.mjs'

const DB_DIR = path.join(ROOT, 'db')
fs.mkdirSync(DB_DIR, { recursive: true })

export const db = new Database(path.join(DB_DIR, 'notes.db'))
db.pragma('journal_mode = WAL')
db.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    user     TEXT NOT NULL,
    id       TEXT NOT NULL,       -- category/slug, matches users/<user>/notes/<id>.md
    title    TEXT NOT NULL,
    category TEXT NOT NULL,
    tags     TEXT NOT NULL DEFAULT '[]',  -- JSON array
    content  TEXT NOT NULL,               -- markdown body (no frontmatter)
    created  TEXT NOT NULL,
    updated  TEXT NOT NULL,
    archived TEXT,                        -- ISO timestamp; purged 30 days after
    PRIMARY KEY (user, id)
  );
`)
try { db.exec('ALTER TABLE notes ADD COLUMN archived TEXT') } catch { /* column exists */ }

export const upsertNote = db.prepare(`
  INSERT INTO notes (user, id, title, category, tags, content, created, updated, archived)
  VALUES (@user, @id, @title, @category, @tags, @content, @created, @updated, @archived)
  ON CONFLICT(user, id) DO UPDATE SET
    title=@title, category=@category, tags=@tags, content=@content,
    created=@created, updated=@updated, archived=@archived
`)

export const userNotes = db.prepare('SELECT * FROM notes WHERE user = ? ORDER BY updated DESC, created DESC')
export const deleteNote = db.prepare('DELETE FROM notes WHERE user = ? AND id = ?')

// link-preview metadata cache (fetched at sync time; the browser can't due to CORS)
db.exec(`
  CREATE TABLE IF NOT EXISTS previews (
    url         TEXT PRIMARY KEY,
    title       TEXT,
    description TEXT,
    image       TEXT,
    site        TEXT,
    fetched     TEXT NOT NULL
  );
`)
export const getPreview = db.prepare('SELECT * FROM previews WHERE url = ?')
export const upsertPreview = db.prepare(`
  INSERT INTO previews (url, title, description, image, site, fetched)
  VALUES (@url, @title, @description, @image, @site, @fetched)
  ON CONFLICT(url) DO UPDATE SET
    title=@title, description=@description, image=@image, site=@site, fetched=@fetched
`)
