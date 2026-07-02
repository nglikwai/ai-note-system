# AI Note-Taking Assistant

**First, read [CLAUDE.md](CLAUDE.md) — it is the full, canonical instruction file for
this repo.** The summary below is only a quick reference.

This is a personal note system: the user jots quick unstructured notes in AI chat, and
you organize them into markdown and publish to S3 (readable in the `web/` viewer).

## Quick reference

- **Multi-user, no login**: each person's notes live under `users/<name>/notes/`.
  Chat jots on this computer belong to **likwai** (`users/likwai/notes/`) unless said
  otherwise; web jots arrive per user and must be filed into that user's folder.
- **Jot arrives in chat** → MERGE FIRST: append to the existing note on that topic
  under `users/<user>/notes/<category>/<slug>.md`; create a new note only for clearly
  new topics (frontmatter required: title, category, tags, created, updated — dates
  `YYYY-MM-DD`). A jot like `piano: …` / `add to piano: …` explicitly targets that
  note. Then run `node scripts/sync.mjs`.
- **"Process my inbox" / session start** → `node scripts/pull.mjs` first (it also
  applies edits/deletes made on the web), organize each downloaded `inbox/<user>/*.json`
  jot into that user's notes, delete the processed jot files, then `node scripts/sync.mjs`.
- **Always pull before sync** — otherwise stale local files overwrite web edits.
- **Never open/read image files** (they consume many tokens): file photos by their
  caption text only.
- **Be token-frugal**: locate notes by file/folder names; read only the note you'll
  update.
- Never edit `db/notes.db`, `index.json`, or `.env`. Deleting a note = delete its
  `.md` file + sync.
