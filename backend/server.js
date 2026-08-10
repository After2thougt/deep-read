const express = require("express");
const axios = require("axios");
const cors = require("cors");
const dotenv = require("dotenv");
const https = require("https");
const crypto = require("crypto");
const path = require("path");

dotenv.config({ path: path.resolve(__dirname, ".env"), override: true });

console.log('Translate provider:', process.env.TRANSLATE_PROVIDER || 'libre');
console.log('Has TRANSLATE_API_KEY:', !!process.env.TRANSLATE_API_KEY);
console.log('Has Tencent creds:', !!process.env.TENCENT_SECRET_ID, !!process.env.TENCENT_SECRET_KEY);

const app = express();
const PORT = process.env.PORT || 3001;
const eudicHttpsAgent = new https.Agent({
  keepAlive: true,
  family: 4,
  minVersion: "TLSv1.2",
  maxVersion: "TLSv1.2",
});

app.use(cors());
app.use(express.json());

function parseMcpResponse(data) {
  const line = String(data)
    .split("\n")
    .find((item) => item.startsWith("data: "));

  if (!line) {
    throw new Error("Eudic returned an invalid MCP response.");
  }

  const payload = JSON.parse(line.slice(6));
  if (payload.error) {
    throw new Error(payload.error.message || "Eudic MCP request failed.");
  }

  if (payload.result?.isError) {
    const message = payload.result.content
      ?.filter((item) => item.type === "text")
      .map((item) => item.text)
      .join(" ");
    throw new Error(message || "Eudic rejected this request.");
  }

  return payload.result;
}

function hashSha256(message) {
  return crypto.createHash("sha256").update(message, "utf8").digest("hex");
}

function hmacSha256(key, message) {
  return crypto.createHmac("sha256", key).update(message, "utf8").digest();
}

function hmacSha256Hex(key, message) {
  return crypto.createHmac("sha256", key).update(message, "utf8").digest("hex");
}

function buildTencentAuthorization(secretId, secretKey, timestamp, date, service, canonicalRequest) {
  const hashedRequest = hashSha256(canonicalRequest);
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = [
    "TC3-HMAC-SHA256",
    timestamp.toString(),
    credentialScope,
    hashedRequest,
  ].join("\n");

  const secretDate = hmacSha256(`TC3${secretKey}`, date);
  const secretService = hmacSha256(secretDate, service);
  const secretSigning = hmacSha256(secretService, "tc3_request");
  const signature = crypto.createHmac("sha256", secretSigning).update(stringToSign, "utf8").digest("hex");

  return `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=content-type;host, Signature=${signature}`;
}

async function callTencentTextTranslation(paragraph, target, source = "auto") {
  const secretId = process.env.TENCENT_SECRET_ID;
  const secretKey = process.env.TENCENT_SECRET_KEY;
  if (!secretId || !secretKey) {
    throw new Error("Tencent Cloud SecretId or SecretKey is not configured.");
  }

  const region = process.env.TENCENT_REGION || "ap-guangzhou";
  const service = "tmt";
  const host = "tmt.tencentcloudapi.com";
  const action = "TextTranslate";
  const version = "2018-03-21";
  const requestPayload = {
    SourceText: paragraph,
    Source: source,
    Target: target,
    ProjectId: 0,
  };

  const requestPayloadJson = JSON.stringify(requestPayload);

  async function sendRequest() {
    const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10); // Tencent expects YYYY-MM-DD

    const canonicalRequest = [
      "POST",
      "/",
      "",
      `content-type:application/json\nhost:${host}\n`,
      "content-type;host",
      hashSha256(requestPayloadJson),
    ].join("\n");

    const authorization = buildTencentAuthorization(secretId, secretKey, timestamp, date, service, canonicalRequest);
    const headers = {
      Authorization: authorization,
      "Content-Type": "application/json",
      Host: host,
      "X-TC-Action": action,
      "X-TC-Version": version,
      "X-TC-Timestamp": timestamp.toString(),
      "X-TC-Region": region,
    };

    return axios.post(`https://${host}/`, requestPayloadJson, {
      headers,
      timeout: 20000,
    });
  }

  const maxRetries = 4;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      console.log('Tencent translate request attempt', attempt + 1, { service, host, action, version, region });
      const response = await sendRequest();

      if (!response.data?.Response?.TargetText) {
        const errorDetails = JSON.stringify(response.data || response, null, 2);
        throw new Error(`Tencent translation response missing TargetText: ${errorDetails}`);
      }

      return response.data.Response.TargetText;
    } catch (error) {
      const errorCode = error.response?.data?.Response?.Error?.Code;
      const errorMessage = error.response?.data?.Response?.Error?.Message || error.message;

      if (errorCode === 'RequestLimitExceeded' && attempt < maxRetries - 1) {
        const delayMs = 1000 * Math.pow(2, attempt);
        console.warn(`Tencent request limited, retrying after ${delayMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        attempt += 1;
        continue;
      }

      if (!error.response?.data?.Response?.TargetText) {
        throw new Error(`Tencent translation response missing TargetText: ${errorMessage}`);
      }

      throw error;
    }
  }

  throw new Error('Tencent translation failed after retries.');
}

function extractJsonObject(text) {
  const jsonMatch = text.match(/\{[\s\S]*\}/m);
  if (!jsonMatch) return null;

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

function buildFallbackAnalysis(text, reason = 'AI analysis is unavailable.') {
  const sentences = String(text)
    .replace(/\s+/g, ' ')
    .split(/(?<=[.?!])\s+/)
    .filter(Boolean);

  return {
    summary: sentences.slice(0, 2).join(' '),
    hardSentences: sentences.slice(0, 2).map((sentence) => ({
      sentence,
      explanation: 'This sentence may contain complex structure; focus on subject-verb agreement and clause ordering.',
    })),
    grammarPoints: [
      {
        point: 'sentence structure',
        detail: 'Long sentences often combine multiple clauses; identify the main clause first.',
      },
      {
        point: 'verb tense',
        detail: 'Check whether the sentence describes past events or general truths.',
      },
    ],
    raw: 'AI analysis is unavailable. Returning a lightweight fallback summary and grammar guidance.',
    source: 'fallback',
    fallbackReason: reason,
  };
}

function extractOpenAIResponseText(responseData) {
  if (!responseData) return null;
  if (typeof responseData.output_text === 'string' && responseData.output_text.trim()) {
    return responseData.output_text.trim();
  }

  const content = responseData.output?.[0]?.content;
  if (Array.isArray(content)) {
    const textParts = content
      .filter((item) => item.type === 'output_text' || item.type === 'text')
      .map((item) => item.text || item?.content || '')
      .filter(Boolean);

    if (textParts.length > 0) {
      return textParts.join('');
    }
  }

  return null;
}

function normalizeOpenAIBase(rawBase) {
  return String(rawBase || 'https://api.openai.com/v1')
    .replace(/\/+$/, '')
    .replace(/\/v1$/i, '');
}

async function callOpenAITextAnalysis(text, model = process.env.OPENAI_MODEL || 'gpt-5.4-mini') {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OpenAI API key is not configured.');
  }

  const rawBase = String(process.env.OPENAI_API_BASE || 'https://api.openai.com/v1');
  const base = normalizeOpenAIBase(rawBase);
  const apiMode = (process.env.OPENAI_API_MODE || 'responses').toLowerCase();
  const explicitResponses = rawBase.toLowerCase().endsWith('/responses') || apiMode === 'responses';
  const explicitChatCompletions = rawBase.toLowerCase().endsWith('/chat/completions') || apiMode === 'chat_completions';
  const isChatAnywhereProxy = base.includes('chatanywhere.tech');
  let useResponses = explicitResponses;

  if (explicitChatCompletions) {
    useResponses = false;
  } else if (isChatAnywhereProxy && !explicitResponses) {
    useResponses = false;
  }

  const chatCompletionsUrl = rawBase.toLowerCase().endsWith('/chat/completions') ? rawBase : `${base}/v1/chat/completions`;
  const responsesUrl = rawBase.toLowerCase().endsWith('/responses') ? rawBase : `${base}/v1/responses`;

  const buildPayload = (useResponsesMode) => {
    if (useResponsesMode) {
      return {
        model,
        input: `请对以下文章进行语法分析、全文重点内容总结，并分析高难度句子。请以纯 JSON 格式返回，字段为：\n- summary：文章重点\n- hardSentences：高难句解析，数组形式，每项包含 sentence 和 explanation\n- grammarPoints：语法要点，数组形式，每项包含 point 和 detail\n\n只返回 JSON，不要添加额外说明。\n\n文章：\n${text}`,
        max_output_tokens: 800,
      };
    }

    return {
      model,
      messages: [
        {
          role: 'user',
          content: `请对以下文章进行语法分析、全文重点内容总结，并分析高难度句子。请以纯 JSON 格式返回，字段为：\n- summary：文章重点\n- hardSentences：高难句解析，数组形式，每项包含 sentence 和 explanation\n- grammarPoints：语法要点，数组形式，每项包含 point 和 detail\n\n只返回 JSON，不要添加额外说明。\n\n文章：\n${text}`,
        },
      ],
      temperature: 0.0,
      max_tokens: 800,
    };
  };

  const sendRequest = async (endpoint, requestPayload) => {
    return axios.post(endpoint, requestPayload, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: 30000,
    });
  };

  let endpointUrl = useResponses ? responsesUrl : chatCompletionsUrl;
  let payload = buildPayload(useResponses);

  try {
    let response;
    try {
      response = await sendRequest(endpointUrl, payload);
    } catch (ex) {
      const failedWithResponses = useResponses && ex.response?.status === 403 && String(ex.response?.data?.error?.message || '').includes('免费API限制使用');
      if (failedWithResponses) {
        console.warn('ChatAnywhere responses endpoint forbidden, retrying with chat completions.');
        endpointUrl = chatCompletionsUrl;
        payload = buildPayload(false);
        response = await sendRequest(endpointUrl, payload);
      } else {
        throw ex;
      }
    }

    let textContent = extractOpenAIResponseText(response.data);
    if (!textContent && response.data?.choices?.[0]?.message?.content) {
      textContent = response.data.choices[0].message.content;
    }

    if (!textContent) {
      throw new Error(`OpenAI response missing text output: ${JSON.stringify(response.data)}`);
    }

    const cleaned = String(textContent).trim();
    const parsed = extractJsonObject(cleaned);

    if (parsed && typeof parsed === 'object') {
      return { ...parsed, source: 'openai', model };
    }

    return {
      summary: cleaned,
      hardSentences: [],
      grammarPoints: [],
      raw: cleaned,
      source: 'openai',
      model,
    };
  } catch (error) {
    const message = String(error.message || '');
    const isNetworkError = [
      'ETIMEDOUT',
      'ECONNABORTED',
      'ECONNREFUSED',
      'ENOTFOUND',
      'EAI_AGAIN',
    ].includes(error.code) ||
      /connect .*ETIMEDOUT/i.test(message) ||
      /timeout of \d+ms exceeded/i.test(message) ||
      /socket hang up/i.test(message) ||
      /Network Error/i.test(message);

    if (isNetworkError) {
      console.warn('OpenAI network error, returning fallback analysis:', message);
      return buildFallbackAnalysis(text, message);
    }

    throw error;
  }
}

async function callGeminiTextAnalysis(text) {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Google Gemini API key is not configured.');
  }

  const model = process.env.GOOGLE_GEMINI_MODEL || 'gemini-flash-latest';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const prompt = `请对以下文章进行语法分析、全文重点内容总结，并分析高难度句子。请以纯 JSON 格式返回，字段为：\n- summary：文章重点\n- hardSentences：高难句解析，数组形式，每项包含 sentence 和 explanation\n- grammarPoints：语法要点，数组形式，每项包含 point 和 detail\n\n只返回 JSON，不要添加额外说明。\n\n文章：\n${text}`;
  const payload = {
    contents: [
      {
        parts: [
          {
            text: prompt,
          },
        ],
      },
    ],
  };

  try {
    const response = await axios.post(endpoint, payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': apiKey,
      },
      timeout: 30000,
    });

    const candidate = response.data?.candidates?.[0];
    const textContent = candidate?.content?.find((item) => item.type === 'text')?.text || candidate?.text;

    if (!textContent) {
      throw new Error(`Gemini response missing text output: ${JSON.stringify(response.data)}`);
    }

    const cleaned = textContent.trim();
    const parsed = extractJsonObject(cleaned);

    if (parsed && typeof parsed === 'object') {
      return { ...parsed, source: 'gemini' };
    }

    return {
      summary: cleaned,
      hardSentences: [],
      grammarPoints: [],
      raw: cleaned,
      source: 'gemini',
    };
  } catch (error) {
    const message = String(error.message || '');
    const isNetworkError = [
      'ETIMEDOUT',
      'ECONNABORTED',
      'ECONNREFUSED',
      'ENOTFOUND',
      'EAI_AGAIN',
    ].includes(error.code) ||
      /connect .*ETIMEDOUT/i.test(message) ||
      /timeout of \d+ms exceeded/i.test(message) ||
      /socket hang up/i.test(message) ||
      /Network Error/i.test(message);

    if (isNetworkError) {
      console.warn('Gemini network error, returning fallback analysis:', message);
      return buildFallbackAnalysis(text, message);
    }

    throw error;
  }
}

async function callEudicTool(name, args) {
  if (!process.env.EUDIC_TOKEN) {
    throw new Error("EUDIC_TOKEN is not configured on the server.");
  }

  const response = await axios.post(
    "https://api.frdic.com/en/mcp",
    {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name, arguments: args },
    },
    {
      headers: {
        Authorization: process.env.EUDIC_TOKEN,
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      httpsAgent: eudicHttpsAgent,
      timeout: 15000,
    },
  );

  return parseMcpResponse(response.data);
}

function normalizeDictionaryEntry(entry) {
  const meanings = entry.meanings || [];
  const firstMeaning = meanings[0] || {};
  const definitions = meanings
    .flatMap((meaning) => meaning.definitions || [])
    .map((definition) => definition.definition)
    .filter(Boolean);
  const examples = meanings
    .flatMap((meaning) => meaning.definitions || [])
    .map((definition) => definition.example)
    .filter(Boolean);
  const phonetic = entry.phonetic || entry.phonetics?.find((item) => item.text)?.text || "";

  return {
    word: entry.word,
    phonetic,
    partOfSpeech: firstMeaning.partOfSpeech || "",
    definition: definitions[0] || "No definition available.",
    definitions,
    example: examples[0] || "No example available.",
    examples,
    synonyms: meanings.flatMap((meaning) => meaning.synonyms || []).slice(0, 8),
  };
}

function normalizeWiktionaryEntry(entries, requestedWord) {
  const englishEntries = entries.en || [];
  const firstEntry = englishEntries[0] || {};
  const definitions = englishEntries
    .flatMap((entry) => entry.definitions || [])
    .map((definition) => definition.definition)
    .filter(Boolean);
  const examples = englishEntries
    .flatMap((entry) => entry.definitions || [])
    .flatMap((definition) => definition.examples || [])
    .filter(Boolean);

  if (definitions.length === 0) {
    throw new Error("No Wiktionary definition was found.");
  }

  return {
    word: requestedWord,
    phonetic: firstEntry.sounds?.find((sound) => sound.ipa)?.ipa || "",
    partOfSpeech: firstEntry.partOfSpeech || "",
    definition: definitions[0],
    definitions,
    example: examples[0] || "No example available.",
    examples,
    synonyms: [],
  };
}

async function lookupWord(word) {
  try {
    const response = await axios.get(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
      { timeout: 10000 },
    );
    return normalizeDictionaryEntry(response.data[0]);
  } catch (freeDictionaryError) {
    try {
      const response = await axios.get(
        `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`,
        {
          headers: { "User-Agent": "DeepReadAI/1.0 (personal learning project)" },
          timeout: 10000,
        },
      );
      return normalizeWiktionaryEntry(response.data, word);
    } catch (wiktionaryError) {
      if (freeDictionaryError.response?.status === 404 && wiktionaryError.response?.status === 404) {
        const error = new Error("Word not found.");
        error.status = 404;
        throw error;
      }

      throw new Error("Dictionary providers are temporarily unavailable.");
    }
  }
}

app.get("/api/dictionary/:word", async (req, res) => {
  const word = req.params.word.trim().toLowerCase();

  if (!/^[a-z]+(?:'[a-z]+)?$/i.test(word)) {
    return res.status(400).json({ error: "Please provide a single English word." });
  }

  try {
    return res.json(await lookupWord(word));
  } catch (error) {
    if (error.status === 404) {
      return res.status(404).json({ error: `No dictionary entry found for “${word}”.` });
    }

    return res.status(502).json({ error: "Dictionary service is temporarily unavailable." });
  }
});

app.post("/api/eudic/vocabulary", async (req, res) => {
  const { word, contextLine } = req.body || {};

  if (typeof word !== "string" || !/^[a-z]+(?:'[a-z]+)?$/i.test(word)) {
    return res.status(400).json({ error: "Please provide a single English word." });
  }

  try {
    const result = await callEudicTool("add_word", {
      word: word.toLowerCase(),
      star: 1,
      context_line: typeof contextLine === "string" ? contextLine.slice(0, 1000) : null,
    });
    return res.status(201).json({ ok: true, result });
  } catch (error) {
    const status = error.response?.status;
    return res.status(status === 401 ? 401 : 502).json({
      error: status === 401 ? "Eudic authorization failed. Check EUDIC_TOKEN." : "Could not sync this word to Eudic.",
      details: error.message,
    });
  }
});

app.post('/api/translate', async (req, res) => {
  const { text, target = 'zh' } = req.body || {};

  console.log('translate request query:', req.query || {});

  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Please provide text to translate.' });
  }

  // Split into paragraph blocks by blank lines
  const paragraphs = String(text).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  const autoProvider = process.env.TENCENT_SECRET_ID && process.env.TENCENT_SECRET_KEY ? 'tencent' : 'libre';
  const provider = (req.query.provider || process.env.TRANSLATE_PROVIDER || autoProvider).toLowerCase();
  const results = [];

  try {
    for (const paragraph of paragraphs) {
      if (provider === 'mock') {
        results.push({ source: paragraph, translated: `[ZH] ${paragraph}` });
        continue;
      }

      if (provider === 'tencent') {
        const sourceLanguage = req.query.source || 'auto';

        if (paragraphs.length > 1) {
          const fullText = paragraphs.join('\n\n');
          const fullTranslated = await callTencentTextTranslation(fullText, target, sourceLanguage);
          const translatedBlocks = String(fullTranslated)
            .split(/\n\s*\n/)
            .map((block) => block.trim())
            .filter(Boolean);

          if (translatedBlocks.length === paragraphs.length) {
            translatedBlocks.forEach((translated, index) => {
              results.push({ source: paragraphs[index], translated });
            });
          } else {
            results.push({ source: fullText, translated: fullTranslated });
          }
          break;
        }

        const translated = await callTencentTextTranslation(paragraph, target, sourceLanguage);
        results.push({ source: paragraph, translated });
        continue;
      }

      if (provider === 'libre') {
        // Development fallback: if no API key is configured, return a placeholder
        // translation to avoid 3rd-party 403 during local development.
        if (!process.env.TRANSLATE_API_KEY) {
          results.push({ source: paragraph, translated: `[ZH] ${paragraph}` });
          continue;
        }

        const resp = await axios.post(
          'https://libretranslate.de/translate',
          {
            q: paragraph,
            source: 'en',
            target,
            format: 'text',
            api_key: process.env.TRANSLATE_API_KEY || '',
          },
          { timeout: 20000 },
        );

        const translated = resp.data?.translatedText || resp.data || '';
        results.push({ source: paragraph, translated });
        continue;
      }

      throw new Error(`Unsupported translate provider: ${provider}`);
    }

    return res.json({ paragraphs: results });
  } catch (error) {
    console.error('Translate error:', error?.message || error, error?.response?.data || 'no response body');
    return res.status(502).json({
      error: 'Translation provider error.',
      details: String(error?.response?.data?.Response?.Error?.Message || error?.message || error),
      provider,
    });
  }
});

app.post('/api/analyze', async (req, res) => {
  const { text } = req.body || {};
  const provider = (req.query.provider || process.env.ANALYSIS_PROVIDER || (process.env.OPENAI_API_KEY ? 'openai' : process.env.GOOGLE_GEMINI_API_KEY ? 'gemini' : 'fallback')).toLowerCase();
  const model = req.query.model || process.env.OPENAI_MODEL || 'gpt-5.4-mini';

  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Please provide text to analyze.' });
  }

  try {
    let analysis;

    if (provider === 'openai') {
      analysis = await callOpenAITextAnalysis(text, model);
    } else if (provider === 'gemini') {
      analysis = await callGeminiTextAnalysis(text);
    } else {
      analysis = buildFallbackAnalysis(text, 'No AI provider configured.');
    }

    return res.json(analysis);
  } catch (error) {
    const message = String(error?.message || error || '');
    const isNetworkError = /(?:ETIMEDOUT|ECONNABORTED|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|Network Error|timeout of \d+ms exceeded)/i.test(message);

    if (isNetworkError) {
      console.warn('Analyze network fallback:', message);
      const analysis = buildFallbackAnalysis(text, message);
      return res.json(analysis);
    }

    console.error('Analyze error:', message, error?.response?.data || 'no response body');
    return res.status(502).json({
      error: 'Text analysis provider error.',
      details: String(error?.response?.data?.error?.message || error?.message || error),
      provider,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Dictionary server running on http://localhost:${PORT}`);
});
