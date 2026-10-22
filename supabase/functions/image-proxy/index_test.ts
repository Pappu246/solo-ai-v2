import { corsHeaders } from "../shared/cors.ts";

function allowed(host:string){const h=host.toLowerCase().replace(/\.$/,"");return ["gstatic.com","googleusercontent.com","upload.wikimedia.org","thumb.wikimedia.org"].some(b=>h===b||h.endsWith(`.${b}`))}
Deno.test("Google thumbnail host is allowed",()=>{if(!allowed("encrypted-tbn0.gstatic.com"))throw new Error("expected allowed")});
Deno.test("googleusercontent subdomain is allowed",()=>{if(!allowed("lh3.googleusercontent.com"))throw new Error("expected allowed")});
Deno.test("Wikimedia Commons thumbnail host is allowed",()=>{if(!allowed("upload.wikimedia.org"))throw new Error("expected Wikimedia upload host allowed")});
Deno.test("Wikimedia thumbnail host is allowed",()=>{if(!allowed("thumb.wikimedia.org"))throw new Error("expected Wikimedia thumbnail host allowed")});
Deno.test("unrelated Wikimedia subdomain is rejected",()=>{if(allowed("api.wikimedia.org"))throw new Error("unexpected Wikimedia host allowed")});
Deno.test("untrusted host is rejected",()=>{if(allowed("evil.example.com"))throw new Error("expected rejected")});
Deno.test("lookalike suffix is rejected",()=>{if(allowed("gstatic.com.evil.example"))throw new Error("expected rejected")});

Deno.test("CORS allows default production origin", () => {
  const req = new Request("https://localhost/image-proxy", {
    headers: { Origin: "https://solo-ai-v2-mu.vercel.app" },
  });
  const headers = corsHeaders(req, undefined, { allowMethods: "GET, OPTIONS", allowHeaders: "Content-Type" });
  if (headers["Access-Control-Allow-Origin"] !== "https://solo-ai-v2-mu.vercel.app") {
    throw new Error("Expected production origin allowed");
  }
});

Deno.test("CORS rejects untrusted origin", () => {
  const req = new Request("https://localhost/image-proxy", {
    headers: { Origin: "https://evil.example.com" },
  });
  const headers = corsHeaders(req, undefined, { allowMethods: "GET, OPTIONS", allowHeaders: "Content-Type" });
  if (headers["Access-Control-Allow-Origin"] !== undefined) {
    throw new Error("Expected untrusted origin rejected");
  }
});
