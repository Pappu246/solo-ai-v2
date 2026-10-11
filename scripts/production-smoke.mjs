#!/usr/bin/env node

/**
 * Production smoke gates for Solo AI.
 *
 * Required for the public/unauthenticated gate:
 *   SMOKE_BASE_URL       deployed frontend URL
 *   SMOKE_SUPABASE_URL   Supabase project URL
 *
 * Authenticated image-search gate:
 *   SMOKE_JWT            optional access token (normally obtained by login below)
 *   SMOKE_USER_EMAIL     dedicated test user's email (GitHub Actions secret)
 *   SMOKE_USER_PASSWORD  dedicated test user's password (GitHub Actions secret)
 *   SMOKE_REQUIRE_AUTH   set to "true" so missing credentials fail instead of skip
 *   SMOKE_REQUIRE_SECURITY_HEADERS  verify expected browser response headers
 *   SMOKE_REQUIRE_CORS_ALLOWLIST     verify approved/denied browser origins after Edge Function deploys
 *   SMOKE_REQUIRE_CSP_REPORTING      verify report-only policy and reachable report endpoint
 *
 * The authenticated gate deliberately verifies the real image-search contract
 * and then fetches the returned thumbnail through the image-proxy. It does not
 * bypass authentication or require service-role credentials.
 */

const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 15000);
const baseUrl = requiredUrl("SMOKE_BASE_URL");
const supabaseUrl = requiredUrl("SMOKE_SUPABASE_URL");
let jwt = process.env.SMOKE_JWT?.trim() || "";
const requireAuth = process.env.SMOKE_REQUIRE_AUTH === "true";
const requireSecurityHeaders = process.env.SMOKE_REQUIRE_SECURITY_HEADERS === "true";
const requireCorsAllowlist = process.env.SMOKE_REQUIRE_CORS_ALLOWLIST === "true";
const requireCspReporting = process.env.SMOKE_REQUIRE_CSP_REPORTING === "true";
const smokeEmail = process.env.SMOKE_USER_EMAIL?.trim() || "";
const smokePassword = process.env.SMOKE_USER_PASSWORD || "";
const publishableKey = process.env.SMOKE_SUPABASE_PUBLISHABLE_KEY?.trim() || "";

const checks = [];

function requiredUrl(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must be a valid URL`); }
  if (url.protocol !== "https:" && process.env.CI) throw new Error(`${name} must use HTTPS in CI`);
  return value.replace(/\/+$/, "");
}

function record(name, ok, detail) {
  checks.push({ name, ok, detail });
  const prefix = ok ? "PASS" : "FAIL";
  console.log(`[${prefix}] ${name} — ${detail}`);
}

async function request(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, redirect: "manual", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function expectStatus(name, url, expected, init) {
  try {
    const response = await request(url, init);
    const ok = response.status === expected;
    record(name, ok, `HTTP ${response.status} (expected ${expected})`);
    return response;
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function checkCorsAllowlist() {
  const expectedOrigin = new URL(baseUrl).origin;
  const untrustedOrigin = "https://solo-ai-cors-probe.invalid";

  for (const functionName of ["chat", "image-search"]) {
    const endpoint = `${supabaseUrl}/functions/v1/${functionName}`;
    const preflight = (origin) => ({
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,apikey,content-type",
      },
    });

    try {
      const response = await request(endpoint, preflight(expectedOrigin));
      const allowedOrigin = response.headers.get("access-control-allow-origin") || "";
      const methods = (response.headers.get("access-control-allow-methods") || "").toLowerCase();
      const headers = (response.headers.get("access-control-allow-headers") || "").toLowerCase();
      const ok = response.status >= 200 && response.status < 400 &&
        allowedOrigin === expectedOrigin &&
        methods.includes("post") && methods.includes("options") &&
        headers.includes("authorization") && headers.includes("apikey") && headers.includes("content-type");
      record(
        `${functionName} CORS allows production origin`,
        ok,
        `HTTP ${response.status}, allow-origin=${allowedOrigin || "(absent)"}`,
      );
    } catch (error) {
      record(`${functionName} CORS allows production origin`, false, error instanceof Error ? error.message : String(error));
    }

    try {
      const response = await request(endpoint, preflight(untrustedOrigin));
      const allowOrigin = response.headers.get("access-control-allow-origin");
      const ok = response.status >= 200 && response.status < 400 && !allowOrigin;
      record(
        `${functionName} CORS rejects untrusted origin`,
        ok,
        `HTTP ${response.status}, allow-origin=${allowOrigin || "(absent)"}`,
      );
    } catch (error) {
      record(`${functionName} CORS rejects untrusted origin`, false, error instanceof Error ? error.message : String(error));
    }
  }
}

async function run() {
  console.log("Solo AI production smoke gate");
  console.log(`Target: ${baseUrl}`);

  try {
    const response = await request(baseUrl);
    const type = response.headers.get("content-type") || "";
    const ok = response.status >= 200 && response.status < 400 && type.includes("text/html");
    record("frontend reachable", ok, `HTTP ${response.status}, content-type=${type.split(";")[0] || "unknown"}`);

    if (requireCspReporting) {
      const reportOnlyPolicy = (response.headers.get("content-security-policy-report-only") || "").toLowerCase();
      const reportingEndpoints = (response.headers.get("reporting-endpoints") || "").toLowerCase();
      const enforcedPolicy = response.headers.get("content-security-policy") || "";
      const policyOk =
        reportOnlyPolicy.includes("report-uri /api/csp-report") &&
        reportOnlyPolicy.includes("report-to csp-endpoint") &&
        reportingEndpoints.includes('csp-endpoint="https://solo-ai-v2-mu.vercel.app/api/csp-report"') &&
        !enforcedPolicy.trim();
      record(
        "CSP policy is report-only",
        policyOk,
        policyOk
          ? "Reporting endpoint is configured and no enforcing Content-Security-Policy header is present."
          : `Report-only policy/report endpoint missing or an enforcing policy is present (report-only length=${reportOnlyPolicy.length}, reporting endpoint=${reportingEndpoints ? "present" : "missing"}, enforced policy=${enforcedPolicy ? "present" : "absent"}).`,
      );

      try {
        const reportEndpoint = new URL("/api/csp-report", baseUrl).toString();
        const endpointResponse = await request(reportEndpoint, { method: "GET" });
        const allow = (endpointResponse.headers.get("allow") || "").toUpperCase();
        const endpointOk = endpointResponse.status === 405 && allow.split(",").map(v => v.trim()).includes("POST");
        record(
          "CSP report endpoint reachable",
          endpointOk,
          `HTTP ${endpointResponse.status}, Allow=${allow || "(absent)"}`,
        );
      } catch (error) {
        record("CSP report endpoint reachable", false, error instanceof Error ? error.message : String(error));
      }
    }
    if (requireSecurityHeaders) {
      const expectedHeaders = [
        ["x-content-type-options", "nosniff"],
        ["x-frame-options", "deny"],
        ["referrer-policy", "strict-origin-when-cross-origin"],
      ];
      const problems = expectedHeaders
        .filter(([name, expected]) => (response.headers.get(name) || "").trim().toLowerCase() !== expected)
        .map(([name, expected]) => `${name}: expected ${expected}`);
      const permissionsPolicy = (response.headers.get("permissions-policy") || "").toLowerCase().replace(/\s/g, "");
      for (const directive of ["camera=()", "geolocation=()", "microphone=(self)"]) {
        if (!permissionsPolicy.includes(directive)) problems.push(`permissions-policy: missing ${directive}`);
      }
      record(
        "production security headers",
        problems.length === 0,
        problems.length === 0
          ? "X-Content-Type-Options, X-Frame-Options, Referrer-Policy, and Permissions-Policy are present."
          : problems.join("; "),
      );
    }
  } catch (error) {
    record("frontend reachable", false, error instanceof Error ? error.message : String(error));
    if (requireCspReporting) {
      record("CSP policy is report-only", false, "Frontend request failed; CSP headers could not be verified.");
      record("CSP report endpoint reachable", false, "Frontend request failed; report endpoint could not be verified.");
    }

    if (requireSecurityHeaders) {
      record("production security headers", false, "Frontend request failed; response headers could not be verified.");
    }
  }

  if (requireCorsAllowlist) await checkCorsAllowlist();

  await expectStatus(
    "chat auth boundary",
    `${supabaseUrl}/functions/v1/chat`,
    401,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) },
  );

  await expectStatus(
    "image-search auth boundary",
    `${supabaseUrl}/functions/v1/image-search`,
    401,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ queries: ["smoke"] }) },
  );

  await expectStatus(
    "image-proxy public route",
    `${supabaseUrl}/functions/v1/image-proxy`,
    400,
  );

  // Obtain a fresh short-lived user JWT at runtime when one was not explicitly supplied.
  // Only a dedicated low-privilege smoke account should be used here.
  if (!jwt && requireAuth && smokeEmail && smokePassword && publishableKey) {
    try {
      const loginResponse = await request(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: {
          apikey: publishableKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: smokeEmail, password: smokePassword }),
      });
      if (loginResponse.status === 200) {
        const loginBody = await loginResponse.json();
        if (typeof loginBody?.access_token === "string" && loginBody.access_token.length > 0) {
          jwt = loginBody.access_token;
          record("authenticated smoke login", true, "Dedicated test user signed in; short-lived token obtained.");
        } else {
          record("authenticated smoke login", false, "Login response did not contain an access token.");
        }
      } else {
        // Do not log the response body: auth providers may return sensitive details.
        record("authenticated smoke login", false, `HTTP ${loginResponse.status}; check test-account credentials and email confirmation.`);
      }
    } catch (error) {
      record("authenticated smoke login", false, error instanceof Error ? error.message : String(error));
    }
  }

  if (jwt) {
    const authHeaders = {
      authorization: `Bearer ${jwt}`,
      apikey: publishableKey,
      "content-type": "application/json",
    };

    try {
      const response = await request(`${supabaseUrl}/functions/v1/image-search`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ queries: ["golden retriever puppies"], maxResults: 4 }),
      });

      if (response.status !== 200) {
        record("authenticated image-search", false, `HTTP ${response.status}; authenticated request was rejected.`);
      } else {
        const body = await response.json();
        const results = Array.isArray(body?.results) ? body.results : [];
        const valid = results.length > 0 && results.every((item) =>
          typeof item?.thumbnail === "string" &&
          /^https?:\/\//i.test(item.thumbnail)
        );
        record("authenticated image-search", valid, `${results.length} result(s) with HTTP thumbnail URLs`);

        const firstThumbnail = results[0]?.thumbnail;
        if (valid && firstThumbnail) {
          try {
            const proxyUrl = `${supabaseUrl}/functions/v1/image-proxy?url=${encodeURIComponent(firstThumbnail)}`;
            const thumbResponse = await request(proxyUrl);
            const contentType = thumbResponse.headers.get("content-type") || "";
            const thumbOk = thumbResponse.status === 200 && contentType.toLowerCase().startsWith("image/");
            record(
              "real thumbnail proxy",
              thumbOk,
              `HTTP ${thumbResponse.status}, content-type=${contentType.split(";")[0] || "unknown"}`,
            );
          } catch (error) {
            record("real thumbnail proxy", false, error instanceof Error ? error.message : String(error));
          }
        }
      }
    } catch (error) {
      record("authenticated image-search", false, error instanceof Error ? error.message : String(error));
    }
  } else if (requireAuth) {
    record(
      "authenticated credentials",
      false,
      "No session token found. Configure SMOKE_USER_EMAIL and SMOKE_USER_PASSWORD secrets (or SMOKE_JWT) before running the authenticated gate.",
    );
  } else {
    console.log("[INFO] Authenticated image-search/thumbnail checks skipped: SMOKE_JWT is not set.");
  }

  const failed = checks.filter(check => !check.ok);
  console.log(`Smoke summary: ${checks.length - failed.length}/${checks.length} required checks passed.`);

  if (failed.length) {
    for (const check of failed) console.error(`  - ${check.name}: ${check.detail}`);
    process.exitCode = 1;
  }
}

run().catch(error => {
  console.error(`Smoke gate aborted: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
