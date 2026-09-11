import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideImageSearch, extractSearchQueries, quickHeuristicCheck } from "./decision.ts";

const env = (_name: string) => undefined;
const fetchImpl = async (_input: string, _init?: RequestInit) => new Response("", { status: 500 });

Deno.test("logic gate visual prompt triggers search with focused queries", async () => {
  const prompt = "Explain all logic gates (AND, OR, NOT, NAND, NOR, XOR, XNOR) with their circuit/block diagrams and truth tables. Automatically include relevant images/diagrams wherever they improve the explanation.";
  assertEquals(quickHeuristicCheck(prompt), "visual");
  const result = await decideImageSearch(prompt, { env, fetchImpl });
  assert(result.shouldSearch);
  assertEquals(result.queries.length, 3);
  assertStringIncludes(result.queries[0].toLowerCase(), "logic gates");
  assertStringIncludes(result.queries[0].toLowerCase(), "circuit diagrams");
  assert(!result.queries.some(q => q.toLowerCase() === "the explanation"));
});

Deno.test("ordinary multiplication does not trigger image search", async () => {
  const result = await decideImageSearch("What is 17 × 29?", { env, fetchImpl });
  assertEquals(result.shouldSearch, false);
  assertEquals(result.queries, []);
});

Deno.test("visual query extractor never uses an unrelated for/of tail", () => {
  const result = extractSearchQueries("Show me diagrams of CPU architecture and block diagrams wherever they improve the explanation");
  assert(result.length > 0);
  assert(!result.some(q => q.toLowerCase() === "the explanation"));
});
