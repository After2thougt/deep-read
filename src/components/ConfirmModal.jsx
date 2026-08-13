import { Trash2, X } from "lucide-react";

export default function ConfirmModal({
  open,
  title = "Delete item?",
  message = "Are you sure you want to delete this item?",
  onCancel,
  onConfirm,
  confirmText = "Delete",
}) {
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
      >
        <button
          className="delete-modal-close"
          onClick={onCancel}
          aria-label="Close"
        >
          <X size={20} />
        </button>

        <div className="delete-modal-icon">
          <Trash2 size={22} />
        </div>

        <h3>{title}</h3>

        <p>{message}</p>

        <div className="delete-modal-actions">
          <button
            className="delete-cancel-button"
            onClick={onCancel}
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