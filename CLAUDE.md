# AI Note-Taking Assistant

This repo is a personal note system. The user jots quick, unstructured notes either
**here in AI chat** or **on the web viewer** (which has no AI — it just drops raw jots
into S3). **Your job is to organize jots into markdown notes and sync them** so they are
readable at the web viewer (`web/`).

Data flow:

```
AI chat jot ─────────────┐
                         ├→ users/<u>/notes/*.md → sync → SQLite (db/notes.db) → S3 users/<u>/
web jot → S3 inbox → pull → inbox/<u>/*.json (you process these) ─┘
```

**Multi-user:** there is no login — each person has a folder `users/<name>/`. The owner
of this computer is **likwai**: jots typed in chat belong to `users/likwai/notes/`
unless the user says otherwise. Jots pulled from the web land in `inbox/<name>/` and
must be filed into that same person's `users/<name>/notes/`.

## When the user jots a note in chat

Example: *"learning Piano, teacher: Miss LEE"*

1. **Decide where it belongs — MERGE FIRST.** Merging into an existing note is the
   default; creating a new note is the exception. Check the person's
   `users/<user>/notes/` file listing for any note whose topic overlaps the jot, and if
   the jot plausibly extends it, append there. Only create a new
   `users/<user>/notes/<category>/<slug>.md` when the jot is clearly a new topic that
   no existing note covers. Pick a sensible category folder (e.g.
   `learning/`, `work/`, `life/`, `ideas/`, `contacts/`); create new categories
   sparingly.

   **Explicit merge target:** if the jot names a note up front — forms like
   `piano: next lesson Friday`, `add to piano: …`, or `→ piano …` — treat that as an
   instruction to merge into that note (match by title/slug), never create a new one.
   This also applies to jots pulled from the web inbox.

   **When merging, append cleanly:** integrate the new fact into the existing
   structure (extend the right bullet/section). If it's time-stamped information like
   an event or a log entry, add it under a dated line (e.g. `- **2026-07-02:** …`).
   Bump `updated`, and add new tags only if genuinely new.
2. **Structure the content.** Clean up the jot into tidy markdown — headings, bullets,
   bold labels. Keep every fact the user gave; don't invent details. Notes may contain
   anything: numbers, emails, links, image URLs. Keep them renderable:
   - Links: `[label](https://...)` (bare URLs auto-link)
   - Emails: `<someone@example.com>`
   - Image by URL: `![description](https://...)`
   - Local image file: copy to `users/<user>/notes/attachments/`, reference as
     `![description](https://likwai.s3.us-east-1.amazonaws.com/users/<user>/attachments/<filename>)`

   **To-do items:** if the jot is (or contains) an actionable task — something to do,
   buy, call, finish, book, etc., not just a fact to remember — write that line as a
   GFM task checkbox (`- [ ] Buy milk`) and add `todo` to that note's tags. This still
   follows merge-first: the item goes into whatever topic note it belongs to (a dentist
   call goes in the health note, not a generic todo note); the `todo` tag is what makes
   every pending item discoverable together via the `#todo` filter in the web app,
   regardless of which note it lives in. When the user later marks it done (in chat, or
   the web note text says so), check the box (`- [x]`) rather than deleting the line;
   drop `todo` from the note's tags only once no unchecked boxes remain in it.
3. **Frontmatter is required** on every note (dates `YYYY-MM-DD`; set `updated` to
   today whenever you touch a note):

   ```markdown
   ---
   title: Learning Piano
   category: learning
   tags: [piano, music, lessons]
   created: 2026-07-02
   updated: 2026-07-02
   ---
   ```

4. **Sync:** `node scripts/sync.mjs` — imports files into the SQLite database, then
   publishes notes + attachments + `index.json` to S3 (and prunes S3 notes deleted
   locally). Run after every change — but ALWAYS run `node scripts/pull.mjs` first,
   so edits/deletions made on the web aren't overwritten by stale local files.
5. **Confirm briefly**: which file you wrote/updated and that it's synced.

## Processing the web inbox

At the start of a session — or whenever the user asks to "process/pull notes" — run:

```bash
node scripts/pull.mjs
```

This downloads jots made on the web into `inbox/<user>/*.json` (each: `{user, id,
text, photo, created}`) and mirrors their photos into that person's
`users/<user>/notes/attachments/`. It also applies
**web edits and deletions automatically** (the web's edit/delete buttons leave
`{action: "edit"|"delete", noteId}` markers; pull rewrites or removes the local file —
no AI work needed, but this is why you must run pull BEFORE sync: syncing first would
overwrite online edits with stale local files). Then for each remaining jot file:

1. **Targeted remarks first.** A jot with a `noteId` (and `noteTitle`) field — left via
   the "leave a remark" box at the bottom of a note in the web app — is already tied to
   one exact note. Skip the merge-target search entirely: open
   `users/<user>/notes/<noteId>.md` directly and apply the remark as an edit (e.g. "the
   teacher name changed to Mr Chan" → update the teacher's name wherever it appears),
   following the same append-cleanly/bump-`updated` rules as any other merge. If that
   file no longer exists (deleted/archived since), fall back to treating `text` like a
   normal jot.
2. Otherwise, organize `text` into that same person's `users/<user>/notes/` exactly
   like a chat jot (merge into existing topic notes when one fits). Never file one
   user's jot into another user's folder.
3. If `photo` is set (a path like `attachments/<file>`), embed it in the note:
   `![<description from the jot text>](https://likwai.s3.us-east-1.amazonaws.com/users/<user>/<photo>)`
4. **NEVER open, Read, or view image files — not from `attachments/`, not from
   `inbox` photos.** Images consume a large number of tokens. File photos using ONLY
   the jot's text caption; if there is no caption, title it by date (e.g. "Photo
   2026-07-02") and let the user rename it later. Only look at an image if the user
   explicitly asks you to in this conversation.
5. Delete the processed `inbox/<user>/*.json` file.
6. When all items are processed, run `node scripts/sync.mjs`.

**Unorganized placeholders:** every web jot is also published by the web app as an
instant placeholder note under `notes/unorganized/` (category/tag `unorganized`) so it
shows online immediately. These live only in S3 — you don't need to touch them; once
you organize the jot and sync, the placeholder is pruned automatically. EXCEPTION: if
the user edited a placeholder on the web, pull writes it to the local
`users/<user>/notes/unorganized/` folder — treat any local file there as an inbox jot:
organize its content into a proper note, delete the placeholder file, sync.

## Regrouping / reorganizing notes

The user may ask to regroup notes (merge topics, split a note, rename categories,
re-tag). Work ONLY on the markdown files — never on the database or S3 directly:

1. Move/rename files under `users/<user>/notes/` (e.g. `…/notes/learning/piano.md` →
   `…/notes/hobbies/piano.md`), merge or split content as asked. Stay within one
   user's folder.
2. Update frontmatter to match (`category`, `tags`, `updated`; keep the original
   `created`).
3. Run `node scripts/sync.mjs` — it rebuilds the database from the files and fixes S3
   automatically (uploads new paths, deletes old ones).

The database and S3 always follow the files; there is nothing else to migrate.

## Rules

- **Be token-frugal as the collection grows.** To find where a jot belongs, list the
  user's `users/<user>/notes/` tree and decide from file/folder names (they are
  descriptive on purpose) — do NOT read every note. Read only the single note you
  intend to update. Never bulk-read notes unless the user explicitly asks for a
  reorganization or review.
- One topic per file. Merge related jots into the existing note for that topic.
- Never delete or rewrite the user's existing content unless they ask; add to it.
- File names: lowercase kebab-case, e.g. `piano.md`, `japan-trip-2026.md`.
- Don't touch `.env` or print its contents.
- To delete a note: DON'T remove the file — add `archived: <ISO timestamp>` to its
  frontmatter and sync. Archived notes are hidden in the app (under an "archived"
  chip, restorable) and are purged permanently by sync 30 days later. Only hard-delete
  a file if the user explicitly asks for immediate permanent deletion.
- Never edit `db/notes.db` directly or hand-edit `index.json`; both are managed by
  `scripts/sync.mjs`.

## Project layout

```
users/<name>/notes/  ← that person's markdown notes (editing surface), by category
users/<name>/notes/attachments/ ← their images/files → s3://likwai/users/<name>/attachments/
inbox/<name>/        ← pending web jots pulled from S3 (delete after processing)
db/notes.db          ← SQLite source of truth, all users (generated — do not edit)
scripts/pull.mjs     ← fetch all users' web jots + apply web edits/deletes
scripts/sync.mjs     ← files → database → S3 publish (all users)
scripts/setup-bucket.mjs ← one-time CORS setup
web/                 ← React viewer + quick-jot composer (npm run dev inside web/)
```
