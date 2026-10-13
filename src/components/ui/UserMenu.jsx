import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Lock, User, UserCog, LogOut, Info } from "lucide-react";
import ConfirmModal from "./ConfirmModal";
import PasswordModal from "./PasswordModal";

export default function UserMenu({ username, role, onLogout }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const ref = useRef(null);
 

  useEffect(() => {
    function handleClickOutside(event) {
      if (ref.current && !ref.current.contains(event.target)) {
        setOpen(false);
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
        onClick={() => setOpen(v => !v)}
        aria-label="User menu"
      >
        <User size={20} />
      </button>

      {open && (
        <div className="user-dropdown">
          <div className="user-name">{username || "Guest"}</div>


          <button onClick={() => navigate("/about")}>
            <Info size={16} style={{ marginRight: "6px", verticalAlign: "middle" }} />
            About DeepRead
          </button>

          {role !== "guest" && (
            <button onClick={() => { setOpen(false); setShowPasswordModal(true); }}>
              <Lock size={16} style={{ marginRight: "6px", verticalAlign: "middle" }} />
              Change Password
            </button>
          )}


          <button onClick={() => setShowLogoutConfirm(true)}>
            <LogOut size={16} style={{marginRight: "6px", verticalAlign: "middle"}} />
            Logout
          </button>
        </div>
      )}

      <ConfirmModal
        open={showLogoutConfirm}
        title="Log out?"
        message="You’ll need to sign in again to keep using Deep Read."
        icon={<LogOut size={22} strokeWidth={2} />}
        onCancel={() => setShowLogoutConfirm(false)}
        onConfirm={() => {
          setShowLogoutConfirm(false);
          onLogout();
        }}
        confirmText="Logout"
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
