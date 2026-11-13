function initializeGuestAccessSettings(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS guest_access_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
    updated_at TEXT NOT NULL
  )`);
  database.prepare(`INSERT OR IGNORE INTO guest_access_settings (id, is_active, updated_at)
    VALUES (1, 1, ?)`).run(new Date().toISOString());
}

function isGuestAccessEnabled(database) {
  return Boolean(database.prepare(
    'SELECT is_active FROM guest_access_settings WHERE id = 1',
  ).get()?.is_active);
}

function setGuestAccessEnabled(database, isActive) {
  database.prepare(`UPDATE guest_access_settings
    SET is_active = ?, updated_at = ? WHERE id = 1`)
    .run(isActive ? 1 : 0, new Date().toISOString());
  return isGuestAccessEnabled(database);
}

function getGuestSystemAccount(adminDatabase, guestDatabase, sessions, now = Date.now()) {
  const isActive = isGuestAccessEnabled(adminDatabase);
  const guestUsername = String(process.env.GUEST_USERNAME || '').trim();
  const loginConfigured = Boolean(guestUsername && guestDatabase.prepare(
    'SELECT 1 FROM auth_users WHERE username = ?',
  ).get(guestUsername));
  const databaseStats = guestDatabase.prepare(`SELECT
    (SELECT COUNT(*) FROM articles) AS articles,
    (SELECT COUNT(*) FROM tags) AS tags,
    (SELECT COUNT(*) FROM vocabulary) AS vocabulary`).get();
  const activeSessions = [...sessions.values()].filter((session) =>
    session.database === guestDatabase && session.expiresAt >= now).length;

  return {
    id: 'guest',
    username: 'Guest',
    role: 'guest',
    is_active: Number(isActive),
    created_at: null,
    account_count: 1,
    active_sessions: activeSessions,
    database: 'Guest Database',
    database_stats: databaseStats,
    login_configured: loginConfigured,
  };
}

module.exports = {
  getGuestSystemAccount,
  initializeGuestAccessSettings,
  isGuestAccessEnabled,
  setGuestAccessEnabled,
};
