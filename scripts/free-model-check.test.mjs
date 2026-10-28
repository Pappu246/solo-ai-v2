import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluate, parseCatalog } from "./free-model-check.mjs";

test("parses every model in the real catalog", () => {
  const source = readFileSync(new URL("../supabase/functions/chat/providers.ts", import.meta.url), "utf8");
  const models = parseCatalog(source);
  assert.ok(models.length >= 6, `found ${models.length}`);
  assert.ok(models.some((m) => m.id === "gemini-3.7-flash" && m.providerModel === "gemini-3.7-flash" && m.provider === "google"));
  assert.ok(models.some((m) => m.id === "openrouter-flint" && m.providerModel === "recursive/flint-v1.0:free"));
  assert.ok(models.some((m) => m.id === "gpt-oss-120b" && m.provider === "groq"));
});

test("flags models that disappeared or became paid, skips what it cannot check", () => {
  const models = [
    { id: "a", provider: "openrouter", providerModel: "x/free:free" },
    { id: "b", provider: "openrouter", providerModel: "x/gone:free" },
    { id: "c", provider: "openrouter", providerModel: "x/paid:free" },
    { id: "d", provider: "openrouter", providerModel: "openrouter/free" },
    { id: "e", provider: "groq", providerModel: "openai/gpt-oss-120b" },
    { id: "f", provider: "google", providerModel: "gemini-3.7-flash" },
  ];
  const listings = {
    openrouter: [
      { id: "x/free:free", pricing: { prompt: "0", completion: "0" } },
      { id: "x/paid:free", pricing: { prompt: "0.000001", completion: "0.000002" } },
    ],
    groq: ["openai/gpt-oss-120b"],
  };
  const status = Object.fromEntries(evaluate(models, listings).map((r) => [r.id, r.status]));
  assert.deepEqual(status, { a: "ok", b: "gone", c: "paid", d: "skipped", e: "ok", f: "skipped" });
});

test("without any listing nothing is reported as broken", () => {
  const models = [{ id: "a", provider: "openrouter", providerModel: "x:free" }];
  assert.equal(evaluate(models, {})[0].status, "skipped");
});
