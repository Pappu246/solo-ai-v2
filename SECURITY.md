# Security & production checklist

## Secrets

AI provider credentials must live in Supabase Edge Function secrets, never in Vite variables, localStorage, or source control. Supabase recommends publishable keys for browser code and secret keys only for backend components.

Recommended Edge Function secrets:
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_API_KEY`
- `GROQ_API_KEY`
- `DEEPSEEK_API_KEY`
- `APP_ORIGIN`

## Browser keys

Only `VITE_SUPABASE_URL` and the Supabase publishable key belong in the browser. A legacy `VITE_SUPABASE_ANON_KEY` is supported temporarily for older projects.

## Production checklist

- Keep `.env`, `.env.local`, and provider credentials out of Git.
- Keep Supabase RLS enabled on every user-owned table.
- Configure `APP_ORIGIN` to the exact production frontend origin.
- Enable email verification/password policies appropriate for production.
- Rotate any provider credential immediately if exposed.
- Deploy the chat Edge Function after changing its code or secrets. The function injects a server-controlled system prompt; client-supplied `system` messages are rejected.
- Test sign-in, chat streaming, attachments, RLS isolation, and error/fallback behavior before making the repository public.
- Keep dependency versions reviewed and update them regularly.
