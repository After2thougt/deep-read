
import { useState, useEffect } from "react";
import {
  X,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle,
} from "lucide-react";

export default function PasswordModal({
  open,
  onClose,
  onSubmit,
  title = "Change Password",
  mode = "self",
  username = "",
}) {
  const isAdminMode = mode === "admin";
  const minPasswordLength = isAdminMode ? 12 : 8;

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setShowCurrent(false);
      setShowNew(false);
      setShowConfirm(false);
      setError("");
      setSuccess("");
      setLoading(false);
    }
  }, [open]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (
      (!isAdminMode && !currentPassword) ||
      !newPassword ||
      !confirmPassword
    ) {
      setError("All fields are required.");
      return;
    }

    if (newPassword.length < minPasswordLength) {
      setError(
        `New password must be at least ${minPasswordLength} characters.`
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    setLoading(true);

    try {
  if (isAdminMode) {
    await onSubmit(newPassword);
    onClose();
    return;
  }

  const response = await fetch("/api/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      currentPassword,
      newPassword,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Failed to change password.");
  }

  onSubmit?.();

  setSuccess("Password updated successfully.");
  setCurrentPassword("");
  setNewPassword("");
  setConfirmPassword("");

  setTimeout(() => {
    onClose();
  }, 1200);
} catch (err) {
  setError(err.message || "Unable to update password.");
} finally {
  setLoading(false);
}
  };

  if (!open) return null;

  return (
    <div
      className="password-modal-overlay"
      onClick={() => {
        if (!loading) onClose();
      }}
    >
      <div
        className="password-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-modal-title"
      >
        <button
          className="password-modal-close"
          onClick={onClose}
          aria-label="Close"
          disabled={loading}
        >
          <X size={20} />
        </button>

        <div className="password-modal-header">
          <h3
            id="password-modal-title"
            className="password-modal-title"
          >
            {title}
          </h3>

          {isAdminMode && username && (
            <p>Set a new password for {username}.</p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="password-modal-form">
          {error && (
            <div
              className="password-modal-alert password-modal-alert--error"
              role="alert"
            >
              <AlertCircle size={18} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div
              className="password-modal-alert password-modal-alert--success"
              role="status"
            >
              <CheckCircle size={18} aria-hidden="true" />
              <span>{success}</span>
            </div>
          )}

          {!isAdminMode && (
            <div className="password-modal-field">
              <div className="password-input-wrapper">
                <input
                  id="currentPassword"
                  type={showCurrent ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Current password"
                  autoComplete="current-password"
                  disabled={loading}
                />

                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowCurrent(!showCurrent)}
                  aria-label={
                    showCurrent
                      ? "Hide current password"
                      : "Show current password"
                  }
                  disabled={loading}
                >
                  {showCurrent ? (
                    <EyeOff size={18} />
                  ) : (
                    <Eye size={18} />
                  )}
                </button>
              </div>
            </div>
          )}

          <div className="password-modal-field">
            <div className="password-input-wrapper">
              <input
                id="newPassword"
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={`New password (min ${minPasswordLength} chars)`}
                autoComplete="new-password"
                minLength={minPasswordLength}
                disabled={loading}
              />

              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowNew(!showNew)}
                aria-label={
                  showNew ? "Hide new password" : "Show new password"
                }
                disabled={loading}
              >
                {showNew ? (
                  <EyeOff size={18} />
                ) : (
                  <Eye size={18} />
                )}
              </button>
            </div>
          </div>

          <div className="password-modal-field">
            <div className="password-input-wrapper">
              <input
                id="confirmPassword"
                type={showConfirm ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                autoComplete="new-password"
                minLength={minPasswordLength}
                disabled={loading}
              />

              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowConfirm(!showConfirm)}
                aria-label={
                  showConfirm
                    ? "Hide confirm password"
                    : "Show confirm password"
                }
                disabled={loading}
              >
                {showConfirm ? (
                  <EyeOff size={18} />
                ) : (
                  <Eye size={18} />
                )}
              </button>
            </div>
          </div>

          <div className="password-modal-actions">
            <button
              type="button"
              className="password-modal-button password-modal-button--secondary"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="password-modal-button password-modal-button--primary"
              disabled={loading}
            >
              {loading ? "Updating..." : "Confirm"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
