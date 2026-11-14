import { useState } from "react";
import { Save, X } from "lucide-react";
import Tooltip from "./Tooltip";

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
        <Tooltip text="Save">
  <button
    className="save-note-button"
    type="button"
    aria-label="Save"
    onClick={() => onSave(draft.trim())}
  >
    <Save size={15} />
  </button>
</Tooltip>

<Tooltip text="Discard">
  <button
    type="button"
    className="cancel-note-button"
    onClick={onCancel}
    aria-label="Discard"
  >
    <X size={15} />
  </button>
</Tooltip>
      </div>
    </div>
  );
}