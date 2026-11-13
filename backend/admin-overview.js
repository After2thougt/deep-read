function getAdministratorOverview(database) {
  const readOverview = database.transaction(() => {
    const stats = database.prepare(`SELECT
      COUNT(CASE WHEN role = 'user' THEN 1 END) AS totalUsers,
      COUNT(CASE WHEN role = 'user' AND is_active = 1 THEN 1 END) AS activeUsers,
      COUNT(CASE WHEN role = 'user' AND is_active = 0 THEN 1 END) AS disabledUsers,
      COUNT(CASE WHEN role = 'administrator' THEN 1 END) AS administrators
      FROM auth_users`).get();
    const recentUsers = database.prepare(`SELECT username, created_at AS createdAt
      FROM auth_users
      WHERE role = 'user'
      ORDER BY created_at DESC, id DESC
      LIMIT 5`).all();

    return { stats, recentUsers };
  });

  return readOverview.deferred();
}

module.exports = { getAdministratorOverview };
