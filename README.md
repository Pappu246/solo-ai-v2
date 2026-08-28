# ⚡ SOLO AI

A production-minded multi-model AI chat application built with **React, TypeScript, Vite, Tailwind CSS, and Supabase**.

SOLO AI provides authentication, persistent conversations, multi-provider model selection, automatic routing, streaming responses, attachments, vision-capable models, and voice/text utilities.

## ✨ Features

- 🔐 Email authentication with Supabase
- 💬 Persistent conversations and message history
- 🧠 Multi-provider AI model gateway
- ⚡ Automatic task-based model routing
- 🎯 Explicit model selection always wins over auto-routing
- 🌊 Streaming AI responses
- 🖼️ Vision/image input for supported models
- 📎 File attachments and extracted-text context
- 🔄 Regenerate responses
- 📌 Pin, rename, search, and delete conversations
- ⚙️ Theme, accent, typography, and chat preferences
- 📱 Responsive dark-first UI
- 🔊 Text-to-speech utility
- 🛡️ Server-side provider secrets, request limits, validation, timeouts, and transient-error fallbacks
- 🗃️ Supabase RLS-backed user ownership

## 🛠️ Tech Stack

- React 18 + TypeScript
- Vite + Tailwind CSS
- Supabase Auth + Postgres + Edge Functions
- Lucide React

## 🏗️ Architecture

```text
src/
├── components/     # Reusable UI
├── hooks/          # Authentication, chat, and settings logic
├── lib/            # Supabase, files, settings, and TTS utilities
├── App.tsx         # Application shell
└── types.ts        # Shared domain types

supabase/
├── functions/chat/ # Authenticated AI gateway + routing + streaming
├── migrations/     # Schema + RLS hardening
└── config.toml     # Edge Function deployment configuration
```

## 🚀 Getting Started

### 1. Clone

```bash
git clone https://github.com/Pappu246/solo-ai-v2.git
cd solo-ai-v2
```

### 2. Install

```bash
npm install
```

### 3. Configure the browser client

Create `.env` from `.env.example` and set:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

For older Supabase projects, the legacy `VITE_SUPABASE_ANON_KEY` remains supported as a temporary fallback.

### 4. Configure provider secrets

Put provider credentials in **Supabase Edge Function secrets**, never in the browser or Git repository.

```text
OPENAI_API_KEY
ANTHROPIC_API_KEY
GOOGLE_API_KEY
GROQ_API_KEY
DEEPSEEK_API_KEY
APP_ORIGIN
```

### 5. Run locally

```bash
npm run dev
```

### 6. Validate

```bash
npm run check
```

`check` runs TypeScript validation, ESLint, and the production Vite build.

## 🔒 Security

Provider API keys are server-side only. The chat Edge Function authenticates the caller, validates request size and message roles, applies a per-user request guard, enforces vision capability, uses provider timeouts, and only falls back on transient provider failures.

See [`SECURITY.md`](./SECURITY.md) before deploying publicly.

## 📌 Project Status

SOLO AI is a portfolio-grade learning project focused on modern AI application architecture, responsive UX, multi-provider routing, streaming, vision input, and Supabase-backed persistence.

## 👨‍💻 Author

**Pappu Yadav**

Built as a learning and portfolio project.
