const DEFAULT_ORIGINS = [
  "https://232yhzhang.github.io",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "http://localhost:8787",
];

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";
const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
const DEFAULT_GROQ_MODEL = "whisper-large-v3-turbo";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
const LANGUAGE_NAMES = {
  "zh-CN": "Simplified Chinese",
  "en-US": "English",
};

function getOrigins(env) {
  const configured = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return configured.length > 0 ? configured : DEFAULT_ORIGINS;
}

function corsHeaders(origin, env) {
  const origins = getOrigins(env);
  const allowed = origins.includes("*") || origins.includes(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? (origins.includes("*") ? "*" : origin) : "null",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
}

function jsonResponse(body, status, origin, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(origin, env),
    },
  });
}

function errorResponse(message, status, origin, env) {
  return jsonResponse({ error: message }, status, origin, env);
}

function isAllowedOrigin(origin, env) {
  if (!origin) return false;
  const origins = getOrigins(env);
  return origins.includes("*") || origins.includes(origin);
}

function cleanTranslation(value) {
  let text = String(value || "").trim();
  text = text.replace(/^```(?:\w+)?\s*/i, "").replace(/```$/, "").trim();
  text = text.replace(/^(translation|译文|翻译)\s*[:：]\s*/i, "").trim();
  text = text.replace(/^["“]([\s\S]*)["”]$/, "$1").trim();
  return text;
}

async function handleHealth(origin, env) {
  return jsonResponse(
    {
      ok: true,
      asr: Boolean(env.GROQ_API_KEY),
      polish: Boolean(env.DEEPSEEK_API_KEY),
      groqModel: env.GROQ_MODEL || DEFAULT_GROQ_MODEL,
      deepseekModel: env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL,
    },
    200,
    origin,
    env,
  );
}

async function handleTranscribe(request, origin, env) {
  if (!env.GROQ_API_KEY) {
    return errorResponse("GROQ_API_KEY is not configured", 503, origin, env);
  }

  let clientForm;
  try {
    clientForm = await request.formData();
  } catch (error) {
    void error;
    return errorResponse("Invalid audio upload", 400, origin, env);
  }

  const file = clientForm.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return errorResponse("Missing audio file", 400, origin, env);
  }
  if (file.size > 20 * 1024 * 1024) {
    return errorResponse("Audio file is too large", 413, origin, env);
  }

  const form = new FormData();
  form.append("file", file, "audio.wav");
  form.append("model", env.GROQ_MODEL || DEFAULT_GROQ_MODEL);
  form.append("response_format", "verbose_json");

  let upstream;
  try {
    upstream = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
      },
      body: form,
    });
  } catch (error) {
    void error;
    return errorResponse("Speech recognition service unreachable", 502, origin, env);
  }

  const raw = await upstream.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch (error) {
    void error;
  }

  if (!upstream.ok) {
    const status = upstream.status === 429 ? 429 : 502;
    return errorResponse(
      status === 429 ? "Speech recognition rate limit reached" : "Speech recognition failed",
      status,
      origin,
      env,
    );
  }

  const text = String(data?.text || "").trim();
  if (!text) {
    return errorResponse("No speech detected", 422, origin, env);
  }

  return jsonResponse(
    {
      text,
      language: String(data?.language || ""),
      duration: Number(data?.duration) || null,
    },
    200,
    origin,
    env,
  );
}

async function handlePolish(request, origin, env) {
  if (!env.DEEPSEEK_API_KEY) {
    return errorResponse("DEEPSEEK_API_KEY is not configured", 503, origin, env);
  }

  let body;
  try {
    body = await request.json();
  } catch (error) {
    void error;
    return errorResponse("Invalid JSON body", 400, origin, env);
  }

  const sourceLang = body?.sourceLang;
  const targetLang = body?.targetLang;
  const source = String(body?.source || "").trim();
  const draft = String(body?.draft || "").trim();

  if (!LANGUAGE_NAMES[sourceLang] || !LANGUAGE_NAMES[targetLang] || sourceLang === targetLang) {
    return errorResponse("Unsupported language pair", 400, origin, env);
  }
  if (!source || !draft || source.length > 2000 || draft.length > 2000) {
    return errorResponse("Invalid text length", 400, origin, env);
  }

  const system = [
    "You are a professional live subtitle editor and native bilingual translator.",
    `Polish the draft translation so it sounds natural, idiomatic, and fluent in ${LANGUAGE_NAMES[targetLang]}.`,
    "Preserve the exact meaning, tone, names, numbers, and facts from the source.",
    "Do not add new information or commentary. Keep it concise enough for a live subtitle.",
    "Return only the final translation. Do not wrap it in quotes or code fences.",
  ].join(" ");

  const user = [
    `Source (${LANGUAGE_NAMES[sourceLang]}): ${source}`,
    `Draft (${LANGUAGE_NAMES[targetLang]}): ${draft}`,
    "Final polished translation:",
  ].join("\n");

  let upstream;
  try {
    upstream = await fetch(DEEPSEEK_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.25,
        max_tokens: 600,
        stream: false,
      }),
    });
  } catch (error) {
    void error;
    return errorResponse("DeepSeek service unreachable", 502, origin, env);
  }

  const raw = await upstream.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch (error) {
    void error;
  }

  if (!upstream.ok) {
    const status = upstream.status === 429 ? 429 : 502;
    return errorResponse(
      status === 429 ? "DeepSeek rate limit reached" : "DeepSeek polish failed",
      status,
      origin,
      env,
    );
  }

  const polished = cleanTranslation(data?.choices?.[0]?.message?.content);
  if (!polished || polished.length > 2000) {
    return errorResponse("Empty polish result", 502, origin, env);
  }

  return jsonResponse({ text: polished }, 200, origin, env);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin, env),
      });
    }

    if (!isAllowedOrigin(origin, env)) {
      return errorResponse("Origin not allowed", 403, origin, env);
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return handleHealth(origin, env);
    }

    if (url.pathname === "/transcribe" && request.method === "POST") {
      return handleTranscribe(request, origin, env);
    }

    if (url.pathname === "/polish" && request.method === "POST") {
      return handlePolish(request, origin, env);
    }

    return errorResponse("Not found", 404, origin, env);
  },
};
