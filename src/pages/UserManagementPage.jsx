
import { useEffect, useState } from "react";
import {
  createAdminUser,
  deleteAdminUser,
  exportAdminUserData,
  fetchAdminUsers,
  updateAdminUserStatus,
  updateGuestAccess,
  changeAdminUserPassword,
} from "../api/adminUsers";
import {
  Download,
  Trash2,
  UserCheck,
  UserX,
  KeyRound,
} from "lucide-react";
import ConfirmModal from "../components/ui/ConfirmModal";
import { clearAccountStorage } from "../utils/storage";
import Tooltip from "../components/ui/Tooltip";
import PasswordModal from "../components/ui/PasswordModal";

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
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
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busyUserId, setBusyUserId] = useState(null);
  const [exportingUserId, setExportingUserId] = useState(null);
  const [userToDelete, setUserToDelete] = useState(null);
  const [deletingUserId, setDeletingUserId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [userToChangePassword, setUserToChangePassword] = useState(null);

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
      setIsCreateModalOpen(false);
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

  async function handleDeleteUser() {
    if (!userToDelete || deletingUserId !== null) return;

    const user = userToDelete;
    setDeletingUserId(user.id);
    setError("");
    setNotice("");

    try {
      await deleteAdminUser(user.id);
      const localDataCleared = clearAccountStorage(user.id);
      setUserToDelete(null);
      setNotice(
        localDataCleared
          ? `User account "${user.username}" and its associated data were deleted.`
          : `User account "${user.username}" was deleted, but browser-local data could not be cleared on this device.`,
      );
      setRefreshVersion((version) => version + 1);
    } catch (deleteError) {
      if (deleteError.accountDeleted) {
        clearAccountStorage(user.id);
        setUsers((current) => current.filter((account) => account.id !== user.id));
        setUserToDelete(null);
      }
      setError(deleteError.message || "Unable to delete the account.");
    } finally {
      setDeletingUserId(null);
    }
  }

  function handleCancelDelete() {
    if (deletingUserId === null) setUserToDelete(null);
  }

async function handleChangePassword(newPassword) {
  if (!userToChangePassword) return;

  const targetUser = userToChangePassword;

  await changeAdminUserPassword(
    targetUser.id,
    newPassword
  );

  setUserToChangePassword(null);

  setNotice(
    `Password updated for ${targetUser.username}. The account must log in again.`
  );
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



{/* Create User Modal */}
{isCreateModalOpen && (
  <div
    className="user-modal-overlay"
    onMouseDown={(event) => {
      if (event.target === event.currentTarget && !creating) {
        setIsCreateModalOpen(false);
      }
    }}
  >
    <section
      className="user-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-user-heading"
    >
      <div className="user-modal-header">
        <div>
          <p className="user-management-eyebrow">New account</p>
          <h3 id="create-user-heading">Create User</h3>
          <p>
            Create a new regular user account.
          </p>
        </div>

        <button
          type="button"
          className="user-modal-close"
          onClick={() => setIsCreateModalOpen(false)}
          disabled={creating}
          aria-label="Close"
        >
          ×
        </button>
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
          Password
          <input
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        <p className="user-management-hint">
          Passwords must be at least 12 characters.
          
        </p>

        {error && (
          <p className="user-management-message is-error" role="alert">
            {error}
          </p>
        )}

        <div className="user-modal-actions">
          <button
            type="button"
            className="user-management-secondary"
            onClick={() => setIsCreateModalOpen(false)}
            disabled={creating}
          >
            Cancel
          </button>

          <button
            type="submit"
            className="user-management-primary"
            disabled={creating}
          >
            {creating ? "Creating…" : "Comfirm"}
          </button>
        </div>
      </form>
    </section>
  </div>
)}

      {(notice || (error && !isCreateModalOpen)) && (
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

  <div className="user-management-header-actions">
    {!loading && (
      <span className="user-management-count">
        {users.length}
      </span>
    )}

    <button
      type="button"
      className="user-management-primary"
      onClick={() => {
        setError("");
        setIsCreateModalOpen(true);
      }}
    >
      + Add User
    </button>
  </div>
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
                  <th scope="col">Actions</th>
                </tr>
              </thead>

              <tbody>
                {sortedUsers.map((user, index) => {
                  const isAdministrator =
                    user.role === "administrator";
                  const isGuest = user.role === "guest";
                  const isActive = Boolean(user.is_active);
                  const isRowBusy =
                    busyUserId === user.id
                    || exportingUserId === user.id
                    || deletingUserId === user.id;

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
    <Tooltip text={isActive ? "Deactivate Guest" : "Activate Guest"}>
      <button
        type="button"
        className="user-management-icon-button"
        onClick={() => handleGuestStatusChange(user)}
        disabled={isRowBusy}
        aria-label={isActive ? "Deactivate Guest" : "Activate Guest"}
      >
        {isActive ? <UserCheck size={17} /> : <UserX size={17} />}
      </button>
    </Tooltip>
  ) : (
    <>
      <Tooltip text={isActive ? "Deactivate account" : "Activate account"}>
        <button
          type="button"
          className="user-management-icon-button"
          onClick={() => handleStatusChange(user)}
          disabled={isRowBusy}
          aria-label={isActive ? "Deactivate account" : "Activate account"}
        >
          {isActive ? <UserCheck size={17} /> : <UserX size={17} />}
        </button>
      </Tooltip>

      {!isAdministrator && (
        <Tooltip text="Export data">
          <button
            type="button"
            className="user-management-icon-button"
            onClick={() => handleExport(user)}
            disabled={isRowBusy}
            aria-label="Export data"
          >
            <Download size={16} />
          </button>
        </Tooltip>
      )}
    </>
  )}

  {/* All account types can reset passwords */}
  <Tooltip text="Reset password">
    <button
      type="button"
      className="user-management-icon-button"
      onClick={() => {
        setError("");
        setNotice("");
        setUserToChangePassword(user);
      }}
      disabled={isRowBusy}
      aria-label={`Reset password for ${user.username}`}
    >
      <KeyRound size={16} />
    </button>
  </Tooltip>

  {/* Delete account */}
  <Tooltip text="Delete user">
    <button
      type="button"
      className="user-management-icon-button is-delete"
      onClick={() => setUserToDelete(user)}
      disabled={isRowBusy}
      aria-label={`Delete user ${user.username}`}
    >
      <Trash2 size={16} />
    </button>
  </Tooltip>
</td>

                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmModal
        open={Boolean(userToDelete)}
        data-tooltip="Delete user?"
        message={
          userToDelete
            ? `Are you sure you want to permanently delete the account "${userToDelete.username}" and all associated data? This action cannot be undone.`
            : ""
        }
        onCancel={handleCancelDelete}
        onConfirm={handleDeleteUser}
        confirmText={deletingUserId !== null ? "Deleting…" : "Delete user"}
        confirmDisabled={deletingUserId !== null}
      />

      <PasswordModal
  open={Boolean(userToChangePassword)}
  onClose={() => setUserToChangePassword(null)}
  onSubmit={handleChangePassword}
  mode="admin"
  username={userToChangePassword?.username || ""}
  title="Reset Password"
/>
    </main>
  );
}
