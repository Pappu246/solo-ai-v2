# SOLO AI

A premium AI workspace built with React, TypeScript, Vite, Tailwind CSS and Supabase.

SOLO AI brings different AI providers into one clean chat interface with saved conversations, streaming replies, image input and a responsive, accessible UI. This release is **Phase 1 — Foundation** (app shell, chat engine, auth, database, streaming, history, settings). Projects, files, memory, tools and agents arrive in later phases.

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
│   ├── layout/     Sidebar, Topbar
│   ├── settings/   SettingsPanel
│   └── ui/         Button, IconButton, Dialog, ConfirmDialog, Toast, Toggle, Kbd, Logo
├── hooks/          useAuth, useChat, useSettings, useKeyboardShortcuts, useSpeechInput
├── lib/
│   ├── chat/       api.ts (persistence), stream.ts (SSE client)
│   ├── errors.ts   friendly error mapping
│   └── settings.ts schema normalisation + theme application
├── test/           test setup and Supabase mock
├── App.tsx
└── types.ts

supabase/
├── functions/chat/
├── migrations/
└── config.toml
```

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

Run the SQL files in `supabase/migrations/` in order (or `supabase db push`). The latest, `20260903000100_add_archived_to_conversations.sql`, adds the `archived` column used by the sidebar.

## Security

API keys are kept on the server side. The chat function authenticates requests, validates messages and attachments, limits request size, applies a per-user request guard and uses provider timeouts.

See [SECURITY.md](./SECURITY.md) for deployment notes.

## Status

This is a learning and portfolio project.

## Author

**Pappu Yadav**

GitHub: https://github.com/Pappu246
