const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const Database = require('better-sqlite3');
const { runMigrations } = require('../scripts/migrate');
const { initializeAdministrator } = require('../scripts/bootstrap-administrator');
const { hashPassword } = require('../password');

const backendRoot = path.resolve(__dirname, '..');
const migrationDirectory = path.resolve(backendRoot, '..', 'deploy', 'migrations');
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

function initializeDatabases(adminPath, guestPath) {
  const savedAdminPath = process.env.DATABASE_PATH;
  const savedGuestPath = process.env.GUEST_DATABASE_PATH;
  process.env.DATABASE_PATH = adminPath;
  process.env.GUEST_DATABASE_PATH = guestPath;
  const databaseModulePath = require.resolve('../db');
  delete require.cache[databaseModulePath];
  const { adminDb, guestDb } = require('../db');
  const now = new Date().toISOString();
  adminDb.prepare(`INSERT INTO auth_users (username, password_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?)`).run('test-admin', hashPassword('test-admin-password'), now, now);
  guestDb.prepare(`INSERT INTO auth_users (username, password_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?)`).run('test-guest', hashPassword('test-guest-password'), now, now);
  runMigrations(adminDb, migrationDirectory);
  const secondaryId = Number(adminDb.prepare(`INSERT INTO auth_users
    (username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run('secondary-user', hashPassword('secondary-user-password'), now, now).lastInsertRowid);
  const administratorId = initializeAdministrator(adminDb, {
    username: 'test-administrator',
    password: 'test-administrator-password',
  });
  const primaryId = adminDb.prepare('SELECT id FROM auth_users WHERE username = ?').get('test-admin').id;
  adminDb.close();
  guestDb.close();
  delete require.cache[databaseModulePath];
  if (savedAdminPath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = savedAdminPath;
  if (savedGuestPath === undefined) delete process.env.GUEST_DATABASE_PATH;
  else process.env.GUEST_DATABASE_PATH = savedGuestPath;
  return { primaryId, secondaryId, administratorId };
}

function seedDatabase(filePath, owner, userId = null, accountScoped = false) {
  const db = new Database(filePath);
  db.pragma('foreign_keys = ON');
  const now = new Date().toISOString();
  const articleId = `${owner.toLowerCase()}-article-id`;
  const title = `${owner}_PRIVATE_ARTICLE`;
  const word = `${owner.toLowerCase()}word`;
  const tagName = `${owner.toLowerCase()}-tag`;

  db.prepare(`INSERT INTO articles
    (id, title, content, highlights, source_name, source_url, source_author, source_published_at, created_at, updated_at${accountScoped ? ', user_id' : ''})
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?${accountScoped ? ', ?' : ''})`)
    .run(articleId, title, `${owner}_PRIVATE_CONTENT`, '[]', `${owner}_SOURCE`, `https://${owner.toLowerCase()}.example/`,
      `${owner}_AUTHOR`, '2026-01-02', now, now, ...(accountScoped ? [userId] : []));
  const tag = accountScoped
    ? db.prepare('INSERT INTO tags (name, created_at, updated_at, user_id) VALUES (?, ?, ?, ?)').run(tagName, now, now, userId)
    : db.prepare('INSERT INTO tags (name, created_at, updated_at) VALUES (?, ?, ?)').run(tagName, now, now);
  if (accountScoped) {
    db.prepare('INSERT INTO article_tags (article_id, tag_id, user_id, created_at) VALUES (?, ?, ?, ?)')
      .run(articleId, tag.lastInsertRowid, userId, now);
  } else {
    db.prepare('INSERT INTO article_tags (article_id, tag_id, created_at) VALUES (?, ?, ?)')
      .run(articleId, tag.lastInsertRowid, now);
  }
  db.prepare(`INSERT INTO article_blocks
    (id, article_id, type, content, thumbnail, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(`${owner.toLowerCase()}-block`, articleId, 'text', `${owner}_BLOCK`, null, 0, now);
  db.prepare(`INSERT INTO vocabulary
    (id, word, definition, phonetic, part_of_speech, example, article_id, saved_at, next_review,
      review_count, ease_factor, interval, context_line, raw, start_offset, end_offset${accountScoped ? ', user_id' : ''})
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${accountScoped ? ', ?' : ''})`)
    .run(`${owner.toLowerCase()}-vocabulary`, word, `${owner}_DEFINITION`, 'phonetic', 'noun', `${owner}_EXAMPLE`,
      articleId, now, null, 1, 2.5, 1, `${owner}_CONTEXT`, '{}', 0, 4, ...(accountScoped ? [userId] : []));
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
  const { primaryId, secondaryId, administratorId } = initializeDatabases(adminDatabasePath, guestDatabasePath);
  seedDatabase(guestDatabasePath, 'GUEST');
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
      UPLOADS_PATH: path.join(tempRoot, 'uploads'),
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

  const admin = await login(baseUrl, 'test-admin', 'test-admin-password');
  let guest = await login(baseUrl, 'test-guest', 'test-guest-password');
  const secondaryAdmin = await login(baseUrl, 'secondary-user', 'secondary-user-password');
  const administrator = await login(baseUrl, 'test-administrator', 'test-administrator-password');
  assert.equal(admin.user.role, 'user');
  assert.equal(guest.user.role, 'guest');
  assert.equal(secondaryAdmin.user.role, 'user');
  assert.equal(administrator.user.role, 'administrator');
  assert.equal(administrator.user.userId, administratorId);
  assert.equal(admin.user.userId, primaryId);
  assert.equal(secondaryAdmin.user.userId, secondaryId);
  seedDatabase(adminDatabasePath, 'USER_A', primaryId, true);
  seedDatabase(adminDatabasePath, 'USER_B', secondaryId, true);
  const mediaPath = `/api/media/users/${primaryId}/articles/user_a-article-id/private.webp`;
  const mediaFilePath = path.join(tempRoot, 'uploads', 'users', String(primaryId), 'articles', 'user_a-article-id', 'private.webp');
  fs.mkdirSync(path.dirname(mediaFilePath), { recursive: true });
  fs.writeFileSync(mediaFilePath, 'isolated-test-media');
  const seededAdminDb = new Database(adminDatabasePath);
  seededAdminDb.prepare(`INSERT INTO article_blocks
    (id, article_id, type, content, thumbnail, sort_order, created_at)
    VALUES (?, ?, 'image', ?, NULL, 1, ?)`)
    .run('user-a-private-image', 'user_a-article-id', mediaPath, new Date().toISOString());
  seededAdminDb.close();

  await t.test('rejects unauthenticated and invalid sessions', async () => {
    const unauthenticated = await exportData(baseUrl, null);
    assert.equal(unauthenticated.status, 401);
    const invalid = await exportData(baseUrl, 'deepread_session=not-a-valid-session');
    assert.equal(invalid.status, 401);
    const tampered = await exportData(baseUrl, `${admin.cookie}tampered`);
    assert.equal(tampered.status, 401);
  });

  await t.test('Administrator tools are role-gated and never expose password hashes or allow role assignment', async () => {
    const forbidden = await fetch(`${baseUrl}/api/admin/users`, { headers: { Cookie: admin.cookie } });
    assert.equal(forbidden.status, 403);
    const listResponse = await fetch(`${baseUrl}/api/admin/users`, { headers: { Cookie: administrator.cookie } });
    assert.equal(listResponse.status, 200);
    const users = await listResponse.json();
    assert.ok(users.some((user) => user.id === primaryId));
    assert.ok(users.every((user) => !Object.hasOwn(user, 'password_hash')));

    const forgedRole = await fetch(`${baseUrl}/api/admin/users`, {
      method: 'POST',
      headers: { Cookie: administrator.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'forged-admin', password: 'long-enough-password', role: 'administrator' }),
    });
    assert.equal(forgedRole.status, 400);
    const created = await fetch(`${baseUrl}/api/admin/users`, {
      method: 'POST',
      headers: { Cookie: administrator.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'managed-user', password: 'long-enough-password' }),
    });
    assert.equal(created.status, 201);
    const createdUser = await created.json();
    assert.equal(createdUser.role, 'user');
    assert.ok(!Object.hasOwn(createdUser, 'password_hash'));

    const forgedPromotion = await fetch(`${baseUrl}/api/admin/users/${createdUser.id}`, {
      method: 'PATCH',
      headers: { Cookie: administrator.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'administrator', isActive: true }),
    });
    assert.equal(forgedPromotion.status, 400);
    const disableUser = await fetch(`${baseUrl}/api/admin/users/${createdUser.id}`, {
      method: 'PATCH',
      headers: { Cookie: administrator.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: false }),
    });
    assert.equal(disableUser.status, 200);
    assert.equal((await disableUser.json()).is_active, 0);

    const refreshedAccountsResponse = await fetch(`${baseUrl}/api/admin/users`, {
      headers: { Cookie: administrator.cookie },
    });
    assert.equal(refreshedAccountsResponse.status, 200);
    const refreshedAccounts = await refreshedAccountsResponse.json();
    assert.equal(refreshedAccounts.filter((account) => account.role === 'user').length, 3);
    assert.equal(refreshedAccounts.filter((account) => account.role === 'administrator').length, 1);
    assert.equal(refreshedAccounts.filter((account) => account.role === 'guest').length, 1);
    assert.equal(refreshedAccounts.length, 5);
    assert.equal(
      refreshedAccounts.find((account) => account.username === 'managed-user').is_active,
      0,
    );

    const unauthenticatedOverview = await fetch(`${baseUrl}/api/admin/overview`);
    assert.equal(unauthenticatedOverview.status, 401);
    const regularOverview = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: { Cookie: admin.cookie },
    });
    assert.equal(regularOverview.status, 403);
    const guestOverview = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: { Cookie: guest.cookie },
    });
    assert.equal(guestOverview.status, 403);
    const overviewResponse = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: { Cookie: administrator.cookie },
    });
    assert.equal(overviewResponse.status, 200);
    const overview = await overviewResponse.json();
    assert.deepEqual(overview.stats, {
      totalUsers: 3,
      activeUsers: 2,
      disabledUsers: 1,
      administrators: 1,
    });
    assert.equal(overview.recentUsers.length, 3);
    assert.ok(overview.recentUsers.some((user) => user.username === 'managed-user'));
    assert.ok(overview.recentUsers.every((user) => user.username !== 'test-guest'));
    assert.ok(overview.recentUsers.every((user) =>
      Object.keys(user).sort().join(',') === 'createdAt,username'));
    assert.doesNotMatch(JSON.stringify(overview), /password_hash|session_token|test-session/);

    const accountExport = await fetch(`${baseUrl}/api/admin/users/${primaryId}/export`, {
      headers: { Cookie: administrator.cookie },
    });
    assert.equal(accountExport.status, 200);
    const accountExportBody = await accountExport.text();
    assert.match(accountExportBody, /USER_A_PRIVATE_ARTICLE/);
    assert.doesNotMatch(accountExportBody, /USER_B_PRIVATE|GUEST_PRIVATE|password_hash/);
    const emptyExport = await fetch(`${baseUrl}/api/admin/users/${createdUser.id}/export`, {
      headers: { Cookie: administrator.cookie },
    });
    assert.equal(emptyExport.status, 200);
    const emptyData = (await emptyExport.json()).data;
    for (const key of ['articles', 'articleBlocks', 'tags', 'articleTags', 'vocabulary',
      'articleAnalyses', 'articleTranslations', 'readingRecords']) {
      assert.deepEqual(emptyData[key], [], `${key} should be empty for an account with no content`);
    }
    const userAttempt = await fetch(`${baseUrl}/api/admin/users/${secondaryId}/export`, {
      headers: { Cookie: admin.cookie },
    });
    assert.equal(userAttempt.status, 403);
    const disabledLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'managed-user', password: 'long-enough-password' }),
    });
    assert.equal(disabledLogin.status, 401);
  });

  await t.test('isolates regular-account article, tag, vocabulary, relationship, cache, and media access', async () => {
    const userAArticlesResponse = await fetch(`${baseUrl}/api/articles?limit=50`, { headers: { Cookie: admin.cookie } });
    const userBArticlesResponse = await fetch(`${baseUrl}/api/articles?limit=50`, { headers: { Cookie: secondaryAdmin.cookie } });
    assert.equal(userAArticlesResponse.status, 200);
    assert.equal(userBArticlesResponse.status, 200);
    const userAArticles = await userAArticlesResponse.json();
    const userBArticles = await userBArticlesResponse.json();
    assert.deepEqual(userAArticles.items.map((row) => row.title), ['USER_A_PRIVATE_ARTICLE']);
    assert.deepEqual(userBArticles.items.map((row) => row.title), ['USER_B_PRIVATE_ARTICLE']);

    const foreignArticle = await fetch(`${baseUrl}/api/articles/user_b-article-id`, { headers: { Cookie: admin.cookie } });
    assert.equal(foreignArticle.status, 404);
    const foreignUpdate = await fetch(`${baseUrl}/api/articles`, {
      method: 'POST',
      headers: { Cookie: admin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'user_b-article-id', title: 'FORGED', content: 'FORGED' }),
    });
    assert.equal(foreignUpdate.status, 404);

    const userATags = await fetch(`${baseUrl}/api/tags`, { headers: { Cookie: admin.cookie } }).then((response) => response.json());
    const userBTags = await fetch(`${baseUrl}/api/tags`, { headers: { Cookie: secondaryAdmin.cookie } }).then((response) => response.json());
    assert.deepEqual(userATags.map((tag) => tag.name), ['user_a-tag']);
    assert.deepEqual(userBTags.map((tag) => tag.name), ['user_b-tag']);
    const foreignRelationship = await fetch(`${baseUrl}/api/articles/user_a-article-id/tags/${userBTags[0].id}`, {
      method: 'POST',
      headers: { Cookie: admin.cookie },
    });
    assert.equal(foreignRelationship.status, 404);

    const userAVocabulary = await fetch(`${baseUrl}/api/vocabulary?limit=50`, { headers: { Cookie: admin.cookie } }).then((response) => response.json());
    const userBVocabulary = await fetch(`${baseUrl}/api/vocabulary?limit=50`, { headers: { Cookie: secondaryAdmin.cookie } }).then((response) => response.json());
    assert.deepEqual(userAVocabulary.items.map((entry) => entry.word), ['user_aword']);
    assert.deepEqual(userBVocabulary.items.map((entry) => entry.word), ['user_bword']);
    const foreignWord = await fetch(`${baseUrl}/api/vocabulary/user_bword`, { headers: { Cookie: admin.cookie } });
    assert.equal(foreignWord.status, 404);
    const foreignVocabularyLink = await fetch(`${baseUrl}/api/vocabulary`, {
      method: 'POST',
      headers: { Cookie: admin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ word: 'forged-link', articleId: 'user_b-article-id' }),
    });
    assert.equal(foreignVocabularyLink.status, 404);

    for (const [url, body] of [
      ['/api/analyze', { text: 'private analysis input', articleId: 'user_b-article-id' }],
      ['/api/translate', { text: 'private translation input', articleId: 'user_b-article-id' }],
    ]) {
      const response = await fetch(`${baseUrl}${url}`, {
        method: 'POST',
        headers: { Cookie: admin.cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 404);
    }

    const forgedSync = await fetch(`${baseUrl}/api/sync`, {
      method: 'POST',
      headers: { Cookie: admin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ articles: [{ id: 'user_b-article-id', title: 'FORGED', content: 'FORGED' }] }),
    });
    assert.equal(forgedSync.status, 409);

    const ownMedia = await fetch(`${baseUrl}${mediaPath}`, { headers: { Cookie: admin.cookie } });
    assert.equal(ownMedia.status, 200);
    assert.equal(ownMedia.headers.get('cache-control'), 'private, no-store');
    const foreignMedia = await fetch(`${baseUrl}/api/media/users/${secondaryId}/articles/user_b-article-id/private.webp`, {
      headers: { Cookie: admin.cookie },
    });
    assert.equal(foreignMedia.status, 404);
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
    assert.deepEqual(exported.data.articles.map((article) => article.title), ['USER_A_PRIVATE_ARTICLE']);
    assert.match(raw, /USER_A_PRIVATE_CONTENT/);
    assert.doesNotMatch(raw, /USER_B_PRIVATE|GUEST_PRIVATE|user_bword|GUEST_TRANSLATION/);
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
    assert.doesNotMatch(raw, /USER_A_PRIVATE|USER_B_PRIVATE|user_aword|user_bword|USER_A_TRANSLATION/);
    assertRelationshipsAreInternal(exported.data);

    const forbiddenRoleAction = await fetch(`${baseUrl}/api/eudic/vocabulary`, {
      method: 'POST',
      headers: { Cookie: guest.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ word: 'guestword' }),
    });
    assert.equal(forbiddenRoleAction.status, 403);
  });

  await t.test('regular accounts sharing Admin database remain isolated by user id', async () => {
    const response = await exportData(baseUrl, secondaryAdmin.cookie);
    assert.equal(response.status, 200);
    const raw = await response.text();
    const exported = JSON.parse(raw);
    assert.deepEqual(exported.data.articles.map((article) => article.title), ['USER_B_PRIVATE_ARTICLE']);
    assert.match(raw, /USER_B_PRIVATE_CONTENT/);
    assert.doesNotMatch(raw, /USER_A_PRIVATE|GUEST_PRIVATE/);
    assert.deepEqual(exported.data.readingRecords, []);
    assertRelationshipsAreInternal(exported.data);
  });

  await t.test('media endpoints reject unauthenticated requests, cross-user reads, and traversal attempts', async () => {
    const guestImagePath = path.join(tempRoot, 'uploads', 'guest', String(guest.user.userId), 'articles', 'guest-private.webp');
    fs.mkdirSync(path.dirname(guestImagePath), { recursive: true });
    fs.writeFileSync(guestImagePath, 'guest-private-media');

    const secondaryImagePath = path.join(tempRoot, 'uploads', 'users', String(secondaryId), 'articles', 'user_b-article-id', 'user_b_private.webp');
    fs.mkdirSync(path.dirname(secondaryImagePath), { recursive: true });
    fs.writeFileSync(secondaryImagePath, 'secondary-private-media');

    const seededDb = new Database(adminDatabasePath);
    seededDb.prepare(`INSERT INTO article_blocks
      (id, article_id, type, content, thumbnail, sort_order, created_at)
      VALUES (?, ?, 'image', ?, NULL, 2, ?)`)
      .run('user-b-private-image', 'user_b-article-id', `/api/media/users/${secondaryId}/articles/user_b-article-id/user_b_private.webp`, new Date().toISOString());
    seededDb.close();

    const unauthenticated = await fetch(`${baseUrl}/api/media/users/${primaryId}/articles/user_a-article-id/private.webp`);
    assert.equal(unauthenticated.status, 401);

    const unauthenticatedLegacy = await fetch(`${baseUrl}/uploads/articles/user_a-article-id/private.webp`);
    assert.equal(unauthenticatedLegacy.status, 404);

    const traversal = await fetch(`${baseUrl}/api/media/users/${primaryId}/articles/%2E%2E%2F%2E%2E%2Fetc/passwd`, { headers: { Cookie: admin.cookie } });
    assert.equal(traversal.status, 404);

    const adminAttemptsForeignMedia = await fetch(`${baseUrl}/api/media/users/${secondaryId}/articles/user_b-article-id/user_b_private.webp`, { headers: { Cookie: admin.cookie } });
    assert.equal(adminAttemptsForeignMedia.status, 404);

    const guestAttemptsAdminMedia = await fetch(`${baseUrl}/api/media/users/${primaryId}/articles/user_a-article-id/private.webp`, { headers: { Cookie: guest.cookie } });
    assert.equal(guestAttemptsAdminMedia.status, 404);

    const adminAttemptsGuestMedia = await fetch(`${baseUrl}/api/media/guest/${guest.user.userId}/articles/guest-private.webp`, { headers: { Cookie: admin.cookie } });
    assert.equal(adminAttemptsGuestMedia.status, 404);

    const foreignDelete = await fetch(`${baseUrl}/api/articles/user_b-article-id`, {
      method: 'DELETE',
      headers: { Cookie: admin.cookie },
    });
    assert.equal(foreignDelete.status, 404);
    assert.equal(fs.existsSync(secondaryImagePath), true);
  });

  await t.test('admin and guest media remains isolated from each other and ordinary user data', async () => {
    const guestImageUrl = `/api/media/guest/${guest.user.userId}/articles/guest-private.webp`;
    const guestPrivateFile = path.join(tempRoot, 'uploads', 'guest', String(guest.user.userId), 'articles', 'guest-private.webp');
    fs.mkdirSync(path.dirname(guestPrivateFile), { recursive: true });
    fs.writeFileSync(guestPrivateFile, 'guest-owned-media');

    const guestOwnRead = await fetch(`${baseUrl}${guestImageUrl}`, { headers: { Cookie: guest.cookie } });
    assert.equal(guestOwnRead.status, 200);

    const guestToAdminRead = await fetch(`${baseUrl}/api/media/users/${primaryId}/articles/user_a-article-id/private.webp`, { headers: { Cookie: guest.cookie } });
    assert.equal(guestToAdminRead.status, 404);

    const adminToGuestRead = await fetch(`${baseUrl}${guestImageUrl}`, { headers: { Cookie: admin.cookie } });
    assert.equal(adminToGuestRead.status, 404);

    const guestLegacyRead = await fetch(`${baseUrl}/uploads/articles/user_a-article-id/private.webp`, { headers: { Cookie: guest.cookie } });
    assert.equal(guestLegacyRead.status, 404);
  });

  await t.test('ordinary users cannot access administrator endpoints and administrator data remains scoped to the administrator account', async () => {
    const adminArticleId = 'administrator-private-article';
    const administratorOwnedArticle = {
      id: adminArticleId,
      title: 'ADMINISTRATOR_PRIVATE_ARTICLE',
      content: 'Administrator-only content',
      highlights: [],
      blocks: [],
      sourceMetadata: {
        sourceName: '',
        sourceUrl: '',
        sourceAuthor: '',
        sourcePublishedAt: '',
      },
    };
    const adminDb = new Database(adminDatabasePath);
    adminDb.prepare(`INSERT INTO articles
      (id, title, content, highlights, source_name, source_url, source_author, source_published_at, created_at, updated_at, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        administratorOwnedArticle.id,
        administratorOwnedArticle.title,
        administratorOwnedArticle.content,
        '[]',
        '',
        '',
        '',
        '',
        new Date().toISOString(),
        new Date().toISOString(),
        administratorId,
      );
    adminDb.close();

    const userListAttempt = await fetch(`${baseUrl}/api/admin/users`, { headers: { Cookie: admin.cookie } });
    const userCreateAttempt = await fetch(`${baseUrl}/api/admin/users`, {
      method: 'POST',
      headers: { Cookie: admin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'blocked-user', password: 'long-enough-password' }),
    });
    const userPatchAttempt = await fetch(`${baseUrl}/api/admin/users/${primaryId}`, {
      method: 'PATCH',
      headers: { Cookie: admin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: false }),
    });
    const userExportAttempt = await fetch(`${baseUrl}/api/admin/users/${primaryId}/export`, { headers: { Cookie: admin.cookie } });
    assert.equal(userListAttempt.status, 403);
    assert.equal(userCreateAttempt.status, 403);
    assert.equal(userPatchAttempt.status, 403);
    assert.equal(userExportAttempt.status, 403);

    const regularUserAccess = await fetch(`${baseUrl}/api/articles/${adminArticleId}`, { headers: { Cookie: admin.cookie } });
    const administratorOwnAccess = await fetch(`${baseUrl}/api/articles/${adminArticleId}`, { headers: { Cookie: administrator.cookie } });
    assert.equal(regularUserAccess.status, 404);
    assert.equal(administratorOwnAccess.status, 200);

    const adminExport = await fetch(`${baseUrl}/api/export`, { headers: { Cookie: administrator.cookie } });
    assert.equal(adminExport.status, 200);
    const exportedAdmin = await adminExport.json();
    assert.deepEqual(exportedAdmin.data.articles.map((article) => article.title), ['ADMINISTRATOR_PRIVATE_ARTICLE']);
    assert.doesNotMatch(JSON.stringify(exportedAdmin), /USER_A_PRIVATE_ARTICLE|USER_B_PRIVATE_ARTICLE/);
  });

  await t.test('last active Administrator cannot be disabled through management endpoints', async () => {
    const disableAdmin = await fetch(`${baseUrl}/api/admin/users/${administratorId}`, {
      method: 'PATCH',
      headers: { Cookie: administrator.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: false }),
    });
    const disableAdminAsRegular = await fetch(`${baseUrl}/api/admin/users/${administratorId}`, {
      method: 'PATCH',
      headers: { Cookie: admin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: false }),
    });
    assert.equal(disableAdmin.status, 404);
    assert.equal(disableAdminAsRegular.status, 403);
  });

  await t.test('Guest is a single manageable system account and disabling it preserves its database', async () => {
    const listResponse = await fetch(`${baseUrl}/api/admin/users`, {
      headers: { Cookie: administrator.cookie },
    });
    assert.equal(listResponse.status, 200);
    const accounts = await listResponse.json();
    const guestAccounts = accounts.filter((account) => account.role === 'guest');
    assert.equal(guestAccounts.length, 1);
    assert.equal(guestAccounts[0].username, 'Guest');
    assert.equal(guestAccounts[0].account_count, 1);
    assert.equal(guestAccounts[0].is_active, 1);
    assert.equal(guestAccounts[0].active_sessions, 1);
    assert.equal(guestAccounts[0].database, 'Guest Database');
    assert.deepEqual(guestAccounts[0].database_stats, { articles: 1, tags: 1, vocabulary: 1 });
    assert.equal(guestAccounts[0].login_configured, true);
    assert.doesNotMatch(JSON.stringify(guestAccounts[0]), /password_hash|test-guest-password/);
    const adminDatabase = new Database(adminDatabasePath);
    assert.equal(adminDatabase.prepare(
      'SELECT COUNT(*) AS count FROM auth_users WHERE username = ?',
    ).get('test-guest').count, 0);
    assert.equal(adminDatabase.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'guest_access_settings'",
    ).get().count, 1);
    adminDatabase.close();

    const forbiddenUpdate = await fetch(`${baseUrl}/api/admin/guest`, {
      method: 'PATCH',
      headers: { Cookie: admin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: false }),
    });
    assert.equal(forbiddenUpdate.status, 403);
    const guestUpdate = await fetch(`${baseUrl}/api/admin/guest`, {
      method: 'PATCH',
      headers: { Cookie: guest.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: false }),
    });
    assert.equal(guestUpdate.status, 403);

    const disabled = await fetch(`${baseUrl}/api/admin/guest`, {
      method: 'PATCH',
      headers: { Cookie: administrator.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: false }),
    });
    assert.equal(disabled.status, 200);
    const disabledGuest = await disabled.json();
    assert.equal(disabledGuest.is_active, 0);
    assert.equal(disabledGuest.active_sessions, 0);

    const existingGuestSession = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: guest.cookie },
    });
    assert.equal(existingGuestSession.status, 401);
    const disabledLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'test-guest', password: 'test-guest-password' }),
    });
    assert.equal(disabledLogin.status, 401);

    const guestDatabase = new Database(guestDatabasePath);
    assert.equal(guestDatabase.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'guest_access_settings'",
    ).get().count, 0);
    assert.equal(guestDatabase.prepare('SELECT COUNT(*) AS count FROM auth_users').get().count, 1);
    assert.equal(guestDatabase.prepare('SELECT COUNT(*) AS count FROM articles').get().count, 1);
    assert.equal(guestDatabase.prepare('SELECT COUNT(*) AS count FROM tags').get().count, 1);
    assert.equal(guestDatabase.prepare('SELECT COUNT(*) AS count FROM vocabulary').get().count, 1);
    assert.equal(guestDatabase.prepare('SELECT content FROM articles').get().content, 'GUEST_PRIVATE_CONTENT');
    guestDatabase.close();

    const enabled = await fetch(`${baseUrl}/api/admin/guest`, {
      method: 'PATCH',
      headers: { Cookie: administrator.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: true }),
    });
    assert.equal(enabled.status, 200);
    assert.equal((await enabled.json()).is_active, 1);
    guest = await login(baseUrl, 'test-guest', 'test-guest-password');
    assert.equal(guest.user.role, 'guest');
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
      assert.match(raw, /USER_A_PRIVATE_ARTICLE/);
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

test('account-specific browser state keys are isolated by authenticated user id', async () => {
  const { accountStorageKey, setStorageAccount } = await import('../../src/utils/storage.js');
  setStorageAccount(17);
  const firstUserKey = accountStorageKey('deep-read-draft-article');
  setStorageAccount(17, 'guest');
  const guestKey = accountStorageKey('deep-read-draft-article');
  setStorageAccount(28);
  const secondUserKey = accountStorageKey('deep-read-draft-article');
  setStorageAccount(null);
  assert.notEqual(firstUserKey, secondUserKey);
  assert.notEqual(firstUserKey, guestKey);
  assert.match(firstUserKey, /:17:/);
  assert.match(guestKey, /guest:17:/);
  assert.match(secondUserKey, /:28:/);
  assert.match(accountStorageKey('temporary'), /:unavailable:/);
});
