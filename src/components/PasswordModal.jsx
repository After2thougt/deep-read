import { useState, useEffect } from "react";
import { X, Eye, EyeOff, AlertCircle, CheckCircle } from "lucide-react";

export default function PasswordModal({
  open,
  onClose,
  onSubmit,
  title = "Change Password"
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setError("");
      setSuccess("");
    }
  }, [open]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("All fields are required.");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to change password.");
        return;
      }

      // Success
      setSuccess("Password updated successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");

      // Close modal after short delay to show success message
      setTimeout(() => {
        onSubmit();
        onClose();
      }, 1200);
    } catch (err) {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="password-modal-overlay" onClick={onClose}>
      <div className="password-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="password-modal-title">
        {/* Close button - top right */}
        <button
          className="password-modal-close"
          onClick={onClose}
          aria-label="Close"
          disabled={loading}
        >
          <X size={20} />
        </button>

        {/* Header: icon, title, description */}
        <div className="password-modal-header">
          <div className="password-modal-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h3 id="password-modal-title" className="password-modal-title">{title}</h3>
          <p className="password-modal-description">
            Enter your current password and choose a new one. Your new password must be at least 8 characters.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="password-modal-form">
          {/* Alert messages */}
          {error && (
            <div className="password-modal-alert password-modal-alert--error" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="password-modal-alert password-modal-alert--success" role="status">
              <CheckCircle size={18} aria-hidden="true" />
              <span>{success}</span>
            </div>
          )}

          {/* Current Password */}
          <div className="password-modal-field">
            <label htmlFor="currentPassword">Current Password</label>
            <div className="password-input-wrapper">
              <input
                id="currentPassword"
                type={showCurrent ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                autoComplete="current-password"
                disabled={loading}
                aria-describedby={error ? "password-error" : undefined}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowCurrent(!showCurrent)}
                aria-label={showCurrent ? "Hide current password" : "Show current password"}
                disabled={loading}
              >
                {showCurrent ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {/* New Password */}
          <div className="password-modal-field">
            <label htmlFor="newPassword">New Password</label>
            <div className="password-input-wrapper">
              <input
                id="newPassword"
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password (min 8 chars)"
                autoComplete="new-password"
                disabled={loading}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowNew(!showNew)}
                aria-label={showNew ? "Hide new password" : "Show new password"}
                disabled={loading}
              >
                {showNew ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {/* Confirm New Password */}
          <div className="password-modal-field">
            <label htmlFor="confirmPassword">Confirm New Password</label>
            <div className="password-input-wrapper">
              <input
                id="confirmPassword"
                type={showConfirm ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                autoComplete="new-password"
                disabled={loading}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowConfirm(!showConfirm)}
                aria-label={showConfirm ? "Hide confirm password" : "Show confirm password"}
                disabled={loading}
              >
                {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {/* Actions - right aligned */}
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
              {loading ? "Updating..." : "Update Password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}