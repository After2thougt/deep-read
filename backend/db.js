const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const databasePath = path.resolve(process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'app.db'));
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new Database(databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    highlights TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS auth_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS article_tags (
    article_id TEXT NOT NULL,
    tag_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (article_id, tag_id),
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS article_tags_tag_idx ON article_tags (tag_id, article_id);
  CREATE TABLE IF NOT EXISTS article_blocks (
    id TEXT PRIMARY KEY,
    article_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('text', 'image')),
    content TEXT NOT NULL,
    thumbnail TEXT,
    sort_order INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS article_blocks_article_order_idx
    ON article_blocks (article_id, sort_order);
  CREATE TABLE IF NOT EXISTS vocabulary (
    id TEXT PRIMARY KEY,
    word TEXT NOT NULL UNIQUE COLLATE NOCASE,
    definition TEXT,
    phonetic TEXT,
    part_of_speech TEXT,
    example TEXT,
    article_id TEXT,
    saved_at TEXT NOT NULL,
    next_review TEXT,
    review_count INTEGER NOT NULL DEFAULT 0,
    ease_factor REAL NOT NULL DEFAULT 2.5,
    interval INTEGER NOT NULL DEFAULT 0,
    context_line TEXT,
    raw TEXT,
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS articles_updated_at_idx ON articles (updated_at DESC);
  CREATE INDEX IF NOT EXISTS vocabulary_saved_at_idx ON vocabulary (saved_at DESC);
  CREATE TABLE IF NOT EXISTS article_analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id TEXT NOT NULL,
    page_number INTEGER NOT NULL DEFAULT 1,
    content_hash TEXT NOT NULL,
    analysis TEXT NOT NULL,
    model TEXT,
    prompt_version TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
    UNIQUE (article_id, page_number, content_hash, prompt_version)
  );
  CREATE INDEX IF NOT EXISTS article_analyses_lookup_idx
    ON article_analyses (article_id, content_hash, prompt_version);
`);

try { db.exec('ALTER TABLE article_analyses ADD COLUMN page_number INTEGER NOT NULL DEFAULT 1'); } catch (error) { if (!/duplicate column/i.test(error.message)) throw error; }
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS article_analyses_page_lookup_idx
  ON article_analyses (article_id, page_number, content_hash, prompt_version);
  CREATE TABLE IF NOT EXISTS article_translation_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    target TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'auto',
    provider TEXT NOT NULL DEFAULT 'deeplx',
    translation TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
    UNIQUE (article_id, page_number, content_hash, source, target, provider)
  );`);

try {
  db.exec(
    'ALTER TABLE vocabulary ADD COLUMN start_offset INTEGER'
  );
} catch (error) {
  if (!/duplicate column/i.test(error.message)) throw error;
}

try {
  db.exec(
    'ALTER TABLE vocabulary ADD COLUMN end_offset INTEGER'
  );
} catch (error) {
  if (!/duplicate column/i.test(error.message)) throw error;
}

// Migration: add thumbnail column to article_blocks
try {
  db.exec('ALTER TABLE article_blocks ADD COLUMN thumbnail TEXT');
} catch (error) {
  if (!/duplicate column/i.test(error.message)) throw error;
}

try { db.exec("ALTER TABLE article_translation_cache ADD COLUMN source TEXT NOT NULL DEFAULT 'auto'"); } catch (error) { if (!/duplicate column/i.test(error.message)) throw error; }
try { db.exec("ALTER TABLE article_translation_cache ADD COLUMN provider TEXT NOT NULL DEFAULT 'deeplx'"); } catch (error) { if (!/duplicate column/i.test(error.message)) throw error; }

const translationCacheIndexes = db.prepare("PRAGMA index_list('article_translation_cache')").all();
const hasSourceInTranslationCacheKey = translationCacheIndexes
  .filter((index) => index.unique)
  .some((index) => db.prepare(`PRAGMA index_info('${index.name.replace(/'/g, "''")}')`).all().map((column) => column.name).join(',') === 'article_id,page_number,content_hash,source,target,provider');

if (!hasSourceInTranslationCacheKey) {
  db.exec(`
    BEGIN;
    CREATE TABLE article_translation_cache_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id TEXT NOT NULL,
      page_number INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      target TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'auto',
      provider TEXT NOT NULL DEFAULT 'deeplx',
      translation TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
      UNIQUE (article_id, page_number, content_hash, source, target, provider)
    );
    INSERT INTO article_translation_cache_v2 (id, article_id, page_number, content_hash, target, source, provider, translation, created_at, updated_at)
      SELECT id, article_id, page_number, content_hash, target, source, provider, translation, created_at, updated_at
      FROM article_translation_cache;
    DROP TABLE article_translation_cache;
    ALTER TABLE article_translation_cache_v2 RENAME TO article_translation_cache;
    COMMIT;
  `);
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function serializeArticle(row) {
  return { ...row, highlights: parseJson(row.highlights, []) };
}

function serializeVocabulary(row) {
  return row ? { ...row, raw: parseJson(row.raw, null) } : row;
}

// Startup: log migration status
const hasThumbnail = db.prepare("PRAGMA table_info('article_blocks')").all().some(c => c.name === 'thumbnail');
console.log(`[DB Migration] article_blocks.thumbnail column: ${hasThumbnail ? 'EXISTS' : 'MISSING'}`);

module.exports = { db, databasePath, serializeArticle, serializeVocabulary };
