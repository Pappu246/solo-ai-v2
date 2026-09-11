import { filterResults } from "./providers.ts";
const base={url:"https://example.com/logic.png",thumbnail:"https://encrypted-tbn0.gstatic.com/images?q=test",title:"Logic gate diagram",sourceUrl:"https://example.com/article",sourceName:"example.com",width:640,height:480};
Deno.test("valid Google thumbnail survives filtering",()=>{if(filterResults([base]).length!==1)throw new Error("valid thumbnail removed")});
Deno.test("empty provider response stays empty",()=>{if(filterResults([]).length!==0)throw new Error("expected empty")});
Deno.test("invalid thumbnail host remains a valid URL for provider normalization",()=>{if(filterResults([{...base,thumbnail:"https://bad-host.invalid/image.png"}]).length!==1)throw new Error("URL normalization should not guess hosts")});
Deno.test("malformed thumbnail URL is removed",()=>{if(filterResults([{...base,thumbnail:"not-a-url"}]).length!==0)throw new Error("malformed URL survived")});
