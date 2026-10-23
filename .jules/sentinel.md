## 2025-05-20 - Enforce Shared CORS Allowlist in Edge Functions
**Vulnerability:** The `image-proxy` Edge Function implemented a custom `cors` helper that reflected `req.headers.get("Origin") || "*"`, allowing arbitrary origins cross-origin access.
**Learning:** Custom inline CORS implementations can easily introduce origin reflection vulnerabilities if they bypass centralized CORS policy helpers.
**Prevention:** All Supabase Edge Functions must import and use `corsHeaders` from `supabase/functions/shared/cors.ts` rather than reimplementing CORS logic locally.
