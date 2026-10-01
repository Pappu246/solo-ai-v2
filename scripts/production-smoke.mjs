#!/usr/bin/env node

/**
 * Production smoke gates for Solo AI.
 *
 * Required for the public/unauthenticated gate:
 *   SMOKE_BASE_URL       deployed frontend URL
 *   SMOKE_SUPABASE_URL   Supabase project URL
 *
 * Optional authenticated image-search gate:
 *   SMOKE_JWT            short-lived user access token for a dedicated smoke user
 *
 * The authenticated gate deliberately verifies the real image-search contract
 * and then fetches the returned thumbnail through the image-proxy. It does not
 * bypass authentication or require service-role credentials.
 */

const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 15000);
const baseUrl = requiredUrl("SMOKE_BASE_URL");
const supabaseUrl = requiredUrl("SMOKE_SUPABASE_URL");
const jwt = process.env.SMOKE_JWT?.trim() || "";

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

async function run() {
  console.log("Solo AI production smoke gate");
  console.log(`Target: ${baseUrl}`);

  try {
    const response = await request(baseUrl);
    const type = response.headers.get("content-type") || "";
    const ok = response.status >= 200 && response.status < 400 && type.includes("text/html");
    record("frontend reachable", ok, `HTTP ${response.status}, content-type=${type.split(";")[0] || "unknown"}`);
  } catch (error) {
    record("frontend reachable", false, error instanceof Error ? error.message : String(error));
  }

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

  if (jwt) {
    const authHeaders = {
      authorization: `Bearer ${jwt}`,
      "content-type": "application/json",
    };

    try {
      const response = await request(`${supabaseUrl}/functions/v1/image-search`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ queries: ["golden retriever puppies"], maxResults: 4 }),
      });

      if (response.status !== 200) {
        const body = await response.text();
        record("authenticated image-search", false, `HTTP ${response.status}; body=${body.slice(0, 120)}`);
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
