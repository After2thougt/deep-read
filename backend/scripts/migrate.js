const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { resolveAdminDatabasePath } = require('./admin-database-path');

const LEGACY_OWNER_TOKEN = '__LEGACY_OWNER_ID__';

function runMigrations(db, migrationsDirectory) {
  if (db.pragma('foreign_keys', { simple: true }) !== 1) {
    throw new Error('SQLite foreign-key enforcement must be enabled before migrations run.');
  }

  const migrationFiles = fs.readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  const applied = [];

  for (const filename of migrationFiles) {
    const migrationId = filename.slice(0, -4);
    const applyMigration = db.transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
      if (db.prepare('SELECT 1 FROM migrations WHERE id = ?').get(migrationId)) return false;

      let sql = fs.readFileSync(path.join(migrationsDirectory, filename), 'utf8');
      if (sql.includes(LEGACY_OWNER_TOKEN)) {
        const authTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'auth_users'").get();
        if (!authTable) throw new Error(`${migrationId} requires the existing Admin auth_users table.`);
        const accounts = db.prepare('SELECT id FROM auth_users ORDER BY id').all();
        if (accounts.length !== 1) {
          throw new Error(`${migrationId} requires exactly one existing Admin account; found ${accounts.length}.`);
        }
        sql = sql.replaceAll(LEGACY_OWNER_TOKEN, String(accounts[0].id));
      }

      db.exec(sql);
      const violations = db.pragma('foreign_key_check');
      if (violations.length) {
        throw new Error(`${migrationId} produced ${violations.length} foreign-key violation(s).`);
      }
      db.prepare('INSERT INTO migrations (id) VALUES (?)').run(migrationId);
      return true;
    });

    if (applyMigration.immediate()) applied.push(migrationId);
  }

  return applied;
}

function loadEnvironment() {
  const backendDirectory = path.resolve(__dirname, '..');
  require('dotenv').config({ path: path.resolve(backendDirectory, '..', '.env') });
  require('dotenv').config({ path: path.join(backendDirectory, '.env') });
}

function parseDatabasePath(args) {
  const index = args.indexOf('--database-path');
  const explicitPath = index >= 0 ? args[index + 1] : undefined;
  if (explicitPath?.startsWith('--')) {
    throw new Error('Provide a path after --database-path.');
  }
  const resolvedPath = resolveAdminDatabasePath(explicitPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Database file does not exist: ${resolvedPath}`);
  }
  return resolvedPath;
}

function main() {
  loadEnvironment();
  const databasePath = parseDatabasePath(process.argv.slice(2));
  const db = new Database(databasePath);
  try {
    db.pragma('foreign_keys = ON');
    const migrationsDirectory = path.resolve(__dirname, '..', '..', 'deploy', 'migrations');
    const applied = runMigrations(db, migrationsDirectory);
    for (const migrationId of applied) console.log(`Applied migration: ${migrationId}`);
    if (applied.length === 0) console.log('No pending database migrations.');
  } finally {
    db.close();
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[migration] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { runMigrations };
