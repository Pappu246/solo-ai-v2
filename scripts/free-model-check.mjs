/**
 * Free-model health check.
 *
 * Reads the model catalog from supabase/functions/chat/providers.ts and asks
 * each provider whether the model id still exists (and, on OpenRouter, is still
 * free). Free tiers change without notice: this is what caught Qwen3 Coder
 * silently turning paid. OpenRouter's list is public; Groq and Google are
 * checked only when GROQ_API_KEY / GOOGLE_API_KEY are present (optional GitHub
 * secrets), otherwise they are reported as skipped.
 *
 * Exit code 1 when any model is gone or no longer free.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Extract { id, provider, providerModel } from the MODELS array (one entry per line). */
export function parseCatalog(source) {
  const models = [];
  for (const line of source.split("\n")) {
    const id = /^\s*\{\s*id:\s*"([^"]+)"/.exec(line)?.[1];
    const provider = /\bprovider:\s*"([^"]+)"/.exec(line)?.[1];
    if (!id || !provider) continue;
    // Entries without provider_model use their own id upstream (e.g. Gemini).
    const providerModel = /\bprovider_model:\s*"([^"]+)"/.exec(line)?.[1] ?? id;
    models.push({ id, provider, providerModel });
  }
  return models;
}

const isRouter = (providerModel) => providerModel.startsWith("openrouter/");

/**
 * @param models parsed catalog
 * @param listings { openrouter?: Array<{id, pricing}>, groq?: string[], google?: string[] }
 * @returns [{ id, status: "ok" | "gone" | "paid" | "skipped", detail }]
 */
export function evaluate(models, listings) {
  return models.map(({ id, provider, providerModel }) => {
    if (provider === "openrouter") {
      if (isRouter(providerModel)) return { id, status: "skipped", detail: "router id, not in model list" };
      const found = listings.openrouter?.find((m) => m.id === providerModel);
      if (!listings.openrouter) return { id, status: "skipped", detail: "OpenRouter list unavailable" };
      if (!found) return { id, status: "gone", detail: `${providerModel} is not listed on OpenRouter` };
      const free = Number(found.pricing?.prompt) === 0 && Number(found.pricing?.completion) === 0;
      return free
        ? { id, status: "ok", detail: providerModel }
        : { id, status: "paid", detail: `${providerModel} is no longer free` };
    }
    const list = listings[provider];
    if (!list) return { id, status: "skipped", detail: `no ${provider.toUpperCase()}_API_KEY, not checked` };
    return list.includes(providerModel)
      ? { id, status: "ok", detail: providerModel }
      : { id, status: "gone", detail: `${providerModel} is not listed by ${provider}` };
  });
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function loadListings(env) {
  const listings = {};
  try {
    listings.openrouter = (await getJson("https://openrouter.ai/api/v1/models")).data ?? [];
  } catch (error) {
    console.warn(`OpenRouter list failed: ${error.message}`);
  }
  if (env.GROQ_API_KEY) {
    try {
      const data = await getJson("https://api.groq.com/openai/v1/models", { Authorization: `Bearer ${env.GROQ_API_KEY}` });
      listings.groq = (data.data ?? []).map((m) => m.id);
    } catch (error) {
      console.warn(`Groq list failed: ${error.message}`);
    }
  }
  if (env.GOOGLE_API_KEY) {
    try {
      const data = await getJson("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
        "x-goog-api-key": env.GOOGLE_API_KEY,
      });
      listings.google = (data.models ?? []).map((m) => String(m.name).replace(/^models\//, ""));
    } catch (error) {
      console.warn(`Google list failed: ${error.message}`);
    }
  }
  return listings;
}

async function main() {
  const source = readFileSync(fileURLToPath(new URL("../supabase/functions/chat/providers.ts", import.meta.url)), "utf8");
  const models = parseCatalog(source);
  if (!models.length) throw new Error("No models found in providers.ts; the parser needs updating.");
  const results = evaluate(models, await loadListings(process.env));
  for (const r of results) console.log(`${r.status.padEnd(8)} ${r.id}  ${r.detail}`);
  const bad = results.filter((r) => r.status === "gone" || r.status === "paid");
  if (bad.length) {
    console.error(`\n${bad.length} model(s) need attention:\n${bad.map((r) => `- ${r.id}: ${r.detail}`).join("\n")}`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
