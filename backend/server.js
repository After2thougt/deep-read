const express = require("express");
const axios = require("axios");
const cors = require("cors");
const dotenv = require("dotenv");
const https = require("https");
const crypto = require("crypto");

function generateId(prefix = 'id') {
  // Avoid crypto.randomUUID() because some runtimes/polyfills may not expose it.
  // Node.js has crypto.randomBytes; use that first.
  try {
    const bytes = crypto.randomBytes(16);
    // 32 hex chars + time prefix keeps it unique without relying on UUID APIs.
    const rand = bytes.toString('hex');
    return `${prefix}-${Date.now().toString(36)}-${rand}`;
  } catch {
    // Extremely unlikely fallback.
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

const path = require("path");
const fs = require("fs");

const uploadsRoot = path.resolve(__dirname, "..", "uploads", "articles");
fs.mkdirSync(uploadsRoot, { recursive: true });

function normalizeArticleBlocks(articleId, blocks) {
  if (!Array.isArray(blocks) || !blocks.length) {
    const article = db.prepare('SELECT content FROM articles WHERE id = ?').get(articleId);
    return article ? [{ type: 'text', content: article.content }] : [];
  }
  return blocks
    .filter((block) => block && (block.type === 'text' || block.type === 'image') && typeof block.content === 'string')
    .map((block) => ({ id: block.id || generateId('block'), type: block.type, content: block.content, sort_order: Number.isFinite(Number(block.sort_order)) ? Number(block.sort_order) : 0 }));
}

function getArticleBlocks(articleId) {
  const rows = db.prepare('SELECT id, type, content, sort_order, created_at FROM article_blocks WHERE article_id = ? ORDER BY sort_order ASC, rowid ASC').all(articleId);
  if (rows.length) return rows;
  const article = db.prepare('SELECT content FROM articles WHERE id = ?').get(articleId);
  return article ? [{ type: 'text', content: article.content, sort_order: 0 }] : [];
}

function removeArticleImageIfUnused(imagePath, excludedArticleId) {
  const normalizedPath = String(imagePath || '');
  const relative = normalizedPath.startsWith('/uploads/articles/')
    ? normalizedPath.slice('/uploads/articles/'.length)
    : '';
  if (!relative || !/^[A-Za-z0-9._-]+$/.test(relative)) return false;

  const referencedElsewhere = db.prepare(`SELECT 1 FROM article_blocks
    WHERE type = 'image' AND content = ? AND article_id != ? LIMIT 1`)
    .get(normalizedPath, excludedArticleId);
  if (referencedElsewhere) return false;

  try {
    fs.unlinkSync(path.join(uploadsRoot, relative));
    return true;
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Unable to remove article image:', error.message);
    return false;
  }
}

function removeArticleImages(articleId) {
  const rows = db.prepare("SELECT content FROM article_blocks WHERE article_id = ? AND type = 'image'").all(articleId);
  for (const row of rows) removeArticleImageIfUnused(row.content, articleId);
}

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });
dotenv.config({ path: path.resolve(__dirname, ".env") });
const { db, serializeArticle, serializeVocabulary } = require("./db");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const eudicHttpsAgent = new https.Agent({
  keepAlive: true,
  family: 4,
  minVersion: "TLSv1.2",
  maxVersion: "TLSv1.2",
});

const allowedOrigin = String(process.env.CORS_ORIGIN || '').trim();
if (process.env.NODE_ENV === 'production' && !process.env.AUTH_SESSION_SECRET) {
  throw new Error('AUTH_SESSION_SECRET must be configured in production.');
}
if (process.env.NODE_ENV === 'production' && (!process.env.AUTH_USERNAME || !process.env.AUTH_PASSWORD)) {
  throw new Error('AUTH_USERNAME and AUTH_PASSWORD must be configured in production.');
}
const sessionSecret = String(process.env.AUTH_SESSION_SECRET || 'development-session-secret');
app.use(cors(allowedOrigin ? { origin: allowedOrigin, credentials: true } : (process.env.NODE_ENV === 'production' ? { origin: false } : undefined)));
app.use(express.json({ limit: '12mb' }));
app.use('/uploads', express.static(path.resolve(__dirname, '..', 'uploads')));

const sessions = new Map();
const loginAttempts = new Map();
const SESSION_COOKIE = 'deepread_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

// Session cleanup: remove expired sessions every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt < now) {
      sessions.delete(token);
    }
  }
}, 10 * 60 * 1000);
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [, salt, expected] = String(stored || '').split('$');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return actual.length === expected.length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function parseCookies(header) {
  return String(header || '').split(';').reduce((cookies, item) => {
    const index = item.indexOf('=');
    if (index > 0) cookies[item.slice(0, index).trim()] = decodeURIComponent(item.slice(index + 1).trim());
    return cookies;
  }, {});
}

function setSessionCookie(res, token) {
  const isProd = process.env.NODE_ENV === 'production';
  const secure = isProd ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; Path=/; HttpOnly; SameSite=Lax${secure}`);
}

function currentUser(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const [tokenId, signature] = String(token || '').split('.');
  const expectedSignature = tokenId && crypto.createHmac('sha256', sessionSecret).update(tokenId).digest('hex');
  if (!tokenId || !signature || signature.length !== expectedSignature.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    return null;
  }
  const session = token && sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  return session.username;
}

function requireAuth(req, res, next) {
  if (currentUser(req)) return next();
  return res.status(401).json({ error: 'Authentication required.' });
}

function ensureAdminUser() {
  const username = String(process.env.AUTH_USERNAME || '').trim();
  const password = String(process.env.AUTH_PASSWORD || '');
  if (!username || !password) return;
  const existing = db.prepare('SELECT id FROM auth_users WHERE username = ?').get(username);
  if (!existing) {
    const now = new Date().toISOString();
    db.prepare('INSERT INTO auth_users (username,password_hash,created_at,updated_at) VALUES (?,?,?,?)').run(username, hashPassword(password), now, now);
  }
}

function loginRateLimited(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || entry.resetAt <= now) { loginAttempts.set(ip, { count: 0, resetAt: now + LOGIN_WINDOW_MS }); return false; }
  return entry.count >= LOGIN_MAX_ATTEMPTS;
}

function recordLoginFailure(ip) {
  const entry = loginAttempts.get(ip) || { count: 0, resetAt: Date.now() + LOGIN_WINDOW_MS };
  entry.count += 1;
  loginAttempts.set(ip, entry);
}

ensureAdminUser();

app.post('/api/auth/login', (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (loginRateLimited(ip)) return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const user = db.prepare('SELECT username,password_hash FROM auth_users WHERE username = ?').get(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    recordLoginFailure(ip);
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  loginAttempts.delete(ip);
  const tokenId = crypto.randomBytes(32).toString('hex');
  const token = `${tokenId}.${crypto.createHmac('sha256', sessionSecret).update(tokenId).digest('hex')}`;
  sessions.set(token, { username: user.username, expiresAt: Date.now() + SESSION_TTL_MS });
  setSessionCookie(res, token);
  return res.json({ username: user.username });
});

app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) sessions.delete(token);
  const isProd = process.env.NODE_ENV === 'production';
  const secure = isProd ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure}`);
  return res.status(204).end();
});

app.post('/api/auth/change-password', requireAuth, (req, res) => {
  const username = currentUser(req);
  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current password and new password are required.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }

  const user = db.prepare('SELECT username, password_hash FROM auth_users WHERE username = ?').get(username);
  if (!user || !verifyPassword(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  // Update password hash
  const newHash = hashPassword(newPassword);
  db.prepare('UPDATE auth_users SET password_hash = ?, updated_at = ? WHERE username = ?')
    .run(newHash, new Date().toISOString(), username);

  // Delete ALL sessions for this user
  for (const [token, session] of sessions.entries()) {
    if (session.username === username) {
      sessions.delete(token);
    }
  }

  // Create new session for the user
  const tokenId = crypto.randomBytes(32).toString('hex');
  const token = `${tokenId}.${crypto.createHmac('sha256', sessionSecret).update(tokenId).digest('hex')}`;
  sessions.set(token, { username, expiresAt: Date.now() + SESSION_TTL_MS });
  setSessionCookie(res, token);

  return res.json({ success: true, message: 'Password changed successfully.' });
});

app.get("/api/auth/me", (req, res) => {
  const username = currentUser(req);
  if (!username) {
    return res.status(401).json({});
  }
  res.json({ username });
});

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/') || req.path === '/health') return next();
  return requireAuth(req, res, next);
});

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

const analysisGenerations = new Map();
const cancelledAnalysisRequests = new Set();

function analysisCacheKey(articleId, pageNumber, contentHash, promptVersion) {
  return `${articleId}:${pageNumber}:${contentHash}:${promptVersion}`;
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

// Tencent TextTranslate permits five requests per second. Keep a small margin
// and serialize request starts globally so parallel page/chunk translations do
// not exceed the account-wide rate limit.
const TENCENT_REQUEST_INTERVAL_MS = 275;
let nextTencentRequestAt = 0;

async function waitForTencentRequestSlot() {
  const now = Date.now();
  const scheduledAt = Math.max(now, nextTencentRequestAt);
  nextTencentRequestAt = scheduledAt + TENCENT_REQUEST_INTERVAL_MS;
  if (scheduledAt > now) {
    await new Promise((resolve) => setTimeout(resolve, scheduledAt - now));
  }
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
    await waitForTencentRequestSlot();
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

      const providerError = response.data?.Response?.Error;
      if (providerError) {
        const providerFailure = new Error(`Tencent translation error ${providerError.Code || 'Unknown'}: ${providerError.Message || 'Unknown provider error'}`);
        providerFailure.code = providerError.Code;
        throw providerFailure;
      }

      if (!response.data?.Response?.TargetText) {
        const errorDetails = JSON.stringify(response.data || response, null, 2);
        throw new Error(`Tencent translation response missing TargetText: ${errorDetails}`);
      }

      return response.data.Response.TargetText;
    } catch (error) {
      const errorCode = error.code || error.response?.data?.Response?.Error?.Code;
      const errorMessage = error.response?.data?.Response?.Error?.Message || error.message;

      if (errorCode === 'RequestLimitExceeded' && attempt < maxRetries - 1) {
        const delayMs = 1000 * Math.pow(2, attempt);
        console.warn(`Tencent request limited, retrying after ${delayMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        attempt += 1;
        continue;
      }

      if (errorCode) {
        throw new Error(`Tencent translation error ${errorCode}: ${errorMessage}`);
      }

      if (!error.response?.data?.Response?.TargetText) {
        throw new Error(`Tencent translation response missing TargetText: ${errorMessage}`);
      }

      throw error;
    }
  }

  throw new Error('Tencent translation failed after retries.');
}

// Tencent TextTranslate documents a 2,000-character SourceText limit.
// Keep a margin for provider-side counting differences and request overhead.
const TENCENT_TEXT_LIMIT = 2000;
const TENCENT_SAFE_TEXT_LIMIT = 1800;
const TENCENT_TRANSLATION_CONCURRENCY = 3;

function splitAtBoundaries(text, limit) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let remaining = text;
  const sentenceEnd = /[.!?。！？]+(?:["'”’»）)]*)?(?:\s+|$)/g;
  const softEnd = /[,;:\uFF0C\uFF1B\uFF1A]+(?:\s+|$)/g;

  while (remaining.length > limit) {
    const candidate = remaining.slice(0, limit);
    let cut = 0;
    for (const match of candidate.matchAll(sentenceEnd)) cut = match.index + match[0].length;
    if (!cut) for (const match of candidate.matchAll(softEnd)) cut = match.index + match[0].length;
    if (!cut) {
      const whitespace = candidate.lastIndexOf(" ");
      cut = whitespace > Math.floor(limit * 0.6) ? whitespace + 1 : limit;
    }
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function splitTranslationChunks(text, limit = TENCENT_SAFE_TEXT_LIMIT) {
  if (text.length <= limit) return [text];
  const paragraphs = text.split(/(\r?\n\s*\r?\n)/);
  const chunks = [];
  let pending = "";
  for (const part of paragraphs) {
    if (/^\r?\n\s*\r?\n$/.test(part)) {
      pending += part;
      continue;
    }
    if (pending && part.length + pending.length <= limit) {
      pending += part;
      continue;
    }
    if (pending) { chunks.push(...splitAtBoundaries(pending, limit)); pending = ""; }
    if (part.length <= limit) pending = part;
    else chunks.push(...splitAtBoundaries(part, limit));
  }
  if (pending) chunks.push(...splitAtBoundaries(pending, limit));
  if (chunks.join("") !== text) throw new Error("Translation chunking integrity check failed.");
  return chunks;
}

function normalizeTranslationInput(text) {
  return String(text || '')
    .replace(/[\u00B6\u2029]/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function removeStandaloneSectionMarkers(text) {
  return String(text || '')
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:[IVXLCDM]+|\d+)[.)]\s*$/i.test(line))
    .join('\n');
}

function toBaiduTargetLanguage(target) {
  const normalized = String(target || 'zh').trim().toLowerCase();
  if (normalized === 'zh' || normalized === 'zh-cn') return 'zh';
  return normalized;
}

// The Baidu AI text translation endpoint enforces a QPS limit. Serialize starts
// across article pages and retry only transient provider-side limit failures.
const BAIDU_REQUEST_INTERVAL_MS = 1100;
let nextBaiduRequestAt = 0;

async function waitForBaiduRequestSlot() {
  const now = Date.now();
  const scheduledAt = Math.max(now, nextBaiduRequestAt);
  nextBaiduRequestAt = scheduledAt + BAIDU_REQUEST_INTERVAL_MS;
  if (scheduledAt > now) await new Promise((resolve) => setTimeout(resolve, scheduledAt - now));
}

async function callBaiduTranslation(text, target, source = 'en') {
  const appId = String(process.env.BAIDU_TRANSLATE_APPID || '').trim();
  const apiKey = String(process.env.BAIDU_AI_TRANSLATE_API_KEY || '').trim();
  if (!appId || !apiKey) throw new Error('Baidu AI Translate credentials are not configured. Set BAIDU_TRANSLATE_APPID and BAIDU_AI_TRANSLATE_API_KEY.');

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await waitForBaiduRequestSlot();
    const response = await axios.post('https://fanyi-api.baidu.com/ait/api/aiTextTranslate', {
      appid: appId,
      q: text,
      from: source === 'auto' ? 'auto' : String(source).toLowerCase(),
      to: toBaiduTargetLanguage(target),
      model_type: 'llm',
    }, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: 30000,
      validateStatus: () => true,
    });
    if (response.status >= 200 && response.status < 300 && !response.data?.error_code) {
      const translated = response.data?.trans_result?.map((item) => item?.dst).filter(Boolean).join('\n');
      if (typeof translated !== 'string' || !translated.trim()) throw new Error(`Baidu AI Translate response missing translated text: ${JSON.stringify(response.data)}`);
      return translated.trim();
    }

    const errorCode = String(response.data?.error_code || response.status || 'Unknown');
    const errorMessage = response.data?.error_msg || `HTTP ${response.status}`;
    console.error('Baidu AI Translate API error', {
      errorCode,
      appIdSuffix: appId.slice(-4),
      source: source === 'auto' ? 'auto' : String(source).toLowerCase(),
      target: toBaiduTargetLanguage(target),
    });
    if (['54003', '59004', '429'].includes(errorCode) && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
      continue;
    }
    throw new Error(`Baidu AI Translate error ${errorCode}: ${errorMessage}`);
  }
  throw new Error('Baidu AI Translate request retry limit reached.');
}

async function translateTencentText(text, target, source) {
  const chunks = splitTranslationChunks(text);
  if (chunks.length === 1) return callTencentTextTranslation(chunks[0], target, source);
  const translated = new Array(chunks.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= chunks.length) return;
      try {
        translated[index] = await callTencentTextTranslation(chunks[index], target, source);
      } catch (error) {
        throw new Error(`Tencent translation failed for chunk ${index + 1}/${chunks.length}: ${error.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(TENCENT_TRANSLATION_CONCURRENCY, chunks.length) }, worker));
  return translated.join("");
}

function extractFirstSentence(text) {
  if (typeof text !== 'string' || !text.trim()) return '';
  // Remove JSON structural characters to get plain text, then take first sentence.
  const plain = text
    .replace(/[{}\[\]"\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const match = plain.match(/^[^.!?]*[.!?]/);
  return match ? match[0].trim() : plain.slice(0, 120).trim();
}

// Extract the root analysis JSON object from an AI text response.
//
// All bracket matching is delegated to JSON.parse (the only perfectly correct
// JSON parser).  The strategy:
//
//  1. Collect every `{…}` snippet that JSON.parse accepts as a valid object.
//  2. Prefer candidates that contain a `summary` field (root analysis).
//  3. Among summary-bearing candidates, pick the largest (handles the rare
//     case where a smaller junk object also has a `summary` key).
//
function extractOutermostJson(text) {
  if (!text || typeof text !== 'string') return null;

  // Strip ``` fences the AI may have added.
  const clean = text
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();

  // Fast path: entire response is valid JSON.
  try {
    const p = JSON.parse(clean);
    if (p && typeof p === 'object') {
      console.log('[analysis] fast-path full parse, keys:', Object.keys(p));
      return p;
    }
  } catch { /* fall through */ }

  // ------------- collect all parseable candidates ------------
  const candidates = [];  // { parsed, len, keys }

  const errorPosition = (err) => {
    const m = String(err.message || '').match(/position\s+(\d+)/i);
    return m ? parseInt(m[1], 10) : null;
  };

  let pos = 0;
  while ((pos = clean.indexOf('{', pos)) !== -1) {
    const suffix = clean.slice(pos);

    // ---- attempt: full suffix ----
    try {
      const p = JSON.parse(suffix);
      if (p && typeof p === 'object') {
        candidates.push({ parsed: p, len: suffix.length, keys: Object.keys(p) });
        pos++;
        continue;
      }
    } catch (e) {
      const errPos = errorPosition(e);
      if (errPos === null || errPos <= 2) { pos++; continue; }

      // ---- attempt: trim at error position ----
      const candidate = suffix.slice(0, errPos);
      try {
        const p = JSON.parse(candidate);
        if (p && typeof p === 'object') {
          candidates.push({ parsed: p, len: candidate.length, keys: Object.keys(p) });
          pos++;
          continue;
        }
      } catch {
        // ---- attempt: shrink char-by-char (up to 200 chars) ----
        let found = false;
        for (let end = errPos - 1; end > Math.max(5, errPos - 200); end--) {
          try {
            const p = JSON.parse(suffix.slice(0, end));
            if (p && typeof p === 'object') {
              candidates.push({ parsed: p, len: end, keys: Object.keys(p) });
              found = true;
              break;
            }
          } catch { /* keep shrinking */ }
        }
        if (!found) {
          // Log the first few failures for diagnosis.
          if (candidates.length === 0) {
            const ctx = clean.slice(Math.max(0, pos - 20), pos + 200);
            console.warn('[analysis] parse-fail at pos', pos,
              'errPos=', errPos, 'msg=', String(e.message || e).slice(0, 80),
              'ctx=', JSON.stringify(ctx.slice(0, 120)));
          }
        }
      }
    }

    pos++;
  }

  if (candidates.length === 0) {
    console.error('[analysis] No parseable JSON found in response.');
    return null;
  }

  // -------------- selection --------------\
  // Prefer candidates with a `summary` field (root analysis).
  const summaryBearing = candidates.filter(c => c.keys.includes('summary'));
  if (summaryBearing.length > 0) {
    // Pick largest — root analysis is always the biggest JSON block.
    summaryBearing.sort((a, b) => b.len - a.len);
    const best = summaryBearing[0];
    console.log('[analysis] selected summary-bearing candidate, keys:', best.keys,
      `(from ${candidates.length} candidates, ${summaryBearing.length} summary-bearing, len=${best.len})`);
    return best.parsed;
  }

  // Fallback — no summary-bearing candidate.  Use the largest overall.
  candidates.sort((a, b) => b.len - a.len);
  const best = candidates[0];
  console.warn('[analysis] NO summary-bearing candidate — falling back to largest. keys:', best.keys,
    `(from ${candidates.length} candidates, len=${best.len})`);
  return best.parsed;
}

function buildFallbackAnalysis(text, reason = 'AI analysis is unavailable.') {
  const sentences = String(text)
    .replace(/\s+/g, ' ')
    .split(/(?<=[.?!])\s+/)
    .filter((sentence) => sentence && !/^(?:[IVXLCDM]+|\d+)[.)]?$/i.test(sentence.trim()));

  return {
    summary: sentences.slice(0, 2).join(' '),
    hardSentences: sentences.slice(0, 2).map((sentence) => ({
      sentence,
      explanation: 'This sentence may contain complex structure; focus on subject-verb agreement and clause ordering.',
    })),
    keyPoints: [],
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
    vocabularyAnalysis: [],
    phraseCollocations: [],
    raw: 'AI analysis is unavailable. Returning a lightweight fallback summary and grammar guidance.',
    source: 'fallback',
    fallbackReason: reason,
  };
}

function buildAnalysisPrompt(text) {
  return `Analyze ONLY the current page text below. Return one valid JSON object and no Markdown.
Required top-level fields: summary (specific page summary), keyPoints (array), hardSentences (array), vocabularyAnalysis (array), phraseCollocations (array).
Select 2-4 complete, natural-language sentences from the supplied text (or fewer if there are fewer). Never select headings, Roman numerals, numbered list markers, isolated letters, or fragments such as "I." or "1.".
Every hardSentences item MUST include:
sentence: the exact complete source sentence;
difficulty: a concise level;
reason: why this sentence is difficult;
sentenceStructure: a clear pipe-separated text (grammar type) fallback map of THIS sentence, including word order;
sentenceStructureGroups: an array of 1-4 reliable syntax groups. Each group has label (use Main Clause, Coordinate Clause, Subordinate Clause, Relative Clause, Absolute Construction, Participial Phrase, Infinitive Phrase, Prepositional Phrase only when genuinely supported) and tokens (array of {text, type}). Preserve source order. Do not invent clause relationships. Put simple modifiers inline with their owning group when possible;
grammarExplanation: a concrete, sentence-specific explanation of the grammar and why it matters for a learner. Do not use placeholders such as "may contain complex structure";
literaryAnalysis: evidence-based comment, or say that literary value is limited;
chineseUnderstanding: natural Chinese meaning.
The fields sentenceStructure, sentenceStructureGroups, grammarExplanation, and literaryAnalysis are mandatory for every selected sentence. Do not return a separate structure field.
vocabularyAnalysis: extract 3-8 useful words from the entire current page, each with word, partOfSpeech, level, meaning, usage. meaning MUST be written in English only. 
Do not provide Chinese translations or bilingual explanations in vocabularyAnalysis.
The meaning should be a concise English dictionary-style definition suitable for English learners.
usage should be an English explanation of how the word is used in this context. Prefer C1/C2, literary, classical, formal, uncommon, potentially misleading, or contextually special words. Never include basic words such as the, room, night, and, or was. Use Formal, Literary, Archaic, or Advanced when an exact CEFR level is uncertain.
phraseCollocations:
Extract only genuine fixed expressions, idioms, phrasal verbs, lexical collocations, or commonly paired expressions from the current page.
Rules:
- Do NOT include ordinary word combinations or random phrases.
- A phrase must have a recognized usage pattern beyond its literal meaning.
- Include phrases only when they are useful for English learners.
- If the page contains no meaningful collocations, return an empty array [].
- Do not force the number of items.
- Do not invent phrases that are not present in the source text.
Each item must include:
phrase: the exact phrase from the source text;
meaning: an English-only explanation of the phrase;
context: explain the meaning of this phrase in the specific sentence from the article;
usage: typical usage notes, including literary/formal nuance when relevant.
Preserve the exact source phrase and do not invent facts.

CURRENT PAGE TEXT:
${text}`;
}

function hasDetailedSentenceAnalysis(analysis) {
  return Boolean(
    analysis &&
      typeof analysis === 'object' &&
      Array.isArray(analysis.hardSentences) &&
      analysis.hardSentences.some((item) =>
        item &&
        String(item.sentence || item.text || '').trim() &&
        String(item.sentenceStructure || '').trim() &&
        String(item.grammarExplanation || '').trim() &&
        String(item.literaryAnalysis || '').trim(),
      ),
  );
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
        input: buildAnalysisPrompt(text),
        max_output_tokens: 5000,
      };
    }

    return {
      model,
      messages: [
        {
          role: 'user',
          content: buildAnalysisPrompt(text),
        },
      ],
      temperature: 0.0,
      max_tokens: 5000,
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
    const parsed = extractOutermostJson(cleaned);

    if (parsed) {
      return { ...parsed, source: 'openai', model };
    }

    // Extraction failed — safe fallback.  Never leak raw AI text into summary.
    console.warn('[analysis] Extraction failed — using safe fallback', {
      responseLength: cleaned.length,
    });
    console.log('[analysis] Raw response preview:', cleaned.slice(0, 1000));
    return {
      summary: extractFirstSentence(cleaned) || 'AI analysis returned an unexpected format.',
      hardSentences: [],
      keyPoints: [],
      vocabularyAnalysis: [],
      phraseCollocations: [],
      source: 'fallback',
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

async function callOpenAITextTranslation(text, target, source = 'auto') {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OpenAI API key is not configured.');

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const rawBase = String(process.env.OPENAI_API_BASE || 'https://api.openai.com/v1');
  const base = normalizeOpenAIBase(rawBase);
  const useChatCompletions = rawBase.toLowerCase().endsWith('/chat/completions') || (process.env.OPENAI_API_MODE || 'responses').toLowerCase() === 'chat_completions' || base.includes('chatanywhere.tech');
  const targetName = target === 'zh' ? 'Chinese' : target;
  const prompt = `Translate the text below from ${source === 'auto' ? 'its source language' : source} into ${targetName}. Return only the translation. Do not explain, summarize, analyze grammar, add headings, or add quotation marks. Preserve the original paragraph text as faithfully as possible.\n\nTEXT:\n${text}`;
  const endpoint = useChatCompletions
    ? (rawBase.toLowerCase().endsWith('/chat/completions') ? rawBase : `${base}/v1/chat/completions`)
    : (rawBase.toLowerCase().endsWith('/responses') ? rawBase : `${base}/v1/responses`);
  const payload = useChatCompletions
    ? { model, messages: [{ role: 'user', content: prompt }], temperature: 0, max_tokens: 2400 }
    : { model, input: prompt, max_output_tokens: 2400 };
  const response = await axios.post(endpoint, payload, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    timeout: 30000,
  });
  const translated = String(extractOpenAIResponseText(response.data) || response.data?.choices?.[0]?.message?.content || '').trim();
  if (!translated) throw new Error('OpenAI translation response missing text output.');
  return translated;
}

async function callGeminiTextAnalysis(text) {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Google Gemini API key is not configured.');
  }

  const model = process.env.GOOGLE_GEMINI_MODEL || 'gemini-flash-latest';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const prompt = buildAnalysisPrompt(text);
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
    generationConfig: { temperature: 0.2, maxOutputTokens: 2400 },
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
    const parsed = extractOutermostJson(cleaned);

    if (parsed) {
      return { ...parsed, source: 'gemini' };
    }

    console.warn('[gemini] Extraction failed — using safe fallback');
    return {
      summary: extractFirstSentence(cleaned) || 'AI analysis returned an unexpected format.',
      hardSentences: [],
      keyPoints: [],
      vocabularyAnalysis: [],
      phraseCollocations: [],
      source: 'fallback',
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
  const apiKey = process.env.MERRIAM_WEBSTER_LEARNERS_KEY;
  if (!apiKey) throw new Error('Merriam-Webster Learner\'s Dictionary API key is not configured.');
  try {
    const response = await axios.get(
      `https://www.dictionaryapi.com/api/v3/references/learners/json/${encodeURIComponent(word)}`,
      { params: { key: apiKey }, timeout: 10000 },
    );
    const entries = Array.isArray(response.data) ? response.data.filter((entry) => entry && typeof entry === 'object') : [];
    if (!entries.length) {
      const notFound = new Error('Word not found.');
      notFound.status = 404;
      throw notFound;
    }
    const cleanText = (value) => String(value || '').replace(/\{[^}]+\}/g, '').replace(/\s+/g, ' ').trim();
    const definitions = entries.flatMap((entry) => entry.shortdef || []).map(cleanText).filter(Boolean);
    const examples = entries.flatMap((entry) => entry.def || [])
      .flatMap((definition) => definition.sseq || [])
      .flatMap((sequence) => sequence)
      .flatMap((item) => item?.[1]?.dt || [])
      .filter(([type]) => type === 'vis')
      .flatMap(([, values]) => values || [])
      .map((value) => cleanText(value.t))
      .filter(Boolean);
    if (!definitions.length) throw new Error("No dictionary definition was found.");
    const firstEntry = entries[0] || {};
    return {
      word: firstEntry.meta?.id?.split(':')[0] || word,
      phonetic: firstEntry.hwi?.prs?.[0]?.ipa || '',
      partOfSpeech: firstEntry.fl || '',
      definition: definitions[0],
      definitions,
      example: examples[0] || 'No example available.',
      examples,
      synonyms: [],
    };
  } catch (error) {
    if (error.status === 404 || error.response?.status === 404) {
      const notFound = new Error("Word not found.");
      notFound.status = 404;
      throw notFound;
    }
    throw new Error("Merriam-Webster Dictionary is temporarily unavailable.");
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
    });
  }
});

function parseListNumber(value, fallback, max = 50) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function resolveSort(sort) {
  switch (sort) {
    case 'created_desc': return 'a.created_at DESC';
    case 'title_asc':   return 'a.title COLLATE NOCASE ASC';
    case 'words_desc':  return 'length(a.content) DESC';
    default:            return 'a.updated_at DESC'; // recently updated (backward compatible)
  }
}

app.get('/api/articles', async (req, res) => {
  const page = parseListNumber(req.query.page, 1, Number.MAX_SAFE_INTEGER);
  const limit = parseListNumber(req.query.limit, 10);
  const tag = typeof req.query.tag === 'string' ? req.query.tag : 'all';
  const title = (typeof req.query.title === 'string' && req.query.title.trim()) ? req.query.title.trim() : '';
  const tagSearch = (typeof req.query.tagSearch === 'string' && req.query.tagSearch.trim()) ? req.query.tagSearch.trim() : '';
  const sort = resolveSort(req.query.sort);
  const isSearching = title || tagSearch;
  const params = [];
  let where = '';

  if (isSearching) {
    const clauses = [];
    if (title) {
      clauses.push('a.title LIKE ?');
      params.push(`%${title}%`);
    }
    if (tagSearch) {
      clauses.push(`EXISTS (SELECT 1 FROM article_tags at JOIN tags t ON t.id = at.tag_id
        WHERE at.article_id = a.id AND t.name LIKE ?)`);
      params.push(`%${tagSearch}%`);
    }
    where = `WHERE ${clauses.join(' OR ')}`;
  } else if (tag === 'untagged') {
    where = 'WHERE NOT EXISTS (SELECT 1 FROM article_tags at WHERE at.article_id = a.id)';
  } else if (tag !== 'all') {
    const tagId = Number(tag);
    if (!Number.isInteger(tagId) || tagId <= 0) return res.status(400).json({ error: 'Invalid tag filter.' });
    where = 'WHERE EXISTS (SELECT 1 FROM article_tags at WHERE at.article_id = a.id AND at.tag_id = ?)';
    params.push(tagId);
  }

  try {
    const total = db.prepare(`SELECT COUNT(*) AS count FROM articles a ${where}`).get(...params).count;
    const rows = db.prepare(`SELECT a.id, a.title,  a.created_at, a.updated_at, length(a.content) AS content_length
      FROM articles a ${where} ORDER BY ${sort} LIMIT ? OFFSET ?`)
      .all(...params, limit, (page - 1) * limit);
    const ids = rows.map((row) => row.id);
    const tagsByArticle = new Map(ids.map((id) => [id, []]));
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      const tagRows = db.prepare(`SELECT at.article_id, t.id, t.name
        FROM article_tags at JOIN tags t ON t.id = at.tag_id
        WHERE at.article_id IN (${placeholders}) ORDER BY t.name COLLATE NOCASE`).all(...ids);
      for (const row of tagRows) tagsByArticle.get(row.article_id).push({ id: row.id, name: row.name });
    }
    const untaggedTotal = db.prepare(`SELECT COUNT(*) AS count FROM articles a
      WHERE NOT EXISTS (SELECT 1 FROM article_tags at WHERE at.article_id = a.id)`).get().count;
    const allTotal = db.prepare('SELECT COUNT(*) AS count FROM articles').get().count;
    const tags = db.prepare(`SELECT t.id, t.name, t.created_at, t.updated_at,
      COUNT(at.article_id) AS article_count
      FROM tags t LEFT JOIN article_tags at ON at.tag_id = t.id
      GROUP BY t.id ORDER BY t.name COLLATE NOCASE`).all();
    return res.json({
      items: rows.map((row) => ({ ...row, tags: tagsByArticle.get(row.id) || [] })),
      tags,
      total,
      allTotal,
      untaggedTotal,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/tags', (req, res) => {
  try {
    return res.json(db.prepare(`SELECT t.id, t.name, t.created_at, t.updated_at,
      COUNT(at.article_id) AS article_count
      FROM tags t LEFT JOIN article_tags at ON at.tag_id = t.id
      GROUP BY t.id ORDER BY t.name COLLATE NOCASE`).all());
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load tags.' });
  }
});

app.get('/api/articles/:id/tags', (req, res) => {
  try {
    const article = db.prepare('SELECT id FROM articles WHERE id = ?').get(req.params.id);
    if (!article) return res.status(404).json({ error: 'Article not found.' });
    return res.json(db.prepare(`SELECT t.id, t.name, t.created_at, t.updated_at
      FROM article_tags at JOIN tags t ON t.id = at.tag_id
      WHERE at.article_id = ? ORDER BY t.name COLLATE NOCASE`).all(req.params.id));
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load article tags.' });
  }
});

app.post('/api/tags', (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'Tag name is required.' });
  if (name.length > 80) return res.status(400).json({ error: 'Tag name is too long.' });
  try {
    const now = new Date().toISOString();
    const result = db.prepare('INSERT INTO tags (name, created_at, updated_at) VALUES (?, ?, ?)').run(name, now, now);
    return res.status(201).json(db.prepare('SELECT id, name, created_at, updated_at, 0 AS article_count FROM tags WHERE id = ?').get(result.lastInsertRowid));
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error: 'That tag already exists.' });
    return res.status(500).json({ error: 'Unable to create tag.' });
  }
});

app.patch('/api/tags/:id', (req, res) => {
  const id = Number(req.params.id);
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!Number.isInteger(id) || id <= 0 || !name) return res.status(400).json({ error: 'Valid tag id and name are required.' });
  if (name.length > 80) return res.status(400).json({ error: 'Tag name is too long.' });
  try {
    const result = db.prepare('UPDATE tags SET name = ?, updated_at = ? WHERE id = ?').run(name, new Date().toISOString(), id);
    if (!result.changes) return res.status(404).json({ error: 'Tag not found.' });
    return res.json(db.prepare(`SELECT t.id, t.name, t.created_at, t.updated_at, COUNT(at.article_id) AS article_count
      FROM tags t LEFT JOIN article_tags at ON at.tag_id = t.id WHERE t.id = ? GROUP BY t.id`).get(id));
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error: 'That tag already exists.' });
    return res.status(500).json({ error: 'Unable to rename tag.' });
  }
});

app.delete('/api/tags/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Valid tag id is required.' });
  try {
    const result = db.prepare('DELETE FROM tags WHERE id = ?').run(id);
    return result.changes ? res.status(204).end() : res.status(404).json({ error: 'Tag not found.' });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to delete tag.' });
  }
});

app.post('/api/articles/:id/tags/:tagId', (req, res) => {
  const articleId = String(req.params.id || '');
  const tagId = Number(req.params.tagId);
  if (!articleId || !Number.isInteger(tagId) || tagId <= 0) return res.status(400).json({ error: 'Valid article and tag are required.' });
  try {
    const article = db.prepare('SELECT id FROM articles WHERE id = ?').get(articleId);
    const tag = db.prepare('SELECT id FROM tags WHERE id = ?').get(tagId);
    if (!article || !tag) return res.status(404).json({ error: 'Article or tag not found.' });
    db.prepare('INSERT OR IGNORE INTO article_tags (article_id, tag_id, created_at) VALUES (?, ?, ?)').run(articleId, tagId, new Date().toISOString());
    return res.status(204).end();
  } catch (error) {
    return res.status(500).json({ error: 'Unable to add tag to article.' });
  }
});

app.delete('/api/articles/:id/tags/:tagId', (req, res) => {
  const articleId = String(req.params.id || '');
  const tagId = Number(req.params.tagId);
  if (!articleId || !Number.isInteger(tagId) || tagId <= 0) return res.status(400).json({ error: 'Valid article and tag are required.' });
  try {
    db.prepare('DELETE FROM article_tags WHERE article_id = ? AND tag_id = ?').run(articleId, tagId);
    return res.status(204).end();
  } catch (error) {
    return res.status(500).json({ error: 'Unable to remove tag from article.' });
  }
});

app.post('/api/articles/images', (req, res) => {
  const { data, mimeType } = req.body || {};
  const allowed = new Map([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/gif', 'gif'],
    ['image/webp', 'webp'],
  ]);
  const extension = allowed.get(mimeType);
  if (!extension || typeof data !== 'string') return res.status(400).json({ error: 'Only JPEG, PNG, GIF, and WebP images are allowed.' });
  const match = data.match(/^data:([^;]+);base64,(.+)$/);
  if (!match || match[1] !== mimeType) return res.status(400).json({ error: 'Invalid image data.' });
  let buffer;
  try { buffer = Buffer.from(match[2], 'base64'); } catch { return res.status(400).json({ error: 'Invalid image data.' }); }
  if (!buffer.length || buffer.length > 8 * 1024 * 1024) return res.status(413).json({ error: 'Image must be smaller than 8 MB.' });
  const fileName = `${generateId('image')}.${extension}`;
  fs.writeFileSync(path.join(uploadsRoot, fileName), buffer, { flag: 'wx' });
  return res.status(201).json({ path: `/uploads/articles/${fileName}`, url: `/uploads/articles/${fileName}` });
});

app.get('/api/articles/:id', (req, res) => {
  try {
    const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(req.params.id);
    if (!article) return res.status(404).json({ error: 'Article not found.' });
    const tags = db.prepare(`SELECT t.id, t.name FROM article_tags at
      JOIN tags t ON t.id = at.tag_id WHERE at.article_id = ? ORDER BY t.name COLLATE NOCASE`).all(article.id);
    return res.json({ ...serializeArticle(article), tags, blocks: getArticleBlocks(article.id).map(({ id, type, content, sort_order }) => ({ id, type, content, sort_order })) });
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/articles', async (req, res) => {
  const { id, title, content, highlights = [], blocks } = req.body || {};
  if (typeof title !== 'string' || !title.trim() || typeof content !== 'string') {
    return res.status(400).json({ error: 'Article title and content are required.' });
  }

  try {
    const now = new Date().toISOString();
    const article = { id: id || generateId('article'), title: title.trim(), content, highlights: JSON.stringify(highlights), created_at: now, updated_at: now };
    db.prepare(`INSERT INTO articles (id, title, content, highlights, created_at, updated_at)
      VALUES (@id, @title, @content, @highlights, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, content = excluded.content,
      highlights = excluded.highlights, updated_at = excluded.updated_at`).run(article);
    if (Array.isArray(blocks)) {
      const normalizedBlocks = normalizeArticleBlocks(article.id, blocks);
      const previousImages = db.prepare("SELECT content FROM article_blocks WHERE article_id = ? AND type = 'image'").all(article.id);
      db.prepare('DELETE FROM article_blocks WHERE article_id = ?').run(article.id);
      const insertBlock = db.prepare('INSERT INTO article_blocks (id, article_id, type, content, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)');
      normalizedBlocks.forEach((block, index) => insertBlock.run(block.id, article.id, block.type, block.content, index, now));
      const nextImages = new Set(normalizedBlocks.filter((block) => block.type === 'image').map((block) => block.content));
      for (const row of previousImages) {
        if (!nextImages.has(row.content)) removeArticleImageIfUnused(row.content, article.id);
      }
    }
    return res.status(201).json({ ...serializeArticle(db.prepare('SELECT * FROM articles WHERE id = ?').get(article.id)), blocks: getArticleBlocks(article.id).map(({ id, type, content, sort_order }) => ({ id, type, content, sort_order })) });
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/articles/:id', async (req, res) => {
  const id = req.params.id;
  if (!id) {
    return res.status(400).json({ error: 'Article id is required.' });
  }

  try {
    removeArticleImages(id);
    db.prepare('DELETE FROM articles WHERE id = ?').run(id);
    return res.status(204).end();
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/articles/:id/analysis', async (req, res) => {
  const articleId = req.params.id;
  const { text, pageNumber = 1 } = req.body || {};
  const promptVersion = process.env.ANALYSIS_PROMPT_VERSION || 'v4';
  const requestId = req.get('X-Analysis-Request-Id');

  if (!articleId || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Article id and article text are required.' });
  }

  try {
    if (requestId) cancelledAnalysisRequests.add(requestId);
    // Only clear the cache for this saved article at its current content revision.
    const article = db.prepare('SELECT id FROM articles WHERE id = ?').get(articleId);
    if (!article) {
      return res.json({ deleted: 0 });
    }

    const contentHash = hashSha256(text);
    const key = analysisCacheKey(article.id, pageNumber, contentHash, promptVersion);
    analysisGenerations.set(key, (analysisGenerations.get(key) || 0) + 1);
    const result = db.prepare(`DELETE FROM article_analyses
      WHERE article_id = ? AND page_number = ? AND content_hash = ? AND prompt_version = ?`)
      .run(article.id, pageNumber, contentHash, promptVersion);
    return res.json({ deleted: result.changes });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to clear the analysis cache.' });
  }
});

app.get('/api/vocabulary', async (req, res) => {
  const page = parseListNumber(req.query.page, 1, Number.MAX_SAFE_INTEGER);
  const limit = parseListNumber(req.query.limit, 10);
  const sort = req.query.sort === 'az' ? 'az' : 'recent';

  const search =
    typeof req.query.search === 'string'
      ? req.query.search.trim().slice(0, 100)
      : '';

  const articleId = req.query.article_id;  // 放这里

  const conditions = [];
  const params = [];

  if (search) {
    conditions.push('LOWER(v.word) LIKE LOWER(?)');
    params.push(`%${search}%`);
  }

  if (articleId) {
    conditions.push('v.article_id = ?');
    params.push(articleId);
  }

  const where = conditions.length
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  const orderBy =
    sort === 'az'
      ? 'v.word COLLATE NOCASE ASC'
      : 'v.saved_at DESC';

  try {
    const total = db.prepare(
      `SELECT COUNT(*) AS count 
       FROM vocabulary v ${where}`
    ).get(...params).count;

    const rows = db.prepare(
      `SELECT v.*, a.title AS source_article_title
       FROM vocabulary v 
       LEFT JOIN articles a ON a.id = v.article_id
       ${where}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`
    )
    .all(
      ...params,
      limit,
      (page - 1) * limit
    )
    .map(serializeVocabulary);

    return res.json({
      items: rows,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit))
    });

  } catch (error) {
    console.error(error);
    return res.status(500)
      .json({ error: 'Internal server error' });
  }
});

app.post('/api/vocabulary', async (req, res) => {
  const { id, word, definition, phonetic, partOfSpeech, example, articleId, savedAt, nextReview, reviewCount, easeFactor, interval, contextLine, raw } = req.body || {};
  if (typeof word !== 'string' || !word.trim()) {
    return res.status(400).json({ error: 'Vocabulary word is required.' });
  }

  try {
    const entry = {
      id: id || generateId('vocab'),
      word: word.trim().toLowerCase(),
      definition: typeof definition === 'string' ? definition : null,
      phonetic: typeof phonetic === 'string' ? phonetic : null,
      part_of_speech: typeof partOfSpeech === 'string' ? partOfSpeech : null,
      example: typeof example === 'string' ? example : null,
      article_id: typeof articleId === 'string' ? articleId : null,
      saved_at: savedAt || new Date().toISOString(),
      next_review: typeof nextReview === 'string' ? nextReview : null,
      review_count: Number.isInteger(reviewCount) ? reviewCount : 0,
      ease_factor: typeof easeFactor === 'number' ? easeFactor : 2.5,
      interval: Number.isInteger(interval) ? interval : 0,
      context_line: typeof contextLine === 'string' ? contextLine : null,
      raw: raw ? JSON.stringify(raw) : null,
    };

    db.prepare(`INSERT INTO vocabulary (id, word, definition, phonetic, part_of_speech, example, article_id, saved_at, next_review, review_count, ease_factor, interval, context_line, raw)
      VALUES (@id, @word, @definition, @phonetic, @part_of_speech, @example, @article_id, @saved_at, @next_review, @review_count, @ease_factor, @interval, @context_line, @raw)
      ON CONFLICT(word) DO UPDATE SET definition = excluded.definition, phonetic = excluded.phonetic,
      part_of_speech = excluded.part_of_speech, example = excluded.example,
      saved_at = excluded.saved_at, next_review = excluded.next_review, review_count = excluded.review_count,
      ease_factor = excluded.ease_factor, interval = excluded.interval, context_line = excluded.context_line,
      raw = excluded.raw, article_id = COALESCE(vocabulary.article_id, excluded.article_id)`).run(entry);
    return res.status(201).json(serializeVocabulary(db.prepare('SELECT * FROM vocabulary WHERE word = ?').get(entry.word)));
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/vocabulary/:word', async (req, res) => {
  const word = req.params.word?.trim().toLowerCase();
  if (!word) {
    return res.status(400).json({ error: 'Vocabulary word is required.' });
  }

  try {
    const entry = db.prepare('SELECT * FROM vocabulary WHERE word = ?').get(word);
    if (!entry) {
      return res.status(404).json({ error: 'Word not found.' });
    }
    return res.json(serializeVocabulary(entry));
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/articles/:id/vocabulary', (req, res) => {
  try {
    const words = db.prepare(`
      SELECT word
      FROM vocabulary
      WHERE article_id = ?
    `)
    .all(req.params.id)
    .map(row => row.word.toLowerCase());

    res.json(words);

  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Internal server error"
    });
  }
});

app.delete('/api/vocabulary/:word', async (req, res) => {
  const word = req.params.word?.trim().toLowerCase();
  if (!word) {
    return res.status(400).json({ error: 'Vocabulary word is required.' });
  }

  try {
    db.prepare('DELETE FROM vocabulary WHERE word = ?').run(word);
    return res.status(204).end();
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/sync', async (req, res) => {
  const { articles = [], vocabulary = [] } = req.body || {};

  try {
    let articlesSaved = 0;
    let vocabularySaved = 0;

    const saveAll = db.transaction(() => {
    if (Array.isArray(articles)) {
      for (const a of articles) {
        const article = {
          id: a.id || generateId('article'),
          title: (a.title || 'Untitled article').trim(),
          content: a.content || '',
          highlights: JSON.stringify(a.highlights || []),
          created_at: a.createdAt || new Date().toISOString(),
          updated_at: a.updatedAt || new Date().toISOString(),
        };
        db.prepare(`INSERT INTO articles (id, title, content, highlights, created_at, updated_at)
          VALUES (@id, @title, @content, @highlights, @created_at, @updated_at)
          ON CONFLICT(id) DO UPDATE SET title = excluded.title, content = excluded.content,
          highlights = excluded.highlights, updated_at = excluded.updated_at`).run(article);
        articlesSaved += 1;
      }
    }

    if (Array.isArray(vocabulary)) {
      for (const v of vocabulary) {
        const entry = {
          id: v.id || generateId('vocab'),
          word: (v.word || '').trim().toLowerCase(),
          definition: v.definition || null,
          phonetic: v.phonetic || null,
          part_of_speech: v.partOfSpeech || null,
          example: v.example || null,
          article_id: v.articleId || null,
          saved_at: v.savedAt || new Date().toISOString(),
          next_review: v.nextReview || null,
          review_count: Number.isInteger(v.reviewCount) ? v.reviewCount : 0,
          ease_factor: typeof v.easeFactor === 'number' ? v.easeFactor : 2.5,
          interval: Number.isInteger(v.interval) ? v.interval : 0,
          context_line: v.contextLine || null,
          raw: v.raw ? JSON.stringify(v.raw) : null,
        };

        if (!entry.word) continue;
        db.prepare(`INSERT INTO vocabulary (id, word, definition, phonetic, part_of_speech, example, article_id, saved_at, next_review, review_count, ease_factor, interval, context_line, raw)
          VALUES (@id, @word, @definition, @phonetic, @part_of_speech, @example, @article_id, @saved_at, @next_review, @review_count, @ease_factor, @interval, @context_line, @raw)
          ON CONFLICT(word) DO UPDATE SET definition = excluded.definition, phonetic = excluded.phonetic,
          part_of_speech = excluded.part_of_speech, example = excluded.example, article_id = excluded.article_id,
          saved_at = excluded.saved_at, next_review = excluded.next_review, review_count = excluded.review_count,
          ease_factor = excluded.ease_factor, interval = excluded.interval, context_line = excluded.context_line, raw = excluded.raw`).run(entry);
        vocabularySaved += 1;
      }
    }
    });
    saveAll();

    return res.json({ ok: true, articlesSaved, vocabularySaved });
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/translate', async (req, res) => {
  const { text, target = 'zh', articleId, pageNumber = 1 } = req.body || {};

  console.log('translate request query:', req.query || {});

  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Please provide text to translate.' });
  }

  // Split into paragraph blocks by blank lines
  const paragraphs = String(text)
    .split(/\r?\n\s*\r?\n/)
    .map((p) => removeStandaloneSectionMarkers(p).replace(/[\u00B6\u2029]/g, ' ').trim())
    .filter((p) => p && !/^[\s\u00B6\u2029]+$/.test(p));

  const provider = 'baidu';
  const results = [];

  try {
    const contentHash = hashSha256(paragraphs.map(normalizeTranslationInput).join('\n\n'));
    const legacyContentHash = hashSha256(text);
    const sourceLanguage = req.query.source || 'EN';
    if (articleId) {
      const cacheLookup = db.prepare('SELECT translation FROM article_translation_cache WHERE article_id = ? AND page_number = ? AND content_hash = ? AND target = ? AND source = ? AND provider = ?');
      const cached = cacheLookup.get(articleId, pageNumber, contentHash, target, sourceLanguage, provider);
      if (cached) return res.json(JSON.parse(cached.translation));

      // Existing caches were keyed by the raw page text. Reuse them when they
      // do not contain a standalone section marker that must now be filtered.
      const legacyCached = legacyContentHash === contentHash ? null : cacheLookup.get(articleId, pageNumber, legacyContentHash, target, sourceLanguage, provider);
      if (legacyCached) {
        const legacyPayload = JSON.parse(legacyCached.translation);
        const containsStandaloneMarker = Array.isArray(legacyPayload?.paragraphs) && legacyPayload.paragraphs.some((item) => /(?:^|\n)\s*(?:[IVXLCDM]+|\d+)[.)]\s*(?:\n|$)/i.test(String(item?.source || '')));
        if (!containsStandaloneMarker) return res.json(legacyPayload);
      }
    }
    for (const paragraph of paragraphs) {
      const translationInput = normalizeTranslationInput(paragraph);
      if (!translationInput) continue;

      const translated = await callBaiduTranslation(translationInput, target, sourceLanguage);
      results.push({ source: translationInput, translated });
    }

    const payload = { paragraphs: results };
    if (articleId) {
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO article_translation_cache (article_id,page_number,content_hash,target,source,provider,translation,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(article_id,page_number,content_hash,source,target,provider) DO UPDATE SET translation=excluded.translation,updated_at=excluded.updated_at`)
        .run(articleId, pageNumber, contentHash, target, sourceLanguage, provider, JSON.stringify(payload), now, now);
    }
    return res.json(payload);
  } catch (error) {
    console.error('Translate error:', error?.message || error, error?.response?.data || 'no response body');
    return res.status(502).json({
      error: error?.message || 'Baidu AI Translate failed.',
      provider,
    });
  }
});

app.post("/api/auth/logout",(req,res)=>{
  req.session.destroy(()=>{
    res.json({
      success:true
    });
  });
});

app.post('/api/analyze', async (req, res) => {
  const { text, articleId, pageNumber = 1 } = req.body || {};
  const requestId = req.get('X-Analysis-Request-Id');
  const provider = (req.query.provider || process.env.ANALYSIS_PROVIDER || (process.env.OPENAI_API_KEY ? 'openai' : process.env.GOOGLE_GEMINI_API_KEY ? 'gemini' : 'fallback')).toLowerCase();
  const model = req.query.model || process.env.OPENAI_MODEL || 'gpt-5.4-mini';
  const analysisModel = provider === 'gemini' ? (process.env.GOOGLE_GEMINI_MODEL || 'gemini-flash-latest') : provider === 'openai' ? model : provider;
  const promptVersion = process.env.ANALYSIS_PROMPT_VERSION || 'v4';

  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Please provide text to analyze.' });
  }

  const analysisInput = text;
  const contentHash = hashSha256(analysisInput);
  let cacheArticle = null;
  let cacheKey = null;
  let cacheGeneration = null;

  // The existing frontend sends the article text only. Resolve a saved article
  // by its exact content so the request contract remains unchanged. Unsaved or
  // edited drafts still use the existing AI path without being cached.
  try {
    cacheArticle = articleId
      ? db.prepare('SELECT id FROM articles WHERE id = ?').get(articleId)
      : db.prepare('SELECT id FROM articles WHERE content = ? ORDER BY updated_at DESC LIMIT 1').get(analysisInput);
    if (cacheArticle) {
      cacheKey = analysisCacheKey(cacheArticle.id, pageNumber, contentHash, promptVersion);
      cacheGeneration = analysisGenerations.get(cacheKey) || 0;
      const cached = db.prepare(`SELECT analysis FROM article_analyses
        WHERE article_id = ? AND page_number = ? AND content_hash = ? AND prompt_version = ? LIMIT 1`)
        .get(articleId || cacheArticle.id, pageNumber, contentHash, promptVersion);
      if (cached) {
        try {
          if (requestId) cancelledAnalysisRequests.delete(requestId);
          return res.json(JSON.parse(cached.analysis));
        } catch (cacheParseError) {
          console.warn('Ignoring malformed analysis cache entry, re-fetching.');
        }
      }
    }
  } catch (cacheReadError) {
    console.warn('Analysis cache lookup failed; continuing without cache.');
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

    // Cache writes are best-effort. A cache failure must never turn a valid AI
    // response into an analysis error. Network fallbacks are intentionally not
    // cached so a later request can retry the configured provider.
    // Validate that analysis has meaningful content before caching
    const hasMeaningfulContent = analysis &&
      typeof analysis.summary === 'string' && analysis.summary.trim().length > 0 &&
      Array.isArray(analysis.hardSentences) && analysis.hardSentences.length > 0 &&
      Array.isArray(analysis.vocabularyAnalysis) && analysis.vocabularyAnalysis.length > 0 &&
      Array.isArray(analysis.phraseCollocations) && analysis.phraseCollocations.length > 0;

    if (cacheArticle && analysis?.source !== 'fallback' && hasMeaningfulContent && (analysisGenerations.get(cacheKey) || 0) === cacheGeneration && !cancelledAnalysisRequests.has(requestId)) {
      try {
        const now = new Date().toISOString();
        const saveAnalysis = db.transaction(() => {
          db.prepare('DELETE FROM article_analyses WHERE article_id = ? AND page_number = ? AND content_hash = ? AND prompt_version = ?')
            .run(cacheArticle.id, pageNumber, contentHash, promptVersion);
          db.prepare(`INSERT INTO article_analyses
            (article_id, page_number, content_hash, analysis, model, prompt_version, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(cacheArticle.id, pageNumber, contentHash, JSON.stringify(analysis), analysisModel, promptVersion, now, now);
        });
        saveAnalysis();
      } catch (cacheWriteError) {
        console.warn('Analysis cache save failed; returning the AI result.');
      }
    }

    console.log('[api/analyze] returning analysis keys:', Object.keys(analysis || {}),
      'hardSentences.length:', analysis?.hardSentences?.length,
      'vocabularyAnalysis.length:', analysis?.vocabularyAnalysis?.length,
      'phraseCollocations.length:', analysis?.phraseCollocations?.length);

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
      provider,
    });
  } finally {
    if (requestId) cancelledAnalysisRequests.delete(requestId);
  }
});

app.get('/api/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    return res.json({ status: 'ok' });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

if (process.env.NODE_ENV === 'production') {
  const distPath = path.resolve(__dirname, '..', 'dist');
  app.use(express.static(distPath));
  app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`Server listening on ${HOST}:${PORT}`);
  });
}

module.exports = { app, splitTranslationChunks, splitAtBoundaries };
