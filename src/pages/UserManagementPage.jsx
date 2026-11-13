import { useEffect, useState } from "react";
import {
  createAdminUser,
  exportAdminUserData,
  fetchAdminUsers,
  updateAdminUserStatus,
} from "../api/adminUsers";

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
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
        if (!cancelled) setError(loadError.message || "Unable to load accounts.");
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
      await createAdminUser({ username: username.trim(), password });
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
      const updatedUser = await updateAdminUserStatus(user.id, nextIsActive);
      setUsers((current) => current.map((item) => item.id === updatedUser.id ? updatedUser : item));
      setNotice(`${updatedUser.username} is now ${updatedUser.is_active ? "active" : "inactive"}.`);
    } catch (statusError) {
      setError(statusError.message || "Unable to update account status.");
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
      setError(exportError.message || "Unable to export this account.");
    } finally {
      setExportingUserId(null);
    }
  }

  return (
    <main className="user-management-page">
      <header className="user-management-heading">
        <p className="user-management-eyebrow">Administration</p>
        <h2>User Management</h2>
        <p>Manage regular accounts and their access to DeepRead.</p>
      </header>

      <section className="user-management-card" aria-labelledby="create-user-heading">
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
          <button type="submit" className="user-management-primary" disabled={creating}>
            {creating ? "Creating…" : "Create user"}
          </button>
        </form>
        <p className="user-management-hint">Passwords must be at least 12 characters. New accounts are regular users.</p>
      </section>

      {(error || notice) && (
        <p className={error ? "user-management-message is-error" : "user-management-message is-success"}
          role={error ? "alert" : "status"}>
          {error || notice}
        </p>
      )}

      <section className="user-management-card" aria-labelledby="accounts-heading">
        <div className="user-management-card-heading">
          <div>
            <p className="user-management-eyebrow">Accounts</p>
            <h3 id="accounts-heading">DeepRead users</h3>
          </div>
          {!loading && <span className="user-management-count">{users.length}</span>}
        </div>

        {loading ? (
          <p className="user-management-empty">Loading accounts…</p>
        ) : users.length === 0 ? (
          <p className="user-management-empty">No accounts found.</p>
        ) : (
          <div className="user-management-table-wrap">
            <table className="user-management-table">
              <thead>
                <tr>
                  <th scope="col">Username</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">Created</th>
                  <th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const isAdministrator = user.role === "administrator";
                  const isActive = Boolean(user.is_active);
                  return (
                    <tr key={user.id}>
                      <td data-label="Username">{user.username}</td>
                      <td data-label="Role">{isAdministrator ? "Administrator" : "User"}</td>
                      <td data-label="Status">
                        <span className={`user-management-status ${isActive ? "is-active" : "is-inactive"}`}>
                          {isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td data-label="Created">{formatDate(user.created_at)}</td>
                      <td className="user-management-actions">
                        {!isAdministrator && (
                          <>
                            <button
                              type="button"
                              className="user-management-secondary"
                              onClick={() => handleStatusChange(user)}
                              disabled={busyUserId === user.id}
                            >
                              {busyUserId === user.id ? "Saving…" : isActive ? "Deactivate" : "Activate"}
                            </button>
                            <button
                              type="button"
                              className="user-management-secondary"
                              onClick={() => handleExport(user)}
                              disabled={exportingUserId === user.id}
                            >
                              {exportingUserId === user.id ? "Exporting…" : "Export data"}
                            </button>
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
