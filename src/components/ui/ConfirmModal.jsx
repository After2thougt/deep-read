
import { X } from "lucide-react";
import { useEffect, useRef } from "react";

export default function ConfirmModal({
  open,
  title = "Delete User?",
  message = "This will delete this item.",
  onCancel,
  onConfirm,
  confirmText = "Delete",
  confirmDisabled = false,
  initialFocusRef,
  icon,
  children,
}) {
  const cancelButtonRef = useRef(null);
  const previousActiveElement = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    previousActiveElement.current = document.activeElement;
    (initialFocusRef?.current || cancelButtonRef.current)?.focus();

    function handleKeyDown(event) {
      if (event.key === "Escape" && !confirmDisabled) {
        onCancel();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousActiveElement.current?.focus?.();
    };
  }, [open, onCancel, initialFocusRef, confirmDisabled]);

  if (!open) return null;

  function handleCancel() {
    if (!confirmDisabled) {
      onCancel();
    }
  }

  return (
    <div
      className="delete-modal-overlay"
      onClick={handleCancel}
    >
      <div
        className="delete-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-busy={confirmDisabled}
      >
        <button
          type="button"
          className="delete-modal-close"
          onClick={handleCancel}
          aria-label="Close"
          disabled={confirmDisabled}
        >
          <X size={20} />
        </button>

        {icon && (
          <div className="delete-modal-icon">
            {icon}
          </div>
        )}

        <h3 id="confirm-modal-title">{title}</h3>

        <p>{message}</p>

        {children}

        <div className="delete-modal-actions">
          <button
            type="button"
            className="delete-cancel-button"
            onClick={handleCancel}
            ref={cancelButtonRef}
            disabled={confirmDisabled}
          >
            Cancel
          </button>

          <button
            type="button"
            className="delete-confirm-button"
            onClick={onConfirm}
            disabled={confirmDisabled}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
