# SOLO AI

A multi-model AI chat app built with React, TypeScript, Vite, Tailwind CSS and Supabase.

SOLO AI brings different AI providers into one chat interface with saved conversations, streaming replies, image input and a responsive UI.

## Features

- Email authentication
- Saved chat history
- Multiple AI providers and models
- Manual model selection and automatic routing
- Streaming responses
- Image input for supported models
- File attachments
- Regenerate responses
- Search, rename, pin and delete chats
- Theme and chat settings
- Responsive interface
- Text-to-speech
- Supabase Row Level Security
- Server-side API keys
- Request validation and rate limiting

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
├── hooks/
├── lib/
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

This runs TypeScript checking, ESLint and the production build.

## Security

API keys are kept on the server side. The chat function authenticates requests, validates messages and attachments, limits request size, applies a per-user request guard and uses provider timeouts.

See [SECURITY.md](./SECURITY.md) for deployment notes.

## Status

This is a learning and portfolio project.

## Author

**Pappu Yadav**

GitHub: https://github.com/Pappu246
