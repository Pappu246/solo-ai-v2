# ⚡ SOLO AI

A modern multi-model AI chat application built with **React, TypeScript, Vite, Tailwind CSS, and Supabase**.

SOLO AI provides a clean chat experience with authentication, persistent conversations, model selection, automatic model routing, streaming responses, attachments, and voice/text utilities.

## ✨ Features

- 🔐 Email authentication with Supabase
- 💬 Persistent conversations and message history
- 🧠 Multi-model AI support across multiple providers
- ⚡ Automatic routing by task category
- 🌊 Streaming AI responses
- 🖼️ Image/vision attachment support where supported
- 📎 File attachments and extracted text context
- 🔄 Regenerate responses
- 📌 Pin, rename, search, and delete conversations
- ⚙️ User settings and model preferences
- 📱 Responsive dark UI
- 🔊 Text-to-speech utility

## 🛠️ Tech Stack

- React 18 + TypeScript
- Vite
- Tailwind CSS
- Supabase Auth + Database + Edge Functions
- Lucide React

## 🏗️ Architecture

```text
src/
├── components/     # Reusable UI components
├── hooks/          # Authentication, chat, and settings logic
├── lib/            # Supabase, file, settings, and TTS utilities
├── App.tsx         # Application shell and UI composition
├── main.tsx        # React entry point
└── types.ts        # Shared TypeScript types

supabase/
├── functions/chat/ # Server-side AI gateway and model routing
└── migrations/     # Database schema migrations
```

## 🚀 Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/Pappu246/solo-ai-v2.git
cd solo-ai-v2
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file using `.env.example` as a template and provide your Supabase project URL and anonymous key.

> Never commit private provider API keys or other secrets to Git.

### 4. Start development server

```bash
npm run dev
```

### 5. Validate the project

```bash
npm run lint
npm run typecheck
npm run build
```

## 🔑 Environment Variables

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

Provider API keys should remain server-side in Supabase Edge Function secrets rather than being exposed in the browser.

## 📌 Project Status

SOLO AI is an actively developed portfolio project focused on modern AI application architecture, responsive UX, multi-provider model routing, and Supabase-backed persistence.

## 👨‍💻 Author

**Pappu Yadav**

Built as a learning and portfolio project.
