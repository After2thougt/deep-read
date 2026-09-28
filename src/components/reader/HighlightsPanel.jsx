import { useState, useEffect } from "react";
import {
  MessageSquare,
  Pencil,
  Trash2,
  Copy
} from "lucide-react";

import ConfirmModal from "../ui/ConfirmModal";
import NoteEditor from "../ui/NoteEditor";

export default function HighlightsPanel({
  pageHighlights,
  onUpdateUnderline,
  onRemoveUnderline,
  pageKey,
}) {
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [collapsed, setCollapsed] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [copiedHighlightId, setCopiedHighlightId] = useState(null);

  // Auto-collapse when page changes
  useEffect(() => {
    setCollapsed(true);
  }, [pageKey]);

  function startNoteEdit(item) {
    setEditingNoteId(item.id);
  }

  function saveNote(item, noteText) {
    onUpdateUnderline(item.id, { note: noteText });
    setEditingNoteId(null);
  }

  function cancelNote() {
    setEditingNoteId(null);
  }

  async function copyHighlight(item) {
    if (!item.text) return;

    try {
      await navigator.clipboard.writeText(item.text.trim());

      setCopiedHighlightId(item.id);

      setTimeout(() => {
        setCopiedHighlightId(null);
      }, 1500);
    } catch (error) {
      console.error("Failed to copy highlight:", error);
    }
  }

  if (pageHighlights.length === 0) {
    return null;
  }

  return (
    <section className="highlights-list">
      <div className="accordion-wrapper">
        <div
          className="accordion-header"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          <div className="accordion-header-left">
            <h3 className="accordion-title">
              Click to show/hide the Underlined passages
              <span className="highlight-count">
                {pageHighlights.length}
              </span>
            </h3>
          </div>

          <div
            className={`accordion-chevron ${
              collapsed ? "" : "open"
            }`}
          ></div>
        </div>

        <div
          className={`accordion-content ${
            !collapsed ? "expanded" : ""
          }`}
        >
          <div className="accordion-content-inner">
            {pageHighlights.map((item) => (
              <article className="underline-note" key={item.id}>

                <div className="highlight-text-wrapper">
                  <p className="highlight-text">
                    <span>{item.text.trim()}</span>
                  </p>

                  <button
                    type="button"
                    className={`copy-highlight-button ${
                      copiedHighlightId === item.id ? "copied" : ""
                    }`}
                    onClick={() => copyHighlight(item)}
                    title={
                      copiedHighlightId === item.id
                        ? "Copied"
                        : "Copy highlight"
                    }
                    aria-label={
                      copiedHighlightId === item.id
                        ? "Copied"
                        : "Copy highlight"
                    }
                  >
                    {copiedHighlightId === item.id ? (
                      "✓"
                    ) : (
                      <Copy size={15} />
                    )}
                  </button>
                </div>

                {editingNoteId === item.id ? (
                  <NoteEditor
                    note={item.note || ""}
                    onSave={(noteText) =>
                      saveNote(item, noteText)
                    }
                    onCancel={cancelNote}
                  />
                ) : (
                  <>
                    {item.note && (
                      <div className="saved-note">
                        <MessageSquare size={16} />

                        <span className="saved-note-text">
                          {item.note}
                        </span>
                      </div>
                    )}

                    <div className="underline-item-actions">
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => startNoteEdit(item)}
                      >
                        <Pencil size={16} />
                        {item.note ? "Edit Note" : "Add Note"}
                      </button>

                      <button
                        className="text-button delete-underline"
                        type="button"
                        onClick={() =>
                          setDeleteTarget(item.id)
                        }
                        title="Remove underline"
                      >
                        <Trash2 size={16} />
                        Remove
                      </button>
                    </div>
                  </>
                )}
              </article>
            ))}
          </div>
        </div>
      </div>

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Remove underline?"
        message={[
          "Are you sure you want to remove this highlight?",
          <br key="br" />,
          "If there is a note, the note will be deleted too."
        ]}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          onRemoveUnderline(deleteTarget);
          setDeleteTarget(null);
        }}
        confirmText="Delete"
      />
    </section>
  );
}