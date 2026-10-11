import { corsHeaders } from "./cors.ts";

function assertEquals<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const OPTIONS = {
  allowMethods: "GET, POST, OPTIONS",
  allowHeaders: "Content-Type, Authorization, X-Client-Info, Apikey",
  exposeHeaders: "X-Request-Id",
};

Deno.test("default allowlist accepts the current production origin", () => {
  const req = new Request("https://edge.example/functions/v1/chat", {
    headers: { Origin: "https://solo-ai-v2-mu.vercel.app" },
  });
  const headers = corsHeaders(req, undefined, OPTIONS);
  assertEquals(headers["Access-Control-Allow-Origin"], "https://solo-ai-v2-mu.vercel.app", "production origin");
  assertEquals(headers["Vary"], "Origin", "vary header");
});

Deno.test("default allowlist does not reflect an arbitrary origin", () => {
  const req = new Request("https://edge.example/functions/v1/chat", {
    headers: { Origin: "https://attacker.example" },
  });
  const headers = corsHeaders(req, undefined, OPTIONS);
  assertEquals(headers["Access-Control-Allow-Origin"], undefined, "untrusted origin");
  assertEquals(headers["Access-Control-Allow-Credentials"], undefined, "credentials are not enabled");
});

Deno.test("explicit APP_ORIGIN list replaces defaults and permits exact matches", () => {
  const allowed = new Request("https://edge.example/functions/v1/chat", {
    headers: { Origin: "https://app.example" },
  });
  const deniedDefault = new Request("https://edge.example/functions/v1/chat", {
    headers: { Origin: "https://solo-ai-v2-mu.vercel.app" },
  });
  assertEquals(corsHeaders(allowed, "https://app.example, https://preview.example", OPTIONS)["Access-Control-Allow-Origin"], "https://app.example", "explicit match");
  assertEquals(corsHeaders(deniedDefault, "https://app.example, https://preview.example", OPTIONS)["Access-Control-Allow-Origin"], undefined, "default not implicitly allowed");
});

Deno.test("invalid non-empty APP_ORIGIN configuration fails closed", () => {
  const req = new Request("https://edge.example/functions/v1/chat", {
    headers: { Origin: "https://solo-ai-v2-mu.vercel.app" },
  });
  assertEquals(corsHeaders(req, "ftp://not-an-http-origin", OPTIONS)["Access-Control-Allow-Origin"], undefined, "invalid configuration");
});

Deno.test("does not allow malformed Origin values containing a path", () => {
  const req = new Request("https://edge.example/functions/v1/chat", {
    headers: { Origin: "https://app.example/path" },
  });
  assertEquals(corsHeaders(req, "https://app.example", OPTIONS)["Access-Control-Allow-Origin"], undefined, "malformed origin");
});

Deno.test("requests without Origin remain usable by non-browser clients without wildcard CORS", () => {
  const req = new Request("https://edge.example/functions/v1/chat");
  const headers = corsHeaders(req, undefined, OPTIONS);
  assertEquals(headers["Access-Control-Allow-Origin"], undefined, "missing origin");
  assertEquals(headers["Access-Control-Allow-Methods"], OPTIONS.allowMethods, "allowed methods");
  assertEquals(headers["Access-Control-Allow-Headers"], OPTIONS.allowHeaders, "allowed headers");
  assertEquals(headers["Access-Control-Expose-Headers"], OPTIONS.exposeHeaders, "exposed headers");
});
