
import { useEffect, useState } from "react";
import {
  createAdminUser,
  exportAdminUserData,
  fetchAdminUsers,
  updateAdminUserStatus,
  updateGuestAccess,
} from "../api/adminUsers";

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

// Administrator → Guest → regular Users (oldest first)
function sortUsers(users) {
  const roleOrder = {
    administrator: 0,
    guest: 1,
    user: 2,
  };

  return [...users].sort((a, b) => {
    const roleA = roleOrder[a.role] ?? 2;
    const roleB = roleOrder[b.role] ?? 2;

    if (roleA !== roleB) {
      return roleA - roleB;
    }

    // Missing or invalid dates sort as epoch; account id stabilizes ties.
    if (a.role === "user" && b.role === "user") {
      const dateA = new Date(a.created_at || 0).getTime();
      const dateB = new Date(b.created_at || 0).getTime();

      const validA = Number.isFinite(dateA) ? dateA : 0;
      const validB = Number.isFinite(dateB) ? dateB : 0;
      const dateOrder = validA - validB;

      if (dateOrder !== 0) {
        return dateOrder;
      }

      const idOrder = Number(a.id) - Number(b.id);
      return Number.isFinite(idOrder) && idOrder !== 0
        ? idOrder
        : String(a.id).localeCompare(String(b.id));
    }

    return 0;
  });
}

export default function UserManagementPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyUserId, setBusyUserId] = useState(null);
  const [exportingUserId, setExportingUserId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    fetchAdminUsers()
      .then((accounts) => {
        if (!cancelled) setUsers(accounts);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError.message || "Unable to load accounts.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshVersion]);

  async function handleCreate(event) {
    event.preventDefault();
    setCreating(true);
    setError("");
    setNotice("");

    try {
      await createAdminUser({
        username: username.trim(),
        password,
      });

      setUsername("");
      setPassword("");
      setNotice("User account created.");
      setRefreshVersion((version) => version + 1);
    } catch (createError) {
      setError(createError.message || "Unable to create the account.");
    } finally {
      setCreating(false);
    }
  }

  async function handleStatusChange(user) {
    const nextIsActive = !user.is_active;
    setBusyUserId(user.id);
    setError("");
    setNotice("");

    try {
      const updatedUser = await updateAdminUserStatus(
        user.id,
        nextIsActive
      );

      setUsers((current) =>
        current.map((item) =>
          item.id === updatedUser.id ? updatedUser : item
        )
      );

      setNotice(
        `${updatedUser.username} is now ${
          updatedUser.is_active ? "active" : "inactive"
        }.`
      );
    } catch (statusError) {
      setError(
        statusError.message || "Unable to update account status."
      );
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleGuestStatusChange(user) {
    const nextIsActive = !user.is_active;
    setBusyUserId(user.id);
    setError("");
    setNotice("");

    try {
      const updatedGuest = await updateGuestAccess(nextIsActive);

      setUsers((current) =>
        current.map((item) =>
          item.role === "guest" ? updatedGuest : item
        )
      );

      setNotice(
        `Guest access is now ${
          updatedGuest.is_active ? "enabled" : "disabled"
        }.`
      );
    } catch (statusError) {
      setError(
        statusError.message || "Unable to update Guest access."
      );
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleExport(user) {
    setExportingUserId(user.id);
    setError("");
    setNotice("");

    try {
      await exportAdminUserData(user.id);
      setNotice(`Data export downloaded for ${user.username}.`);
    } catch (exportError) {
      setError(
        exportError.message || "Unable to export this account."
      );
    } finally {
      setExportingUserId(null);
    }
  }

  // Always render the accounts in the required order.
  const sortedUsers = sortUsers(users);

  return (
    <main className="user-management-page">
      <header className="user-management-heading">
        <p className="user-management-eyebrow">Administration</p>
        <h2>User Management</h2>
        <p>
          Manage regular accounts and the shared Guest account's access.
        </p>
      </header>

      <section
        className="user-management-card"
        aria-labelledby="create-user-heading"
      >
        <div className="user-management-card-heading">
          <div>
            <p className="user-management-eyebrow">New account</p>
            <h3 id="create-user-heading">Create a user</h3>
          </div>
        </div>

        <form className="user-create-form" onSubmit={handleCreate}>
          <label>
            Username
            <input
              autoComplete="off"
              maxLength={64}
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>

          <label>
            Temporary password
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          <button
            type="submit"
            className="user-management-primary"
            disabled={creating}
          >
            {creating ? "Creating…" : "Create user"}
          </button>
        </form>

        <p className="user-management-hint">
          Passwords must be at least 12 characters. New accounts are regular users.
        </p>
      </section>

      {(error || notice) && (
        <p
          className={
            error
              ? "user-management-message is-error"
              : "user-management-message is-success"
          }
          role={error ? "alert" : "status"}
        >
          {error || notice}
        </p>
      )}

      <section
        className="user-management-card"
        aria-labelledby="accounts-heading"
      >
        <div className="user-management-card-heading">
          <div>
            <p className="user-management-eyebrow">Accounts</p>
            <h3 id="accounts-heading">DeepRead users</h3>
          </div>

          {!loading && (
            <span className="user-management-count">
              {users.length}
            </span>
          )}
        </div>

        {loading ? (
          <p className="user-management-empty">
            Loading accounts…
          </p>
        ) : sortedUsers.length === 0 ? (
          <p className="user-management-empty">
            No accounts found.
          </p>
        ) : (
          <div className="user-management-table-wrap">
            <table className="user-management-table">
              <thead>
                <tr>
                  <th scope="col">No.</th>
                  <th scope="col">Username</th>
                  <th scope="col">Account Type</th>
                  <th scope="col">Status</th>
                  <th scope="col">Database</th>
                  <th scope="col">Created</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>

              <tbody>
                {sortedUsers.map((user, index) => {
                  const isAdministrator =
                    user.role === "administrator";
                  const isGuest = user.role === "guest";
                  const isActive = Boolean(user.is_active);

                  return (
                    <tr key={user.id}>
                      <td data-label="No.">
                        {index + 1}
                      </td>

                      <td data-label="Username">
                        {user.username}
                      </td>

                      <td data-label="Account Type">
                        {isGuest
                          ? "Guest"
                          : isAdministrator
                            ? "Administrator"
                            : "User"}
                      </td>

                      <td data-label="Status">
                        <span
                          className={`user-management-status ${
                            isActive ? "is-active" : "is-inactive"
                          }`}
                        >
                          {isGuest
                            ? isActive
                              ? "Enabled"
                              : "Disabled"
                            : isActive
                              ? "Active"
                              : "Inactive"}
                        </span>
                      </td>

                      <td data-label="Database">
                        {isGuest ? (
                          <div className="user-management-guest-details">
                            <strong>{user.database}</strong>
                            {!user.login_configured && (
                              <span>
                                Guest login is not configured.
                              </span>
                            )}
                          </div>
                        ) : (
                          "Admin Database"
                        )}
                      </td>

                      <td data-label="Created">
                        {isGuest
                          ? "—"
                          : formatDate(user.created_at)}
                      </td>

                      <td
                        className="user-management-actions"
                        data-label="Actions"
                      >
                        {isGuest ? (
                          <button
                            type="button"
                            className="user-management-secondary"
                            onClick={() => handleGuestStatusChange(user)}
                            disabled={busyUserId === user.id}
                          >
                            {busyUserId === user.id
                              ? "Saving…"
                              : isActive
                                ? "Disable Guest"
                                : "Enable Guest"}
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="user-management-secondary"
                              onClick={() => handleStatusChange(user)}
                              disabled={busyUserId === user.id}
                            >
                              {busyUserId === user.id
                                ? "Saving…"
                                : isAdministrator
                                  ? isActive
                                    ? "Disable Admin"
                                    : "Enable Admin"
                                  : isActive
                                    ? "Deactivate"
                                    : "Activate"}
                            </button>

                            {!isAdministrator && (
                              <button
                                type="button"
                                className="user-management-secondary"
                                onClick={() => handleExport(user)}
                                disabled={exportingUserId === user.id}
                              >
                                {exportingUserId === user.id
                                  ? "Exporting…"
                                  : "Export data"}
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
