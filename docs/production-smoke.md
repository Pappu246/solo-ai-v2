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

## Browser security response headers

The Vercel deployment sets these baseline headers on frontend routes:

| Header | Required value | Purpose |
| --- | --- | --- |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME-type sniffing |
| `X-Frame-Options` | `DENY` | Prevent framing/clickjacking |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limit referrer details sent to other origins |
| `Permissions-Policy` | `camera=(), geolocation=(), microphone=(self)` | Disable camera/geolocation APIs while retaining same-origin voice input |

The smoke script checks these headers when `SMOKE_REQUIRE_SECURITY_HEADERS=true`. The workflow enables that check for manual production smoke runs and successful Vercel Production deployment events. It is disabled on pull requests because those checks target the current production URL, not the preview deployment.

## Content Security Policy — enforced

The Vercel deployment emits an enforced `Content-Security-Policy`, with both a `Reporting-Endpoints` target and a legacy `report-uri` target. Violations are still reported to `/api/csp-report`.

The initial policy reflects known runtime requirements: Supabase HTTPS/WSS connectivity, Google Fonts, local/blob PDF.js workers, microphone access via the existing Permissions Policy, and remote HTTPS images rendered from user/assistant markdown. `img-src https:` is intentionally broad because markdown currently permits remote HTTPS images; narrowing image sources requires a separate proxy/allowlist change. Inline script/style allowances remain for the existing theme bootstrap and application styling. These allowances should be revisited before enforcement.

The `/api/csp-report` receiver accepts bounded JSON report bodies, caps individual requests at 32 KiB and logs at most 20 reports per warm instance per minute. It logs only directive, disposition, status, and resource **origins** for reports whose document origin is the canonical production origin. It omits full paths, query strings, source samples, original policy text, referrer, and user-agent. Reports are untrusted and sampled; absence of logs is not proof of zero violations.

When `SMOKE_REQUIRE_CSP_REPORTING=true`, the smoke script checks that the enforced CSP header (with `default-src 'self'`, `object-src 'none'` and the reporting directives) and the Reporting API target are present, that no report-only header remains, and that `/api/csp-report` responds as a POST-only endpoint. The workflow enables this verification on manual runs and successful Production deployment events.

The e2e suite also runs under the enforced policy (`E2E_CSP=1 npx playwright test`); any violation fails the test.

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
