import { corsHeaders } from "../shared/cors.ts";

function allowed(host: string) {
  const h = host.toLowerCase().replace(/\.$/, "");
  return ["gstatic.com", "googleusercontent.com", "upload.wikimedia.org", "thumb.wikimedia.org"].some(b => h === b || h.endsWith(`.${b}`));
}

Deno.test("Google thumbnail host is allowed", () => { if (!allowed("encrypted-tbn0.gstatic.com")) throw new Error("expected allowed"); });
Deno.test("googleusercontent subdomain is allowed", () => { if (!allowed("lh3.googleusercontent.com")) throw new Error("expected allowed"); });
Deno.test("Wikimedia Commons thumbnail host is allowed", () => { if (!allowed("upload.wikimedia.org")) throw new Error("expected Wikimedia upload host allowed"); });
Deno.test("Wikimedia thumbnail host is allowed", () => { if (!allowed("thumb.wikimedia.org")) throw new Error("expected Wikimedia thumbnail host allowed"); });
Deno.test("unrelated Wikimedia subdomain is rejected", () => { if (allowed("api.wikimedia.org")) throw new Error("unexpected Wikimedia host allowed"); });
Deno.test("untrusted host is rejected", () => { if (allowed("evil.example.com")) throw new Error("expected rejected"); });
Deno.test("lookalike suffix is rejected", () => { if (allowed("gstatic.com.evil.example")) throw new Error("expected rejected"); });

Deno.test("image-proxy CORS headers permit configured app origin", () => {
  const req = new Request("https://localhost/functions/v1/image-proxy?url=https://gstatic.com/test.png", {
    headers: { Origin: "https://solo-ai-v2-mu.vercel.app" },
  });
  const headers = corsHeaders(req, undefined, { allowMethods: "GET, OPTIONS", allowHeaders: "Content-Type", exposeHeaders: "X-Request-Id" });
  if (headers["Access-Control-Allow-Origin"] !== "https://solo-ai-v2-mu.vercel.app") {
    throw new Error(`expected https://solo-ai-v2-mu.vercel.app but got ${headers["Access-Control-Allow-Origin"]}`);
  }
});

Deno.test("image-proxy CORS headers reject untrusted origin", () => {
  const req = new Request("https://localhost/functions/v1/image-proxy?url=https://gstatic.com/test.png", {
    headers: { Origin: "https://evil.example.com" },
  });
  const headers = corsHeaders(req, undefined, { allowMethods: "GET, OPTIONS", allowHeaders: "Content-Type", exposeHeaders: "X-Request-Id" });
  if (headers["Access-Control-Allow-Origin"] !== undefined) {
    throw new Error(`expected undefined Access-Control-Allow-Origin for untrusted origin, got ${headers["Access-Control-Allow-Origin"]}`);
  }
});
