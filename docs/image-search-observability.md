# Image Search Observability

The diagnostics helper is best-effort and bounded. It must not be treated as proof that production thumbnails loaded in an authenticated browser session.

Required smoke tests after deployment:

- Visual query with Gemini 3.7 Flash: confirm real thumbnails render.
- Visual query with GPT OSS 120B: confirm real thumbnails render.
- Non-visual query (`What is 17 × 29?`): confirm image search is not invoked.
- Confirm the same request ID is present across backend logs, SSE, frontend parsing, and proxy diagnostics when those diagnostics are enabled.
