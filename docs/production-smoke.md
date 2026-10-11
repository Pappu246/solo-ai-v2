# Production smoke gates

The dependency-free production smoke suite lives in `scripts/production-smoke.mjs`
and is wired by `.github/workflows/production-smoke.yml`.

## What each check proves

| Status | Meaning | Evidence |
| --- | --- | --- |
| **CODE READY** | The smoke script exists and parses | `node --check scripts/production-smoke.mjs` in CI |
| **CI VERIFIED** | Deterministic project checks passed | Green `CI` workflow: `validate`, `End-to-end (Playwright)`, and `Edge function (Deno)` |
| **DEPLOYMENT DETECTED** | A deployment or deployment workflow event was observed | GitHub `deployment_status` or `workflow_run` event |
| **RUNTIME VERIFIED** | The public smoke gate passed against the configured live base URL | Green `Public production smoke` job |
| **AUTHENTICATED SMOKE VERIFIED** | Authenticated image search returned usable thumbnails and the production proxy returned real image bytes | Green `Authenticated image-search + thumbnail smoke` job |

Report only the highest status supported by the recorded evidence. A skipped authenticated job is not a pass.

## Public production smoke

The public gate checks:

1. The configured frontend URL returns a successful response containing HTML.
2. The chat Edge Function rejects an unauthenticated request with HTTP 401.
3. The image-search Edge Function rejects an unauthenticated request with HTTP 401.
4. The image proxy rejects a malformed request cleanly with HTTP 400.

The workflow defaults to the current production frontend and Supabase project. Set the following repository secrets only if these defaults need to be overridden:

- `SMOKE_BASE_URL` — frontend base URL.
- `SMOKE_SUPABASE_URL` — Supabase project URL.

For same-repository pull requests, the public smoke job checks the configured live base URL; it does not test a PR preview deployment. The public smoke job also runs for successful production deployment-status events and after a successful `Deploy Supabase AI Functions` workflow on `main`.

## Authenticated image-search and thumbnail smoke

The authenticated gate validates this complete live path:

**authenticated user → image-search Edge Function → thumbnail URL → production image proxy → actual image bytes**

It requires at least one valid HTTP(S) thumbnail URL from a real image-search response and a successful proxy response with HTTP 200 and an `image/*` content type.

### Credentials

Use a dedicated smoke-test account, not a personal account, and never use a service-role key.

The workflow can obtain a short-lived session token in either of these ways:

- Provide `SMOKE_JWT` as a GitHub Actions secret; or
- Configure `SMOKE_USER_EMAIL` and `SMOKE_USER_PASSWORD` as GitHub Actions secrets so the script can sign in through Supabase Auth.

The workflow currently supplies the project's public Supabase publishable client key to the login request. It is not a service-role key. If the Supabase project changes, make sure this public client key and the configured project URL still refer to the same project.

Set `SMOKE_REQUIRE_AUTH=true` for authenticated runs. The workflow already does this, so missing or invalid authentication details fail the job rather than being reported as a pass.

### When the authenticated gate runs

- **Manual run:** Open Actions → Production Smoke Gates → Run workflow and enable **Run the authenticated image-search + real-thumbnail checks**.
- **After deployment:** It runs after a successful `Deploy Supabase AI Functions` workflow on `main`.
- A normal pull-request run does not execute the authenticated job. The public smoke job and the deterministic CI jobs are separate checks.

No `PRODUCTION_SMOKE_ENABLED` variable is required by the current workflow.

## CI merge gates

The protected `main` branch uses these required pre-merge checks:

- `validate`
- `End-to-end (Playwright)`
- `Edge function (Deno)`

Post-deployment smoke checks are runtime evidence, not pre-merge requirements.

## Local run

```bash
SMOKE_BASE_URL=https://your-app.example \\
SMOKE_SUPABASE_URL=https://your-project.supabase.co \\
npm run smoke:production
```

For the authenticated path locally, provide either `SMOKE_JWT` or the dedicated smoke-user login credentials and the matching public publishable key. Never print a JWT, password, service-role key, or Authorization header in logs.
