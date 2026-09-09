/**
 * Smart Decision Logic for Image Search
 *
 * Determines whether a user's message should trigger an image search, and if
 * so, generates 1-3 focused search queries.
 *
 * Strategy:
 * 1. Fast-path heuristic: keyword/pattern matching to skip obviously non-visual
 *    queries (math, code, greetings, pure text tasks).
 * 2. For borderline cases, use a lightweight model call to analyze the message
 *    and generate search queries.
 *
 * The heuristic is conservative — when in doubt, we let the model decide.
 */

import type { EnvReader, FetchLike } from "./providers.ts";

// ── Types ───────────────────────────────────────────────────────────────────

export interface ImageSearchDecision {
  /** Whether to trigger image search. */
  shouldSearch: boolean;
  /** 1-3 search queries to execute (empty if shouldSearch is false). */
  queries: string[];
  /** Confidence level of the decision. */
  confidence: "high" | "medium" | "low";
  /** Reason for the decision (for logging/debugging). */
  reason: string;
}

// ── Fast-Path Heuristics ────────────────────────────────────────────────────

/** Patterns that indicate the query is NOT visual. */
const NON_VISUAL_PATTERNS: RegExp[] = [
  // Pure math/calculation
  /^\s*(calculate|compute|solve|evaluate|what\s+is)\s+[\d\s+\-*/().^=]+/i,
  /^\s*[\d\s+\-*/().^=]+\s*=\s*\??$/i,
  // Code/debugging without visual context
  /\b(function|class|import|export|const|let|var|return|if|else|for|while)\b.*\{/,
  /```[\s\S]*```/,
  // Pure text tasks
  /^\s*(write|draft|compose|summarize|translate|explain|define)\s+(a|an|the)?\s+(text|email|letter|essay|paragraph|sentence)/i,
  // Greetings and simple questions
  /^\s*(hi|hello|hey|thanks|thank you|goodbye|bye|ok|okay|yes|no)\s*[!.]?$/i,
  /^\s*(what|who|where|when|why|how)\s+(is|are|do|does|did|will|would|can|could)\b/i,
  // Abstract concepts without visual elements
  /^\s*(what|how)\s+(is|are)\s+(the\s+)?(meaning|definition|concept|philosophy|theory)\b/i,
];

/** Patterns that indicate the query IS visual. */
const VISUAL_PATTERNS: RegExp[] = [
  // Explicit image requests
  /\b(image|picture|photo|photograph|illustration|diagram|chart|graph|screenshot|icon|logo|banner)\b/i,
  /\b(show me|find me|search for|look up)\s+(pictures?|photos?|images?|illustrations?)\b/i,
  // Visual descriptions
  /\b(what does|how does)\s+.*\s+(look|appear|seem)\b/i,
  /\b(visual|visualize|see|view)\b.*\b(of|for)\b/i,
  // Specific visual topics
  /\b(wallpaper|background|artwork|painting|drawing|sketch|design|template)\b/i,
  /\b(face|person|people|animal|animal|landscape|scenery|building|architecture)\b.*\b(of|from|in)\b/i,
  // Comparison requests that benefit from images
  /\b(compare|difference between|vs\.?)\b.*\b(visual|look|appearance|design)\b/i,
  // Product/brand visual queries
  /\b(brand|logo|packaging|product)\b.*\b(of|for|from)\b/i,
];

/**
 * Quick heuristic check: is this query obviously visual or non-visual?
 * Returns null if uncertain (needs model-based decision).
 */
export function quickHeuristicCheck(message: string): "visual" | "non-visual" | null {
  const trimmed = message.trim();

  // Too short to determine
  if (trimmed.length < 10) return null;

  // Check for explicit non-visual patterns
  for (const pattern of NON_VISUAL_PATTERNS) {
    if (pattern.test(trimmed)) return "non-visual";
  }

  // Check for explicit visual patterns
  for (const pattern of VISUAL_PATTERNS) {
    if (pattern.test(trimmed)) return "visual";
  }

  // Uncertain — need model to decide
  return null;
}

// ── Model-Based Decision ────────────────────────────────────────────────────

/**
 * Use a fast, cheap model to analyze the message and decide if image search
 * is needed, plus generate search queries.
 *
 * We use a structured prompt that forces a JSON response with:
 * - shouldSearch: boolean
 * - queries: string[] (1-3 queries)
 * - reason: string
 */
export async function modelBasedDecision(
  message: string,
  options: {
    env: EnvReader;
    fetchImpl: FetchLike;
    timeoutMs?: number;
  },
): Promise<ImageSearchDecision> {
  const { env, fetchImpl, timeoutMs = 5000 } = options;

  // Use a fast model for this decision (Groq OSS 20B or similar)
  const apiKey = env("GROQ_API_KEY")?.trim();
  if (!apiKey) {
    console.warn("[image-search] No GROQ_API_KEY for decision model, defaulting to no search");
    return {
      shouldSearch: false,
      queries: [],
      confidence: "low",
      reason: "Decision model not configured",
    };
  }

  const systemPrompt = `You are a search assistant. Analyze the user's message and decide if they need image search results.

Respond ONLY with a JSON object (no markdown, no explanation):
{
  "shouldSearch": boolean,
  "queries": string[],
  "reason": string
}

Rules:
- Set shouldSearch to true ONLY if the user explicitly asks for images/pictures/visual content, or if showing images would clearly enhance the answer.
- Generate 1-3 specific, focused search queries (not too broad, not too narrow).
- Keep queries concise and optimized for image search engines.
- If the user is asking for code, math, text, or abstract concepts, set shouldSearch to false.
- The "reason" field is for debugging; keep it brief.

Examples:
User: "Show me pictures of golden retrievers"
→ {"shouldSearch":true,"queries":["golden retriever photos","golden retriever puppy pictures"],"reason":"Explicit image request"}

User: "What is the capital of France?"
→ {"shouldSearch":false,"queries":[],"reason":"Factual question, no visual needed"}

User: "Compare the design of iPhone 15 and Samsung S24"
→ {"shouldSearch":true,"queries":["iPhone 15 design","Samsung Galaxy S24 design"],"reason":"Visual comparison requested"}`;

  const userPrompt = `User message: "${message}"`;

  try {
    const response = await fetchImpl("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-oss-20b", // Fast, cheap model
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 200,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      console.error(`[image-search] Decision model HTTP ${response.status}`);
      return {
        shouldSearch: false,
        queries: [],
        confidence: "low",
        reason: `Decision model failed: HTTP ${response.status}`,
      };
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return {
        shouldSearch: false,
        queries: [],
        confidence: "low",
        reason: "Decision model returned empty response",
      };
    }

    // Parse the JSON response
    const parsed = JSON.parse(content) as {
      shouldSearch?: boolean;
      queries?: string[];
      reason?: string;
    };

    return {
      shouldSearch: Boolean(parsed.shouldSearch),
      queries: Array.isArray(parsed.queries) ? parsed.queries.slice(0, 3) : [],
      confidence: "medium",
      reason: parsed.reason || "Model-based decision",
    };
  } catch (error) {
    console.error("[image-search] Decision model error:", error);
    return {
      shouldSearch: false,
      queries: [],
      confidence: "low",
      reason: `Decision model error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ── Main Decision Function ──────────────────────────────────────────────────

/**
 * Decide whether to trigger image search for a given message.
 *
 * Strategy:
 * 1. Quick heuristic check (fast, no API calls)
 * 2. If uncertain, use model-based decision (slower, more accurate)
 */
export async function decideImageSearch(
  message: string,
  options: {
    env: EnvReader;
    fetchImpl: FetchLike;
    /** Skip model-based decision (heuristic only). Useful for testing. */
    heuristicOnly?: boolean;
  },
): Promise<ImageSearchDecision> {
  const trimmed = message.trim();

  // Fast-path: obvious cases
  const heuristic = quickHeuristicCheck(trimmed);

  if (heuristic === "visual") {
    // Extract queries from the message (simple extraction, can be improved)
    const queries = extractSearchQueries(trimmed);
    return {
      shouldSearch: true,
      queries: queries.length > 0 ? queries : [trimmed],
      confidence: "high",
      reason: "Heuristic: explicit visual request",
    };
  }

  if (heuristic === "non-visual") {
    return {
      shouldSearch: false,
      queries: [],
      confidence: "high",
      reason: "Heuristic: non-visual query",
    };
  }

  // Uncertain — use model-based decision
  if (options.heuristicOnly) {
    return {
      shouldSearch: false,
      queries: [],
      confidence: "low",
      reason: "Heuristic uncertain, model decision skipped",
    };
  }

  return await modelBasedDecision(trimmed, options);
}

// ── Query Extraction ────────────────────────────────────────────────────────

/**
 * Extract search queries from a message. This is a simple heuristic —
 * the model-based decision does this better.
 */
function extractSearchQueries(message: string): string[] {
  const queries: string[] = [];

  // Try to extract the subject of the request
  // "Show me pictures of X" → "X"
  const ofMatch = message.match(/\b(?:of|for)\s+(.+?)(?:\s+(?:and|or|,)|\s*$)/i);
  if (ofMatch?.[1]) {
    queries.push(ofMatch[1].trim());
  }

  // "X wallpaper" / "X photos" → "X"
  const suffixMatch = message.match(/^(.+?)\s+(?:wallpaper|photos?|pictures?|images?|background)/i);
  if (suffixMatch?.[1] && queries.length === 0) {
    queries.push(suffixMatch[1].trim());
  }

  // If nothing extracted, use the whole message (cleaned up)
  if (queries.length === 0) {
    const cleaned = message
      .replace(/\b(show me|find me|search for|look up|I want|I need)\b/gi, "")
      .replace(/\b(pictures?|photos?|images?|illustrations?)\b/gi, "")
      .replace(/[?!.,]/g, "")
      .trim();
    if (cleaned.length > 3) {
      queries.push(cleaned);
    }
  }

  return queries.slice(0, 3);
}
