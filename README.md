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

- **Files** — upload PDF, TXT, Markdown, CSV, JSON and common code files (≤ 20 MB). Files are stored in a private Supabase Storage bucket, text is extracted in the browser (PDF via `pdfjs-dist`), chunked, and indexed for full-text search. Each file shows its lifecycle: *uploading → processing → ready | failed*, with retry and a reason on failure.
- **Retrieval** — before each reply, only the excerpts relevant to the question (from files attached to the chat or in its project) are sent to the model, within a strict budget. Replies show which files and excerpts were used. Nothing is sent when nothing is relevant.
- **Memory** — save facts, preferences, instructions and context explicitly (Memory view or *Remember this* on a reply). Memories carry a type, scope (every chat or one project), importance and source, and can be edited or deleted. Nothing is remembered automatically.
- **Projects** — group chats, files and memories; project instructions are sent with every chat inside the project. Create, rename, archive, delete (chats and files are detached, not deleted). Projects live in the existing sidebar.
- **Global search** — `⌘/Ctrl+K` searches chats, messages, projects, files and memories (Postgres full-text search, grouped results, per-group *more*, keyboard navigation). Results only ever include the signed-in user's data.

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
├── functions/chat/
│   ├── index.ts          request validation, auth, rate limit, Phase 2 context, SSE response
│   ├── providers.ts      model catalog + aliases, provider fallback, stream guards, safe errors
│   └── providers_test.ts offline Deno tests (`deno test supabase/functions/chat/providers_test.ts`)
├── migrations/
└── config.toml
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

### 5. Start the app

```bash
npm run dev
```

### 6. Run checks

```bash
npm run check
```

This runs TypeScript checking, ESLint, the Vitest suite and the production build. Use `npm test` for tests alone.

### 7. Apply database migrations

Run the SQL files in `supabase/migrations/` in order (or `supabase db push`). The latest, `20260903120000_phase2_knowledge.sql`, creates the `projects`, `files`, `file_chunks` and `memories` tables (with RLS), adds `conversations.project_id` and `messages.sources`, the search indexes, the `search_all` / `match_file_chunks` functions, and the private `knowledge` Storage bucket with its policies. It is idempotent and safe to re-run. Then redeploy the chat Edge Function (`supabase functions deploy chat`) so it accepts the new `context` field.

## Security

API keys are kept on the server side. The chat function authenticates requests, validates messages, attachments and knowledge context, limits request size, applies a per-user request guard and uses provider timeouts. All Phase 2 tables and the `knowledge` bucket are protected by Row Level Security: a user can only see and change their own projects, files, chunks and memories, storage objects live under `<user_id>/…` and are only readable by that user, and the search / retrieval functions run as the caller (`SECURITY INVOKER`).

See [SECURITY.md](./SECURITY.md) for deployment notes.

## Status

This is a learning and portfolio project.

## Author

**Pappu Yadav**

GitHub: https://github.com/Pappu246
