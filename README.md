# AI Notes

Jot quick notes anywhere → AI on your computer organizes them → read them anywhere.

```
AI chat jot (Claude Code / Cursor) ──┐
                                     ├→ notes/*.md → SQLite (source of truth) → S3
web quick-jot (+photo) → S3 inbox/ ──┘         ↑ pull                          ↓
                                        local AI organizes              mobile web viewer
```

- **Local SQLite database** (`db/notes.db`) is the source of truth; S3 is the online
  mirror the web viewer reads.
- **The web has no AI** — its quick-jot composer just drops raw text (and photos from
  your camera) into `s3://likwai/inbox/`. AI organizing always happens locally.

## Daily use

**On your computer** — open your AI CLI (Claude Code, Codex, Cursor, …) in this
folder and type a note:

> learning Piano, teacher: Miss LEE

The AI files it under `notes/<category>/`, runs the sync, and it appears in the web
viewer. Instructions load automatically per tool: Claude Code reads `CLAUDE.md`
(canonical), Codex reads `AGENTS.md`, Cursor reads `.cursorrules` — the latter two
summarize and defer to `CLAUDE.md`.

**On your phone / anywhere** — open the web viewer, tap **＋**, type anything and/or
take a photo, Save. It lands in the S3 inbox as-is. You can also **✏️ edit** and
**🗑 delete** notes directly online — changes apply to S3 immediately and flow back to
your computer on the next pull. **📤 Share** publishes a standalone HTML copy of the
note and gives you a link anyone can open without the app; links expire after 7 days
(the S3 maximum) and expired copies are cleaned up by the next sync. The app is a **PWA**: use "Add to Home Screen" on your
phone to install it like a native app (notes you've opened stay readable offline).

**Back on your computer** — say "process my inbox" (or the AI does it at session
start). It runs `npm run pull`, organizes each jot into proper notes, and syncs.
Photos are filed by their caption text only — the AI never reads image content
(images are expensive in tokens).

## Web viewer

```bash
cd web
npm install     # first time only
npm run dev     # open the printed URL on your phone/desktop
```

To put it online: `npm run build` inside `web/`, then host `web/dist/` anywhere static
(Netlify, Vercel, S3+CloudFront, ...). See Security below first.

## One-time setup

```bash
npm install                    # root deps (sync/pull scripts, SQLite)
node scripts/setup-bucket.mjs  # CORS so the browser can read/write the bucket
node scripts/sync.mjs          # first sync
```

## Commands

| Command | What it does |
|---|---|
| `npm run pull` | Apply web edits/deletes locally + download web jots for AI processing (run before sync) |
| `npm run sync` | Import `notes/*.md` → SQLite → publish everything to S3 (incl. deletions) |
| `npm run setup` | One-time bucket CORS configuration |
| `npm run web` | Start the web viewer dev server |

## Storage format

- Each note = one markdown file with YAML frontmatter (`title`, `category`, `tags`,
  `created`, `updated`). Markdown over raw JSON because notes stay human-readable, AI
  edits it natively, and links/emails/images render directly in the viewer.
- `db/notes.db` — SQLite source of truth, rebuilt from the markdown files by sync.
- **Multi-user, no login**: pick a name once in the web app (remembered per device;
  new names ask for confirmation to catch typos). Everything is namespaced per user:
  S3 layout is `users/<name>/notes/<category>/<slug>.md` + `users/<name>/notes/index.json`,
  `users/<name>/attachments/<file>`, `users/<name>/inbox/<id>.json`. Locally the same:
  `users/<name>/notes/…`. The device only lists profiles that were used on it before.

## ⚠️ Security

- `.env` holds the AWS keys and is **gitignored — never commit it**.
- `VITE_*` env vars are **embedded in the built JavaScript**. Anyone who can open your
  deployed site can extract these keys — and this app's keys can also *write* to the
  bucket. Only deploy publicly if the IAM user is locked down to this bucket only, and
  prefer keeping the deployed site behind auth (e.g. Vercel/Netlify password).
- These keys were shared in a chat once — rotate them in the IAM console and update
  `.env`.
- Safer long-term: a tiny API (e.g. Lambda/Cloudflare Worker) that signs uploads and
  serves reads, so no AWS keys ship to the browser. Ask the AI to build it when needed.
