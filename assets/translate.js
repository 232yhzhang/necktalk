const MYMEMORY_ENDPOINT = "https://api.mymemory.translated.net/get";
const MAX_QUERY_LENGTH = 500;

export const LANGUAGE_INFO = {
  "zh-CN": {
    tag: "中",
    label: "中文",
    target: "en-US",
    builtIn: "zh",
  },
  "en-US": {
    tag: "EN",
    label: "English",
    target: "zh-CN",
    builtIn: "en",
  },
};

export class TranslationError extends Error {
  constructor(message, code = "error") {
    super(message);
    this.name = "TranslationError";
    this.code = code;
  }
}

export function pairFor(sourceLang) {
  const source = LANGUAGE_INFO[sourceLang] || LANGUAGE_INFO["zh-CN"];
  const targetLang = source.target;
  const target = LANGUAGE_INFO[targetLang];
  return {
    sourceLang: LANGUAGE_INFO[sourceLang] ? sourceLang : "zh-CN",
    targetLang,
    sourceTag: source.tag,
    targetTag: target.tag,
    sourceLabel: source.label,
    targetLabel: target.label,
  };
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function decodeEntities(value) {
  if (!/[&<>]/.test(value)) return value;
  const area = document.createElement("textarea");
  area.innerHTML = value;
  return area.value;
}

export class TranslationService {
  constructor() {
    this.cache = new Map();
    this.inFlight = new Map();
    this.queue = [];
    this.active = 0;
    this.maxActive = 2;
    this.builtIn = new Map();
    this.builtInChecked = new Set();
  }

  translate(text, sourceLang) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (!clean) return Promise.resolve("");
    if (clean.length > MAX_QUERY_LENGTH) {
      return Promise.reject(new TranslationError("内容过长，暂未翻译", "too-long"));
    }

    const pair = pairFor(sourceLang);
    const key = `${pair.sourceLang}|${pair.targetLang}|${clean}`;
    if (this.cache.has(key)) return Promise.resolve(this.cache.get(key));
    if (this.inFlight.has(key)) return this.inFlight.get(key);

    const request = this.enqueue(() => this.translateWithFallback(clean, pair))
      .then((result) => {
        this.cache.set(key, result);
        this.trimCache();
        return result;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, request);
    return request;
  }

  enqueue(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.pump();
    });
  }

  pump() {
    while (this.active < this.maxActive && this.queue.length > 0) {
      const job = this.queue.shift();
      this.active += 1;
      job
        .task()
        .then(job.resolve, job.reject)
        .finally(() => {
          this.active -= 1;
          this.pump();
        });
    }
  }

  async translateWithFallback(text, pair) {
    const builtIn = await this.getBuiltIn(pair);
    if (builtIn) {
      try {
        const translated = await builtIn.translate(text);
        if (translated) return String(translated).trim();
      } catch (error) {
        void error;
      }
    }
    return this.translateWithMyMemory(text, pair);
  }

  async getBuiltIn(pair) {
    const key = `${pair.sourceLang}>${pair.targetLang}`;
    if (this.builtIn.has(key)) return this.builtIn.get(key);
    if (this.builtInChecked.has(key)) return null;
    this.builtInChecked.add(key);

    if (typeof Translator === "undefined") return null;

    try {
      const availability = await Translator.availability({
        sourceLanguage: LANGUAGE_INFO[pair.sourceLang].builtIn,
        targetLanguage: LANGUAGE_INFO[pair.targetLang].builtIn,
      });
      if (availability !== "available") return null;

      const translator = await Translator.create({
        sourceLanguage: LANGUAGE_INFO[pair.sourceLang].builtIn,
        targetLanguage: LANGUAGE_INFO[pair.targetLang].builtIn,
      });
      this.builtIn.set(key, translator);
      return translator;
    } catch (error) {
      void error;
      return null;
    }
  }

  async translateWithMyMemory(text, pair) {
    const params = new URLSearchParams({
      q: text,
      langpair: `${pair.sourceLang}|${pair.targetLang}`,
    });
    const url = `${MYMEMORY_ENDPOINT}?${params.toString()}`;

    let lastError = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) {
          const status = response.status;
          if (status === 403) {
            throw new TranslationError("今日翻译额度已用完", "quota");
          }
          if (status === 429) {
            throw new TranslationError("翻译请求过于频繁", "rate-limit");
          }
          throw new TranslationError(`翻译服务错误 (${status})`, "http");
        }

        const data = await response.json();
        const translated = String(data?.responseData?.translatedText || "").trim();
        const details = String(data?.responseDetails || "");

        if (data?.quotaFinished) {
          throw new TranslationError("今日翻译额度已用完", "quota");
        }
        if (/QUERY LENGTH LIMIT/i.test(details)) {
          throw new TranslationError("内容过长，暂未翻译", "too-long");
        }
        if (Number(data?.responseStatus) !== 200) {
          if (Number(data?.responseStatus) === 403 || Number(data?.responseStatus) === 429) {
            throw new TranslationError("翻译额度已用完或请求过于频繁", "quota");
          }
          throw new TranslationError(details || "翻译服务出错", "api");
        }
        if (!translated) {
          throw new TranslationError("翻译结果为空", "empty");
        }
        if (/MYMEMORY WARNING|QUOTA/i.test(translated)) {
          throw new TranslationError("今日翻译额度已用完", "quota");
        }

        return decodeEntities(translated);
      } catch (error) {
        lastError = error;

        const isTransportError =
          error?.name === "TimeoutError" ||
          error?.name === "AbortError" ||
          error instanceof TypeError;

        if (isTransportError && attempt === 0) {
          await delay(650);
          continue;
        }

        if (isTransportError) {
          throw new TranslationError("翻译服务连接失败", "network");
        }

        throw error;
      }
    }

    throw lastError || new TranslationError("翻译失败", "error");
  }

  trimCache() {
    while (this.cache.size > 260) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
  }
}

export function translationErrorMessage(error) {
  if (error instanceof TranslationError) {
    switch (error.code) {
      case "network":
        return "翻译服务连接失败";
      case "quota":
      case "rate-limit":
        return "翻译额度已用完";
      case "too-long":
        return "内容过长，暂未翻译";
      default:
        return error.message || "翻译暂不可用";
    }
  }
  return "翻译暂不可用";
}
