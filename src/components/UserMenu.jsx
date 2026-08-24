import { useEffect, useRef, useState } from "react";
import { User, LogOut } from "lucide-react";
import ConfirmModal from "./ConfirmModal";

export default function UserMenu({ username, onLogout }) {
  const [open, setOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
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
          <div className="user-name">
            {username || "Guest"}
          </div>

          <button>
            Settings
          </button>

          <button>
            Export Data
          </button>

          <button onClick={() => setShowLogoutConfirm(true)}>
            <LogOut size={16} style={{marginRight: "6px", verticalAlign: "middle"}} />
            Logout
          </button>
        </div>
      )}

      <ConfirmModal
        open={showLogoutConfirm}
        title="Confirm Logout"
        message="Are you sure you want to sign out?"
        icon={<LogOut size={22} strokeWidth={2} />}
        onCancel={() => setShowLogoutConfirm(false)}
        onConfirm={() => {
          setShowLogoutConfirm(false);
          onLogout();
        }}
        confirmText="Logout"
      />
    </div>
  );
}