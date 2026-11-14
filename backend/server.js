const express = require("express");
const axios = require("axios");
const cors = require("cors");
const dotenv = require("dotenv");
const https = require("https");
const crypto = require("crypto");
const sharp = require("sharp");
const { ProxyAgent } = require("undici");

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

const uploadsBase = path.resolve(process.env.UPLOADS_PATH || path.resolve(__dirname, "..", "uploads"));
const legacyUploadsRoot = path.join(uploadsBase, "articles");
fs.mkdirSync(uploadsBase, { recursive: true });

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_DOWNLOAD_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * Common image processing: sharp rotate, resize to max 1600px, convert to WebP quality 80
 * Returns { buffer, metadata, fileName }
 */
async function processImageBuffer(buffer, mimeType) {
  if (!buffer.length || buffer.length > MAX_IMAGE_SIZE) {
    throw new Error('Image size invalid or exceeds 10 MB limit.');
  }
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error('Only JPEG, PNG, GIF, and WebP images are allowed.');
  }

  const processed = sharp(buffer)
    .rotate()
    .resize({ width: 1600, withoutEnlargement: true })
    .webp({ quality: 80 });
  const processedBuffer = await processed.toBuffer();
  const metadata = await sharp(processedBuffer).metadata();
  const fileName = `${generateId('image')}.webp`;
  return { buffer: processedBuffer, metadata, fileName };
}

/**
 * Save processed image to temp uploads and return URL
 */
function accountMediaRoot(auth) {
  const namespace = auth.role === 'guest' ? 'guest' : 'users';
  return path.join(uploadsBase, namespace, String(auth.userId));
}

function stageUserMediaDirectory(userId) {
  const usersRoot = path.resolve(uploadsBase, 'users');
  const mediaDirectory = path.resolve(usersRoot, String(userId));
  if (!mediaDirectory.startsWith(`${usersRoot}${path.sep}`)) {
    throw new Error('Invalid user media directory.');
  }

  try {
    fs.lstatSync(mediaDirectory);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }

  const stagedDirectory = path.join(
    usersRoot,
    `.deleting-${userId}-${crypto.randomBytes(12).toString('hex')}`,
  );
  fs.renameSync(mediaDirectory, stagedDirectory);
  return { mediaDirectory, stagedDirectory };
}

function restoreUserMediaDirectory(stagedMedia) {
  if (!stagedMedia) return;
  fs.renameSync(stagedMedia.stagedDirectory, stagedMedia.mediaDirectory);
}

function saveImageToTemp(buffer, fileName, auth) {
  const tempDirectory = path.join(accountMediaRoot(auth), 'temp');
  fs.mkdirSync(tempDirectory, { recursive: true });
  fs.writeFileSync(path.join(tempDirectory, fileName), buffer, { flag: 'wx' });
  const namespace = auth.role === 'guest' ? 'guest' : 'users';
  return `/api/media/${namespace}/${auth.userId}/temp/${fileName}`;
}

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

function getArticlePreview(content) {
  const source = String(content || '');
  const paragraphs = source.match(/<(p|div|li|h[1-6]|blockquote)\b[^>]*>[\s\S]*?<\/\1>/gi) || source.split(/\n\s*\n/);
  return paragraphs.find((paragraph) => paragraph.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').trim())?.trim() || '';
}

function removeArticleImageIfUnused(imagePath, excludedArticleId) {
  const normalizedPath = String(imagePath || '');
  const match = normalizedPath.match(/^\/api\/media\/(users|guest)\/(\d+)\/articles\/([A-Za-z0-9_-]+)\/([A-Za-z0-9._-]+)$/);
  if (!match) return false;
  const [, namespace, userId, articleId, fileName] = match;
  if (articleId !== excludedArticleId) return false;

  const referencedElsewhere = namespace === 'guest'
    ? db.prepare(`SELECT 1 FROM article_blocks
        WHERE type = 'image' AND (content = ? OR thumbnail = ?) LIMIT 1`).get(normalizedPath, normalizedPath)
    : db.prepare(`SELECT 1 FROM article_blocks
        JOIN articles ON articles.id = article_blocks.article_id
        WHERE article_blocks.type = 'image' AND (article_blocks.content = ? OR article_blocks.thumbnail = ?)
          AND articles.user_id = ? LIMIT 1`).get(normalizedPath, normalizedPath, Number(userId));
  if (referencedElsewhere) return false;

  try {
    const articleDirectory = path.join(accountMediaRoot({
      role: namespace === 'guest' ? 'guest' : 'user',
      userId: Number(userId),
    }), 'articles', articleId);
    fs.unlinkSync(path.join(articleDirectory, fileName));
    const thumbPath = path.join(articleDirectory, fileName.replace('.webp', '_thumb.webp'));
    try { fs.unlinkSync(thumbPath); } catch {}
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
const { db, adminDb, guestDb, runWithDatabase, serializeArticle, serializeVocabulary } = require("./db");
const { hashPassword, verifyPassword } = require("./password");
const { assertAdminDatabaseReady } = require("./database-readiness");
const { getAdministratorOverview } = require("./admin-overview");
const {
  getGuestSystemAccount,
  initializeGuestAccessSettings,
  isGuestAccessEnabled,
  setGuestAccessEnabled,
} = require("./guest-management");

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

const sessions = new Map();
const loginAttempts = new Map();
const SESSION_COOKIE = 'deepread_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

// Session cleanup: remove expired sessions every 10 minutes
const sessionCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt < now) {
      sessions.delete(token);
    }
  }
}, 10 * 60 * 1000);
sessionCleanupTimer.unref();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

function parseCookies(header) {
  return String(header || '').split(';').reduce((cookies, item) => {
    const index = item.indexOf('=');
    if (index > 0) cookies[item.slice(0, index).trim()] = decodeURIComponent(item.slice(index + 1).trim());
    return cookies;
  }, {});
}

function setSessionCookie(res, token) {
  const isProd = process.env.NODE_ENV === 'production';
  const secure = '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; Path=/; HttpOnly; SameSite=Lax${secure}`);
}

function currentSession(req) {
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
  const user = session.database.prepare('SELECT id, username FROM auth_users WHERE id = ?').get(session.userId);
  if (!user || user.username !== session.username) {
    sessions.delete(token);
    return null;
  }
  if (session.database === guestDb) {
    if (!isGuestAccessEnabled(adminDb)) {
      sessions.delete(token);
      return null;
    }
    return { ...session, userId: user.id, role: 'guest' };
  }

  const account = session.database.prepare('SELECT role, is_active FROM auth_users WHERE id = ?').get(user.id);
  if (!account || !account.is_active || account.role !== session.role) {
    sessions.delete(token);
    return null;
  }
  return { ...session, userId: user.id, role: account.role };
}

function currentUser(req) {
  return currentSession(req)?.username || null;
}

function requireAuth(req, res, next) {
  const session = currentSession(req);
  if (session) {
    req.auth = {
      userId: session.userId,
      username: session.username,
      role: session.role,
      database: session.database,
    };
    return runWithDatabase(session.database, next);
  }
  return res.status(401).json({ error: 'Authentication required.' });
}

function ensureUser(connection, username, password) {
  if (!username || !password) return;
  const existing = connection.prepare('SELECT id FROM auth_users WHERE username = ?').get(username);
  if (!existing) {
    const now = new Date().toISOString();
    connection.prepare('INSERT INTO auth_users (username,password_hash,created_at,updated_at) VALUES (?,?,?,?)').run(username, hashPassword(password), now, now);
  }
}

function ensureAdminUser() {
  ensureUser(adminDb, String(process.env.AUTH_USERNAME || '').trim(), String(process.env.AUTH_PASSWORD || ''));
}

function ensureGuestUser() {
  ensureUser(guestDb, String(process.env.GUEST_USERNAME || '').trim(), String(process.env.GUEST_PASSWORD || ''));
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

let startupReadinessError = null;
if (require.main === module && adminDb.prepare('SELECT 1 FROM auth_users LIMIT 1').get()) {
  try {
    assertAdminDatabaseReady(adminDb);
  } catch (error) {
    console.error(`[startup] ${error.message}`);
    startupReadinessError = error;
  }
}

if (!startupReadinessError) {
  initializeGuestAccessSettings(adminDb);
  ensureAdminUser();
  ensureGuestUser();
}

app.post('/api/auth/login', (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (loginRateLimited(ip)) return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const adminUser = adminDb.prepare('SELECT id, username, password_hash, role, is_active FROM auth_users WHERE username = ?')
    .get(username);
  const guestUsername = String(process.env.GUEST_USERNAME || '').trim();
  const guestUser = isGuestAccessEnabled(adminDb) && guestUsername
    && username === guestUsername
    ? guestDb.prepare('SELECT username,password_hash FROM auth_users WHERE username = ?').get(username)
    : null;
  const user = adminUser || guestUser;
  const database = guestUser && !adminUser ? guestDb : adminDb;
  const role = database === guestDb ? 'guest' : adminUser?.role;
  if (!user || (database === adminDb && (!adminUser.is_active || !['user', 'administrator'].includes(role)))
    || !verifyPassword(password, user.password_hash)) {
    recordLoginFailure(ip);
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  loginAttempts.delete(ip);
  const tokenId = crypto.randomBytes(32).toString('hex');
  const token = `${tokenId}.${crypto.createHmac('sha256', sessionSecret).update(tokenId).digest('hex')}`;
  const userId = database === guestDb
    ? guestDb.prepare('SELECT id FROM auth_users WHERE username = ?').get(user.username).id
    : adminUser.id;
  sessions.set(token, { userId, username: user.username, database, role, expiresAt: Date.now() + SESSION_TTL_MS });
  setSessionCookie(res, token);
  return res.json({ userId, username: user.username, role });
});

app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) sessions.delete(token);
  const isProd = process.env.NODE_ENV === 'production';
  const secure = '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure}`);
  return res.status(204).end();
});

app.post('/api/auth/change-password', requireAuth, (req, res) => {
  const session = currentSession(req);
  const username = session.username;
  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current password and new password are required.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }

  const user = db.prepare('SELECT username, password_hash FROM auth_users WHERE id = ?').get(session.userId);
  if (!user || !verifyPassword(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  // Update password hash
  const newHash = hashPassword(newPassword);
  db.prepare('UPDATE auth_users SET password_hash = ?, updated_at = ? WHERE id = ?')
    .run(newHash, new Date().toISOString(), session.userId);

  // Delete ALL sessions for this user
  for (const [token, activeSession] of sessions.entries()) {
    if (activeSession.database === session.database && activeSession.userId === session.userId) {
      sessions.delete(token);
    }
  }

  // Create new session for the user
  const tokenId = crypto.randomBytes(32).toString('hex');
  const token = `${tokenId}.${crypto.createHmac('sha256', sessionSecret).update(tokenId).digest('hex')}`;
  sessions.set(token, { userId: session.userId, username, database: session.database, role: session.role, expiresAt: Date.now() + SESSION_TTL_MS });
  setSessionCookie(res, token);

  return res.json({ success: true, message: 'Password changed successfully.' });
});

app.get("/api/auth/me", (req, res) => {
  const session = currentSession(req);
  if (!session) {
    return res.status(401).json({});
  }
  res.json({ userId: session.userId, username: session.username, role: session.role });
});

app.use('/api', (req, res, next) => {
  if (req.path === '/auth/login' || req.path === '/auth/logout' || req.path === '/auth/me' || req.path === '/health') return next();
  const session = currentSession(req);
  if (!session) return res.status(401).json({ error: 'Authentication required.' });
  req.auth = {
    userId: session.userId,
    username: session.username,
    role: session.role,
    database: session.database,
  };
  return runWithDatabase(session.database, next);
});

function isOwnedAccountRequest(req) {
  return req.auth.role !== 'guest';
}

function ownerPredicate(req, alias) {
  return isOwnedAccountRequest(req) ? `${alias}.user_id = ?` : '1 = 1';
}

function ownerParameters(req) {
  return isOwnedAccountRequest(req) ? [req.auth.userId] : [];
}

function findOwnedArticle(req, articleId) {
  const predicate = ownerPredicate(req, 'articles');
  return db.prepare(`SELECT articles.id, ${isOwnedAccountRequest(req) ? 'articles.user_id' : 'NULL AS user_id'}
    FROM articles WHERE articles.id = ? AND ${predicate}`).get(articleId, ...ownerParameters(req));
}

function findOwnedTag(req, tagId) {
  const predicate = ownerPredicate(req, 'tags');
  return db.prepare(`SELECT tags.id FROM tags WHERE tags.id = ? AND ${predicate}`)
    .get(tagId, ...ownerParameters(req));
}

function buildAccountExport(userId, settings = {}) {
  const scoped = userId !== null;
  const ownerClause = scoped ? 'WHERE user_id = ?' : '';
  const ownerParams = scoped ? [userId] : [];
  const articleOwnerClause = scoped ? 'WHERE a.user_id = ?' : '';
  return {
    exportVersion: 1,
    app: 'DeepRead',
    exportedAt: new Date().toISOString(),
    exportScope: {
      description: 'Data from the selected account database and explicitly included device-wide browser preferences. This is not a complete cross-device backup.',
      dataSources: ['authenticated session SQLite database', 'browser-local theme and reader font size (device-wide, not account-scoped)'],
      exclusions: [
        'Authentication accounts, password hashes, sessions, tokens, and credentials',
        'Browser drafts, unmigrated legacy data, and browser keys with unverified ownership',
        'Unscoped per-article reading progress and view-mode browser state',
        'Uploaded image and thumbnail files; article block paths are preserved',
      ],
    },
    data: {
      articles: db.prepare(`SELECT id, title, content, highlights, source_name, source_url,
        source_author, source_published_at, created_at, updated_at
        FROM articles ${ownerClause} ORDER BY created_at, id`).all(...ownerParams),
      articleBlocks: db.prepare(`SELECT b.id, b.article_id, b.type, b.content, b.thumbnail, b.sort_order, b.created_at
        FROM article_blocks b JOIN articles a ON a.id = b.article_id ${articleOwnerClause}
        ORDER BY b.article_id, b.sort_order, b.id`).all(...ownerParams),
      tags: db.prepare(`SELECT id, name, created_at, updated_at FROM tags ${ownerClause} ORDER BY id`)
        .all(...ownerParams),
      articleTags: db.prepare(`SELECT at.article_id, at.tag_id, at.created_at
        FROM article_tags at JOIN articles a ON a.id = at.article_id ${articleOwnerClause}
        ORDER BY at.article_id, at.tag_id`).all(...ownerParams),
      vocabulary: db.prepare(`SELECT id, word, definition, phonetic, part_of_speech, example, article_id,
        saved_at, next_review, review_count, ease_factor, interval, context_line, raw, start_offset, end_offset
        FROM vocabulary ${ownerClause} ORDER BY saved_at, id`).all(...ownerParams),
      articleAnalyses: db.prepare(`SELECT aa.id, aa.article_id, aa.page_number, aa.content_hash, aa.analysis, aa.model,
        aa.prompt_version, aa.created_at, aa.updated_at
        FROM article_analyses aa JOIN articles a ON a.id = aa.article_id ${articleOwnerClause}
        ORDER BY aa.id`).all(...ownerParams),
      articleTranslations: db.prepare(`SELECT tc.id, tc.article_id, tc.page_number, tc.content_hash, tc.target, tc.source,
        tc.provider, tc.translation, tc.created_at, tc.updated_at
        FROM article_translation_cache tc JOIN articles a ON a.id = tc.article_id ${articleOwnerClause}
        ORDER BY tc.id`).all(...ownerParams),
      readingRecords: [],
      settings,
    },
  };
}

function isAdministrator(req) {
  return req.auth.role === 'administrator';
}

function requireAdministrator(req, res) {
  if (isAdministrator(req)) return true;
  res.status(403).json({ error: 'Administrator access required.' });
  return false;
}

function requireAdministratorDatabase(req, res) {
  if (!requireAdministrator(req, res)) return false;
  if (req.auth.database === adminDb) return true;
  res.status(403).json({ error: 'Administrator access required.' });
  return false;
}

app.get('/api/admin/overview', (req, res) => {
  if (!requireAdministratorDatabase(req, res)) return;
  try {
    return res.json(getAdministratorOverview(db));
  } catch (error) {
    console.error('Unable to load Administrator overview:', error);
    return res.status(500).json({ error: 'Unable to load platform overview.' });
  }
});

app.get('/api/admin/users', (req, res) => {
  if (!requireAdministratorDatabase(req, res)) return;
  try {
    const accounts = db.prepare(`SELECT id, username, role, is_active, created_at, updated_at
      FROM auth_users WHERE role IN ('user', 'administrator')
      ORDER BY username COLLATE NOCASE`).all();
    accounts.push(getGuestSystemAccount(adminDb, guestDb, sessions));
    return res.json(accounts);
  } catch (error) {
    console.error('Unable to list accounts:', error);
    return res.status(500).json({ error: 'Unable to load accounts.' });
  }
});

app.patch('/api/admin/guest', (req, res) => {
  if (!requireAdministratorDatabase(req, res)) return;
  if (!req.body || typeof req.body.isActive !== 'boolean'
    || Object.keys(req.body).some((key) => key !== 'isActive')) {
    return res.status(400).json({ error: 'Only a valid isActive status may be changed.' });
  }
  try {
    const isActive = setGuestAccessEnabled(adminDb, req.body.isActive);
    if (!isActive) {
      for (const [token, session] of sessions.entries()) {
        if (session.database === guestDb) sessions.delete(token);
      }
    }
    return res.json(getGuestSystemAccount(adminDb, guestDb, sessions));
  } catch (error) {
    console.error('Unable to update Guest access:', error);
    return res.status(500).json({ error: 'Unable to update Guest access.' });
  }
});

app.post('/api/admin/users', (req, res) => {
  if (!requireAdministrator(req, res)) return;
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (Object.hasOwn(req.body || {}, 'role')) {
    return res.status(400).json({ error: 'Account roles cannot be assigned through this endpoint.' });
  }
  if (!username || username.length > 64 || [...username].some((character) => character.charCodeAt(0) < 32)) {
    return res.status(400).json({ error: 'Username must be between 1 and 64 valid characters.' });
  }
  if (password.length < 12) {
    return res.status(400).json({ error: 'Password must be at least 12 characters.' });
  }
  try {
    const now = new Date().toISOString();
    const result = db.prepare(`INSERT INTO auth_users
      (username, password_hash, role, is_active, created_at, updated_at)
      VALUES (?, ?, 'user', 1, ?, ?)`)
      .run(username, hashPassword(password), now, now);
    return res.status(201).json(db.prepare(`SELECT id, username, role, is_active, created_at, updated_at
      FROM auth_users WHERE id = ?`).get(result.lastInsertRowid));
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error: 'Username is already in use.' });
    console.error('Unable to create account:', error);
    return res.status(500).json({ error: 'Unable to create account.' });
  }
});

app.patch('/api/admin/users/:id', (req, res) => {
  if (!requireAdministrator(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0 || !req.body || typeof req.body.isActive !== 'boolean'
    || Object.keys(req.body).some((key) => key !== 'isActive')) {
    return res.status(400).json({ error: 'Only a valid isActive status may be changed.' });
  }
  try {
    const account = db.prepare('SELECT id, role FROM auth_users WHERE id = ?').get(id);
    if (!account || account.role !== 'user') return res.status(404).json({ error: 'Regular account not found.' });
    db.prepare('UPDATE auth_users SET is_active = ?, updated_at = ? WHERE id = ?')
      .run(req.body.isActive ? 1 : 0, new Date().toISOString(), id);
    return res.json(db.prepare(`SELECT id, username, role, is_active, created_at, updated_at
      FROM auth_users WHERE id = ?`).get(id));
  } catch (error) {
    console.error('Unable to update account status:', error);
    return res.status(500).json({ error: 'Unable to update account status.' });
  }
});


app.patch('/api/admin/users/:id/password', (req, res) => {
  if (!requireAdministrator(req, res)) return;

  const accountId = req.params.id;
  const password = typeof req.body?.password === 'string'
    ? req.body.password
    : '';

  if (
    !req.body ||
    Object.keys(req.body).some((key) => key !== 'password')
  ) {
    return res.status(400).json({
      error: 'Only the password may be changed.',
    });
  }

  if (password.length < 12) {
    return res.status(400).json({
      error: 'Password must be at least 12 characters.',
    });
  }

  try {
    const now = new Date().toISOString();

    // Guest is a system account stored in a separate database.
    if (accountId === 'guest') {
      const guestUsername = String(process.env.GUEST_USERNAME || '').trim();

      if (!guestUsername) {
        return res.status(404).json({
          error: 'Guest account is not configured.',
        });
      }

      const guestAccount = guestDb.prepare(
        'SELECT id, username FROM auth_users WHERE username = ?'
      ).get(guestUsername);

      if (!guestAccount) {
        return res.status(404).json({
          error: 'Guest account not found.',
        });
      }

      guestDb.prepare(`
        UPDATE auth_users
        SET password_hash = ?, updated_at = ?
        WHERE id = ?
      `).run(hashPassword(password), now, guestAccount.id);

      // Invalidate all Guest sessions.
      for (const [token, session] of sessions.entries()) {
        if (
          session.database === guestDb &&
          session.userId === guestAccount.id
        ) {
          sessions.delete(token);
        }
      }

      return res.json({
        success: true,
        message: 'Guest password updated successfully. All Guest sessions have been invalidated.',
      });
    }

    // Regular users and administrators are stored in adminDb.
    if (!/^[1-9]\d*$/.test(accountId)) {
      return res.status(400).json({
        error: 'Valid account id is required.',
      });
    }

    const id = Number(accountId);

    if (!Number.isSafeInteger(id)) {
      return res.status(400).json({
        error: 'Valid account id is required.',
      });
    }

    const account = adminDb.prepare(
      'SELECT id, role FROM auth_users WHERE id = ?'
    ).get(id);

    if (
      !account ||
      !['user', 'administrator'].includes(account.role)
    ) {
      return res.status(404).json({
        error: 'Account not found.',
      });
    }

    adminDb.prepare(`
      UPDATE auth_users
      SET password_hash = ?, updated_at = ?
      WHERE id = ?
    `).run(hashPassword(password), now, id);

    // Invalidate all sessions belonging to this account.
    for (const [token, session] of sessions.entries()) {
      if (
        session.database === adminDb &&
        session.userId === id
      ) {
        sessions.delete(token);
      }
    }

    return res.json({
      success: true,
      message: 'Password updated successfully. The account must log in again.',
    });
  } catch (error) {
    console.error('Unable to reset account password:', error);
    return res.status(500).json({
      error: 'Unable to reset account password.',
    });
  }
});


app.delete('/api/admin/users/:id', (req, res) => {
  if (!requireAdministratorDatabase(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Valid account id is required.' });
  }

  let stagedMedia = null;
  try {
    const account = db.prepare('SELECT id, role FROM auth_users WHERE id = ?').get(id);
    if (!account || account.role !== 'user') {
      return res.status(404).json({ error: 'Regular account not found.' });
    }

    stagedMedia = stageUserMediaDirectory(id);
    const deleteUser = db.transaction(() => {
      const currentAccount = db.prepare('SELECT id, role FROM auth_users WHERE id = ?').get(id);
      if (!currentAccount || currentAccount.role !== 'user') return false;

      db.prepare('DELETE FROM article_tags WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM vocabulary WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM tags WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM articles WHERE user_id = ?').run(id);

      const result = db.prepare("DELETE FROM auth_users WHERE id = ? AND role = 'user'").run(id);
      if (result.changes !== 1) {
        throw new Error('The regular account could not be deleted.');
      }
      return true;
    });

    if (!deleteUser.immediate()) {
      restoreUserMediaDirectory(stagedMedia);
      stagedMedia = null;
      return res.status(404).json({ error: 'Regular account not found.' });
    }

    for (const [token, session] of sessions.entries()) {
      if (session.database === adminDb && session.userId === id) {
        sessions.delete(token);
      }
    }

    const ownerPrefix = `admin:${id}:`;
    for (const key of analysisGenerations.keys()) {
      if (key.startsWith(ownerPrefix)) analysisGenerations.delete(key);
    }
    for (const key of cancelledAnalysisRequests) {
      if (key.startsWith(ownerPrefix)) cancelledAnalysisRequests.delete(key);
    }

    if (stagedMedia) {
      try {
        fs.rmSync(stagedMedia.stagedDirectory, { recursive: true, force: true });
      } catch (error) {
        console.error(`Unable to remove staged media for account ${id}:`, error);
        return res.status(500).json({
          error: 'The account was deleted, but its uploaded files could not be fully removed.',
          accountDeleted: true,
        });
      }
    }

    return res.json({ success: true, deletedUserId: id });
  } catch (error) {
    if (stagedMedia) {
      try {
        restoreUserMediaDirectory(stagedMedia);
      } catch (restoreError) {
        console.error(`Unable to restore media for account ${id} after deletion failed:`, restoreError);
        return res.status(500).json({
          error: 'Account deletion failed, and its uploaded files could not be restored automatically.',
        });
      }
    }
    console.error('Unable to delete user account:', error);
    return res.status(500).json({ error: 'Unable to delete the account and its associated data.' });
  }
});

app.get('/api/admin/users/:id/export', (req, res) => {
  if (!requireAdministrator(req, res)) return;
  const userId = Number(req.params.id);
  if (!Number.isSafeInteger(userId) || userId <= 0) return res.status(400).json({ error: 'Valid account id is required.' });
  try {
    const account = db.prepare("SELECT id FROM auth_users WHERE id = ? AND role = 'user'").get(userId);
    if (!account) return res.status(404).json({ error: 'Regular account not found.' });
    const data = db.transaction(() => buildAccountExport(userId))();
    const date = new Date().toISOString().slice(0, 10);
    res.set({
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="deepread-account-${userId}-${date}.json"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.status(200).send(JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Failed to export account data:', error);
    return res.status(500).json({ error: 'Unable to generate account export.' });
  }
});

function handleExportRequest(req, res) {
  try {
    const settings = {};
    const browserSettings = req.body?.browserData?.settings;
    if (browserSettings?.theme === 'light' || browserSettings?.theme === 'dark') settings.theme = browserSettings.theme;
    if (Number.isInteger(browserSettings?.readerFontSize)
      && browserSettings.readerFontSize >= 12
      && browserSettings.readerFontSize <= 32) settings.readerFontSize = browserSettings.readerFontSize;
    const userId = isOwnedAccountRequest(req) ? req.auth.userId : null;
    const exportData = db.transaction(() => buildAccountExport(userId, settings))();

    const date = new Date().toISOString().slice(0, 10);
    res.set({
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="deepread-backup-${date}.json"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.status(200).send(JSON.stringify(exportData, null, 2));
  } catch (error) {
    console.error('Failed to export user data:', error);
    return res.status(500).json({ error: 'Unable to generate your data export. Please try again.' });
  }
}

app.get('/api/export', handleExportRequest);
app.post('/api/export', handleExportRequest);

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

function analysisOwnerKey(req) {
  return `${req.auth.role === 'guest' ? 'guest' : 'admin'}:${req.auth.userId}`;
}

function analysisCacheKey(req, articleId, pageNumber, contentHash, promptVersion) {
  return `${analysisOwnerKey(req)}:${articleId}:${pageNumber}:${contentHash}:${promptVersion}`;
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
            console.debug('  candidate parse failed', {
              errPos: errPos,
              msg: String(e.message || e).slice(0, 80),
              ctx: JSON.stringify(ctx.slice(0, 120))
            });
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
    console.debug(`(from ${candidates.length} candidates, ${summaryBearing.length} summary-bearing, len=${best.len})`);
    return best.parsed;
  }

  // Fallback — no summary-bearing candidate.  Use the largest overall.
  candidates.sort((a, b) => b.len - a.len);
  const best = candidates[0];
  console.debug(`(from ${candidates.length} candidates, len=${best.len})`);
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

async function callOpenAITextAnalysis(text, model = process.env.OPENAI_MODEL || 'gpt-4o-mini') {
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
    console.debug('AI analysis extraction failed, using fallback', {
      responseLength: cleaned.length,
    });
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
    return res.status(400).json({
      error: "Please provide a single English word.",
    });
  }

  try {
    const result = await lookupWord(word);

    return res.json({
      found: true,
      ...result,
    });
  } catch (error) {
    if (error.status === 404) {
      return res.json({
        found: false,
        word,
      });
    }

    return res.status(502).json({
      error: "Dictionary service is temporarily unavailable.",
    });
  }
});

app.post("/api/eudic/vocabulary", async (req, res) => {
  // Only authenticated administrators may sync words to Eudic.
  const session = currentSession(req);

  if (!session) {
    return res.status(401).json({
      error: "Authentication required.",
    });
  }

  if (session.role !== "administrator" && session.role !== "admin") {
    return res.status(403).json({
      error: "Only administrators can sync vocabulary to Eudic.",
    });
  }

  const { word, contextLine } = req.body || {};

  if (typeof word !== "string" || !/^[a-z]+(?:'[a-z]+)?$/i.test(word)) {
    return res.status(400).json({
      error: "Please provide a single English word.",
    });
  }

  try {
    const result = await callEudicTool("add_word", {
      word: word.toLowerCase(),
      star: 1,
      context_line:
        typeof contextLine === "string"
          ? contextLine.slice(0, 1000)
          : null,
    });

    return res.status(201).json({ ok: true, result });
  } catch (error) {
    const status = error.response?.status;

    return res.status(status === 401 ? 401 : 502).json({
      error:
        status === 401
          ? "Eudic authorization failed. Check EUDIC_TOKEN."
          : "Could not sync this word to Eudic.",
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
  const params = ownerParameters(req);
  const clauses = isOwnedAccountRequest(req) ? ['a.user_id = ?'] : [];

  if (isSearching) {
    const searchClauses = [];
    if (title) {
      searchClauses.push('a.title LIKE ?');
      params.push(`%${title}%`);
    }
    if (tagSearch) {
      searchClauses.push(`EXISTS (SELECT 1 FROM article_tags at JOIN tags t ON t.id = at.tag_id
        WHERE at.article_id = a.id AND t.name LIKE ?${isOwnedAccountRequest(req) ? ' AND at.user_id = ? AND t.user_id = ?' : ''})`);
      params.push(`%${tagSearch}%`);
      if (isOwnedAccountRequest(req)) params.push(req.auth.userId, req.auth.userId);
    }
    clauses.push(`(${searchClauses.join(' OR ')})`);
  } else if (tag === 'untagged') {
    clauses.push(`NOT EXISTS (SELECT 1 FROM article_tags at WHERE at.article_id = a.id
      ${isOwnedAccountRequest(req) ? 'AND at.user_id = a.user_id' : ''})`);
  } else if (tag !== 'all') {
    const tagId = Number(tag);
    if (!Number.isInteger(tagId) || tagId <= 0) return res.status(400).json({ error: 'Invalid tag filter.' });
    clauses.push(`EXISTS (SELECT 1 FROM article_tags at WHERE at.article_id = a.id AND at.tag_id = ?
      ${isOwnedAccountRequest(req) ? 'AND at.user_id = a.user_id AND at.user_id = ?' : ''})`);
    params.push(tagId);
    if (isOwnedAccountRequest(req)) params.push(req.auth.userId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  try {
    const total = db.prepare(`SELECT COUNT(*) AS count FROM articles a ${where}`).get(...params).count;
    const rows = db.prepare(`SELECT a.id, a.title, a.content, a.highlights, a.created_at, a.updated_at, length(a.content) AS content_length
      FROM articles a ${where} ORDER BY ${sort} LIMIT ? OFFSET ?`)
      .all(...params, limit, (page - 1) * limit);
    const ids = rows.map((row) => row.id);
    const tagsByArticle = new Map(ids.map((id) => [id, []]));
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      const tagRows = db.prepare(`SELECT at.article_id, t.id, t.name
        FROM article_tags at JOIN tags t ON t.id = at.tag_id
        WHERE at.article_id IN (${placeholders})${isOwnedAccountRequest(req) ? ' AND at.user_id = ? AND t.user_id = ?' : ''}
        ORDER BY t.name COLLATE NOCASE`).all(...ids, ...(isOwnedAccountRequest(req) ? [req.auth.userId, req.auth.userId] : []));
      for (const row of tagRows) tagsByArticle.get(row.article_id).push({ id: row.id, name: row.name });
    }
    const untaggedTotal = db.prepare(`SELECT COUNT(*) AS count FROM articles a
      WHERE ${isOwnedAccountRequest(req) ? 'a.user_id = ? AND ' : ''}
      NOT EXISTS (SELECT 1 FROM article_tags at WHERE at.article_id = a.id
        ${isOwnedAccountRequest(req) ? 'AND at.user_id = a.user_id' : ''})`)
      .get(...ownerParameters(req)).count;
    const allTotal = db.prepare(`SELECT COUNT(*) AS count FROM articles a
      ${isOwnedAccountRequest(req) ? 'WHERE a.user_id = ?' : ''}`).get(...ownerParameters(req)).count;
    const tags = db.prepare(`SELECT t.id, t.name, t.created_at, t.updated_at,
      COUNT(at.article_id) AS article_count
      FROM tags t LEFT JOIN article_tags at ON at.tag_id = t.id
      ${isOwnedAccountRequest(req) ? 'WHERE t.user_id = ?' : ''}
      GROUP BY t.id ORDER BY t.name COLLATE NOCASE`).all(...ownerParameters(req));
    return res.json({
      items: rows.map((row) => {
        let highlights = [];
        try {
          highlights = row.highlights ? JSON.parse(row.highlights) : [];
        } catch {
          highlights = [];
        }
        const { content, ...article } = row;
        return { ...article, content_preview: getArticlePreview(content), highlights, tags: tagsByArticle.get(row.id) || [] };
      }),
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
      ${isOwnedAccountRequest(req) ? 'WHERE t.user_id = ?' : ''}
      GROUP BY t.id ORDER BY t.name COLLATE NOCASE`).all(...ownerParameters(req)));
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load tags.' });
  }
});

app.get('/api/articles/:id/tags', (req, res) => {
  try {
    const article = findOwnedArticle(req, req.params.id);
    if (!article) return res.status(404).json({ error: 'Article not found.' });
    return res.json(db.prepare(`SELECT t.id, t.name, t.created_at, t.updated_at
      FROM article_tags at JOIN tags t ON t.id = at.tag_id
      WHERE at.article_id = ?${isOwnedAccountRequest(req) ? ' AND at.user_id = ? AND t.user_id = ?' : ''}
      ORDER BY t.name COLLATE NOCASE`).all(req.params.id,
      ...(isOwnedAccountRequest(req) ? [req.auth.userId, req.auth.userId] : [])));
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
    const result = isOwnedAccountRequest(req)
      ? db.prepare('INSERT INTO tags (name, created_at, updated_at, user_id) VALUES (?, ?, ?, ?)').run(name, now, now, req.auth.userId)
      : db.prepare('INSERT INTO tags (name, created_at, updated_at) VALUES (?, ?, ?)').run(name, now, now);
    return res.status(201).json(db.prepare(`SELECT id, name, created_at, updated_at, 0 AS article_count
      FROM tags WHERE id = ?${isOwnedAccountRequest(req) ? ' AND user_id = ?' : ''}`)
      .get(result.lastInsertRowid, ...(isOwnedAccountRequest(req) ? [req.auth.userId] : [])));
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
    const result = db.prepare(`UPDATE tags SET name = ?, updated_at = ? WHERE id = ?
      ${isOwnedAccountRequest(req) ? 'AND user_id = ?' : ''}`)
      .run(name, new Date().toISOString(), id, ...ownerParameters(req));
    if (!result.changes) return res.status(404).json({ error: 'Tag not found.' });
    return res.json(db.prepare(`SELECT t.id, t.name, t.created_at, t.updated_at, COUNT(at.article_id) AS article_count
      FROM tags t LEFT JOIN article_tags at ON at.tag_id = t.id
      WHERE t.id = ?${isOwnedAccountRequest(req) ? ' AND t.user_id = ?' : ''} GROUP BY t.id`)
      .get(id, ...ownerParameters(req)));
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error: 'That tag already exists.' });
    return res.status(500).json({ error: 'Unable to rename tag.' });
  }
});

app.delete('/api/tags/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Valid tag id is required.' });
  try {
    const result = db.prepare(`DELETE FROM tags WHERE id = ? ${isOwnedAccountRequest(req) ? 'AND user_id = ?' : ''}`)
      .run(id, ...ownerParameters(req));
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
    const article = findOwnedArticle(req, articleId);
    const tag = findOwnedTag(req, tagId);
    if (!article || !tag) return res.status(404).json({ error: 'Article or tag not found.' });
    if (isOwnedAccountRequest(req)) {
      db.prepare('INSERT OR IGNORE INTO article_tags (article_id, tag_id, user_id, created_at) VALUES (?, ?, ?, ?)')
        .run(articleId, tagId, req.auth.userId, new Date().toISOString());
    } else {
      db.prepare('INSERT OR IGNORE INTO article_tags (article_id, tag_id, created_at) VALUES (?, ?, ?)')
        .run(articleId, tagId, new Date().toISOString());
    }
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
    if (isOwnedAccountRequest(req)) {
      db.prepare('DELETE FROM article_tags WHERE article_id = ? AND tag_id = ? AND user_id = ?')
        .run(articleId, tagId, req.auth.userId);
    } else {
      db.prepare('DELETE FROM article_tags WHERE article_id = ? AND tag_id = ?').run(articleId, tagId);
    }
    return res.status(204).end();
  } catch (error) {
    return res.status(500).json({ error: 'Unable to remove tag from article.' });
  }
});

function mediaNamespace(req) {
  return req.auth.role === 'guest' ? 'guest' : 'users';
}

function isOwnedMediaIdentity(req, namespace, userId) {
  return namespace === mediaNamespace(req) && Number(userId) === req.auth.userId;
}

function sendPrivateMedia(res, filePath) {
  res.set({
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  return res.sendFile(filePath, { dotfiles: 'deny' }, (error) => {
    if (error && !res.headersSent) res.status(error.statusCode || 404).end();
  });
}

app.get('/api/media/:namespace/:userId/temp/:fileName', (req, res) => {
  const { namespace, userId, fileName } = req.params;
  if (!isOwnedMediaIdentity(req, namespace, userId) || !/^[A-Za-z0-9_-]+\.webp$/.test(fileName)) {
    return res.status(404).end();
  }
  const filePath = path.resolve(accountMediaRoot(req.auth), 'temp', fileName);
  if (!filePath.startsWith(`${path.resolve(uploadsBase)}${path.sep}`) || !fs.existsSync(filePath)) {
    return res.status(404).end();
  }
  return sendPrivateMedia(res, filePath);
});

app.get('/api/media/:namespace/:userId/articles/:fileName', (req, res) => {
  const { namespace, userId, fileName } = req.params;
  if (!isOwnedMediaIdentity(req, namespace, userId)
    || !/^[A-Za-z0-9_-]+(?:_thumb)?\.webp$/.test(fileName)) {
    return res.status(404).end();
  }
  const filePath = path.resolve(accountMediaRoot(req.auth), 'articles', fileName);
  if (!filePath.startsWith(`${path.resolve(uploadsBase)}${path.sep}`) || !fs.existsSync(filePath)) {
    return res.status(404).end();
  }
  return sendPrivateMedia(res, filePath);
});

app.get('/api/media/:namespace/:userId/articles/:articleId/:fileName', (req, res) => {
  const { namespace, userId, articleId, fileName } = req.params;
  if (!isOwnedMediaIdentity(req, namespace, userId)
    || !/^[A-Za-z0-9_-]{1,160}$/.test(articleId)
    || !/^[A-Za-z0-9_-]+(?:_thumb)?\.webp$/.test(fileName)
    || !findOwnedArticle(req, articleId)) {
    return res.status(404).end();
  }
  const expectedUrl = `/api/media/${namespace}/${userId}/articles/${articleId}/${fileName}`;
  const referenced = db.prepare(`SELECT 1 FROM article_blocks
    WHERE article_id = ? AND type = 'image' AND (content = ? OR thumbnail = ?) LIMIT 1`)
    .get(articleId, expectedUrl, expectedUrl);
  if (!referenced) return res.status(404).end();
  const filePath = path.resolve(accountMediaRoot(req.auth), 'articles', articleId, fileName);
  if (!filePath.startsWith(`${path.resolve(uploadsBase)}${path.sep}`) || !fs.existsSync(filePath)) {
    return res.status(404).end();
  }
  return sendPrivateMedia(res, filePath);
});

app.get('/uploads/articles/:articleId/:fileName', (req, res) => {
  const session = currentSession(req);
  if (!session) return res.status(404).end();
  const { articleId, fileName } = req.params;
  const auth = {
    userId: session.userId,
    username: session.username,
    role: session.role,
    database: session.database,
  };
  if (auth.role === 'guest'
    || !/^[A-Za-z0-9_-]{1,160}$/.test(articleId)
    || !/^[A-Za-z0-9_-]+(?:_thumb)?\.webp$/.test(fileName)
    || !findOwnedArticle({ auth }, articleId)) {
    return res.status(404).end();
  }
  const legacyUrl = `/uploads/articles/${articleId}/${fileName}`;
  const referenced = db.prepare(`SELECT 1 FROM article_blocks
    WHERE article_id = ? AND type = 'image' AND (content = ? OR thumbnail = ?) LIMIT 1`)
    .get(articleId, legacyUrl, legacyUrl);
  if (!referenced) return res.status(404).end();
  const filePath = path.resolve(legacyUploadsRoot, articleId, fileName);
  if (!filePath.startsWith(`${path.resolve(legacyUploadsRoot)}${path.sep}`) || !fs.existsSync(filePath)) {
    return res.status(404).end();
  }
  return sendPrivateMedia(res, filePath);
});

app.post('/api/articles/images', async (req, res) => {
  const { data, mimeType } = req.body || {};
  if (typeof data !== 'string') return res.status(400).json({ error: 'Invalid image data.' });
  const match = data.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return res.status(400).json({ error: 'Invalid image data format.' });
  const detectedMimeType = match[1];
  if (detectedMimeType !== mimeType) return res.status(400).json({ error: 'MIME type mismatch.' });
  let buffer;
  try { buffer = Buffer.from(match[2], 'base64'); } catch { return res.status(400).json({ error: 'Invalid image data.' }); }

  try {
    const { buffer: processedBuffer, fileName } = await processImageBuffer(buffer, mimeType);
    const tempUrl = saveImageToTemp(processedBuffer, fileName, req.auth);
    return res.status(201).json({ path: tempUrl, url: tempUrl });
  } catch (error) {
    if (error.message?.includes('exceeds') || error.message?.includes('allowed') || error.message?.includes('invalid')) {
      return res.status(400).json({ error: error.message });
    }
    return res.status(400).json({ error: 'Failed to process image.' });
  }
});

/**
 * /**
 * POST /api/articles/images/from-url
 * Download remote image, process it, and save to temp uploads
 * Security: validates protocol, limits size, validates content-type
 * Proxy: configurable via IMAGE_DOWNLOAD_PROXY env var (e.g., http://127.0.0.1:7890)
 */
app.post('/api/articles/images/from-url', async (req, res) => {
  const { url } = req.body || {};
  if (typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: 'URL is required.' });
  }

  // Basic SSRF protection: only allow http/https
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL.' });
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return res.status(400).json({ error: 'Only HTTP/HTTPS URLs are allowed.' });
  }
  // Block private IP ranges (basic SSRF mitigation)
  const hostname = parsedUrl.hostname;
  const isPrivateIp = /^(10.|192.168.|172.(1[6-9]|2[0-9]|3[0-1]).|127.|169.254.|::1$|fe80::)/i.test(hostname);
  if (isPrivateIp) {
    return res.status(400).json({ error: 'Access to private IP addresses is not allowed.' });
  }

  // Build fetch options with optional proxy and proper headers
  const fetchOptions = {
    signal: AbortSignal.timeout(15000), // 15 second timeout (modern fetch)
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; DeepRead/1.0)',
      'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
      'Referer': parsedUrl.origin, // Helps with hotlink protection
    },
  };

  // Optional proxy via environment variable
  const proxyUrl = process.env.IMAGE_DOWNLOAD_PROXY;
  if (proxyUrl) {
    try {
      fetchOptions.dispatcher = new ProxyAgent(proxyUrl);
    } catch (e) {
      console.warn('[ImageDownload] Invalid proxy URL, ignoring:', proxyUrl);
    }
  }

  try {
    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const errMsg = `Failed to download image: HTTP ${response.status} ${response.statusText}`;
      console.error('[ImageDownload] HTTP error', { url, status: response.status, statusText: response.statusText });
      return res.status(400).json({ error: errMsg });
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      console.error('[ImageDownload] Invalid content-type', { url, contentType });
      return res.status(400).json({ error: 'URL does not point to an image.' });
    }
    // Strict MIME type validation against allowed types
    if (!ALLOWED_MIME_TYPES.has(contentType)) {
      console.error('[ImageDownload] Disallowed MIME type', { url, contentType, allowed: [...ALLOWED_MIME_TYPES] });
      return res.status(400).json({ error: `Unsupported image format: ${contentType}. Only JPEG, PNG, GIF, WebP are allowed.` });
    }

    // Check content-length if available
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_DOWNLOAD_SIZE) {
      return res.status(413).json({ error: 'Image exceeds maximum download size (10 MB).' });
    }

    // Stream download with size limit enforcement
    const chunks = [];
    let totalSize = 0;
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalSize += value.length;
      if (totalSize > MAX_DOWNLOAD_SIZE) {
        return res.status(413).json({ error: 'Image exceeds maximum download size (10 MB).' });
      }
    }
    const buffer = Buffer.concat(chunks);
    if (!buffer.length) {
      console.error('[ImageDownload] Empty image data', { url });
      return res.status(400).json({ error: 'Downloaded image is empty.' });
    }
    console.log('[ImageDownload] Downloaded', { url, contentType, size: buffer.length, finalUrl: response.url });

    // Process using common function
    const { buffer: processedBuffer, fileName } = await processImageBuffer(buffer, contentType);
    
    // Save to temp
    const tempUrl = saveImageToTemp(processedBuffer, fileName, req.auth);
    
    return res.status(201).json({ path: tempUrl, url: tempUrl });
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError' || error.code === 'ETIMEDOUT') {
      console.error('[ImageDownload] Timeout', { url, error: error.message });
      return res.status(408).json({ error: 'Image download timed out.' });
    }
    if (error.message?.includes('Invalid image data') || error.message?.includes('exceeds') || error.message?.includes('allowed')) {
      return res.status(400).json({ error: error.message });
    }
    // Detailed error logging for debugging
    console.error('[ImageDownload] Failed', {
      url,
      message: error.message,
      code: error.code,
      cause: error.cause?.message,
      stack: error.stack,
    });
    return res.status(500).json({ error: 'Failed to download and process image.' });
  }
});

app.get('/api/articles/:id', (req, res) => {
  try {
    const article = db.prepare(`SELECT * FROM articles WHERE id = ? ${isOwnedAccountRequest(req) ? 'AND user_id = ?' : ''}`)
      .get(req.params.id, ...ownerParameters(req));
    if (!article) return res.status(404).json({ error: 'Article not found.' });
    const tags = db.prepare(`SELECT t.id, t.name FROM article_tags at
      JOIN tags t ON t.id = at.tag_id WHERE at.article_id = ?
      ${isOwnedAccountRequest(req) ? 'AND at.user_id = ? AND t.user_id = ?' : ''}
      ORDER BY t.name COLLATE NOCASE`).all(article.id,
      ...(isOwnedAccountRequest(req) ? [req.auth.userId, req.auth.userId] : []));
        const serialized = serializeArticle(article);
    return res.json({ ...serialized, tags, blocks: getArticleBlocks(article.id) });
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

function getOwnedTemporaryImagePath(req, imageUrl) {
  const namespace = mediaNamespace(req);
  const match = String(imageUrl || '').match(/^\/api\/media\/(users|guest)\/(\d+)\/temp\/([A-Za-z0-9_-]+\.webp)$/);
  if (!match || match[1] !== namespace || Number(match[2]) !== req.auth.userId) return null;
  const filePath = path.resolve(accountMediaRoot(req.auth), 'temp', match[3]);
  return filePath.startsWith(`${path.resolve(uploadsBase)}${path.sep}`) && fs.existsSync(filePath)
    ? { filePath, fileName: match[3] }
    : null;
}

app.post('/api/articles', async (req, res) => {
  const { id, title, content, highlights = [], blocks } = req.body || {};
  const rawSourceMetadata = req.body?.sourceMetadata;
  const sourceMetadata = rawSourceMetadata && typeof rawSourceMetadata === 'object' && !Array.isArray(rawSourceMetadata)
    ? rawSourceMetadata
    : req.body || {};
  if (rawSourceMetadata != null && (typeof rawSourceMetadata !== 'object' || Array.isArray(rawSourceMetadata))) {
    return res.status(400).json({ error: 'Article source metadata must be an object.' });
  }
  const sourceFields = [
    ['sourceName', 'source_name'],
    ['sourceUrl', 'source_url'],
    ['sourceAuthor', 'source_author'],
    ['sourcePublishedAt', 'source_published_at'],
  ];
  for (const [key] of sourceFields) {
    if (Object.prototype.hasOwnProperty.call(sourceMetadata, key) && typeof sourceMetadata[key] !== 'string') {
      return res.status(400).json({ error: `Article ${key} must be a string.` });
    }
  }
  if (typeof title !== 'string' || !title.trim() || typeof content !== 'string') {
    return res.status(400).json({ error: 'Article title and content are required.' });
  }

  // Track processed images for potential rollback (must be outside try for catch access)
  let processedImages = [];

  try {
    const now = new Date().toISOString();
    const articleId = id || generateId('article');
    const existing = db.prepare(`SELECT id${isOwnedAccountRequest(req) ? ', user_id' : ''}
      FROM articles WHERE id = ?`).get(articleId);
    if (existing && isOwnedAccountRequest(req) && existing.user_id !== req.auth.userId) {
      return res.status(404).json({ error: 'Article not found.' });
    }
    if (Array.isArray(blocks) && !/^[A-Za-z0-9_-]{1,160}$/.test(articleId)) {
      return res.status(400).json({ error: 'Article id is invalid for image storage.' });
    }
    const normalizedBlocks = normalizeArticleBlocks(articleId, blocks);
    for (const block of normalizedBlocks) {
      if (!/^[A-Za-z0-9_-]{1,160}$/.test(block.id)) {
        return res.status(400).json({ error: 'Article block id is invalid.' });
      }
      const existingBlock = db.prepare(`SELECT article_id${isOwnedAccountRequest(req) ? ', (SELECT user_id FROM articles WHERE id = article_id) AS user_id' : ''}
        FROM article_blocks WHERE id = ?`).get(block.id);
      if (existingBlock && (existingBlock.article_id !== articleId
        || (isOwnedAccountRequest(req) && existingBlock.user_id !== req.auth.userId))) {
        return res.status(404).json({ error: 'Article block not found.' });
      }
      if (block.type !== 'image') continue;
      if (block.content.startsWith('/api/media/')) {
        const tempImage = getOwnedTemporaryImagePath(req, block.content);
        const articleImagePattern = new RegExp(
          `^/api/media/${mediaNamespace(req)}/${req.auth.userId}/articles/${articleId}/[A-Za-z0-9_-]+(?:_thumb)?\\.webp$`,
        );
        if (!tempImage && (!articleImagePattern.test(block.content) || !fs.existsSync(path.resolve(
          accountMediaRoot(req.auth), 'articles', articleId, path.basename(block.content),
        )))) {
          return res.status(400).json({ error: 'Image is not owned by this account or article.' });
        }
      } else {
        const legacyImagePattern = new RegExp(
          `^/uploads/articles/${articleId}/[A-Za-z0-9_-]+(?:_thumb)?\\.webp$`,
        );
        if (!legacyImagePattern.test(block.content)
          || !fs.existsSync(path.resolve(legacyUploadsRoot, articleId, path.basename(block.content)))) {
          return res.status(400).json({ error: 'Image is not owned by this article.' });
        }
      }
    }
    const article = {
      id: articleId,
      user_id: req.auth.userId,
      title: title.trim(),
      content,
      highlights: JSON.stringify(highlights),
      created_at: now,
      updated_at: now,
      ...Object.fromEntries(sourceFields.map(([key, column]) => [
        column,
        Object.prototype.hasOwnProperty.call(sourceMetadata, key) ? sourceMetadata[key] : '',
      ])),
      ...Object.fromEntries(sourceFields.map(([key, column]) => [
        `${column}_provided`,
        Object.prototype.hasOwnProperty.call(sourceMetadata, key) ? 1 : 0,
      ])),
    };

    // UPSERT article (create or update) to satisfy FK constraint
    const ownerColumns = isOwnedAccountRequest(req) ? ', user_id' : '';
    const ownerValues = isOwnedAccountRequest(req) ? ', @user_id' : '';
    const ownerUpdateGuard = isOwnedAccountRequest(req) ? 'WHERE articles.user_id = excluded.user_id' : '';
    db.prepare(`INSERT INTO articles (
      id, title, content, highlights, source_name, source_url, source_author,
      source_published_at, created_at, updated_at${ownerColumns}
    ) VALUES (
      @id, @title, @content, @highlights, @source_name, @source_url, @source_author,
      @source_published_at, @created_at, @updated_at${ownerValues}
    )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        highlights = excluded.highlights,
        source_name = CASE WHEN @source_name_provided THEN excluded.source_name ELSE articles.source_name END,
        source_url = CASE WHEN @source_url_provided THEN excluded.source_url ELSE articles.source_url END,
        source_author = CASE WHEN @source_author_provided THEN excluded.source_author ELSE articles.source_author END,
        source_published_at = CASE WHEN @source_published_at_provided THEN excluded.source_published_at ELSE articles.source_published_at END,
        updated_at = excluded.updated_at ${ownerUpdateGuard}`).run(article);
    // Process temp images BEFORE transaction (move + generate thumbnails)
    if (Array.isArray(blocks)) {
      const articleUploadsDir = path.join(accountMediaRoot(req.auth), 'articles', article.id);
      fs.mkdirSync(articleUploadsDir, { recursive: true });
      for (const block of normalizedBlocks) {
        const tempImage = block.type === 'image' ? getOwnedTemporaryImagePath(req, block.content) : null;
        if (tempImage) {
          const fileName = tempImage.fileName;
          const srcPath = tempImage.filePath;
          const destPath = path.join(articleUploadsDir, fileName);
          const thumbFileName = fileName.replace('.webp', '_thumb.webp');
          const thumbPath = path.join(articleUploadsDir, thumbFileName);
          try {
            // Move original image
            fs.renameSync(srcPath, destPath);
            processedImages.push(destPath);
            
            // Generate thumbnail (400px max width, quality 70)
            await sharp(destPath)
              .rotate()
              .resize({ width: 400, withoutEnlargement: true })
              .webp({ quality: 70 })
              .toFile(thumbPath);
            processedImages.push(thumbPath);
            
            const namespace = mediaNamespace(req);
            block.content = `/api/media/${namespace}/${req.auth.userId}/articles/${article.id}/${fileName}`;
            block.thumbnail = `/api/media/${namespace}/${req.auth.userId}/articles/${article.id}/${thumbFileName}`;
          } catch (err) {
            console.error('Failed to process image, aborting save:', err.message);
            // Cleanup on error
            for (const imgPath of processedImages) {
              try { fs.unlinkSync(imgPath); } catch {}
            }
            throw new Error(`Failed to process image ${fileName}: ${err.message}`);
          }
        }
      }
    }

      if (Array.isArray(blocks)) {
        // 2. Replace blocks atomically
        const previousImages = db.prepare("SELECT content FROM article_blocks WHERE article_id = ? AND type = 'image'").all(article.id);
        db.prepare('DELETE FROM article_blocks WHERE article_id = ?').run(article.id);
        const insertBlock = db.prepare('INSERT INTO article_blocks (id, article_id, type, content, thumbnail, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
        normalizedBlocks.forEach((block, index) => insertBlock.run(block.id, article.id, block.type, block.content, block.thumbnail || null, index, now));
        const nextImages = new Set(normalizedBlocks.filter((block) => block.type === 'image').map((block) => block.content));
        for (const row of previousImages) {
          if (!nextImages.has(row.content)) removeArticleImageIfUnused(row.content, article.id);
        }
      }

    const savedArticle = db.prepare(`SELECT source_name, source_url, source_author, source_published_at, created_at, updated_at
      FROM articles WHERE id = ?${isOwnedAccountRequest(req) ? ' AND user_id = ?' : ''}`)
      .get(articleId, ...ownerParameters(req));
    return res.json({
      id: articleId,
      title: title.trim(),
      content,
      highlights,
      sourceMetadata: {
        sourceName: savedArticle.source_name,
        sourceUrl: savedArticle.source_url,
        sourceAuthor: savedArticle.source_author,
        sourcePublishedAt: savedArticle.source_published_at,
      },
      blocks: normalizedBlocks,
      created_at: savedArticle.created_at,
      updated_at: savedArticle.updated_at,
    });
  } catch (error) {
    console.error('POST /api/articles error:', error);
    // Cleanup processed images on error
    for (const imgPath of processedImages) {
      try { fs.unlinkSync(imgPath); } catch {}
    }
    return res.status(500).json({ error: 'Failed to save article.' });
  }
});

app.delete('/api/articles/:id', async (req, res) => {
  const id = req.params.id;
  if (!id) {
    return res.status(400).json({ error: 'Article id is required.' });
  }

  try {
    if (!findOwnedArticle(req, id)) return res.status(404).json({ error: 'Article not found.' });
    removeArticleImages(id);
    db.prepare(`DELETE FROM articles WHERE id = ? ${isOwnedAccountRequest(req) ? 'AND user_id = ?' : ''}`)
      .run(id, ...ownerParameters(req));
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
    // Only clear the cache for this saved article at its current content revision.
    const article = findOwnedArticle(req, articleId);
    if (!article) {
      return res.status(404).json({ error: 'Article not found.' });
    }

    const requestKey = requestId ? `${analysisOwnerKey(req)}:${requestId}` : null;
    if (requestKey) cancelledAnalysisRequests.add(requestKey);
    const contentHash = hashSha256(text);
    const key = analysisCacheKey(req, article.id, pageNumber, contentHash, promptVersion);
    analysisGenerations.set(key, (analysisGenerations.get(key) || 0) + 1);
    const result = db.prepare(`DELETE FROM article_analyses
      WHERE article_id = ? AND page_number = ? AND content_hash = ? AND prompt_version = ?`)
      .run(article.id, pageNumber, contentHash, promptVersion);
    return res.json({ deleted: result.changes });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to clear the analysis cache.' });
  }
});

app.get('/api/vocabulary/check/:word', async (req, res) => {
  const word = req.params.word?.trim().toLowerCase();

  if (!word) {
    return res.status(400).json({ saved: false });
  }

  try {
    const entry = db.prepare(`SELECT 1 FROM vocabulary WHERE word = ?
      ${isOwnedAccountRequest(req) ? 'AND user_id = ?' : ''} LIMIT 1`)
      .get(word, ...ownerParameters(req));

    return res.json({ saved: Boolean(entry) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/vocabulary/version', async (req, res) => {
  try {
    res.json({ version: 1 });
  } catch (err) {
    console.error('Failed to get vocabulary version:', err);
    res.status(500).json({ error: 'Failed to get vocabulary version' });
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

  const conditions = isOwnedAccountRequest(req) ? ['v.user_id = ?'] : [];
  const params = ownerParameters(req);

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
       LEFT JOIN articles a ON a.id = v.article_id${isOwnedAccountRequest(req) ? ' AND a.user_id = v.user_id' : ''}
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
    if (articleId && !findOwnedArticle(req, articleId)) {
      return res.status(404).json({ error: 'Article not found.' });
    }
    if (id) {
      const existingId = db.prepare(`SELECT id${isOwnedAccountRequest(req) ? ', user_id' : ''}
        FROM vocabulary WHERE id = ?`).get(id);
      if (existingId && isOwnedAccountRequest(req) && existingId.user_id !== req.auth.userId) {
        return res.status(404).json({ error: 'Vocabulary entry not found.' });
      }
    }
    const entry = {
      id: id || generateId('vocab'),
      word: word.trim().toLowerCase(),
      definition: typeof definition === 'string' ? definition : null,
      phonetic: typeof phonetic === 'string' ? phonetic : null,
      part_of_speech: typeof partOfSpeech === 'string' ? partOfSpeech : null,
      example: typeof example === 'string' ? example : null,
      article_id: typeof articleId === 'string' && articleId ? articleId : null,
      saved_at: savedAt || new Date().toISOString(),
      next_review: typeof nextReview === 'string' ? nextReview : null,
      review_count: Number.isInteger(reviewCount) ? reviewCount : 0,
      ease_factor: typeof easeFactor === 'number' ? easeFactor : 2.5,
      interval: Number.isInteger(interval) ? interval : 0,
      context_line: typeof contextLine === 'string' ? contextLine : null,
      raw: raw ? JSON.stringify(raw) : null,
    };

    const userColumn = isOwnedAccountRequest(req) ? ', user_id' : '';
    const userValue = isOwnedAccountRequest(req) ? ', @user_id' : '';
    const conflictKey = isOwnedAccountRequest(req) ? 'user_id, word' : 'word';
    const ownerGuard = isOwnedAccountRequest(req) ? 'WHERE vocabulary.user_id = excluded.user_id' : '';
    entry.user_id = req.auth.userId;
    db.prepare(`INSERT INTO vocabulary (id, word, definition, phonetic, part_of_speech, example, article_id, saved_at, next_review, review_count, ease_factor, interval, context_line, raw${userColumn})
      VALUES (@id, @word, @definition, @phonetic, @part_of_speech, @example, @article_id, @saved_at, @next_review, @review_count, @ease_factor, @interval, @context_line, @raw${userValue})
      ON CONFLICT(${conflictKey}) DO UPDATE SET definition = excluded.definition, phonetic = excluded.phonetic,
      part_of_speech = excluded.part_of_speech, example = excluded.example,
      saved_at = excluded.saved_at, next_review = excluded.next_review, review_count = excluded.review_count,
      ease_factor = excluded.ease_factor, interval = excluded.interval, context_line = excluded.context_line,
      raw = excluded.raw, article_id = COALESCE(vocabulary.article_id, excluded.article_id) ${ownerGuard}`).run(entry);
    return res.status(201).json(serializeVocabulary(db.prepare(`SELECT * FROM vocabulary WHERE word = ?
      ${isOwnedAccountRequest(req) ? 'AND user_id = ?' : ''}`).get(entry.word, ...ownerParameters(req))));
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
    const entry = db.prepare(`SELECT * FROM vocabulary WHERE word = ?
      ${isOwnedAccountRequest(req) ? 'AND user_id = ?' : ''}`).get(word, ...ownerParameters(req));
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
      WHERE article_id = ?${isOwnedAccountRequest(req) ? ' AND user_id = ?' : ''}
    `)
    .all(req.params.id, ...ownerParameters(req))
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
    const result = db.prepare(`DELETE FROM vocabulary WHERE word = ?
      ${isOwnedAccountRequest(req) ? 'AND user_id = ?' : ''}`).run(word, ...ownerParameters(req));
    return result.changes ? res.status(204).end() : res.status(404).json({ error: 'Word not found.' });
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/sync', async (req, res) => {
  const { articles = [], vocabulary = [] } = req.body || {};
  if (!Array.isArray(articles) || !Array.isArray(vocabulary)) {
    return res.status(400).json({ error: 'Articles and vocabulary must be arrays.' });
  }

  try {
    const articleIds = new Set(articles.map((article) => article?.id).filter(Boolean));
    for (const article of articles) {
      if (!article || typeof article !== 'object' || Array.isArray(article)) {
        return res.status(400).json({ error: 'Each article must be an object.' });
      }
      if (article.id) {
        const existing = db.prepare(`SELECT id${isOwnedAccountRequest(req) ? ', user_id' : ''}
          FROM articles WHERE id = ?`).get(article.id);
        if (existing && isOwnedAccountRequest(req) && existing.user_id !== req.auth.userId) {
          return res.status(409).json({ error: 'An article id belongs to another account.' });
        }
      }
    }
    for (const entry of vocabulary) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return res.status(400).json({ error: 'Each vocabulary entry must be an object.' });
      }
      if (entry.id) {
        const existing = db.prepare(`SELECT id${isOwnedAccountRequest(req) ? ', user_id' : ''}
          FROM vocabulary WHERE id = ?`).get(entry.id);
        if (existing && isOwnedAccountRequest(req) && existing.user_id !== req.auth.userId) {
          return res.status(409).json({ error: 'A vocabulary id belongs to another account.' });
        }
      }
      if (entry.articleId && !articleIds.has(entry.articleId) && !findOwnedArticle(req, entry.articleId)) {
        return res.status(409).json({ error: 'A vocabulary entry references an unavailable article.' });
      }
    }

    let articlesSaved = 0;
    let vocabularySaved = 0;

    const saveAll = db.transaction(() => {
      for (const a of articles) {
        const sourceMetadata = a.sourceMetadata && typeof a.sourceMetadata === 'object'
          ? a.sourceMetadata
          : a;
        const article = {
          id: a.id || generateId('article'),
          title: (a.title || 'Untitled article').trim(),
          content: a.content || '',
          highlights: JSON.stringify(a.highlights || []),
          source_name: typeof sourceMetadata.sourceName === 'string' ? sourceMetadata.sourceName : '',
          source_url: typeof sourceMetadata.sourceUrl === 'string' ? sourceMetadata.sourceUrl : '',
          source_author: typeof sourceMetadata.sourceAuthor === 'string' ? sourceMetadata.sourceAuthor : '',
          source_published_at: typeof sourceMetadata.sourcePublishedAt === 'string' ? sourceMetadata.sourcePublishedAt : '',
          source_name_provided: typeof sourceMetadata.sourceName === 'string' ? 1 : 0,
          source_url_provided: typeof sourceMetadata.sourceUrl === 'string' ? 1 : 0,
          source_author_provided: typeof sourceMetadata.sourceAuthor === 'string' ? 1 : 0,
          source_published_at_provided: typeof sourceMetadata.sourcePublishedAt === 'string' ? 1 : 0,
          created_at: a.createdAt || new Date().toISOString(),
          updated_at: a.updatedAt || new Date().toISOString(),
          user_id: req.auth.userId,
        };
        const ownerColumns = isOwnedAccountRequest(req) ? ', user_id' : '';
        const ownerValues = isOwnedAccountRequest(req) ? ', @user_id' : '';
        const ownerGuard = isOwnedAccountRequest(req) ? 'WHERE articles.user_id = excluded.user_id' : '';
        db.prepare(`INSERT INTO articles (
          id, title, content, highlights, source_name, source_url, source_author,
          source_published_at, created_at, updated_at${ownerColumns}
        ) VALUES (
          @id, @title, @content, @highlights, @source_name, @source_url, @source_author,
          @source_published_at, @created_at, @updated_at${ownerValues}
        )
          ON CONFLICT(id) DO UPDATE SET title = excluded.title, content = excluded.content,
          highlights = excluded.highlights,
          source_name = CASE WHEN @source_name_provided THEN excluded.source_name ELSE articles.source_name END,
          source_url = CASE WHEN @source_url_provided THEN excluded.source_url ELSE articles.source_url END,
          source_author = CASE WHEN @source_author_provided THEN excluded.source_author ELSE articles.source_author END,
          source_published_at = CASE WHEN @source_published_at_provided THEN excluded.source_published_at ELSE articles.source_published_at END,
          updated_at = excluded.updated_at ${ownerGuard}`).run(article);
        articlesSaved += 1;
      }

      for (const v of vocabulary) {
        if (typeof v.word !== 'string' || !v.word.trim()) continue;
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
          user_id: req.auth.userId,
        };

        if (!entry.word) continue;
        const ownerColumn = isOwnedAccountRequest(req) ? ', user_id' : '';
        const ownerValue = isOwnedAccountRequest(req) ? ', @user_id' : '';
        const conflictKey = isOwnedAccountRequest(req) ? 'user_id, word' : 'word';
        const ownerGuard = isOwnedAccountRequest(req) ? 'WHERE vocabulary.user_id = excluded.user_id' : '';
        db.prepare(`INSERT INTO vocabulary (id, word, definition, phonetic, part_of_speech, example, article_id, saved_at, next_review, review_count, ease_factor, interval, context_line, raw${ownerColumn})
          VALUES (@id, @word, @definition, @phonetic, @part_of_speech, @example, @article_id, @saved_at, @next_review, @review_count, @ease_factor, @interval, @context_line, @raw${ownerValue})
          ON CONFLICT(${conflictKey}) DO UPDATE SET definition = excluded.definition, phonetic = excluded.phonetic,
          part_of_speech = excluded.part_of_speech, example = excluded.example, article_id = excluded.article_id,
          saved_at = excluded.saved_at, next_review = excluded.next_review, review_count = excluded.review_count,
          ease_factor = excluded.ease_factor, interval = excluded.interval, context_line = excluded.context_line, raw = excluded.raw ${ownerGuard}`).run(entry);
        vocabularySaved += 1;
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
      if (!findOwnedArticle(req, articleId)) {
        return res.status(404).json({ error: 'Article not found.' });
      }
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

app.post('/api/analyze', async (req, res) => {
  const { text, articleId, pageNumber = 1 } = req.body || {};
  const requestId = req.get('X-Analysis-Request-Id');
  const requestKey = requestId ? `${analysisOwnerKey(req)}:${requestId}` : null;
  const provider = (req.query.provider || process.env.ANALYSIS_PROVIDER || (process.env.OPENAI_API_KEY ? 'openai' : process.env.GOOGLE_GEMINI_API_KEY ? 'gemini' : 'fallback')).toLowerCase();
  const model = req.query.model || process.env.OPENAI_MODEL || 'gpt-4o-mini';
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
    if (articleId && !findOwnedArticle(req, articleId)) {
      return res.status(404).json({ error: 'Article not found.' });
    }
    cacheArticle = articleId
      ? db.prepare(`SELECT id FROM articles WHERE id = ?${isOwnedAccountRequest(req) ? ' AND user_id = ?' : ''}`)
        .get(articleId, ...ownerParameters(req))
      : db.prepare(`SELECT id FROM articles WHERE content = ?${isOwnedAccountRequest(req) ? ' AND user_id = ?' : ''}
        ORDER BY updated_at DESC LIMIT 1`).get(analysisInput, ...ownerParameters(req));
    if (cacheArticle) {
      cacheKey = analysisCacheKey(req, cacheArticle.id, pageNumber, contentHash, promptVersion);
      cacheGeneration = analysisGenerations.get(cacheKey) || 0;
      const cached = db.prepare(`SELECT analysis FROM article_analyses
        WHERE article_id = ? AND page_number = ? AND content_hash = ? AND prompt_version = ? LIMIT 1`)
        .get(articleId || cacheArticle.id, pageNumber, contentHash, promptVersion);
      if (cached) {
        try {
          if (requestKey) cancelledAnalysisRequests.delete(requestKey);
          return res.json(JSON.parse(cached.analysis));
        } catch (cacheParseError) {
        }
      }
    }
  } catch (cacheReadError) {
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

    if (cacheArticle && analysis?.source !== 'fallback' && hasMeaningfulContent && (analysisGenerations.get(cacheKey) || 0) === cacheGeneration && !cancelledAnalysisRequests.has(requestKey)) {
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
        console.debug('Cache write error:', cacheWriteError);
      }

      console.debug('Analysis completed', {
        'hardSentences.length:': analysis?.hardSentences?.length,
        'vocabularyAnalysis.length:': analysis?.vocabularyAnalysis?.length,
        'phraseCollocations.length:': analysis?.phraseCollocations?.length
      });

      return res.json(analysis);
    }
  } catch (error) {
    const message = String(error?.message || error || '');
    const isNetworkError = /(?:ETIMEDOUT|ECONNABORTED|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|Network Error|timeout of \d+ms exceeded)/i.test(message);

    if (isNetworkError) {
      const analysis = buildFallbackAnalysis(text, message);
      return res.json(analysis);
    }

    console.error('Analyze error:', message, error?.response?.data || 'no response body');
    return res.status(502).json({
      error: 'Text analysis provider error.',
      provider,
    });
  } finally {
    if (requestKey) cancelledAnalysisRequests.delete(requestKey);
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

const distPath = path.resolve(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(distPath, 'index.html')));

if (require.main === module) {
  try {
    if (startupReadinessError) {
      process.exitCode = 1;
    } else {
      assertAdminDatabaseReady(adminDb);
      app.listen(PORT, HOST, () => {
        console.log(`Server listening on ${HOST}:${PORT}`);
      });
    }
  } catch (error) {
    console.error(`[startup] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { app, splitTranslationChunks, splitAtBoundaries };
