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

## Knowledge layer (Phase 2)

- `projects`, `files`, `file_chunks` and `memories` have RLS enabled with `auth.uid() = user_id` on every operation. `files` additionally requires the storage path to start with the caller's user id; `file_chunks` can only be inserted for a file the caller owns.
- The `knowledge` Storage bucket is **private** (20 MB limit, allow-listed MIME types). Objects are keyed `<user_id>/<file_id>/<name>` and every storage policy checks `(storage.foldername(name))[1] = auth.uid()::text`. Files are read through short-lived signed URLs or authenticated downloads only.
- `search_all` and `match_file_chunks` are `SECURITY INVOKER`, revoked from `PUBLIC`/`anon`, and only ever return rows the caller can already read.
- The browser never sends ownership ids that the server trusts: `user_id` is enforced by RLS, not by the client.
- Knowledge context reaching the model (`context` in the chat request) is validated and size-capped server-side, injected into the server-controlled system prompt with clear delimiters, and the prompt instructs the model to treat file excerpts as data, not instructions. Client `system` messages are still rejected.
- Memories are only written by explicit user action. The UI discourages storing passwords, payment details or other sensitive data; treat memories as user content.
- Text extraction (including PDF via `pdfjs-dist`) runs in the browser sandbox; the service role key is never used in the browser.

## Production checklist

- Keep `.env`, `.env.local`, and provider credentials out of Git.
- Keep Supabase RLS enabled on every user-owned table.
- Configure `APP_ORIGIN` to the exact production frontend origin.
- Enable email verification/password policies appropriate for production.
- Rotate any provider credential immediately if exposed.
- Deploy the chat Edge Function after changing its code or secrets. The function injects a server-controlled system prompt; client-supplied `system` messages are rejected.
- Test sign-in, chat streaming, attachments, RLS isolation (including files, storage objects, memories and projects between two accounts), and error/fallback behavior before making the repository public.
- Keep dependency versions reviewed and update them regularly.
