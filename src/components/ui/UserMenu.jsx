import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { User, LogOut, UserCog } from "lucide-react";
import ConfirmModal from "./ConfirmModal";

export default function UserMenu({ username, onLogout }) {
  const navigate = useNavigate();
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

          <button onClick={() => navigate("/profile")}>
            <UserCog size={16} style={{marginRight: "6px", verticalAlign: "middle"}} />
            Profile
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
        message="STAYYY!!"
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