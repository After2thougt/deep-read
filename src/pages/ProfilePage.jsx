import { useState } from "react";
import { User, Lock, Settings, LogOut } from "lucide-react";
import ConfirmModal from "../components/ConfirmModal";
import PasswordModal from "../components/PasswordModal";

export default function ProfilePage({ username, onLogout }) {
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  const handleLogout = () => {
    setShowLogoutConfirm(false);
    onLogout();
  };

  const handlePasswordChange = () => {
    setShowPasswordModal(false);
    setPasswordSuccess(true);
    // Auto-hide success message after 3 seconds
    setTimeout(() => setPasswordSuccess(false), 3000);
  };

  return (
    <div className="profile-page">
      <div className="profile-card">
        <div className="profile-header">
          <div className="profile-avatar">
          <img src="/avatar.png" alt="Profile avatar" />
        </div>
          <h2 className="profile-username">{username}</h2>
          
          <p className="profile-description">You really want to study now?</p>
        </div>

        <div className="profile-section">
          <h3 className="profile-section-title">Account</h3>

          <div className="profile-actions">
            <button
              className="profile-action-button"
              onClick={() => setShowPasswordModal(true)}
            >
              <Lock size={18} />
              <span>Change Password</span>
            </button>

            <button
              className="profile-action-button profile-action-button--danger"
              onClick={() => setShowLogoutConfirm(true)}
            >
              <LogOut size={18} />
              <span>Logout</span>
            </button>
          </div>
        </div>

        <div className="profile-section">
          <h3 className="profile-section-title">Preferences</h3>

          <div className="profile-actions">
            <button className="profile-action-button" onClick={() => window.location.href = "/settings"}>
              <Settings size={18} />
              <span>Settings</span>
            </button>
          </div>
        </div>

        {passwordSuccess && (
          <div className="profile-success-message">
            Password changed successfully.
          </div>
        )}
      </div>

      <ConfirmModal
        open={showLogoutConfirm}
        title="Confirm Logout"
        message="Are you sure you want to sign out?"
        icon={<LogOut size={22} strokeWidth={2} />}
        onCancel={() => setShowLogoutConfirm(false)}
        onConfirm={handleLogout}
        confirmText="Logout"
      />

      <PasswordModal
        open={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        onSubmit={handlePasswordChange}
        title="Change Password"
      />
    </div>
  );
}