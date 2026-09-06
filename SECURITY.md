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
- The `knowledge` Storage bucket is **private** with allow-listed MIME types. Objects are keyed `<user_id>/<file_id>/<name>` and every storage policy checks `(storage.foldername(name))[1] = auth.uid()::text`. Files are read through short-lived signed URLs or authenticated downloads only.
- Uploads use the Storage **resumable (TUS) endpoint** for anything that is not tiny. The user's access token and the publishable key travel only in request headers (`Authorization`, `apikey`), never in query strings or TUS metadata; `x-upsert` is always `false` so an existing object is never silently replaced; cancelling sends the TUS termination request so no partial object is left behind. The same storage RLS policies gate every chunk.
- `search_all` and `match_file_chunks` are `SECURITY INVOKER`, revoked from `PUBLIC`/`anon`, and only ever return rows the caller can already read.
- The browser never sends ownership ids that the server trusts: `user_id` is enforced by RLS, not by the client.
- Knowledge context reaching the model (`context` in the chat request) is validated and size-capped server-side, injected into the server-controlled system prompt with clear delimiters, and the prompt instructs the model to treat file excerpts as data, not instructions. Client `system` messages are still rejected.
- Memories are only written by explicit user action. The UI discourages storing passwords, payment details or other sensitive data; treat memories as user content.
- Text extraction (including PDF via `pdfjs-dist`) runs in the browser sandbox; the service role key is never used in the browser.

## Conversation actions & RLS (Phase 3 review)

Reviewed with Phase 3 Chunk 5; no policy or trigger was changed. Current state
as applied by the migration chain (last writer wins per policy name):

| Table / bucket | Policy | Rule |
| --- | --- | --- |
| `conversations` | `Users can read/insert/update/delete own conversations` (per-command) + `Users own conversations` (`FOR ALL TO authenticated`, `20260829000100`) | `auth.uid() = user_id` as `USING` and `WITH CHECK` |
| `messages` | `Users can read/insert/delete own messages` + `Users own messages` (`FOR ALL TO authenticated`) | `auth.uid() = user_id` |
| `files` | `Users read/insert/update/delete own files` (per-command) | `auth.uid() = user_id`; insert/update also require `split_part(storage_path,'/',1) = auth.uid()::text` |
| `file_chunks`, `memories`, `projects` | per-table owner policies | `auth.uid() = user_id` (`file_chunks` insert also needs an owned `files` row) |
| `storage.objects` (`knowledge`) | `knowledge: users read/upload/update/delete own objects` | `bucket_id = 'knowledge' AND (storage.foldername(name))[1] = auth.uid()::text` |

- **Ownership triggers** (`20260904230000` + `20260905001000`) are untouched:
  `conversations_project_ownership`, `files_project_ownership`,
  `files_conversation_ownership`, `memories_project_ownership`,
  `memories_conversation_ownership`, `file_chunks_ownership`. They raise
  `42501` when a row references a project/conversation/file owned by someone
  else, closing the "known UUID" hole RLS alone would leave.
- **What cross-user access looks like in practice.** PostgREST does not return
  403 for a row you cannot see — RLS filters it out, so `SELECT` returns no
  rows, `UPDATE`/`DELETE` match 0 rows, and an `INSERT` claiming another
  owner fails with `42501`. The client therefore asks for the updated row back
  (`.select().single()`): an update that matched nothing surfaces as
  `PGRST116` → `ConversationNotFoundError` (404 / *Not found*), never as a
  silent success. Vitest covers this boundary end-to-end in
  `src/lib/chat/api.test.ts`, `src/hooks/useChat.sync.test.tsx` and the
  knowledge suites ("Bob cannot …").
- **No service-role key in the browser.** The client reads only
  `VITE_SUPABASE_URL` and the publishable key (`src/lib/supabase.ts`); the chat
  Edge Function verifies the caller with the publishable key
  (`auth.getUser(token)`) and never uses the service role either.
- **Credentials only in headers.** The chat function and the TUS upload
  endpoint receive `Authorization: Bearer <access token>` and `apikey` as
  request headers; nothing is appended to a query string. Signed download URLs
  are the single exception by design: they are short-lived (60 s), scoped to
  one object, and only issued to the owner.

## Production checklist

- Keep `.env`, `.env.local`, and provider credentials out of Git.
- Keep Supabase RLS enabled on every user-owned table.
- Configure `APP_ORIGIN` to the exact production frontend origin.
- Enable email verification/password policies appropriate for production.
- Rotate any provider credential immediately if exposed.
- Deploy the chat Edge Function after changing its code or secrets. The function injects a server-controlled system prompt; client-supplied `system` messages are rejected.
- Test sign-in, chat streaming, attachments, RLS isolation (including files, storage objects, memories and projects between two accounts), and error/fallback behavior before making the repository public.
- Keep dependency versions reviewed and update them regularly.
