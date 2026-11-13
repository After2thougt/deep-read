CREATE TEMP TABLE ownership_migration_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
);

INSERT INTO ownership_migration_guard (valid)
SELECT CASE WHEN COUNT(*) = 1 THEN 1 ELSE 0 END
FROM auth_users
WHERE id = __LEGACY_OWNER_ID__;
DROP TABLE ownership_migration_guard;

CREATE TEMP TABLE ownership_migration_owner (id INTEGER PRIMARY KEY);
INSERT INTO ownership_migration_owner (id)
SELECT id FROM auth_users
WHERE id = __LEGACY_OWNER_ID__;

CREATE TEMP TABLE ownership_migration_articles AS SELECT * FROM articles;
CREATE TEMP TABLE ownership_migration_tags AS SELECT * FROM tags;
CREATE TEMP TABLE ownership_migration_article_tags AS SELECT * FROM article_tags;
CREATE TEMP TABLE ownership_migration_article_blocks AS SELECT * FROM article_blocks;
CREATE TEMP TABLE ownership_migration_vocabulary AS SELECT * FROM vocabulary;
CREATE TEMP TABLE ownership_migration_analyses AS SELECT * FROM article_analyses;
CREATE TEMP TABLE ownership_migration_translations AS SELECT * FROM article_translation_cache;
CREATE TEMP TABLE ownership_migration_sequences AS
  SELECT name, seq FROM sqlite_sequence
  WHERE name IN ('tags', 'article_analyses', 'article_translation_cache');

ALTER TABLE auth_users
  ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'administrator'));
UPDATE auth_users SET role = 'user';

DROP TABLE article_tags;
DROP TABLE article_blocks;
DROP TABLE vocabulary;
DROP TABLE article_analyses;
DROP TABLE article_translation_cache;
DROP TABLE tags;
DROP TABLE articles;

CREATE TABLE articles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  highlights TEXT NOT NULL DEFAULT '[]',
  source_name TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  source_author TEXT NOT NULL DEFAULT '',
  source_published_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  user_id INTEGER NOT NULL DEFAULT __LEGACY_OWNER_ID__,
  FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE RESTRICT,
  UNIQUE (id, user_id)
);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  user_id INTEGER NOT NULL DEFAULT __LEGACY_OWNER_ID__,
  FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE RESTRICT,
  UNIQUE (user_id, name COLLATE NOCASE),
  UNIQUE (id, user_id)
);

CREATE TABLE article_tags (
  article_id TEXT NOT NULL,
  tag_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL DEFAULT __LEGACY_OWNER_ID__,
  created_at TEXT NOT NULL,
  PRIMARY KEY (article_id, tag_id),
  FOREIGN KEY (article_id, user_id) REFERENCES articles(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id, user_id) REFERENCES tags(id, user_id) ON DELETE CASCADE
);

CREATE TABLE article_blocks (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('text', 'image')),
  content TEXT NOT NULL,
  thumbnail TEXT,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE TABLE vocabulary (
  id TEXT PRIMARY KEY,
  word TEXT NOT NULL COLLATE NOCASE,
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
  start_offset INTEGER,
  end_offset INTEGER,
  user_id INTEGER NOT NULL DEFAULT __LEGACY_OWNER_ID__,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE RESTRICT,
  UNIQUE (user_id, word COLLATE NOCASE)
);

CREATE TABLE article_analyses (
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

CREATE TABLE article_translation_cache (
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

INSERT INTO articles (
  id, title, content, highlights, source_name, source_url, source_author,
  source_published_at, created_at, updated_at, user_id
)
SELECT id, title, content, highlights, source_name, source_url, source_author,
  source_published_at, created_at, updated_at, (SELECT id FROM ownership_migration_owner)
FROM ownership_migration_articles;

INSERT INTO tags (id, name, created_at, updated_at, user_id)
SELECT id, name, created_at, updated_at, (SELECT id FROM ownership_migration_owner)
FROM ownership_migration_tags;

CREATE TEMP TABLE ownership_migration_relationship_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
);

INSERT INTO ownership_migration_relationship_guard (valid)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM ownership_migration_article_tags) =
  (
    SELECT COUNT(*)
    FROM ownership_migration_article_tags AS relation
    JOIN articles AS article ON article.id = relation.article_id
    JOIN tags AS tag ON tag.id = relation.tag_id AND tag.user_id = article.user_id
  )
THEN 1 ELSE 0 END;
DROP TABLE ownership_migration_relationship_guard;

INSERT INTO article_tags (article_id, tag_id, user_id, created_at)
SELECT relation.article_id, relation.tag_id, article.user_id, relation.created_at
FROM ownership_migration_article_tags AS relation
JOIN articles AS article ON article.id = relation.article_id
JOIN tags AS tag ON tag.id = relation.tag_id AND tag.user_id = article.user_id;

INSERT INTO article_blocks (id, article_id, type, content, thumbnail, sort_order, created_at)
SELECT id, article_id, type, content, thumbnail, sort_order, created_at
FROM ownership_migration_article_blocks;

INSERT INTO vocabulary (
  id, word, definition, phonetic, part_of_speech, example, article_id, saved_at,
  next_review, review_count, ease_factor, interval, context_line, raw, start_offset,
  end_offset, user_id
)
SELECT id, word, definition, phonetic, part_of_speech, example, article_id, saved_at,
  next_review, review_count, ease_factor, interval, context_line, raw, start_offset,
  end_offset, (SELECT id FROM ownership_migration_owner)
FROM ownership_migration_vocabulary;

INSERT INTO article_analyses (
  id, article_id, page_number, content_hash, analysis, model, prompt_version, created_at, updated_at
)
SELECT id, article_id, page_number, content_hash, analysis, model, prompt_version, created_at, updated_at
FROM ownership_migration_analyses;

INSERT INTO article_translation_cache (
  id, article_id, page_number, content_hash, target, source, provider, translation, created_at, updated_at
)
SELECT id, article_id, page_number, content_hash, target, source, provider, translation, created_at, updated_at
FROM ownership_migration_translations;

CREATE INDEX articles_updated_at_idx ON articles (updated_at DESC);
CREATE INDEX articles_user_updated_at_idx ON articles (user_id, updated_at DESC);
CREATE INDEX article_tags_tag_idx ON article_tags (tag_id, article_id);
CREATE INDEX article_blocks_article_order_idx ON article_blocks (article_id, sort_order);
CREATE INDEX vocabulary_saved_at_idx ON vocabulary (saved_at DESC);
CREATE INDEX vocabulary_user_saved_at_idx ON vocabulary (user_id, saved_at DESC);
CREATE INDEX article_analyses_lookup_idx ON article_analyses (article_id, content_hash, prompt_version);
CREATE UNIQUE INDEX article_analyses_page_lookup_idx
  ON article_analyses (article_id, page_number, content_hash, prompt_version);

CREATE TRIGGER vocabulary_article_owner_insert
BEFORE INSERT ON vocabulary
WHEN NEW.article_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM articles WHERE id = NEW.article_id AND user_id = NEW.user_id
  )
BEGIN
  SELECT RAISE(ABORT, 'Vocabulary article owner mismatch');
END;

CREATE TRIGGER vocabulary_article_owner_update
BEFORE UPDATE OF article_id, user_id ON vocabulary
WHEN NEW.article_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM articles WHERE id = NEW.article_id AND user_id = NEW.user_id
  )
BEGIN
  SELECT RAISE(ABORT, 'Vocabulary article owner mismatch');
END;

UPDATE sqlite_sequence
SET seq = MAX(seq, (SELECT seq FROM ownership_migration_sequences WHERE name = sqlite_sequence.name))
WHERE name IN (SELECT name FROM ownership_migration_sequences);

INSERT INTO sqlite_sequence (name, seq)
SELECT old.name, old.seq
FROM ownership_migration_sequences AS old
WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = old.name);

DROP TABLE ownership_migration_sequences;
DROP TABLE ownership_migration_translations;
DROP TABLE ownership_migration_analyses;
DROP TABLE ownership_migration_vocabulary;
DROP TABLE ownership_migration_article_blocks;
DROP TABLE ownership_migration_article_tags;
DROP TABLE ownership_migration_tags;
DROP TABLE ownership_migration_articles;
DROP TABLE ownership_migration_owner;
