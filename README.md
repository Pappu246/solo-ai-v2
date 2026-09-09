# SOLO AI

A premium AI workspace built with React, TypeScript, Vite, Tailwind CSS and Supabase.

SOLO AI brings different AI providers into one clean chat interface with saved conversations, streaming replies, image input and a responsive, accessible UI. This release adds **Phase 2 — Knowledge Layer** on top of the Phase 1 foundation: file uploads with text extraction and chunking, relevance-based retrieval with visible sources, explicit memory, projects, and global search. Tools and agents arrive in later phases.

## Features

- Email authentication with clear sign-up / confirmation feedback
- Saved chat history: search, rename, pin, archive, delete (with confirmation)
- Multiple AI providers and models — **Auto** routing by default, manual override per chat
- Streaming responses; **Stop** keeps the partial reply
- Regenerate, **edit & resend**, retry — without duplicating messages
- GitHub-flavoured Markdown, tables, and syntax-highlighted code blocks with copy
- Image and file attachments (text is extracted for TXT/CSV; images go to vision models)
- Light / dark / system theme, accent colour, text size — all token-based
- Keyboard shortcuts: `⌘/Ctrl+K` search, `⌘/Ctrl+Shift+O` new chat, `⌘/Ctrl+B` sidebar, `⌘/Ctrl+,` settings, `Esc` stop
- Read-aloud (browser TTS) and voice input (browser STT) where supported
- Humane error states with expandable technical details
- Supabase Row Level Security, server-side API keys, request validation and rate limiting

### Knowledge layer (Phase 2)

- **Files** — upload PDF, TXT, Markdown, CSV, JSON and common code files. Files are stored in a private Supabase Storage bucket, text is extracted in the browser (PDF via `pdfjs-dist`), chunked, and indexed for full-text search. Each file shows its lifecycle: *uploading → processing → ready | failed*, with retry and a reason on failure. Uploads are **resumable** (Phase 3): files of 6 MB and above go through the Storage TUS endpoint in 6 MB chunks with per-chunk retry, live progress and cancel; there is no artificial client-side size cap — the bucket / plan limit is the authority.
- **Retrieval** — before each reply, only the excerpts relevant to the question (from files attached to the chat or in its project) are sent to the model, within a strict budget. Replies show which files and excerpts were used. Nothing is sent when nothing is relevant.
- **Memory** — save facts, preferences, instructions and context explicitly (Memory view or *Remember this* on a reply). Memories carry a type, scope (every chat or one project), importance and source, and can be edited or deleted. Nothing is remembered automatically.
- **Projects** — group chats, files and memories; project instructions are sent with every chat inside the project. Create, rename, archive, delete (chats and files are detached, not deleted). Projects live in the existing sidebar.
- **Global search** — `⌘/Ctrl+K` searches chats, messages, projects, files and memories (Postgres full-text search, grouped results, per-group *more*, keyboard navigation). Results only ever include the signed-in user's data.

### Smart Image Search

- **Automatic visual detection** — when a user's message would benefit from images (e.g., "show me golden retrievers", "wallpaper of mountains"), the system automatically triggers an image search. A fast-path heuristic skips obviously non-visual queries (math, code, greetings) without an AI call; borderline cases use a lightweight model call to decide.
- **Provider abstraction** — image search uses a clean `ImageSearchProvider` interface with a Google Custom Search Engine (CSE) implementation. The provider can be swapped (Bing, DuckDuckGo, etc.) without touching the decision logic or UI.
- **Server-side only** — Google CSE API keys are stored as Edge Function secrets and never reach the browser. Results are filtered for quality (no broken URLs, extremely low resolution, or duplicates) and cached for 30 minutes to stay within the free-tier quota (100 queries/day).
- **Streaming integration** — image search results are delivered via new SSE event types (`event: image_search`) alongside the existing text stream. The search runs in parallel with text generation so it never delays the response.
- **Graceful degradation** — if image search is not configured, fails, or times out, the text response continues normally. The feature is entirely optional.

## Tech Stack

- React 18
- TypeScript
- Vite
- Tailwind CSS
- Supabase
- Lucide React

## Project Structure

```text
src/
├── components/
│   ├── auth/       AuthScreen, SetupScreen
│   ├── chat/       Composer, MessageList, Message, Markdown, CodeBlock, ModelSelector…
│   ├── knowledge/  FilesView, FileList, FileDetailDialog, FilePickerDialog, UploadDropzone, FileStatusBadge
│   ├── memory/     MemoryView, MemoryEditor
│   ├── projects/   ProjectView, ProjectDialog
│   ├── search/     SearchPalette (⌘K)
│   ├── layout/     Sidebar (chats + projects + Files/Memory), Topbar
│   ├── settings/   SettingsPanel
│   └── ui/         Button, IconButton, Dialog, ConfirmDialog, Toast, Toggle, Kbd, Logo
├── hooks/          useAuth, useChat, useSettings, useKeyboardShortcuts, useSpeechInput,
│                   useKnowledge, useMemories, useProjects, useSearch
├── lib/
│   ├── chat/       api.ts (persistence), stream.ts (SSE client)
│   ├── knowledge/  fileTypes, extract (PDF/CSV/JSON/text), chunker, fileService (upload → storage →
│   │               metadata → extraction → chunking → indexing), retriever, search, api
│   ├── errors.ts   friendly error mapping
│   └── settings.ts schema normalisation + theme application
├── test/           test setup and Supabase mock (simulates RLS + Storage)
├── App.tsx
└── types.ts

supabase/
├── functions/
│   ├── chat/
│   │   ├── index.ts          request validation, auth, rate limit, Phase 2 context, image search integration, SSE response
│   │   ├── providers.ts      model catalog + aliases, provider fallback, stream guards, safe errors
│   │   └── providers_test.ts offline Deno tests (`deno test supabase/functions/chat/providers_test.ts`)
│   └── image-search/
│       ├── index.ts          standalone image search endpoint (POST /functions/v1/image-search)
│       ├── providers.ts      ImageSearchProvider interface + Google CSE implementation, result filtering
│       ├── decision.ts       smart decision logic (heuristic + model-based), query extraction
│       ├── cache.ts          TTL-based in-memory cache (30 min, max 200 entries)
│       └── search-events.ts  shared SSE event types for image search (used by chat + image-search functions)
├── migrations/
└── config.toml

e2e/                    Playwright specs (auth, conversations, composer, upload) +
└── support/            mockBackend.ts (Supabase HTTP mock with RLS/TUS/SSE), fixtures.ts
```

### Chat reliability contract

The `chat` function never returns a raw provider error. Failures come back as
`{ error, code, request_id }` (and as an `event: error` SSE frame mid-stream),
with `code` mapped to actionable copy in `src/lib/errors.ts`. Transient
failures (model retired/not found, 401/402/403, 408, 429, 5xx, network resets,
provider timeouts) fall back to the next provider; request-specific failures
(invalid input, context overflow, content policy) fail fast. A clean stream
always ends with `data: [DONE]`, so an interrupted answer is detected
(`stream_incomplete`), kept on screen and persisted.

### PDF extraction and worker loading

PDF processing runs entirely in the browser after Storage upload; there is no
`process-file` Edge Function. `src/lib/knowledge/extract.ts` lazy-loads pdf.js
and a Vite-built `?worker` chunk, supplies it through
`GlobalWorkerOptions.workerPort`, and waits for the worker's ready signal (or
an error/timeout). It does not ask pdf.js to load a standalone `.mjs` module
worker via `workerSrc`, which can fail under production CSP, MIME or base-path
configuration.

If Workers are unavailable or blocked, the reader explicitly imports the
bundled `?url` asset once and registers its `WorkerMessageHandler` before
creating a main-thread reader. This is the pdf.js v6 equivalent of
`disableWorker: true` (that option is no longer supported), not pdf.js's
URL-based fake-worker fallback. The shared reader is reused across concurrent
and later uploads; each document's loading task is cleaned up independently.
If both paths fail, or the PDF is password-protected, corrupt or empty, the
file's failure message retains the original diagnostic and is also logged to
`console.error`. Unknown errors are not mislabeled as corruption.

The modern pdf.js v6 build also requires recent browser APIs such as
`Uint8Array.toHex()`. Keep the Playwright/browser revision current when running
PDF regressions: the former Chromium 131 pin predates that API and cannot
extract real PDFs with this version of pdf.js.

### Conversation state contract

Every conversation action (rename, pin, archive, move, delete) in
`src/hooks/useChat.ts` follows one pattern: apply optimistically to the list
*and* to the open chat, persist, then reconcile with the row the database
returned (`conversationsApi.update` → `.select().single()`). The list is
always kept in `sortConversations` order — pinned first, then most recently
updated — which is the same order `conversationsApi.list` returns, so the
sidebar never differs from what a reload would show. Renaming/pinning the open
chat keeps it open; archiving or deleting it opens the neighbouring chat
(`fallbackAfterRemoval`) or a blank chat when none is left. An update that
matches no row (deleted on another device, or not yours — RLS makes both look
identical) surfaces as *Not found* and the row is evicted locally. The app has
no URL router (a single-screen shell), so there is no route state to keep in
sync; nothing ever triggers a full reload.

## Run Locally

### 1. Clone the repository

```bash
git clone https://github.com/Pappu246/solo-ai-v2.git
cd solo-ai-v2
```

### 2. Install dependencies

```bash
npm install
```

### 3. Add environment variables

Create a `.env` file using `.env.example`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

### 4. Add AI provider secrets

Provider API keys belong in Supabase Edge Function secrets, not in the frontend or GitHub repository.

```text
OPENAI_API_KEY
ANTHROPIC_API_KEY
GOOGLE_API_KEY
GROQ_API_KEY
DEEPSEEK_API_KEY
APP_ORIGIN
```

For the Smart Image Search feature (optional), also add:

```text
GOOGLE_CSE_API_KEY        # Google Custom Search JSON API key
GOOGLE_CSE_ENGINE_ID      # Custom Search Engine ID (cx parameter)
```

Get credentials from [Google Cloud Console](https://console.cloud.google.com/apis/credentials) (API key) and [Programmable Search Engine](https://programmablesearchengine.google.com/) (engine ID). The free tier includes 100 image search queries per day.

### 5. Start the app

```bash
npm run dev
```

### 6. Run checks

```bash
npm run check
```

This runs TypeScript checking, ESLint, the Vitest suite and the production build. Use `npm test` for tests alone.

End-to-end tests (Playwright) drive the real production build in Chromium
against an in-browser mock of the Supabase HTTP surface (`e2e/support/mockBackend.ts`
— auth, PostgREST with simulated RLS, Storage incl. the TUS resumable endpoint,
and the SSE chat function), so they need no project, keys or network:

```bash
npm run test:e2e:install   # once: downloads Chromium
npm run test:e2e           # builds, serves on :4173, runs e2e/*.spec.ts
```

They cover sign-in and cross-user isolation, rename / pin / archive / delete
(cancel + confirm) with reload, composer keyboard behaviour (Enter, Shift+Enter,
Ctrl+Enter mode, Stop/Escape), and the upload flow (single-request and
resumable uploads with progress, cancel, and asking a question about the file).
PDF regressions use valid, runtime-generated fixtures, including a 7 MB PDF
that takes the TUS path. They exercise actual pdf.js extraction, block the
standalone `.mjs` worker asset, disable Workers with CSP or a missing API,
check concurrent/sequential reader reuse, and verify failure details in the UI
and console. Only Supabase is mocked — not the PDF parser or Worker.
Where Chromium cannot be downloaded, point `PLAYWRIGHT_CHROMIUM_PATH` at an
existing binary (and `PLAYWRIGHT_CHROMIUM_ARGS` at its launch flags).

The same mock backend can also be *used* interactively — handy for demos and
UI review without a Supabase project:

```bash
npm run demo               # http://localhost:5173 — sign in as e2e@example.com / "correct horse battery"
```

`e2e/support/mockServer.ts` serves the mock over HTTP (port 8787) and
`vite.demo.config.ts` proxies `/mock/*` to it, so the app runs unmodified with
seeded chats, streaming replies from a canned "model", resumable uploads and
sign-up. Everything is in memory and resets on restart; the AI replies are
placeholders, not real model output.

### 7. Apply database migrations

Run the SQL files in `supabase/migrations/` in order (or `supabase db push`). `20260903120000_phase2_knowledge.sql` creates the `projects`, `files`, `file_chunks` and `memories` tables (with RLS), adds `conversations.project_id` and `messages.sources`, the search indexes, the `search_all` / `match_file_chunks` functions, and the private `knowledge` Storage bucket with its policies. The latest, `20260906090000_phase3_resumable_uploads.sql`, lifts the bucket's 20 MB cap for resumable uploads, widens the MIME allow-list to the code types browsers report, and re-asserts the storage ownership policies. All migrations are idempotent and safe to re-run. Then redeploy the chat Edge Function (`supabase functions deploy chat`) so it accepts the new `context` field.

## Security

API keys are kept on the server side. The chat function authenticates requests, validates messages, attachments and knowledge context, limits request size, applies a per-user request guard and uses provider timeouts. All Phase 2 tables and the `knowledge` bucket are protected by Row Level Security: a user can only see and change their own projects, files, chunks and memories, storage objects live under `<user_id>/…` and are only readable by that user, and the search / retrieval functions run as the caller (`SECURITY INVOKER`).

See [SECURITY.md](./SECURITY.md) for deployment notes.

## Status

This is a learning and portfolio project.

## Author

**Pappu Yadav**

GitHub: https://github.com/Pappu246
