function allowed(host:string){const h=host.toLowerCase().replace(/\.$/,"");return ["gstatic.com","googleusercontent.com"].some(b=>h===b||h.endsWith(`.${b}`))}
Deno.test("Google thumbnail host is allowed",()=>{if(!allowed("encrypted-tbn0.gstatic.com"))throw new Error("expected allowed")});
Deno.test("googleusercontent subdomain is allowed",()=>{if(!allowed("lh3.googleusercontent.com"))throw new Error("expected allowed")});
Deno.test("untrusted host is rejected",()=>{if(allowed("evil.example.com"))throw new Error("expected rejected")});
Deno.test("lookalike suffix is rejected",()=>{if(allowed("gstatic.com.evil.example"))throw new Error("expected rejected")});
