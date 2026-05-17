import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ─── CORS ─────────────────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Expose-Headers': 'X-Model-Used, X-Model-Name, X-Route-Category',
};

// ─── Model Catalogue ──────────────────────────────────────────────────────────
const MODELS = [
  // OpenAI
  { id: 'gpt-4o',        name: 'GPT-4o',           provider: 'openai',    category: 'conversation', speed: 4, quality: 5, cost: 4, free: false, context_length: 128000, supports_vision: true,  supports_tools: true,  tag: 'Best' },
  { id: 'gpt-4o-mini',   name: 'GPT-4o Mini',      provider: 'openai',    category: 'fast',         speed: 5, quality: 4, cost: 2, free: false, context_length: 128000, supports_vision: true,  supports_tools: true },
  { id: 'gpt-4-turbo',   name: 'GPT-4 Turbo',      provider: 'openai',    category: 'coding',       speed: 3, quality: 5, cost: 4, free: false, context_length: 128000, supports_vision: true,  supports_tools: true },
  // Anthropic
  { id: 'claude-3.7-sonnet', name: 'Claude 3.7 Sonnet', provider: 'anthropic', category: 'coding',  speed: 4, quality: 5, cost: 4, free: false, context_length: 200000, supports_vision: true,  supports_tools: true,  tag: 'Top' },
  { id: 'claude-3.5-haiku',  name: 'Claude 3.5 Haiku',  provider: 'anthropic', category: 'fast',   speed: 5, quality: 3, cost: 1, free: false, context_length: 200000, supports_vision: false, supports_tools: true },
  { id: 'claude-3-opus',     name: 'Claude 3 Opus',     provider: 'anthropic', category: 'research',speed: 2, quality: 5, cost: 5, free: false, context_length: 200000, supports_vision: true,  supports_tools: true },
  // Google
  { id: 'gemini-2.0-flash',  name: 'Gemini 2.0 Flash',  provider: 'google',   category: 'research', speed: 5, quality: 4, cost: 0, free: true,  context_length: 1000000, supports_vision: true,  supports_tools: true,  tag: 'Free' },
  { id: 'gemini-1.5-pro',    name: 'Gemini 1.5 Pro',    provider: 'google',   category: 'research', speed: 3, quality: 5, cost: 3, free: false, context_length: 1000000, supports_vision: true,  supports_tools: true },
  // Groq (free, ultra-fast)
  { id: 'llama-3.3-70b',    name: 'Llama 3.3 70B',     provider: 'groq',     category: 'free',      speed: 5, quality: 4, cost: 0, free: true,  context_length: 128000, supports_vision: false, supports_tools: true,  tag: 'Free' },
  { id: 'llama-3.1-8b',     name: 'Llama 3.1 8B',      provider: 'groq',     category: 'fast',      speed: 5, quality: 3, cost: 0, free: true,  context_length: 128000, supports_vision: false, supports_tools: false, tag: 'Fast' },
  { id: 'mistral-small',    name: 'Mistral Small',      provider: 'groq',     category: 'fast',      speed: 5, quality: 3, cost: 0, free: true,  context_length: 32000,  supports_vision: false, supports_tools: false },
  { id: 'gemma-3-27b',      name: 'Gemma 3 27B',        provider: 'groq',     category: 'fast',      speed: 5, quality: 3, cost: 0, free: true,  context_length: 96000,  supports_vision: false, supports_tools: false },
  { id: 'qwen-2.5-72b',     name: 'Qwen 2.5 72B',       provider: 'groq',     category: 'reasoning', speed: 4, quality: 4, cost: 0, free: true,  context_length: 128000, supports_vision: false, supports_tools: false },
  { id: 'phi-4-reasoning',  name: 'Phi-4 Reasoning',    provider: 'groq',     category: 'reasoning', speed: 4, quality: 4, cost: 0, free: true,  context_length: 128000, supports_vision: false, supports_tools: false },
  { id: 'r1-chimera',       name: 'R1 Chimera',          provider: 'groq',     category: 'reasoning', speed: 3, quality: 4, cost: 0, free: true,  context_length: 128000, supports_vision: false, supports_tools: false },
  // DeepSeek
  { id: 'deepseek-r1',     name: 'DeepSeek R1',          provider: 'deepseek', category: 'reasoning', speed: 3, quality: 5, cost: 1, free: false, context_length: 128000, supports_vision: false, supports_tools: false, tag: 'Think' },
  { id: 'deepseek-v3',     name: 'DeepSeek V3',          provider: 'deepseek', category: 'coding',    speed: 4, quality: 4, cost: 1, free: false, context_length: 128000, supports_vision: false, supports_tools: false },
];

// ─── Groq model ID mapping (internal API id vs display id) ─────────────────
const GROQ_MODEL_IDS: Record<string, string> = {
  'llama-3.3-70b':   'llama-3.3-70b-versatile',
  'llama-3.1-8b':    'llama-3.1-8b-instant',
  'mistral-small':   'mistral-saba-24b',
  'gemma-3-27b':     'gemma2-9b-it',
  'qwen-2.5-72b':    'qwen-qwq-32b',
  'phi-4-reasoning': 'meta-llama/llama-4-scout-17b-16e-instruct',
  'r1-chimera':      'deepseek-r1-distill-llama-70b',
};

// ─── Auto-routing keywords ────────────────────────────────────────────────────
const ROUTE_KEYWORDS: Record<string, string[]> = {
  coding: ['code', 'function', 'class', 'debug', 'error', 'typescript', 'javascript', 'python', 'java', 'bug', 'api', 'sql', 'html', 'css', 'react', 'programming', 'algorithm', 'implement'],
  reasoning: ['explain', 'analyze', 'reasoning', 'logic', 'math', 'calculate', 'proof', 'solve', 'think', 'step by step', 'problem', 'strategy', 'compare', 'evaluate'],
  research: ['research', 'latest', 'news', 'search', 'find', 'what is', 'who is', 'history', 'information', 'data', 'facts', 'report', 'study', 'paper', 'science'],
  fast: ['quick', 'fast', 'brief', 'short', 'simple', 'what', 'when', 'where', 'who', 'how many', 'translate', 'summarize'],
};

const CATEGORY_TO_MODEL: Record<string, string> = {
  coding:       'claude-3.7-sonnet',
  reasoning:    'deepseek-r1',
  research:     'gemini-2.0-flash',
  fast:         'llama-3.3-70b',
  conversation: 'llama-3.3-70b',
};

function detectCategory(lastMessage: string): string {
  const text = lastMessage.toLowerCase();
  const scores: Record<string, number> = {};
  for (const [cat, keywords] of Object.entries(ROUTE_KEYWORDS)) {
    scores[cat] = keywords.reduce((acc, kw) => acc + (text.includes(kw) ? kw.length : 0), 0);
  }
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : 'conversation';
}

// ─── API key helpers ──────────────────────────────────────────────────────────
function getApiKey(provider: string, clientKeys?: Record<string, string>): string | null {
  const keyMap: Record<string, string> = {
    openai:    'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    google:    'GOOGLE_API_KEY',
    groq:      'GROQ_API_KEY',
    deepseek:  'DEEPSEEK_API_KEY',
    mistral:   'MISTRAL_API_KEY',
  };
  const envKey = keyMap[provider];
  if (!envKey) return null;
  return clientKeys?.[envKey] || Deno.env.get(envKey) || null;
}

// ─── Provider call functions ──────────────────────────────────────────────────

async function callOpenAI(
  messages: { role: string; content: string }[],
  modelId: string,
  apiKey: string
): Promise<ReadableStream<Uint8Array>> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: modelId, messages, stream: true, max_tokens: 4096 }),
  });
  if (!response.ok) throw new Error(`OpenAI error: ${response.status} ${await response.text()}`);
  return response.body!;
}

async function callAnthropic(
  messages: { role: string; content: string }[],
  modelId: string,
  apiKey: string
): Promise<ReadableStream<Uint8Array>> {
  const systemMessages = messages.filter(m => m.role === 'system');
  const userMessages = messages.filter(m => m.role !== 'system');
  const system = systemMessages.map(m => m.content).join('\n') || 'You are a helpful AI assistant.';

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: modelId === 'claude-3.7-sonnet' ? 'claude-sonnet-4-5' :
             modelId === 'claude-3.5-haiku'  ? 'claude-haiku-4-5-20251001' :
             modelId === 'claude-3-opus'     ? 'claude-opus-4-5' : modelId,
      messages: userMessages,
      system,
      max_tokens: 4096,
      stream: true,
    }),
  });
  if (!response.ok) throw new Error(`Anthropic error: ${response.status} ${await response.text()}`);

  // Adapt Anthropic SSE → OpenAI-compatible SSE
  const reader = response.body!.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          for (const line of text.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6);
            if (data === '[DONE]') { controller.enqueue(encoder.encode('data: [DONE]\n\n')); break; }
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.delta?.text;
              if (delta) {
                const chunk = JSON.stringify({ choices: [{ delta: { content: delta } }] });
                controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
              }
              if (parsed.type === 'message_stop') {
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              }
            } catch { /* skip */ }
          }
        }
      } finally {
        controller.close();
      }
    },
  });
}

async function callGoogle(
  messages: { role: string; content: string }[],
  modelId: string,
  apiKey: string
): Promise<ReadableStream<Uint8Array>> {
  // Convert to Gemini format
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

  const geminiModel = modelId === 'gemini-2.0-flash' ? 'gemini-2.0-flash' : 'gemini-1.5-pro';

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:streamGenerateContent?alt=sse&key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: 4096 } }),
    }
  );
  if (!response.ok) throw new Error(`Google error: ${response.status} ${await response.text()}`);

  const reader = response.body!.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { controller.enqueue(encoder.encode('data: [DONE]\n\n')); break; }
          const text = decoder.decode(value, { stream: true });
          for (const line of text.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              const parsed = JSON.parse(line.slice(6));
              const delta = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
              if (delta) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`));
              }
            } catch { /* skip */ }
          }
        }
      } finally {
        controller.close();
      }
    },
  });
}

async function callGroq(
  messages: { role: string; content: string }[],
  modelId: string,
  apiKey: string
): Promise<ReadableStream<Uint8Array>> {
  const groqModelId = GROQ_MODEL_IDS[modelId] || modelId;
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: groqModelId, messages, stream: true, max_tokens: 4096 }),
  });
  if (!response.ok) throw new Error(`Groq error: ${response.status} ${await response.text()}`);
  return response.body!;
}

async function callDeepSeek(
  messages: { role: string; content: string }[],
  modelId: string,
  apiKey: string
): Promise<ReadableStream<Uint8Array>> {
  const dsModel = modelId === 'deepseek-r1' ? 'deepseek-reasoner' : 'deepseek-chat';
  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: dsModel, messages, stream: true, max_tokens: 4096 }),
  });
  if (!response.ok) throw new Error(`DeepSeek error: ${response.status} ${await response.text()}`);
  return response.body!;
}

// ─── Main router ──────────────────────────────────────────────────────────────
async function callModel(
  modelId: string,
  messages: { role: string; content: string }[],
  clientKeys?: Record<string, string>
): Promise<ReadableStream<Uint8Array>> {
  const modelInfo = MODELS.find(m => m.id === modelId);
  if (!modelInfo) throw new Error(`Unknown model: ${modelId}`);

  const apiKey = getApiKey(modelInfo.provider, clientKeys);
  if (!apiKey) throw new Error(`No API key for provider: ${modelInfo.provider}`);

  switch (modelInfo.provider) {
    case 'openai':    return callOpenAI(messages, modelId, apiKey);
    case 'anthropic': return callAnthropic(messages, modelId, apiKey);
    case 'google':    return callGoogle(messages, modelId, apiKey);
    case 'groq':      return callGroq(messages, modelId, apiKey);
    case 'deepseek':  return callDeepSeek(messages, modelId, apiKey);
    default: throw new Error(`Unsupported provider: ${modelInfo.provider}`);
  }
}

// ─── Fallback chain ────────────────────────────────────────────────────────────
function buildFallbackChain(primaryId: string, clientKeys?: Record<string, string>): string[] {
  const chain: string[] = [];
  if (primaryId) chain.push(primaryId);
  // Free fallbacks that never need API keys (Groq is free tier)
  const freeModels = ['llama-3.3-70b', 'gemini-2.0-flash', 'llama-3.1-8b'];
  for (const m of freeModels) {
    if (!chain.includes(m)) {
      const info = MODELS.find(mo => mo.id === m);
      if (info && getApiKey(info.provider, clientKeys)) chain.push(m);
    }
  }
  return chain;
}

// ─── HTTP handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  // GET: return model catalogue
  if (req.method === 'GET') {
    return new Response(JSON.stringify({ models: MODELS }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const { messages, model: requestedModel, autoRoute, clientKeys } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'messages is required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // Determine model
    let selectedModelId = requestedModel || null;
    let category = 'conversation';

    if (!selectedModelId || autoRoute) {
      const lastMsg = messages[messages.length - 1]?.content || '';
      category = detectCategory(lastMsg);
      selectedModelId = CATEGORY_TO_MODEL[category] || 'llama-3.3-70b';
    }

    const modelInfo = MODELS.find(m => m.id === selectedModelId) || MODELS.find(m => m.id === 'llama-3.3-70b')!;
    const fallbackChain = buildFallbackChain(selectedModelId, clientKeys);

    let stream: ReadableStream<Uint8Array> | null = null;
    let usedModelId = selectedModelId;
    let lastError = '';

    for (const modelId of fallbackChain) {
      try {
        stream = await callModel(modelId, messages, clientKeys);
        usedModelId = modelId;
        break;
      } catch (err) {
        lastError = (err as Error).message;
        console.error(`Model ${modelId} failed:`, lastError);
        continue;
      }
    }

    if (!stream) {
      return new Response(JSON.stringify({ error: `All models failed. Last error: ${lastError}` }), {
        status: 502,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const usedModelInfo = MODELS.find(m => m.id === usedModelId) || modelInfo;

    return new Response(stream, {
      headers: {
        ...CORS,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Model-Used': usedModelId,
        'X-Model-Name': usedModelInfo.name,
        'X-Route-Category': category,
      },
    });
  } catch (err) {
    console.error('Handler error:', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
