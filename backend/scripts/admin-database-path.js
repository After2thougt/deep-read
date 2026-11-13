const path = require('node:path');

function resolveAdminDatabasePath(explicitPath) {
  const configuredAdminPath = process.env.DATABASE_PATH;
  const selectedPath = explicitPath || configuredAdminPath;
  if (!selectedPath) throw new Error('Provide --database-path or set DATABASE_PATH explicitly.');

  const resolvedPath = path.resolve(selectedPath);
  const guestPath = path.resolve(
    process.env.GUEST_DATABASE_PATH
      || path.join(path.dirname(path.resolve(configuredAdminPath || selectedPath)), 'guest.db'),
  );
  if (resolvedPath === guestPath) {
    throw new Error('The ownership migration must target the Admin database, not guest.db.');
  }
  return resolvedPath;
}

module.exports = { resolveAdminDatabasePath };
