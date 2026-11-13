const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const Database = require('better-sqlite3');
const { assertAdminDatabaseReady } = require('../database-readiness');

function openTemporaryDatabase(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepread-readiness-'));
  const db = new Database(path.join(directory, 'admin.db'));
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return db;
}

test('legacy Admin schema fails readiness with the explicit migration command and is unchanged', (t) => {
  const db = openTemporaryDatabase(t);
  db.exec(`CREATE TABLE auth_users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL
  )`);
  db.prepare('INSERT INTO auth_users (id, username, password_hash) VALUES (?, ?, ?)')
    .run(41, 'existing-user', 'preserved-hash');

  assert.throws(
    () => assertAdminDatabaseReady(db),
    /missing migrations: 001-account-ownership, 002-strict-ownership-and-account-status.*npm --prefix backend run db:migrate/,
  );
  assert.deepEqual(db.prepare('SELECT * FROM auth_users').all(), [
    { id: 41, username: 'existing-user', password_hash: 'preserved-hash' },
  ]);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'migrations'").get(), undefined);
});

test('migrated Admin schema passes readiness', (t) => {
  const db = openTemporaryDatabase(t);
  db.exec(`CREATE TABLE auth_users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    is_active INTEGER NOT NULL
  );
  CREATE TABLE migrations (id TEXT PRIMARY KEY);
  INSERT INTO migrations (id) VALUES
    ('001-account-ownership'),
    ('002-strict-ownership-and-account-status');`);

  assert.doesNotThrow(() => assertAdminDatabaseReady(db));
});

test('readiness rejects migration markers when required auth columns are missing', (t) => {
  const db = openTemporaryDatabase(t);
  db.exec(`CREATE TABLE auth_users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL
  );
  CREATE TABLE migrations (id TEXT PRIMARY KEY);
  INSERT INTO migrations (id) VALUES
    ('001-account-ownership'),
    ('002-strict-ownership-and-account-status');`);

  assert.throws(
    () => assertAdminDatabaseReady(db),
    /missing auth_users columns: role, is_active.*npm --prefix backend run db:migrate/,
  );
});

test('server exits before listening when the configured Admin database is unmigrated', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepread-startup-readiness-'));
  const adminPath = path.join(directory, 'admin.db');
  const guestPath = path.join(directory, 'guest.db');
  const legacyDb = new Database(adminPath);
  legacyDb.exec(`CREATE TABLE auth_users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  legacyDb.prepare(`INSERT INTO auth_users
    (id, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run(41, 'existing-user', 'preserved-hash', 'created', 'updated');
  legacyDb.close();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const result = spawnSync(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: '0',
      DATABASE_PATH: adminPath,
      GUEST_DATABASE_PATH: guestPath,
      AUTH_USERNAME: 'startup-user',
      AUTH_PASSWORD: 'startup-password',
      GUEST_USERNAME: '',
      GUEST_PASSWORD: '',
    },
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  assert.equal(result.status, 1, output);
  assert.match(output, /Admin database schema is not ready/);
  assert.match(output, /npm --prefix backend run db:migrate/);
  assert.doesNotMatch(output, /Server listening on/);
  const after = new Database(adminPath, { readonly: true });
  assert.deepEqual(after.prepare('SELECT id, username, password_hash FROM auth_users').all(), [
    { id: 41, username: 'existing-user', password_hash: 'preserved-hash' },
  ]);
  after.close();
});
