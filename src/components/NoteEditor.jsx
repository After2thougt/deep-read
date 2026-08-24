import { useState } from "react";
import { Save, X } from "lucide-react";

export default function NoteEditor({
  note,
  onSave,
  onCancel,
}) {
  const [draft, setDraft] = useState(note || "");

  return (
    <div className="note-editor">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="note-actions">
        <button
          className="save-note-button"
          type="button"
          title="Save note"
          aria-label="Save note"
          onClick={() => onSave(draft.trim())}
        >
          <Save size={15} />
        </button>
        <button
          type="button"
          className="cancel-note-button"
          onClick={onCancel}
          title="Cancel"
          aria-label="Cancel"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}