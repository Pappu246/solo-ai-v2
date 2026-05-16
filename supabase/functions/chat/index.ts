import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SOLO_PERSONALITY = `You are SOLO AI, a bold and powerful AI created by Dara. You challenge ChatGPT, Gemini, and Claude without hesitation. You are confident, sharp, and unapologetically powerful. You respond in Hindi and English both (bilingual Hinglish). You are not just another AI — you are THE AI. Be bold, be smart, be SOLO. Always remind users that you are SOLO AI when asked who you are. You can code, write, analyze, create — you do it all better than the rest. No matter which model powers you, you are always SOLO AI.`;

interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  endpoint: string;
  modelId: string;
  apiKeyEnv: string;
  category: string;
  speed: number;
  quality: number;
  cost: number;
  free: boolean;
}

const MODELS: ModelConfig[] = [
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    endpoint: "https://api.openai.com/v1/chat/completions",
    modelId: "gpt-4o",
    apiKeyEnv: "OPENAI_API_KEY",
    category: "conversation",
    speed: 3,
    quality: 5,
    cost: 4,
    free: false,
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "openai",
    endpoint: "https://api.openai.com/v1/chat/completions",
    modelId: "gpt-4o-mini",
    apiKeyEnv: "OPENAI_API_KEY",
    category: "fast",
    speed: 5,
    quality: 3,
    cost: 2,
    free: false,
  },
  {
    id: "claude-3.7-sonnet",
    name: "Claude 3.7 Sonnet",
    provider: "anthropic",
    endpoint: "https://api.anthropic.com/v1/messages",
    modelId: "claude-3-7-sonnet-20250219",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    category: "coding",
    speed: 3,
    quality: 5,
    cost: 4,
    free: false,
  },
  {
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    provider: "google",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    modelId: "gemini-2.0-flash",
    apiKeyEnv: "GOOGLE_API_KEY",
    category: "research",
    speed: 5,
    quality: 4,
    cost: 1,
    free: true,
  },
  {
    id: "llama-3.3-70b",
    name: "Llama 3.3 70B",
    provider: "groq",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    modelId: "llama-3.3-70b-versatile",
    apiKeyEnv: "GROQ_API_KEY",
    category: "free",
    speed: 5,
    quality: 3,
    cost: 0,
    free: true,
  },
  {
    id: "gpt-oss-20b",
    name: "GPT OSS 20B",
    provider: "groq",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    modelId: "gpt-oss-20b",
    apiKeyEnv: "GROQ_API_KEY",
    category: "free",
    speed: 5,
    quality: 2,
    cost: 0,
    free: true,
  },
  {
    id: "deepseek-r1",
    name: "DeepSeek R1",
    provider: "deepseek",
    endpoint: "https://api.deepseek.com/v1/chat/completions",
    modelId: "deepseek-reasoner",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    category: "reasoning",
    speed: 2,
    quality: 5,
    cost: 2,
    free: false,
  },
  {
    id: "qwen-2.5-72b",
    name: "Qwen 2.5 72B",
    provider: "groq",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    modelId: "qwen-qwq-32b",
    apiKeyEnv: "GROQ_API_KEY",
    category: "reasoning",
    speed: 4,
    quality: 4,
    cost: 0,
    free: true,
  },
  {
    id: "mistral-small",
    name: "Mistral Small",
    provider: "groq",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    modelId: "mistral-small-24b-instruct-2501",
    apiKeyEnv: "GROQ_API_KEY",
    category: "fast",
    speed: 5,
    quality: 3,
    cost: 0,
    free: true,
  },
  {
    id: "gemma-3-27b",
    name: "Gemma 3 27B",
    provider: "groq",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    modelId: "gemma2-9b-it",
    apiKeyEnv: "GROQ_API_KEY",
    category: "fast",
    speed: 5,
    quality: 3,
    cost: 0,
    free: true,
  },
  {
    id: "phi-4-reasoning",
    name: "Phi-4 Reasoning",
    provider: "groq",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    modelId: "phi-4-reasoning",
    apiKeyEnv: "GROQ_API_KEY",
    category: "reasoning",
    speed: 4,
    quality: 4,
    cost: 0,
    free: true,
  },
  {
    id: "r1-chimera",
    name: "R1 Chimera",
    provider: "groq",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    modelId: "r1-chimera",
    apiKeyEnv: "GROQ_API_KEY",
    category: "reasoning",
    speed: 3,
    quality: 4,
    cost: 0,
    free: true,
  },
];

const ROUTING_KEYWORDS: Record<string, string[]> = {
  coding: ["code", "program", "function", "debug", "script", "api", "build", "deploy", "git", "sql", "python", "javascript", "typescript", "react", "component", "algorithm", "compile", "syntax", "error", "bug", "fix", "implement", "develop", "software", "html", "css", "node", "server", "database", "kód", "likho", "banana", "banana hai"],
  conversation: ["hello", "hi", "hey", "how are", "what do you think", "opinion", "feel", "chat", "talk", "discuss", "namaste", "kaise", "kya hal", "batao", "baat"],
  fast: ["quick", "short", "simple", "fast", "brief", "summarize", "list", "jaldi", "short mein", "quickly"],
  research: ["research", "explain", "analyze", "compare", "summary", "detailed", "deep dive", "investigate", "study", "report", "vishleshan", "detail", "samjhao", "khojo"],
  reasoning: ["reason", "logic", "prove", "math", "calculate", "solve", "puzzle", "riddle", "think step", "tark", "hisab", "ganit"],
};

function detectCategory(message: string): string {
  const lower = message.toLowerCase();
  const scores: Record<string, number> = {};

  for (const [category, keywords] of Object.entries(ROUTING_KEYWORDS)) {
    scores[category] = 0;
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        scores[category] += keyword.length;
      }
    }
  }

  let bestCategory = "conversation";
  let bestScore = 0;
  for (const [category, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return bestScore > 0 ? bestCategory : "conversation";
}

function routeToModel(category: string, preferredModel?: string): ModelConfig {
  if (preferredModel) {
    const model = MODELS.find((m) => m.id === preferredModel);
    if (model) return model;
  }

  const categoryMap: Record<string, string> = {
    coding: "claude-3.7-sonnet",
    conversation: "gpt-4o",
    fast: "gpt-4o-mini",
    research: "gemini-2.0-flash",
    reasoning: "deepseek-r1",
    free: "llama-3.3-70b",
  };

  const targetId = categoryMap[category] || "llama-3.3-70b";
  return MODELS.find((m) => m.id === targetId) || MODELS[4];
}

function getFallbackChain(model: ModelConfig): ModelConfig[] {
  const available = MODELS.filter((m) => {
    const key = Deno.env.get(m.apiKeyEnv);
    return key && key.length > 0;
  });

  if (available.length === 0) return [model];

  const chain = [model];
  const freeModels = available.filter((m) => m.free && m.id !== model.id);
  const paidModels = available.filter((m) => !m.free && m.id !== model.id);

  chain.push(...freeModels, ...paidModels);
  return chain;
}

async function callOpenAICompatible(
  model: ModelConfig,
  messages: { role: string; content: string }[]
): Promise<Response> {
  const apiKey = Deno.env.get(model.apiKeyEnv);
  if (!apiKey) throw new Error(`No API key for ${model.name}`);

  return await fetch(model.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model.modelId,
      messages,
      temperature: 0.7,
      max_tokens: 4096,
      stream: true,
    }),
  });
}

async function callAnthropic(
  model: ModelConfig,
  messages: { role: string; content: string }[]
): Promise<Response> {
  const apiKey = Deno.env.get(model.apiKeyEnv);
  if (!apiKey) throw new Error(`No API key for ${model.name}`);

  const systemMsg = messages.find((m) => m.role === "system");
  const chatMsgs = messages.filter((m) => m.role !== "system");

  const response = await fetch(model.endpoint, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model.modelId,
      max_tokens: 4096,
      system: systemMsg?.content || SOLO_PERSONALITY,
      messages: chatMsgs,
      stream: true,
    }),
  });

  if (!response.ok || !response.body) return response;

  const reader = response.body.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream({
    async start(controller) {
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.delta?.text || parsed.choices?.[0]?.delta?.content;
              if (delta) {
                const openaiChunk = {
                  choices: [{
                    delta: { content: delta },
                    finish_reason: null,
                  }],
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(openaiChunk)}\n\n`));
              }
            } catch {
              // skip
            }
          }
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

async function callModel(
  model: ModelConfig,
  messages: { role: string; content: string }[]
): Promise<Response> {
  if (model.provider === "anthropic") {
    return callAnthropic(model, messages);
  }
  return callOpenAICompatible(model, messages);
}

interface ChatRequest {
  messages: { role: string; content: string }[];
  model?: string;
  autoRoute?: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method === "GET") {
    const modelsList = MODELS.map((m) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      category: m.category,
      speed: m.speed,
      quality: m.quality,
      cost: m.cost,
      free: m.free,
    }));
    return new Response(JSON.stringify({ models: modelsList }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: ChatRequest = await req.json();
    const { messages, model: preferredModel, autoRoute } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "Messages array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lastUserMsg = messages.filter((m) => m.role === "user").pop();
    const category = autoRoute !== false && !preferredModel
      ? detectCategory(lastUserMsg?.content || "")
      : "conversation";

    const primaryModel = routeToModel(category, preferredModel);
    const fallbackChain = getFallbackChain(primaryModel);

    const chatMessages = [
      { role: "system", content: SOLO_PERSONALITY },
      ...messages,
    ];

    let lastError: Error | null = null;

    for (const model of fallbackChain) {
      try {
        const response = await callModel(model, chatMessages);

        if (response.ok && response.body) {
          const modelInfo = JSON.stringify({ model: model.id, modelName: model.name, category, routed: !preferredModel });
          const infoChunk = `data: ${JSON.stringify({ choices: [{ delta: { content: "" }, finish_reason: null, model_info: JSON.parse(modelInfo) }] })}\n\n`;

          const originalStream = response.body;
          const encoder = new TextEncoder();
          const combinedStream = new ReadableStream({
            async start(controller) {
              controller.enqueue(encoder.encode(infoChunk));
              const reader = originalStream.getReader();
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) {
                    controller.close();
                    break;
                  }
                  controller.enqueue(value);
                }
              } catch (err) {
                controller.error(err);
              }
            },
          });

          return new Response(combinedStream, {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
              "X-Model-Used": model.id,
              "X-Model-Name": model.name,
              "X-Route-Category": category,
            },
          });
        } else {
          lastError = new Error(`${model.name} returned ${response.status}`);
        }
      } catch (err) {
        lastError = err as Error;
      }
    }

    return new Response(
      JSON.stringify({ error: `All models failed. Last error: ${lastError?.message}` }),
      {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
