const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const Database = require('better-sqlite3');

const databaseContext = new AsyncLocalStorage();
const databasePath = path.resolve(process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'app.db'));
const guestDatabasePath = path.resolve(process.env.GUEST_DATABASE_PATH || path.join(path.dirname(databasePath), 'guest.db'));

const schemaSql = `
  CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
    highlights TEXT NOT NULL DEFAULT '[]', source_name TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL DEFAULT '', source_author TEXT NOT NULL DEFAULT '',
    source_published_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS auth_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL COLLATE BINARY UNIQUE,
    password_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS article_tags (
    article_id TEXT NOT NULL, tag_id INTEGER NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY (article_id, tag_id),
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS article_tags_tag_idx ON article_tags (tag_id, article_id);
  CREATE TABLE IF NOT EXISTS article_blocks (
    id TEXT PRIMARY KEY, article_id TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('text', 'image')),
    content TEXT NOT NULL, thumbnail TEXT, sort_order INTEGER NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS article_blocks_article_order_idx ON article_blocks (article_id, sort_order);
  CREATE TABLE IF NOT EXISTS vocabulary (
    id TEXT PRIMARY KEY, word TEXT NOT NULL UNIQUE COLLATE NOCASE, definition TEXT, phonetic TEXT,
    part_of_speech TEXT, example TEXT, article_id TEXT, saved_at TEXT NOT NULL, next_review TEXT,
    review_count INTEGER NOT NULL DEFAULT 0, ease_factor REAL NOT NULL DEFAULT 2.5,
    interval INTEGER NOT NULL DEFAULT 0, context_line TEXT, raw TEXT,
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS articles_updated_at_idx ON articles (updated_at DESC);
  CREATE INDEX IF NOT EXISTS vocabulary_saved_at_idx ON vocabulary (saved_at DESC);
  CREATE TABLE IF NOT EXISTS article_analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT, article_id TEXT NOT NULL, page_number INTEGER NOT NULL DEFAULT 1,
    content_hash TEXT NOT NULL, analysis TEXT NOT NULL, model TEXT, prompt_version TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
    UNIQUE (article_id, page_number, content_hash, prompt_version)
  );
  CREATE INDEX IF NOT EXISTS article_analyses_lookup_idx ON article_analyses (article_id, content_hash, prompt_version);
  CREATE TABLE IF NOT EXISTS article_translation_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT, article_id TEXT NOT NULL, page_number INTEGER NOT NULL,
    content_hash TEXT NOT NULL, target TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'auto',
    provider TEXT NOT NULL DEFAULT 'deeplx', translation TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
    UNIQUE (article_id, page_number, content_hash, source, target, provider)
  );`;

  function migrateUsernameCollation(db) {
  const table = db.prepare(`
    SELECT sql
    FROM sqlite_master
    WHERE type = 'table' AND name = 'auth_users'
  `).get();

  if (!table?.sql || !/COLLATE\s+NOCASE/i.test(table.sql)) {
    return;
  }

  const columns = db.pragma('table_info(auth_users)');
  const hasRole = columns.some((column) => column.name === 'role');
  const hasIsActive = columns.some((column) => column.name === 'is_active');

  const extraColumns = [
    hasRole
      ? ", role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'administrator'))"
      : '',
    hasIsActive
      ? ', is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))'
      : '',
  ].join('');

  const columnNames = [
    'id',
    'username',
    'password_hash',
    'created_at',
    'updated_at',
    ...(hasRole ? ['role'] : []),
    ...(hasIsActive ? ['is_active'] : []),
  ];

  const columnList = columnNames.map((name) => `"${name}"`).join(', ');

  if (db.pragma('foreign_keys', { simple: true }) !== 1) {
    throw new Error('SQLite foreign-key enforcement must be enabled before username migration.');
  }

  // SQLite requires foreign-key enforcement to be disabled
  // before starting the table-rebuild transaction.
  db.pragma('foreign_keys = OFF');

  try {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE auth_users_case_sensitive (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL COLLATE BINARY UNIQUE,
          password_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
          ${extraColumns}
        );

        INSERT INTO auth_users_case_sensitive (${columnList})
        SELECT ${columnList}
        FROM auth_users;

        DROP TABLE auth_users;

        ALTER TABLE auth_users_case_sensitive
        RENAME TO auth_users;
      `);
    }).immediate();
  } finally {
    // Always restore foreign-key enforcement, including after rollback.
    db.pragma('foreign_keys = ON');
  }

  const violations = db.pragma('foreign_key_check');

  if (violations.length) {
    throw new Error(
      `Username migration produced ${violations.length} foreign-key violation(s).`
    );
  }

  console.log('[DB] Migrated auth_users to case-sensitive usernames.');
}

function migrate(db) {
  db.exec(schemaSql);

  migrateUsernameCollation(db);
  for (const statement of [
    'ALTER TABLE article_analyses ADD COLUMN page_number INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE vocabulary ADD COLUMN start_offset INTEGER',
    'ALTER TABLE vocabulary ADD COLUMN end_offset INTEGER',
    'ALTER TABLE article_blocks ADD COLUMN thumbnail TEXT',
    "ALTER TABLE articles ADD COLUMN source_name TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE articles ADD COLUMN source_url TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE articles ADD COLUMN source_author TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE articles ADD COLUMN source_published_at TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE article_translation_cache ADD COLUMN source TEXT NOT NULL DEFAULT 'auto'",
    "ALTER TABLE article_translation_cache ADD COLUMN provider TEXT NOT NULL DEFAULT 'deeplx'",
  ]) {
    try { db.exec(statement); } catch (error) { if (!/duplicate column/i.test(error.message)) throw error; }
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS article_analyses_page_lookup_idx
    ON article_analyses (article_id, page_number, content_hash, prompt_version);`);
  const indexes = db.prepare("PRAGMA index_list('article_translation_cache')").all();
  const hasTranslationKey = indexes.filter((index) => index.unique).some((index) =>
    db.prepare(`PRAGMA index_info('${index.name.replace(/'/g, "''")}')`).all().map((column) => column.name).join(',') === 'article_id,page_number,content_hash,source,target,provider');
  if (!hasTranslationKey) {
    db.exec(`
      BEGIN;
      CREATE TABLE article_translation_cache_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT, article_id TEXT NOT NULL, page_number INTEGER NOT NULL,
        content_hash TEXT NOT NULL, target TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'auto',
        provider TEXT NOT NULL DEFAULT 'deeplx', translation TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
        UNIQUE (article_id, page_number, content_hash, source, target, provider)
      );
      INSERT INTO article_translation_cache_v2 SELECT id, article_id, page_number, content_hash, target, source, provider, translation, created_at, updated_at FROM article_translation_cache;
      DROP TABLE article_translation_cache;
      ALTER TABLE article_translation_cache_v2 RENAME TO article_translation_cache;
      COMMIT;`);
  }
}

function openDatabase(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const connection = new Database(filePath);
  connection.pragma('journal_mode = WAL');
  connection.pragma('foreign_keys = ON');
  migrate(connection);
  return connection;
}

const adminDb = openDatabase(databasePath);
const guestDb = openDatabase(guestDatabasePath);
const db = new Proxy(adminDb, {
  get(target, property) {
    const active = databaseContext.getStore()?.db || target;
    const value = active[property];
    return typeof value === 'function' ? value.bind(active) : value;
  },
});

function runWithDatabase(connection, callback) {
  return databaseContext.run({ db: connection }, callback);
}

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function serializeArticle(row) {
  return {
    ...row,
    highlights: parseJson(row.highlights, []),
    sourceMetadata: {
      sourceName: row.source_name || '',
      sourceUrl: row.source_url || '',
      sourceAuthor: row.source_author || '',
      sourcePublishedAt: row.source_published_at || '',
    },
  };
}
function serializeVocabulary(row) { return row ? { ...row, raw: parseJson(row.raw, null) } : row; }

console.log(`[DB] admin=${databasePath}`);
console.log(`[DB] guest=${guestDatabasePath}`);

module.exports = { db, adminDb, guestDb, databasePath, guestDatabasePath, runWithDatabase, serializeArticle, serializeVocabulary };
