const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const Database = require('better-sqlite3');
const {
  getGuestSystemAccount,
  initializeGuestAccessSettings,
  isGuestAccessEnabled,
  setGuestAccessEnabled,
} = require('../guest-management');

test('Guest access defaults to enabled and its status persists in the Admin database', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepread-guest-status-'));
  const databasePath = path.join(directory, 'admin.db');
  let database = new Database(databasePath);
  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  initializeGuestAccessSettings(database);
  assert.equal(isGuestAccessEnabled(database), true);
  assert.equal(setGuestAccessEnabled(database, false), false);
  database.close();

  database = new Database(databasePath);
  initializeGuestAccessSettings(database);
  assert.equal(isGuestAccessEnabled(database), false);
});

test('Guest system account reports one shared identity, live sessions, and Guest database counts', (t) => {
  const adminDatabase = new Database(':memory:');
  const guestDatabase = new Database(':memory:');
  t.after(() => {
    adminDatabase.close();
    guestDatabase.close();
  });
  initializeGuestAccessSettings(adminDatabase);
  guestDatabase.exec(`CREATE TABLE auth_users (username TEXT PRIMARY KEY);
    CREATE TABLE articles (id INTEGER PRIMARY KEY);
    CREATE TABLE tags (id INTEGER PRIMARY KEY);
    CREATE TABLE vocabulary (id INTEGER PRIMARY KEY);`);
  guestDatabase.prepare('INSERT INTO auth_users (username) VALUES (?), (?)')
    .run('configured-guest', 'extra-record');
  guestDatabase.prepare('INSERT INTO articles DEFAULT VALUES').run();
  guestDatabase.prepare('INSERT INTO tags DEFAULT VALUES').run();
  guestDatabase.prepare('INSERT INTO vocabulary DEFAULT VALUES').run();

  const previousGuestUsername = process.env.GUEST_USERNAME;
  process.env.GUEST_USERNAME = 'configured-guest';
  t.after(() => {
    if (previousGuestUsername === undefined) delete process.env.GUEST_USERNAME;
    else process.env.GUEST_USERNAME = previousGuestUsername;
  });

  const sessions = new Map([
    ['guest-active', { database: guestDatabase, expiresAt: 200 }],
    ['guest-expired', { database: guestDatabase, expiresAt: 99 }],
    ['admin-active', { database: adminDatabase, expiresAt: 200 }],
  ]);
  const account = getGuestSystemAccount(adminDatabase, guestDatabase, sessions, 100);
  assert.equal(account.account_count, 1);
  assert.equal(account.active_sessions, 1);
  assert.equal(account.database, 'Guest Database');
  assert.deepEqual(account.database_stats, { articles: 1, tags: 1, vocabulary: 1 });
  assert.equal(account.login_configured, true);
  assert.deepEqual(Object.keys(account).sort(), [
    'account_count',
    'active_sessions',
    'created_at',
    'database',
    'database_stats',
    'id',
    'is_active',
    'login_configured',
    'role',
    'username',
  ]);
});
