import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Lock, User, LogOut, Info, Download, LoaderCircle } from "lucide-react";
import ConfirmModal from "./ConfirmModal";
import PasswordModal from "./PasswordModal";
import { exportUserData } from "../../api/export";

export default function UserMenu({ username, role, onLogout }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState(null);
  const ref = useRef(null);
  const [loggingOut, setLoggingOut] = useState(false);

  function closeMenu() {
  setOpen(false);
  setExportMessage(null);
}

  async function handleExport() {
    setExporting(true);
    setExportMessage(null);
    try {
      await exportUserData();
      setExportMessage({ type: "success", text: "Your data export was downloaded." });
    } catch (error) {
      setExportMessage({ type: "error", text: error.message || "Unable to export your data." });
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
  function handleClickOutside(event) {
    if (ref.current && !ref.current.contains(event.target)) {
      closeMenu();
    }
  }

  document.addEventListener("mousedown", handleClickOutside);

  return () => {
    document.removeEventListener("mousedown", handleClickOutside);
  };
}, []);

  return (
    <div className="user-menu" ref={ref}>
      <button
        className="user-button"
        onClick={() => {
          if (open) {
            closeMenu();
          } else {
            setOpen(true);
          }
        }}
        aria-label="User menu"
      >
        <User size={20} />
      </button>

      {open && (
        <div className="user-dropdown">
          <div className="user-name">{username || "Guest"}</div>


          {role !== "administrator" && (
            <button
              onClick={() => {
                  closeMenu();
                  navigate("/about");
              }}
            >
              <Info size={16} style={{ marginRight: "6px", verticalAlign: "middle" }} />
              About DeepRead
            </button>
          )}

          {role !== "administrator" && (
            <button type="button" onClick={handleExport} disabled={exporting}>
              {exporting ? <LoaderCircle className="export-spinner" size={16} style={{ marginRight: "6px", verticalAlign: "middle" }} /> : <Download size={16} style={{ marginRight: "6px", verticalAlign: "middle" }}  />}
              {exporting ? "Preparing export..." : "Export Data"}
            </button>
          )}

          {exportMessage && (
            <p className={`export-status export-status--${exportMessage.type}`} role="status" aria-live="polite">
              {exportMessage.text}
            </p>
          )}

          {role !== "guest" && (
            <button onClick={() => { 
              closeMenu(); 
              setShowPasswordModal(true); }}>
              <Lock size={16} style={{ marginRight: "6px", verticalAlign: "middle" }} />
              Change Password
            </button>
          )}


          <button
            onClick={() => {
              closeMenu();
              setShowLogoutConfirm(true);
            }}
          >
            <LogOut size={16} style={{ marginRight: "6px", verticalAlign: "middle" }} />
            Logout
          </button>
        </div>
      )}

      <ConfirmModal
  open={showLogoutConfirm}
  title="Sign out"
  message="You’ll need to sign in again to access your reading workspace."
  icon={<LogOut size={22} strokeWidth={2} />}
  onCancel={() => {
    if (!loggingOut) {
      setShowLogoutConfirm(false);
    }
  }}
  onConfirm={async () => {
    if (loggingOut) return;

    setLoggingOut(true);

    try {
      await onLogout();
    } finally {
      setLoggingOut(false);
      setShowLogoutConfirm(false);
    }
  }}
  confirmText={loggingOut ? "Signing out..." : "Sign out"}
  confirmDisabled={loggingOut}
/>

      <PasswordModal
        open={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        onSubmit={() => setShowPasswordModal(false)}
        title="Change Password"
      />
    </div>
  );
}
