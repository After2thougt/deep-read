const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const Database = require('better-sqlite3');
const { hashPassword } = require('../password');
const { resolveAdminDatabasePath } = require('./admin-database-path');

const REQUIRED_MIGRATIONS = [
  '001-account-ownership',
  '002-strict-ownership-and-account-status',
];

function assertAdministratorBootstrapReady(db) {
  const columns = new Set(db.pragma("table_info('auth_users')").map((column) => column.name));
  const migrationTable = db.prepare(`SELECT 1 FROM sqlite_master
    WHERE type = 'table' AND name = 'migrations'`).get();
  const appliedMigrations = migrationTable
    ? new Set(db.prepare('SELECT id FROM migrations').all().map(({ id }) => id))
    : new Set();
  const missingMigrations = REQUIRED_MIGRATIONS.filter((id) => !appliedMigrations.has(id));
  const missingColumns = ['role', 'is_active'].filter((column) => !columns.has(column));
  if (missingMigrations.length || missingColumns.length) {
    throw new Error('Apply all account ownership migrations before bootstrapping an Administrator.');
  }
}

function initializeAdministrator(db, { username, password }) {
  const normalizedUsername = String(username || '').trim();
  const normalizedPassword = String(password || '');
  if (!normalizedUsername) throw new Error('An Administrator username is required.');
  if (normalizedPassword.length < 8) throw new Error('The Administrator password must be at least 8 characters.');

  const insertAdministrator = db.transaction(() => {
    assertAdministratorBootstrapReady(db);
    const existingAdministrator = db.prepare("SELECT 1 FROM auth_users WHERE role = 'administrator' LIMIT 1").get();
    if (existingAdministrator) throw new Error('An Administrator is already initialized.');

    const existingUsername = db.prepare('SELECT 1 FROM auth_users WHERE username = ?').get(normalizedUsername);
    if (existingUsername) throw new Error('That username is already in use.');

    const now = new Date().toISOString();
    const result = db.prepare(
      'INSERT INTO auth_users (username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(normalizedUsername, hashPassword(normalizedPassword), 'administrator', now, now);
    return Number(result.lastInsertRowid);
  });

  return insertAdministrator.immediate();
}

function promptVisible(input, output, message) {
  const interfaceInstance = readline.createInterface({ input, output });
  return new Promise((resolve) => interfaceInstance.question(message, (answer) => {
    interfaceInstance.close();
    resolve(answer);
  }));
}

function promptHidden(input, output, message) {
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    return Promise.reject(new Error('Administrator bootstrap requires an interactive terminal for password entry.'));
  }

  return new Promise((resolve, reject) => {
    let password = '';
    const onData = (chunk) => {
      for (const character of String(chunk)) {
        if (character === '\u0003') {
          cleanup();
          reject(new Error('Administrator bootstrap cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          output.write('\n');
          resolve(password);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          password = password.slice(0, -1);
        } else if (character >= ' ') {
          password += character;
        }
      }
    };
    const cleanup = () => {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
    };

    output.write(message);
    input.setEncoding('utf8');
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

function loadEnvironment() {
  const backendDirectory = path.resolve(__dirname, '..');
  require('dotenv').config({ path: path.resolve(backendDirectory, '..', '.env') });
  require('dotenv').config({ path: path.join(backendDirectory, '.env') });
}

async function main() {
  loadEnvironment();
  if (!process.env.DATABASE_PATH) {
    throw new Error('Set DATABASE_PATH to the Admin database before bootstrapping an Administrator.');
  }
  const databasePath = resolveAdminDatabasePath();
  if (!fs.existsSync(databasePath)) throw new Error('The configured Admin database does not exist.');

  const db = new Database(databasePath);
  try {
    db.pragma('foreign_keys = ON');
    assertAdministratorBootstrapReady(db);
    if (db.prepare("SELECT 1 FROM auth_users WHERE role = 'administrator' LIMIT 1").get()) {
      throw new Error('An Administrator is already initialized.');
    }

    const username = await promptVisible(process.stdin, process.stdout, 'New Administrator username: ');
    if (db.prepare('SELECT 1 FROM auth_users WHERE username = ?').get(username.trim())) {
      throw new Error('That username is already in use.');
    }
    const password = await promptHidden(process.stdin, process.stdout, 'New Administrator password (input hidden): ');
    const confirmation = await promptHidden(process.stdin, process.stdout, 'Confirm password (input hidden): ');
    if (password !== confirmation) throw new Error('The passwords did not match.');

    initializeAdministrator(db, { username, password });
  } finally {
    db.close();
  }
  console.log('Administrator initialized. No credentials were displayed.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[administrator bootstrap] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { assertAdministratorBootstrapReady, initializeAdministrator };
