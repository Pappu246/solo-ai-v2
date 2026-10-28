# Security & production checklist

## Secrets

AI provider credentials must live in Supabase Edge Function secrets, never in Vite variables, localStorage, or source control. Supabase recommends publishable keys for browser code and secret keys only for backend components.

Recommended Edge Function secrets:
- `GROQ_API_KEY`
- `GOOGLE_API_KEY`
- `OPENROUTER_API_KEY`
- `APP_ORIGIN`

## Browser keys

Only `VITE_SUPABASE_URL` and the Supabase publishable key belong in the browser. A legacy `VITE_SUPABASE_ANON_KEY` is supported temporarily for older projects.

## Browser response headers

The Vercel deployment applies baseline headers to frontend routes:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), geolocation=(), microphone=(self)`

The production smoke gate verifies these headers after successful Production deployment events and on manual production runs. Pull-request smoke checks do not enforce them because the current smoke workflow targets the already-deployed production URL rather than the PR preview.

**CSP is enforced.** `vercel.json` sends a `Content-Security-Policy` header (with `report-to` and compatibility `report-uri`). It allows the Supabase HTTPS/WSS origin, Google Fonts, local/blob PDF.js workers and HTTPS images; `img-src https:` stays broad because markdown can embed remote images, and `'unsafe-inline'` remains for the pre-paint theme script and Tailwind styles. The e2e suite runs under this exact policy (`E2E_CSP=1 npx playwright test`) and fails on any violation, so a change that needs a new origin is caught in CI.

Reports go to `/api/csp-report`. The receiver caps each body at 32 KiB, processes at most eight reports per request, and rate-limits log output to 20 records per minute per warm instance. It logs only the effective directive, disposition, status code, and normalized resource origins for reports whose document origin is `https://solo-ai-v2-mu.vercel.app`. It deliberately does not log full URL paths/queries, original policy text, source samples, referrers, or user agents. The production smoke gate checks that the report-only policy and endpoint are configured, and asserts that no enforcing `Content-Security-Policy` header is present.

Roll-back: rename the header key back to `Content-Security-Policy-Report-Only` in `vercel.json` and redeploy.

## Database function search-path hardening

All six `SECURITY DEFINER` functions in the `public` schema are configured with an empty PostgreSQL `search_path`; application relations referenced by their bodies are schema-qualified. The migrations that establish this are `20261011095514_harden_db_function_search_path.sql` and `20261011100137_harden_ownership_function_search_paths.sql`.

`public.consume_usage` intentionally remains executable by the `authenticated` role: Edge Functions call it with the user's JWT and do not need a service-role key. The function checks that `p_user_id = auth.uid()`, only accepts known usage scopes, forces each canonical window, clamps per-scope limits, validates amounts/tokens, and increments counters atomically. The `usage_counters` table deliberately has RLS enabled, no client policies, and no table grants for `anon` or `authenticated`. Do not clear these remaining advisory findings by exposing counter rows or revoking the RPC without redesigning its caller architecture.

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

## Rendering assistant output

Model replies are untrusted input and are never injected as raw HTML:

- Markdown is rendered by react-markdown with `skipHtml`; raw HTML in a reply
  is stripped, and links get `rel="noopener noreferrer nofollow"`.
- **Math** (`$…$`, `$$…$$`, plus `\(…\)`/`\[…\]` normalized first) renders
  through KaTeX (`rehype-katex`) with `trust` disabled, so LaTeX cannot embed
  URLs (`\href`, `\includegraphics`, `\url` are refused by KaTeX itself) and
  invalid formulas render as red source instead of throwing.
- **SVG** (fenced ```svg blocks and block-level `<svg>` in the reply) renders
  as a graphic only after passing `src/lib/svgSanitize.ts`, a strict
  allowlist: unknown elements are unwrapped, active-content elements
  (`<script>`, `<foreignObject>`, `<style>`, SMIL animation, `<image>`, …)
  are removed with their subtree, all `on*` handlers and `style` attributes
  are dropped, and the only URLs that survive are in-document fragments
  (`#id`, `url(#gradient)`). Input that is not well-formed XML falls back to a
  plain code block. The sanitized, inert markup is the only thing ever passed
  to `dangerouslySetInnerHTML`.
- Currency-looking dollar pairs ("$5 and $10") are escaped before math
  parsing so prices stay text instead of becoming a formula.

## Edge Function CORS

The authenticated `chat` and `image-search` Edge Functions use a strict origin allowlist. Set `APP_ORIGIN` to a comma-separated list of exact frontend origins (for example, the production origin and explicitly approved preview origins). A configured list replaces the fallback list; malformed non-empty configuration fails closed. When unset, the fallback is limited to `https://solo-ai-v2-mu.vercel.app` and the standard local Vite origins. Unlisted origins receive no `Access-Control-Allow-Origin` header; arbitrary request origins are never reflected and wildcard CORS is never emitted by these authenticated functions.

CORS only controls browser cross-origin access and is not an authorization boundary. The chat and image-search handlers still verify a Supabase JWT, and database RLS/ownership checks remain necessary. The public `image-proxy` is intentionally a separate endpoint: its protection is a strict upstream-host allowlist and byte/content-type limits, not user authentication.

## Approval-based access

When `OWNER_EMAIL` is set, `chat` and `image-search` refuse (`403`, `access_pending` / `access_blocked`) any
user who is not approved. The check runs on the server; the pending screen in the browser is only a courtesy.

- `public.user_access` has RLS: a user can read their own row and insert their own `pending` row. There is no
  client UPDATE/DELETE grant, so nobody can approve themselves.
- An approval lasts `APPROVAL_DAYS` (default 7, `0` = never). After that the user is pending again and the owner gets a
  new email; blocking never expires.
- `APPROVED_EMAILS` (optional, comma separated) lists confirmed accounts that never need approval, such as the CI
  smoke-test user.
- The owner is recognised by a **confirmed** email equal to `OWNER_EMAIL`. Create the owner account before
  opening the app to others (an email can only be registered once).
- Approvals are written by the `access-approve` function using `SUPABASE_SERVICE_ROLE_KEY` (injected by
  Supabase into Edge Functions; never in the browser). It is public (`verify_jwt = false`) on purpose: the
  authorization is an HMAC-signed token (`APPROVAL_SECRET`) bound to one decision and one user, expiring in
  7 days. The email link only opens an app page; the change happens on an explicit confirm click.
- Lookup failures fail closed (treated as pending). If `APPROVAL_SECRET` is missing, no email links are sent.
- Known limit: an unapproved but signed-in user can still read/write their own rows (chats, memories, files)
  through the database API; only the AI functions are gated. Tighten RLS if that matters for your deployment.

## Production checklist

- Keep `.env`, `.env.local`, and provider credentials out of Git.
- Keep Supabase RLS enabled on every user-owned table.
- Configure `APP_ORIGIN` to the exact production frontend origin.
- Enable email verification/password policies appropriate for production.
- Rotate any provider credential immediately if exposed.
- Deploy the chat Edge Function after changing its code or secrets. The function injects a server-controlled system prompt; client-supplied `system` messages are rejected.
- Test sign-in, chat streaming, attachments, RLS isolation (including files, storage objects, memories and projects between two accounts), and error/fallback behavior before making the repository public.
- Keep dependency versions reviewed and update them regularly.
