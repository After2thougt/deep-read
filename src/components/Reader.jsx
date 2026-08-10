import { useEffect, useRef, useState } from "react";
import { MessageSquare, Pencil, Save, X } from "lucide-react";
import { getWords } from "../utils/text";

export default function Reader({ article, highlights, onSelectWord, onSaveUnderline, onRemoveUnderline, onUpdateUnderline }) {
  const contentRef = useRef(null);
  const editorRef = useRef(null);
  const [selection, setSelection] = useState(null);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");
  const tokens = getWords(article);

  useEffect(() => {
    function dismissEditor(event) {
      if (!contentRef.current?.contains(event.target) && !editorRef.current?.contains(event.target)) {
        setSelection(null);
      }
    }

    function dismissWithEscape(event) {
      if (event.key === "Escape") setSelection(null);
    }

    document.addEventListener("mousedown", dismissEditor);
    document.addEventListener("keydown", dismissWithEscape);
    return () => {
      document.removeEventListener("mousedown", dismissEditor);
      document.removeEventListener("keydown", dismissWithEscape);
    };
  }, []);

  function handleSelection() {
    const browserSelection = window.getSelection();
    const range = browserSelection?.rangeCount ? browserSelection.getRangeAt(0) : null;
    const root = contentRef.current;

    if (!range || !root || range.collapsed || !root.contains(range.commonAncestorContainer)) {
      setSelection(null);
      return;
    }

    const beforeRange = range.cloneRange();
    beforeRange.selectNodeContents(root);
    beforeRange.setEnd(range.startContainer, range.startOffset);
    const start = beforeRange.toString().length;
    const text = range.toString();

    if (!text.trim()) {
      setSelection(null);
      return;
    }
    setSelection({ start, end: start + text.length, text });
  }

  function saveUnderline() {
    if (!selection) return;
    onSaveUnderline({
      id: crypto.randomUUID(),
      start: selection.start,
      end: selection.end,
      text: selection.text,
      style: "wavy",
    });
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  }

  function hasUnderline(start, length) {
    return highlights.some((item) => item.start < start + length && item.end > start);
  }

  function startNoteEdit(item) {
    setEditingNoteId(item.id);
    setNoteDraft(item.note || "");
  }

  function saveNote(item) {
    onUpdateUnderline(item.id, { note: noteDraft.trim() });
    setEditingNoteId(null);
    setNoteDraft("");
  }

  let offset = 0;

  return (
    <main className="reader">
      <p className="reader-help">Select a sentence or paragraph, then choose whether to add a wavy underline.</p>
      <section
        className="content"
        aria-label="Article reader"
        ref={contentRef}
        onMouseUpCapture={() => window.setTimeout(handleSelection, 0)}
        onMouseUp={() => window.setTimeout(handleSelection, 0)}
        onTouchEnd={() => window.setTimeout(handleSelection, 0)}
      >
        {tokens.length === 0 ? (
          <p className="empty-reader">Paste an English article above to start reading.</p>
        ) : (
          tokens.map((token, index) => {
            const tokenStart = offset;
            offset += token.length;
            const underlineClass = hasUnderline(tokenStart, token.length) ? "underline-wavy" : "";
            const key = `${token}-${index}`;

            return /^[A-Za-z]+(?:'[A-Za-z]+)?$/.test(token) ? (
              <span
                className={`word ${underlineClass}`}
                key={key}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (window.getSelection()?.isCollapsed) onSelectWord(token);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectWord(token);
                  }
                }}
              >
                {token}
              </span>
            ) : (
              <span className={underlineClass} key={key}>{token}</span>
            );
          })
        )}
      </section>

      {selection && (
        <section className="underline-editor" aria-label="Add wavy underline" ref={editorRef}>
          <p><strong>Selected:</strong> “{selection.text.trim().slice(0, 100)}”</p>
          <div className="underline-actions">
            <button className="primary-button underline-save" onClick={saveUnderline}>Add wavy underline</button>
          </div>
        </section>
      )}

      {highlights.length > 0 && (
        <section className="highlights-list">
          <h3>Underlined passages</h3>
          {highlights.map((item) => (
            <article className="underline-note" key={item.id}>
              <p className="underline-wavy">“{item.text.trim()}”</p>
              {editingNoteId === item.id ? (
                <div className="note-editor">
                  <label className="input-label" htmlFor={`note-${item.id}`}>My note</label>
                  <textarea id={`note-${item.id}`} value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="Write your thought about this passage..." />
                  <div className="note-actions">
                    <button className="secondary-button" onClick={() => setEditingNoteId(null)}><X size={16} /> Cancel</button>
                    <button className="primary-button note-save" onClick={() => saveNote(item)}><Save size={16} /> Save note</button>
                  </div>
                </div>
              ) : (
                <>
                  {item.note && <div className="saved-note"><MessageSquare size={16} /><span>{item.note}</span></div>}
                  <div className="underline-item-actions">
                    <button className="text-button" onClick={() => startNoteEdit(item)}>{item.note ? <><Pencil size={16} /> Edit note</> : <><MessageSquare size={16} /> Add note</>}</button>
                    <button className="text-button delete-underline" onClick={() => onRemoveUnderline(item.id)}>Delete underline</button>
                  </div>
                </>
              )}
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
