# Production smoke gates

The repository has a small, dependency-free production smoke suite in
`scripts/production-smoke.mjs`.

## Verification statuses

A deployed instance is only as verified as the evidence behind it. Use these
statuses exactly — never collapse them into "production is working":

| Status | Meaning | Evidence |
| --- | --- | --- |
| **CODE READY** | The smoke gate and its checks exist in the repository | `scripts/production-smoke.mjs` passes `node --check`; CI runs it |
| **CI VERIFIED** | The deterministic test matrix passes on CI | green `ci.yml` run (Node checks, Playwright, Deno) |
| **DEPLOYMENT DETECTED** | A deployment event/status was observed | `deployment_status` trigger or `freebuff-deploy status` |
| **RUNTIME VERIFIED** | The public gate passed against the live deployment | `production-smoke.yml` public job green |
| **AUTHENTICATED SMOKE VERIFIED** | The authenticated image-search + real-thumbnail path passed | `production-smoke.yml` authenticated job green (needs `SMOKE_JWT`) |

Until every applicable status above is green, report the lower statuses and
name the missing evidence explicitly.

## Required repository secrets

Set these GitHub repository secrets before running the workflow:

- `SMOKE_BASE_URL` — deployed Solo AI frontend URL.
- `SMOKE_SUPABASE_URL` — Supabase project URL.

The public gate verifies:

1. The deployed frontend responds with a successful HTTP status and HTML.
2. `chat` rejects unauthenticated requests.
3. `image-search` rejects unauthenticated requests.
4. `image-proxy` is deployed and responds to a malformed request with HTTP 400.

## Authenticated image-search gate

Create a dedicated smoke-test account and store a short-lived access token as
`SMOKE_JWT`. Never use a service-role key.

Run the workflow manually with **Run authenticated image-search + real-thumbnail
checks** enabled. The authenticated gate then:

1. Calls the real `image-search` Edge Function.
2. Requires at least one valid HTTP(S) thumbnail URL.
3. Fetches the returned thumbnail through the production `image-proxy`.
4. Requires HTTP 200 and an `image/*` content type.

This specifically validates the path that was previously missing from the
automated evidence: **search result → thumbnail URL → production proxy →
actual image bytes**.

## Automatic post-deploy runs

The workflow also listens for GitHub `deployment_status` events. Automatic
runs are disabled by default. To enable them, set the repository variable
`PRODUCTION_SMOKE_ENABLED=true`.

This extra switch prevents a deployment integration from creating noisy
failures before the two production URL secrets have been configured.

## Local run

```bash
SMOKE_BASE_URL=https://your-app.example \
SMOKE_SUPABASE_URL=https://your-project.supabase.co \
npm run smoke:production
```

Add `SMOKE_JWT=...` to exercise the authenticated image-search and real
thumbnail path locally.

The smoke script never prints the JWT value or any authorization header.
