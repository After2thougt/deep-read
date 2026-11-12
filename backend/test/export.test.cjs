const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const Database = require('better-sqlite3');

const backendRoot = path.resolve(__dirname, '..');
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

async function findPort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

function seedDatabase(filePath, owner) {
  const db = new Database(filePath);
  db.pragma('foreign_keys = ON');
  const now = new Date().toISOString();
  const articleId = 'shared-article-id';
  const title = `${owner}_PRIVATE_ARTICLE`;
  const word = `${owner.toLowerCase()}word`;
  const tagName = `${owner.toLowerCase()}-tag`;

  db.prepare(`INSERT INTO articles
    (id, title, content, highlights, source_name, source_url, source_author, source_published_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(articleId, title, `${owner}_PRIVATE_CONTENT`, '[]', `${owner}_SOURCE`, `https://${owner.toLowerCase()}.example/`,
      `${owner}_AUTHOR`, '2026-01-02', now, now);
  const tag = db.prepare('INSERT INTO tags (name, created_at, updated_at) VALUES (?, ?, ?)')
    .run(tagName, now, now);
  db.prepare('INSERT INTO article_tags (article_id, tag_id, created_at) VALUES (?, ?, ?)')
    .run(articleId, tag.lastInsertRowid, now);
  db.prepare(`INSERT INTO article_blocks
    (id, article_id, type, content, thumbnail, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(`${owner.toLowerCase()}-block`, articleId, 'text', `${owner}_BLOCK`, null, 0, now);
  db.prepare(`INSERT INTO vocabulary
    (id, word, definition, phonetic, part_of_speech, example, article_id, saved_at, next_review,
      review_count, ease_factor, interval, context_line, raw, start_offset, end_offset)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(`${owner.toLowerCase()}-vocabulary`, word, `${owner}_DEFINITION`, 'phonetic', 'noun', `${owner}_EXAMPLE`,
      articleId, now, null, 1, 2.5, 1, `${owner}_CONTEXT`, '{}', 0, 4);
  db.prepare(`INSERT INTO article_analyses
    (article_id, page_number, content_hash, analysis, model, prompt_version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(articleId, 1, `${owner}_HASH`, JSON.stringify({ summary: `${owner}_ANALYSIS` }), 'test-model', 'v1', now, now);
  db.prepare(`INSERT INTO article_translation_cache
    (article_id, page_number, content_hash, target, source, provider, translation, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(articleId, 1, `${owner}_HASH`, 'zh', 'en', 'test-provider', `${owner}_TRANSLATION`, now, now);
  db.close();
}

function assertRelationshipsAreInternal(data) {
  const articleIds = new Set(data.articles.map((article) => article.id));
  const tagIds = new Set(data.tags.map((tag) => tag.id));
  for (const block of data.articleBlocks) assert.ok(articleIds.has(block.article_id));
  for (const relation of data.articleTags) {
    assert.ok(articleIds.has(relation.article_id));
    assert.ok(tagIds.has(relation.tag_id));
  }
  for (const word of data.vocabulary) {
    assert.ok(word.article_id === null || articleIds.has(word.article_id));
  }
  for (const analysis of data.articleAnalyses) assert.ok(articleIds.has(analysis.article_id));
  for (const translation of data.articleTranslations) assert.ok(articleIds.has(translation.article_id));
}

async function login(baseUrl, username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 200, `login failed for ${username}`);
  return {
    cookie: response.headers.get('set-cookie').split(';')[0],
    user: await response.json(),
  };
}

async function exportData(baseUrl, cookie, options = {}) {
  const query = options.query || '';
  return fetch(`${baseUrl}/api/export${query}`, {
    method: 'POST',
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(options.body || {}),
  });
}

test('export respects Admin/Guest database and session boundaries', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepread-export-test-'));
  const adminDatabasePath = path.join(tempRoot, 'admin.db');
  const guestDatabasePath = path.join(tempRoot, 'guest.db');
  const clockOffsetPath = path.join(tempRoot, 'clock-offset.txt');
  const clockPreloadPath = path.join(tempRoot, 'clock-preload.cjs');
  fs.writeFileSync(clockOffsetPath, '0');
  fs.writeFileSync(clockPreloadPath, `const fs = require('node:fs');
const systemNow = Date.now.bind(Date);
Date.now = () => {
  const offset = Number(fs.readFileSync(${JSON.stringify(clockOffsetPath)}, 'utf8'));
  return systemNow() + (Number.isFinite(offset) ? offset : 0);
};
`);
  const port = await findPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--require', clockPreloadPath, 'server.js'], {
    cwd: backendRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_PATH: adminDatabasePath,
      GUEST_DATABASE_PATH: guestDatabasePath,
      AUTH_USERNAME: 'test-admin',
      AUTH_PASSWORD: 'test-admin-password',
      GUEST_USERNAME: 'test-guest',
      GUEST_PASSWORD: 'test-guest-password',
      AUTH_SESSION_SECRET: 'isolated-export-test-session-secret',
      TEST_CLOCK_OFFSET_PATH: clockOffsetPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  child.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
  child.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });

  t.after(async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  let healthy = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        healthy = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(healthy, true, `test server failed to start:\n${serverOutput}`);

  seedDatabase(adminDatabasePath, 'ADMIN');
  seedDatabase(guestDatabasePath, 'GUEST');

  const adminDb = new Database(adminDatabasePath);
  const secondaryAdminSalt = 'secondary-admin-test-salt';
  const secondaryAdminHash = crypto.scryptSync('secondary-admin-password', secondaryAdminSalt, 64).toString('hex');
  adminDb.prepare(`INSERT INTO auth_users (username, password_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?)`)
    .run('secondary-admin', `scrypt$${secondaryAdminSalt}$${secondaryAdminHash}`, new Date().toISOString(), new Date().toISOString());
  adminDb.close();

  const admin = await login(baseUrl, 'test-admin', 'test-admin-password');
  const guest = await login(baseUrl, 'test-guest', 'test-guest-password');
  const secondaryAdmin = await login(baseUrl, 'secondary-admin', 'secondary-admin-password');
  assert.equal(admin.user.role, 'admin');
  assert.equal(guest.user.role, 'guest');
  assert.equal(secondaryAdmin.user.role, 'admin');

  await t.test('rejects unauthenticated and invalid sessions', async () => {
    const unauthenticated = await exportData(baseUrl, null);
    assert.equal(unauthenticated.status, 401);
    const invalid = await exportData(baseUrl, 'deepread_session=not-a-valid-session');
    assert.equal(invalid.status, 401);
    const tampered = await exportData(baseUrl, `${admin.cookie}tampered`);
    assert.equal(tampered.status, 401);
  });

  await t.test('exports Admin data only and ignores client database selectors', async () => {
    const response = await exportData(baseUrl, admin.cookie, {
      query: `?userId=test-guest&databasePath=${encodeURIComponent(guestDatabasePath)}`,
      body: {
        userId: 'test-guest',
        databasePath: guestDatabasePath,
        browserData: {
          settings: { theme: 'dark', readerFontSize: 24, secretPreference: 'ignored' },
          readingRecords: [{
            articleId: 'shared-article-id',
            currentPage: 987,
            isCollapsed: true,
            privateMarker: 'UNSCOPED_BROWSER_STATE',
          }],
        },
      },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.match(response.headers.get('content-disposition'), /deepread-backup-\d{4}-\d{2}-\d{2}\.json/);
    const raw = await response.text();
    const exported = JSON.parse(raw);
    assert.deepEqual(exported.data.articles.map((article) => article.title), ['ADMIN_PRIVATE_ARTICLE']);
    assert.match(raw, /ADMIN_PRIVATE_CONTENT/);
    assert.doesNotMatch(raw, /GUEST_PRIVATE|guestword|GUEST_TRANSLATION/);
    assert.doesNotMatch(raw, /password_hash|test-admin-password|test-guest-password/);
    assert.doesNotMatch(raw, /UNSCOPED_BROWSER_STATE|secretPreference/);
    assert.deepEqual(exported.data.settings, { theme: 'dark', readerFontSize: 24 });
    assert.deepEqual(exported.data.readingRecords, []);
    assert.match(exported.exportScope.exclusions.join(' '), /Unscoped per-article reading progress/);
    assert.match(exported.exportScope.dataSources.join(' '), /device-wide, not account-scoped/);
    assertRelationshipsAreInternal(exported.data);
  });

  await t.test('switching to Guest returns only Guest data and retains role gates', async () => {
    const response = await exportData(baseUrl, guest.cookie, {
      query: `?userId=test-admin&databasePath=${encodeURIComponent(adminDatabasePath)}`,
      body: { userId: 'test-admin', databasePath: adminDatabasePath },
    });
    assert.equal(response.status, 200);
    const raw = await response.text();
    const exported = JSON.parse(raw);
    assert.deepEqual(exported.data.articles.map((article) => article.title), ['GUEST_PRIVATE_ARTICLE']);
    assert.match(raw, /GUEST_PRIVATE_CONTENT/);
    assert.doesNotMatch(raw, /ADMIN_PRIVATE|adminword|ADMIN_TRANSLATION/);
    assertRelationshipsAreInternal(exported.data);

    const forbiddenRoleAction = await fetch(`${baseUrl}/api/eudic/vocabulary`, {
      method: 'POST',
      headers: { Cookie: guest.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ word: 'guestword' }),
    });
    assert.equal(forbiddenRoleAction.status, 403);
  });

  await t.test('non-guest accounts share the Admin database by design', async () => {
    const response = await exportData(baseUrl, secondaryAdmin.cookie);
    assert.equal(response.status, 200);
    const exported = await response.json();
    assert.deepEqual(exported.data.articles.map((article) => article.title), ['ADMIN_PRIVATE_ARTICLE']);
    assert.deepEqual(exported.data.readingRecords, []);
  });

  await t.test('repeated exports remain bound to the active session database', async () => {
    const first = await exportData(baseUrl, admin.cookie);
    const second = await exportData(baseUrl, admin.cookie, {
      query: '?userId=test-guest',
      body: { databasePath: guestDatabasePath },
    });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    for (const response of [first, second]) {
      const raw = await response.text();
      assert.match(raw, /ADMIN_PRIVATE_ARTICLE/);
      assert.doesNotMatch(raw, /GUEST_PRIVATE/);
    }
  });

  await t.test('rejects a valid session after its server-side expiry', async () => {
    fs.writeFileSync(clockOffsetPath, String(SESSION_TTL_MS + 1));
    const response = await exportData(baseUrl, admin.cookie);
    assert.equal(response.status, 401);
  });
});

test('browser export collects only allowlisted preferences', async (t) => {
  const originalGlobals = new Map();
  function overrideGlobal(name, value) {
    originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  function restoreGlobal(name) {
    const descriptor = originalGlobals.get(name);
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }

  const values = new Map([
    ['deepread-theme', 'dark'],
    ['reader-font-size', '23'],
    ['vocabulary-trainer:article-page:shared-article-id', '6'],
    ['deepread:reader-view-mode:shared-article-id', 'false'],
    ['deep-read-draft-shared-article-id', '{"title":"unscoped draft"}'],
    ['legacy-migration-data', 'private legacy data'],
    ['unrelated-token', 'must not be read'],
  ]);
  const preferenceReads = [];
  let requestBody;
  let downloaded = false;
  let revoked = false;
  const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
  const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');

  overrideGlobal('localStorage', {
    getItem(key) {
      preferenceReads.push(key);
      return values.get(key) ?? null;
    },
    get length() { throw new Error('Export must not enumerate browser storage.'); },
    key() { throw new Error('Export must not enumerate browser storage.'); },
  });
  overrideGlobal('fetch', async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response('{"exportVersion":1}', {
      headers: { 'Content-Disposition': 'attachment; filename="deepread-backup-test.json"' },
    });
  });
  overrideGlobal('document', {
    createElement() {
      return { click() { downloaded = true; }, remove() {} };
    },
    body: { appendChild() {} },
  });
  overrideGlobal('window', { setTimeout(callback) { callback(); } });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: () => 'blob:test' });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: () => { revoked = true; } });

  t.after(() => {
    for (const name of ['localStorage', 'fetch', 'document', 'window']) restoreGlobal(name);
    if (originalCreateObjectURL) Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURL);
    else delete URL.createObjectURL;
    if (originalRevokeObjectURL) Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectURL);
    else delete URL.revokeObjectURL;
  });

  const { exportUserData } = await import('../../src/api/export.js');
  await exportUserData();
  assert.deepEqual(requestBody, { browserData: { settings: { theme: 'dark', readerFontSize: 23 } } });
  assert.deepEqual(preferenceReads, ['deepread-theme', 'reader-font-size']);
  assert.equal(downloaded, true);
  assert.equal(revoked, true);
});
