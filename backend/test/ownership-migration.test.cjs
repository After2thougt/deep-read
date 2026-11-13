const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const Database = require('better-sqlite3');
const { runMigrations } = require('../scripts/migrate');
const { initializeAdministrator } = require('../scripts/bootstrap-administrator');
const { resolveAdminDatabasePath } = require('../scripts/admin-database-path');
const { verifyPassword } = require('../password');

const migrationDirectory = path.resolve(__dirname, '..', '..', 'deploy', 'migrations');
const ownerId = 42;
const now = '2025-03-04T05:06:07.000Z';

const legacySchema = `
  CREATE TABLE auth_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE articles (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
    highlights TEXT NOT NULL DEFAULT '[]', source_name TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL DEFAULT '', source_author TEXT NOT NULL DEFAULT '',
    source_published_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE article_tags (
    article_id TEXT NOT NULL, tag_id INTEGER NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY (article_id, tag_id),
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
  );
  CREATE INDEX article_tags_tag_idx ON article_tags (tag_id, article_id);
  CREATE TABLE article_blocks (
    id TEXT PRIMARY KEY, article_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('text', 'image')),
    content TEXT NOT NULL, thumbnail TEXT, sort_order INTEGER NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
  );
  CREATE INDEX article_blocks_article_order_idx ON article_blocks (article_id, sort_order);
  CREATE TABLE vocabulary (
    id TEXT PRIMARY KEY, word TEXT NOT NULL UNIQUE COLLATE NOCASE, definition TEXT, phonetic TEXT,
    part_of_speech TEXT, example TEXT, article_id TEXT, saved_at TEXT NOT NULL, next_review TEXT,
    review_count INTEGER NOT NULL DEFAULT 0, ease_factor REAL NOT NULL DEFAULT 2.5,
    interval INTEGER NOT NULL DEFAULT 0, context_line TEXT, raw TEXT,
    start_offset INTEGER, end_offset INTEGER,
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE SET NULL
  );
  CREATE INDEX vocabulary_saved_at_idx ON vocabulary (saved_at DESC);
  CREATE INDEX articles_updated_at_idx ON articles (updated_at DESC);
  CREATE TABLE article_analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT, article_id TEXT NOT NULL,
    page_number INTEGER NOT NULL DEFAULT 1, content_hash TEXT NOT NULL, analysis TEXT NOT NULL,
    model TEXT, prompt_version TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
    UNIQUE (article_id, page_number, content_hash, prompt_version)
  );
  CREATE INDEX article_analyses_lookup_idx
    ON article_analyses (article_id, content_hash, prompt_version);
  CREATE TABLE article_translation_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT, article_id TEXT NOT NULL, page_number INTEGER NOT NULL,
    content_hash TEXT NOT NULL, target TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'auto',
    provider TEXT NOT NULL DEFAULT 'deeplx', translation TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
    UNIQUE (article_id, page_number, content_hash, source, target, provider)
  );
`;

function createTemporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'deepread-ownership-'));
}

function createLegacyDatabase(databasePath, { extraAccount = false, orphanRelationship = false } = {}) {
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');
  db.exec(legacySchema);
  db.prepare(`INSERT INTO auth_users (id, username, password_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)`).run(ownerId, 'production-owner-not-admin', 'scrypt$old$preserved-hash', now, now);
  if (extraAccount) {
    db.prepare(`INSERT INTO auth_users (id, username, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)`).run(91, 'another-account', 'scrypt$another$hash', now, now);
  }
  db.prepare(`INSERT INTO articles
    (id, title, content, highlights, source_name, source_url, source_author,
      source_published_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('article-old', 'Historical title', 'Historical content', '["highlight"]',
      'Original source', 'https://example.test/article', 'Author', '2024-01-02', now, now);
  db.prepare('INSERT INTO tags (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(17, 'Historical tag', now, now);
  db.prepare('INSERT INTO article_tags (article_id, tag_id, created_at) VALUES (?, ?, ?)')
    .run('article-old', 17, now);
  db.prepare(`INSERT INTO article_blocks
    (id, article_id, type, content, thumbnail, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run('block-old', 'article-old', 'text', 'Historical block', null, 3, now);
  db.prepare(`INSERT INTO vocabulary
    (id, word, definition, phonetic, part_of_speech, example, article_id, saved_at,
      next_review, review_count, ease_factor, interval, context_line, raw, start_offset, end_offset)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('vocabulary-old', 'historical', 'Definition', '/h/', 'noun', 'An example',
      'article-old', now, '2025-04-04', 2, 2.6, 3, 'Context', '{"source":"fixture"}', 1, 5);
  db.prepare(`INSERT INTO article_analyses
    (id, article_id, page_number, content_hash, analysis, model, prompt_version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(23, 'article-old', 2, 'analysis-hash', '{"summary":"Summary"}', 'test-model', 'v3', now, now);
  db.prepare(`INSERT INTO article_translation_cache
    (id, article_id, page_number, content_hash, target, source, provider, translation, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(29, 'article-old', 2, 'translation-hash', 'fr', 'en', 'fixture-provider',
      'Traduction', now, now);

  if (orphanRelationship) {
    db.pragma('foreign_keys = OFF');
    db.prepare('INSERT INTO article_tags (article_id, tag_id, created_at) VALUES (?, ?, ?)')
      .run('article-old', 999, now);
    db.pragma('foreign_keys = ON');
  }

  return db;
}

function snapshotDatabase(db) {
  const schema = db.prepare(`SELECT type, name, sql FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`).all();
  const tables = schema.filter((entry) => entry.type === 'table').map(({ name }) => ({
    name,
    rows: db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
  }));
  return { schema, tables };
}

function applyOwnershipMigration(db) {
  db.pragma('foreign_keys = ON');
  return runMigrations(db, migrationDirectory);
}

test('ownership migration preserves legacy account and content and initializes a separate Administrator', (t) => {
  const temporaryDirectory = createTemporaryDirectory();
  const db = createLegacyDatabase(path.join(temporaryDirectory, 'admin.db'));
  t.after(() => {
    db.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  const accountBefore = db.prepare('SELECT * FROM auth_users WHERE id = ?').get(ownerId);
  const articleBefore = db.prepare('SELECT * FROM articles WHERE id = ?').get('article-old');
  const tagBefore = db.prepare('SELECT * FROM tags WHERE id = ?').get(17);
  const articleTagBefore = db.prepare('SELECT * FROM article_tags').get();
  const blockBefore = db.prepare('SELECT * FROM article_blocks').get();
  const vocabularyBefore = db.prepare('SELECT * FROM vocabulary').get();
  const analysisBefore = db.prepare('SELECT * FROM article_analyses').get();
  const translationBefore = db.prepare('SELECT * FROM article_translation_cache').get();

  assert.deepEqual(applyOwnershipMigration(db), [
    '001-account-ownership',
    '002-strict-ownership-and-account-status',
  ]);
  assert.deepEqual(applyOwnershipMigration(db), []);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);

  const accountAfter = db.prepare('SELECT * FROM auth_users WHERE id = ?').get(ownerId);
  assert.equal(accountAfter.id, accountBefore.id);
  assert.equal(accountAfter.username, accountBefore.username);
  assert.equal(accountAfter.password_hash, accountBefore.password_hash);
  assert.equal(accountAfter.created_at, accountBefore.created_at);
  assert.equal(accountAfter.updated_at, accountBefore.updated_at);
  assert.equal(accountAfter.role, 'user');

  assert.deepEqual(db.prepare('SELECT * FROM articles WHERE id = ?').get('article-old'),
    { ...articleBefore, user_id: ownerId });
  assert.deepEqual(db.prepare('SELECT * FROM tags WHERE id = ?').get(17),
    { ...tagBefore, user_id: ownerId });
  assert.deepEqual(db.prepare('SELECT * FROM article_tags').get(),
    { ...articleTagBefore, user_id: ownerId });
  assert.deepEqual(db.prepare('SELECT * FROM article_blocks').get(), blockBefore);
  assert.deepEqual(db.prepare('SELECT * FROM vocabulary').get(),
    { ...vocabularyBefore, user_id: ownerId });
  assert.deepEqual(db.prepare('SELECT * FROM article_analyses').get(), analysisBefore);
  assert.deepEqual(db.prepare('SELECT * FROM article_translation_cache').get(), translationBefore);
  assert.equal(db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'tags'").get().seq, 17);
  assert.equal(db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'article_analyses'").get().seq, 23);
  assert.equal(db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'article_translation_cache'").get().seq, 29);

  assert.throws(() => initializeAdministrator(db, {
    username: 'production-owner-not-admin',
    password: 'another secure password',
  }), /already in use/);
  assert.equal(db.prepare('SELECT role FROM auth_users WHERE id = ?').get(ownerId).role, 'user');

  const administratorId = initializeAdministrator(db, {
    username: 'new-administrator',
    password: 'secure test password',
  });
  assert.notEqual(administratorId, ownerId);
  const administrator = db.prepare('SELECT id, username, password_hash, role FROM auth_users WHERE id = ?')
    .get(administratorId);
  assert.equal(administrator.role, 'administrator');
  assert.notEqual(administrator.password_hash, 'secure test password');
  assert.equal(verifyPassword('secure test password', administrator.password_hash), true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM articles WHERE user_id = ?').get(administratorId).count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM tags WHERE user_id = ?').get(administratorId).count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM vocabulary WHERE user_id = ?').get(administratorId).count, 0);
  const administratorHash = administrator.password_hash;
  assert.throws(() => initializeAdministrator(db, {
    username: 'another-administrator',
    password: 'another secure password',
  }), /already initialized/);
  assert.equal(db.prepare('SELECT password_hash FROM auth_users WHERE id = ?').get(administratorId).password_hash,
    administratorHash);
});

test('ownership constraints scope tag and vocabulary uniqueness and reject cross-owner relationships', (t) => {
  const temporaryDirectory = createTemporaryDirectory();
  const db = createLegacyDatabase(path.join(temporaryDirectory, 'admin.db'));
  t.after(() => {
    db.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });
  applyOwnershipMigration(db);

  const secondOwnerId = Number(db.prepare(`INSERT INTO auth_users
    (username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run('second-user', 'scrypt$salt$hash', now, now).lastInsertRowid);
  assert.equal(db.prepare('SELECT role FROM auth_users WHERE id = ?').get(secondOwnerId).role, 'user');
  const articleInsert = db.prepare(`INSERT INTO articles (id, title, content, created_at, updated_at, user_id)
    VALUES (?, ?, ?, ?, ?, ?)`);
  articleInsert.run('article-second-owner', 'Second article', '', now, now, secondOwnerId);

  const tagInsert = db.prepare('INSERT INTO tags (name, created_at, updated_at, user_id) VALUES (?, ?, ?, ?)');
  const firstOwnerTagId = Number(tagInsert.run('shared-tag', now, now, ownerId).lastInsertRowid);
  const secondOwnerTagId = Number(tagInsert.run('shared-tag', now, now, secondOwnerId).lastInsertRowid);
  assert.notEqual(firstOwnerTagId, secondOwnerTagId);
  assert.throws(() => tagInsert.run('SHARED-TAG', now, now, ownerId), /UNIQUE constraint failed/);

  const wordInsert = db.prepare('INSERT INTO vocabulary (id, word, saved_at, user_id) VALUES (?, ?, ?, ?)');
  wordInsert.run('word-owner-one', 'shared-word', now, ownerId);
  wordInsert.run('word-owner-two', 'shared-word', now, secondOwnerId);
  assert.throws(() => wordInsert.run('word-owner-one-duplicate', 'SHARED-WORD', now, ownerId),
    /UNIQUE constraint failed/);

  assert.throws(() => db.prepare(`INSERT INTO article_tags (article_id, tag_id, user_id, created_at)
    VALUES (?, ?, ?, ?)`).run('article-old', secondOwnerTagId, ownerId, now), /FOREIGN KEY constraint failed/);
  assert.throws(() => db.prepare(`INSERT INTO article_tags (article_id, tag_id, user_id, created_at)
    VALUES (?, ?, ?, ?)`).run('article-second-owner', firstOwnerTagId, ownerId, now),
  /FOREIGN KEY constraint failed/);
  assert.throws(() => db.prepare(`INSERT INTO vocabulary (id, word, article_id, saved_at, user_id)
    VALUES (?, ?, ?, ?, ?)`).run('wrong-owner-vocabulary', 'wrong-owner', 'article-second-owner', now, ownerId),
  /Vocabulary article owner mismatch/);

  const legacyWrite = db.prepare(`INSERT INTO articles (id, title, content, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)`);
  assert.throws(() => legacyWrite.run('legacy-api-write', 'Legacy API write', '', now, now), /NOT NULL constraint failed/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM articles WHERE id = ?').get('legacy-api-write').count, 0);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('the Admin migration leaves a separate Guest database schema and contents unchanged', (t) => {
  const temporaryDirectory = createTemporaryDirectory();
  const adminDb = createLegacyDatabase(path.join(temporaryDirectory, 'admin.db'));
  const guestDb = createLegacyDatabase(path.join(temporaryDirectory, 'guest.db'));
  t.after(() => {
    adminDb.close();
    guestDb.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });
  const guestBefore = snapshotDatabase(guestDb);

  applyOwnershipMigration(adminDb);

  assert.deepEqual(snapshotDatabase(guestDb), guestBefore);
  assert.equal(guestDb.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('auth_users') WHERE name = 'role'")
    .get().count, 0);
  assert.equal(adminDb.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('auth_users') WHERE name = 'role'")
    .get().count, 1);
});

test('migration and bootstrap path resolution reject the configured Guest database', (t) => {
  const previousAdminPath = process.env.DATABASE_PATH;
  const previousGuestPath = process.env.GUEST_DATABASE_PATH;
  process.env.DATABASE_PATH = path.join(os.tmpdir(), 'deepread-path-test', 'app.db');
  process.env.GUEST_DATABASE_PATH = path.join(os.tmpdir(), 'deepread-path-test', 'guest.db');
  t.after(() => {
    if (previousAdminPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousAdminPath;
    if (previousGuestPath === undefined) delete process.env.GUEST_DATABASE_PATH;
    else process.env.GUEST_DATABASE_PATH = previousGuestPath;
  });

  assert.equal(resolveAdminDatabasePath(), path.resolve(process.env.DATABASE_PATH));
  assert.throws(() => resolveAdminDatabasePath(process.env.GUEST_DATABASE_PATH), /not guest\.db/);
});

test('the deployment migration CLI applies and skips migrations using isolated Admin paths', (t) => {
  const temporaryDirectory = createTemporaryDirectory();
  const databasePath = path.join(temporaryDirectory, 'admin.db');
  const guestDatabasePath = path.join(temporaryDirectory, 'guest.db');
  const fixture = createLegacyDatabase(databasePath);
  fixture.close();
  let migrated;
  t.after(() => {
    if (migrated) migrated.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  const runCli = () => spawnSync(process.execPath, [
    path.resolve(__dirname, '..', 'scripts', 'migrate.js'),
    '--database-path',
    databasePath,
  ], {
    cwd: path.resolve(__dirname, '..', '..'),
    encoding: 'utf8',
    env: { ...process.env, DATABASE_PATH: databasePath, GUEST_DATABASE_PATH: guestDatabasePath },
  });

  const firstRun = runCli();
  assert.equal(firstRun.status, 0, firstRun.stderr);
  assert.match(firstRun.stdout, /Applied migration: 001-account-ownership/);
  const secondRun = runCli();
  assert.equal(secondRun.status, 0, secondRun.stderr);
  assert.match(secondRun.stdout, /No pending database migrations/);

  migrated = new Database(databasePath);
  migrated.pragma('foreign_keys = ON');
  assert.equal(migrated.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(migrated.prepare("SELECT role FROM auth_users WHERE id = ?").get(ownerId).role, 'user');
  assert.deepEqual(migrated.pragma('foreign_key_check'), []);
});

test('ambiguous legacy ownership aborts before changing the Admin schema or data', (t) => {
  const temporaryDirectory = createTemporaryDirectory();
  const db = createLegacyDatabase(path.join(temporaryDirectory, 'admin.db'), { extraAccount: true });
  t.after(() => {
    db.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });
  const before = snapshotDatabase(db);

  assert.throws(() => applyOwnershipMigration(db), /ambiguous legacy ownership; found 2 accounts/);
  assert.deepEqual(snapshotDatabase(db), before);
});


test('explicit legacy owner receives all historical data when multiple accounts exist', (t) => {
  const temporaryDirectory = createTemporaryDirectory();
  const db = createLegacyDatabase(
    path.join(temporaryDirectory, 'admin.db'),
    { extraAccount: true }
  );

  t.after(() => {
    db.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  const applied = runMigrations(db, migrationDirectory, {
    legacyOwnerId: 91,
  });

  assert.deepEqual(applied, [
    '001-account-ownership',
    '002-strict-ownership-and-account-status',
  ]);

  assert.equal(
    db.prepare('SELECT user_id FROM articles WHERE id = ?')
      .get('article-old').user_id,
    91
  );

  assert.equal(
    db.prepare('SELECT user_id FROM tags WHERE id = ?')
      .get(17).user_id,
    91
  );

  assert.equal(
    db.prepare('SELECT user_id FROM vocabulary WHERE id = ?')
      .get('vocabulary-old').user_id,
    91
  );

  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM article_blocks').get().count,
    1
  );

  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM article_analyses').get().count,
    1
  );

  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM article_translation_cache').get().count,
    1
  );

  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM article_tags').get().count,
    1
  );

  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('a late relationship integrity failure rolls back the migration completely', (t) => {
  const temporaryDirectory = createTemporaryDirectory();
  const db = createLegacyDatabase(path.join(temporaryDirectory, 'admin.db'), { orphanRelationship: true });
  t.after(() => {
    db.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });
  const before = snapshotDatabase(db);

  assert.throws(() => applyOwnershipMigration(db), /CHECK constraint failed/);
  assert.deepEqual(snapshotDatabase(db), before);
  assert.equal(db.prepare("SELECT 1 FROM pragma_table_info('auth_users') WHERE name = 'role'").get(), undefined);
  assert.equal(db.prepare("SELECT 1 FROM pragma_table_info('articles') WHERE name = 'user_id'").get(), undefined);
});
