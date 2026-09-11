/**
 * Smart Decision Logic for Image Search
 *
 * Determines whether a user's message should trigger an image search, and if
 * so, generates 1-3 focused search queries.
 */

import type { EnvReader, FetchLike } from "./providers.ts";

export interface ImageSearchDecision {
  shouldSearch: boolean;
  queries: string[];
  confidence: "high" | "medium" | "low";
  reason: string;
}

const NON_VISUAL_PATTERNS: RegExp[] = [
  /^\s*(calculate|compute|solve|evaluate|what\s+is)\s+[\d\s+\-*/().^=]+/i,
  /^\s*[\d\s+\-*/().^=]+\s*=\s*\??$/i,
  /\b(function|class|import|export|const|let|var|return|if|else|for|while)\b.*\{/,
  /```[\s\S]*```/,
  /^\s*(write|draft|compose|summarize|translate|explain|define)\s+(a|an|the)?\s+(text|email|letter|essay|paragraph|sentence)/i,
  /^\s*(hi|hello|hey|thanks|thank you|goodbye|bye|ok|okay|yes|no)\s*[!.]?$/i,
  /^\s*(what|who|where|when|why|how)\s+(is|are|do|does|did|will|would|can|could)\b/i,
  /^\s*(what|how)\s+(is|are)\s+(the\s+)?(meaning|definition|concept|philosophy|theory)\b/i,
];

const VISUAL_PATTERNS: RegExp[] = [
  /\b(image|picture|photo|photograph|illustration|diagram|chart|graph|screenshot|icon|logo|banner)\b/i,
  /\b(show me|find me|search for|look up)\s+(pictures?|photos?|images?|illustrations?)\b/i,
  /\b(what does|how does)\s+.*\s+(look|appear|seem)\b/i,
  /\b(visual|visualize|see|view)\b.*\b(of|for)\b/i,
  /\b(wallpaper|background|artwork|painting|drawing|sketch|design|template)\b/i,
  /\b(face|person|people|animal|landscape|scenery|building|architecture)\b.*\b(of|from|in)\b/i,
  /\b(compare|difference between|vs\.?)\b.*\b(visual|look|appearance|design)\b/i,
  /\b(brand|logo|packaging|product)\b.*\b(of|for|from)\b/i,
];

export function quickHeuristicCheck(message: string): "visual" | "non-visual" | null {
  const trimmed = message.trim();
  if (trimmed.length < 10) return null;
  for (const pattern of NON_VISUAL_PATTERNS) if (pattern.test(trimmed)) return "non-visual";
  for (const pattern of VISUAL_PATTERNS) if (pattern.test(trimmed)) return "visual";
  return null;
}

/**
 * Build deterministic image-search queries for explicit visual requests.
 * This intentionally avoids the old `of|for` regex, which could capture an
 * unrelated tail such as "the explanation" instead of the visual subject.
 */
export function extractSearchQueries(message: string): string[] {
  const normalized = message.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();
  const visualTerms = /\b(images?|pictures?|photos?|photographs?|illustrations?|diagrams?|charts?|graphs?|screenshots?|icons?|logos?|banners?)\b/gi;
  const cleaned = normalized
    .replace(visualTerms, " ")
    .replace(/\b(show me|find me|search for|look up|automatically include|relevant|wherever they improve|where they improve|include)\b/gi, " ")
    .replace(/[?!.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const queries: string[] = [];

  if (/\b(logic gates?|and|or|not|nand|nor|xor|xnor)\b/i.test(lower) && /\b(truth table|circuit|diagram|gate)\b/i.test(lower)) {
    queries.push("logic gates AND OR NOT NAND NOR XOR XNOR circuit diagrams");
    queries.push("logic gates truth table diagram chart");
    queries.push("logic gate symbols AND OR NOT NAND NOR XOR XNOR");
  } else if (/\b(truth table|circuit|block diagram|circuit diagram)\b/i.test(lower)) {
    const subject = cleaned.replace(/\b(explain|all|with|their|and|the)\b/gi, " ").replace(/\s+/g, " ").trim();
    if (subject) {
      queries.push(`${subject} circuit diagram`);
      queries.push(`${subject} truth table diagram`);
      queries.push(`${subject} block diagram`);
    }
  } else if (/\b(compare|vs\.?|difference between)\b/i.test(lower)) {
    const subject = cleaned.replace(/\b(compare|difference between|vs\.?)\b/gi, " ").replace(/\s+/g, " ").trim();
    const parts = subject.split(/\s+(?:and|vs\.?|versus)\s+/i).filter(Boolean);
    if (parts.length >= 2) {
      queries.push(`${parts[0]} ${visualHintFor(normalized)}`.trim());
      queries.push(`${parts[1]} ${visualHintFor(normalized)}`.trim());
    }
  }

  if (!queries.length && cleaned.length > 3) {
    queries.push(`${cleaned} ${visualHintFor(normalized)}`.trim());
  }

  return [...new Set(queries.map(q => q.replace(/\s+/g, " ").trim()).filter(q => q.length > 3))].slice(0, 3);
}

function visualHintFor(message: string): string {
  const lower = message.toLowerCase();
  if (/\b(diagram|circuit|block)\b/.test(lower)) return "diagram";
  if (/\b(chart|graph)\b/.test(lower)) return "chart";
  if (/\b(logo|icon)\b/.test(lower)) return "logo";
  return "images";
}

export async function modelBasedDecision(
  message: string,
  options: { env: EnvReader; fetchImpl: FetchLike; timeoutMs?: number },
): Promise<ImageSearchDecision> {
  const { env, fetchImpl, timeoutMs = 5000 } = options;
  const apiKey = env("GROQ_API_KEY")?.trim();
  if (!apiKey) return { shouldSearch: false, queries: [], confidence: "low", reason: "Decision model not configured" };

  const systemPrompt = `You are a search assistant. Analyze the user's message and decide if image search results would materially improve the answer.\n\nRespond ONLY with JSON:\n{"shouldSearch":boolean,"queries":string[],"reason":string}\n\nRules: trigger for explicit image/diagram/chart/visual requests or when visuals clearly improve a technical explanation. Do not trigger for ordinary math, code, translation, writing, or factual questions. Queries must be concrete search-engine queries, 1-3 items, and must describe the visual subject rather than generic words like "explanation".`;

  try {
    const response = await fetchImpl("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-oss-20b", messages: [{ role: "system", content: systemPrompt }, { role: "user", content: `User message: "${message}"` }], temperature: 0.1, max_tokens: 200, response_format: { type: "json_object" } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { shouldSearch: false, queries: [], confidence: "low", reason: `Decision model failed: HTTP ${response.status}` };
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return { shouldSearch: false, queries: [], confidence: "low", reason: "Decision model returned empty response" };
    const parsed = JSON.parse(content) as { shouldSearch?: boolean; queries?: string[]; reason?: string };
    return {
      shouldSearch: Boolean(parsed.shouldSearch),
      queries: Array.isArray(parsed.queries) ? parsed.queries.map(q => String(q).trim()).filter(Boolean).slice(0, 3) : [],
      confidence: "medium",
      reason: parsed.reason || "Model-based decision",
    };
  } catch (error) {
    return { shouldSearch: false, queries: [], confidence: "low", reason: `Decision model error: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function decideImageSearch(
  message: string,
  options: { env: EnvReader; fetchImpl: FetchLike; heuristicOnly?: boolean },
): Promise<ImageSearchDecision> {
  const trimmed = message.trim();
  const heuristic = quickHeuristicCheck(trimmed);

  if (heuristic === "visual") {
    const queries = extractSearchQueries(trimmed);
    return { shouldSearch: true, queries: queries.length ? queries : [trimmed], confidence: "high", reason: "Heuristic: explicit visual request" };
  }
  if (heuristic === "non-visual") return { shouldSearch: false, queries: [], confidence: "high", reason: "Heuristic: non-visual query" };
  if (options.heuristicOnly) return { shouldSearch: false, queries: [], confidence: "low", reason: "Heuristic uncertain, model decision skipped" };
  return modelBasedDecision(trimmed, options);
}
