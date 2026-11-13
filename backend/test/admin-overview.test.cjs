const assert = require('node:assert/strict');
const { test } = require('node:test');
const Database = require('better-sqlite3');
const { getAdministratorOverview } = require('../admin-overview');

function createAccountsDatabase() {
  const database = new Database(':memory:');
  database.exec(`CREATE TABLE auth_users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    is_active INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    session_token TEXT
  )`);
  return database;
}

function insertAccount(database, {
  id,
  username,
  role,
  isActive = 1,
  createdAt,
}) {
  database.prepare(`INSERT INTO auth_users
    (id, username, password_hash, role, is_active, created_at, updated_at, session_token)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, username, 'test-hash-must-not-be-returned', role, isActive, createdAt, createdAt, 'test-session');
}

test('administrator overview counts only regular accounts and returns the latest five safe fields', (t) => {
  const adminDatabase = createAccountsDatabase();
  const guestDatabase = createAccountsDatabase();
  t.after(() => {
    adminDatabase.close();
    guestDatabase.close();
  });

  for (let index = 1; index <= 7; index += 1) {
    insertAccount(adminDatabase, {
      id: index,
      username: `user-${index}`,
      role: 'user',
      isActive: index % 2,
      createdAt: `2026-01-0${index}T00:00:00.000Z`,
    });
  }
  insertAccount(adminDatabase, {
    id: 8,
    username: 'admin-account',
    role: 'administrator',
    createdAt: '2026-01-08T00:00:00.000Z',
  });
  insertAccount(adminDatabase, {
    id: 9,
    username: 'disabled-administrator',
    role: 'administrator',
    isActive: 0,
    createdAt: '2026-01-09T00:00:00.000Z',
  });
  insertAccount(guestDatabase, {
    id: 1,
    username: 'guest-account',
    role: 'user',
    createdAt: '2026-01-10T00:00:00.000Z',
  });

  const overview = getAdministratorOverview(adminDatabase);
  assert.deepEqual(overview.stats, {
    totalUsers: 7,
    activeUsers: 4,
    disabledUsers: 3,
    administrators: 2,
  });
  assert.deepEqual(overview.recentUsers.map(({ username }) => username), [
    'user-7', 'user-6', 'user-5', 'user-4', 'user-3',
  ]);
  assert.equal(overview.recentUsers.length, 5);
  assert.deepEqual(Object.keys(overview.recentUsers[0]).sort(), ['createdAt', 'username']);
  assert.ok(overview.recentUsers.every((user) => !Object.hasOwn(user, 'password_hash')));
  assert.ok(overview.recentUsers.every((user) => !Object.hasOwn(user, 'session_token')));
});

test('administrator overview handles zero regular users without invalid counts', (t) => {
  const adminDatabase = createAccountsDatabase();
  const guestDatabase = createAccountsDatabase();
  t.after(() => {
    adminDatabase.close();
    guestDatabase.close();
  });

  insertAccount(adminDatabase, {
    id: 1,
    username: 'administrator',
    role: 'administrator',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  insertAccount(guestDatabase, {
    id: 1,
    username: 'guest-account',
    role: 'user',
    createdAt: '2026-01-02T00:00:00.000Z',
  });

  const overview = getAdministratorOverview(adminDatabase);
  assert.deepEqual(overview.stats, {
    totalUsers: 0,
    activeUsers: 0,
    disabledUsers: 0,
    administrators: 1,
  });
  assert.deepEqual(overview.recentUsers, []);
});
