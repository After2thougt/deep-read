const REQUIRED_ADMIN_MIGRATIONS = [
  '001-account-ownership',
  '002-strict-ownership-and-account-status',
];

function assertAdminDatabaseReady(db) {
  const migrationTable = db.prepare(`SELECT 1 FROM sqlite_master
    WHERE type = 'table' AND name = 'migrations'`).get();
  const appliedMigrations = migrationTable
    ? new Set(db.prepare('SELECT id FROM migrations').all().map(({ id }) => id))
    : new Set();
  const missingMigrations = REQUIRED_ADMIN_MIGRATIONS.filter((id) => !appliedMigrations.has(id));
  const userColumns = new Set(db.pragma("table_info('auth_users')").map(({ name }) => name));
  const missingColumns = ['role', 'is_active'].filter((column) => !userColumns.has(column));

  if (missingMigrations.length || missingColumns.length) {
    const details = [];
    if (missingMigrations.length) details.push(`missing migrations: ${missingMigrations.join(', ')}`);
    if (missingColumns.length) details.push(`missing auth_users columns: ${missingColumns.join(', ')}`);
    throw new Error(
      `Admin database schema is not ready (${details.join('; ')}). Back up the Admin database, then run ` +
      '`npm --prefix backend run db:migrate` before starting DeepRead.',
    );
  }
}

module.exports = { assertAdminDatabaseReady };
