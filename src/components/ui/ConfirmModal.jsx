import { Trash2, X } from "lucide-react";
import { useEffect, useRef } from "react";

export default function ConfirmModal({
  open,
  title = "Delete item?",
  message = "Are you sure you want to delete this item?",
  onCancel,
  onConfirm,
  confirmText = "Delete",
  icon,
}) {
  const cancelButtonRef = useRef(null);
  const previousActiveElement = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    previousActiveElement.current = document.activeElement;
    cancelButtonRef.current?.focus();

    function handleKeyDown(event) {
      if (event.key === "Escape") onCancel();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousActiveElement.current?.focus?.();
    };
  }, [open, onCancel]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="delete-modal-overlay"
      onClick={onCancel}
    >
      <div
        className="delete-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
      >
        <button
          className="delete-modal-close"
          onClick={onCancel}
          aria-label="Close"
        >
          <X size={20} />
        </button>

        <div className="delete-modal-icon">
          {icon ? icon : <Trash2 size={22} strokeWidth={2} />}
        </div>

        <h3 id="confirm-modal-title">{title}</h3>

        <p>{message}</p>

        <div className="delete-modal-actions">
          <button
            className="delete-cancel-button"
            onClick={onCancel}
            ref={cancelButtonRef}
          >
            Cancel
          </button>

          <button
            className="delete-confirm-button"
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
