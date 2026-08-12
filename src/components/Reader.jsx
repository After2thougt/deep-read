import { useEffect, useRef, useState } from "react";
import { MessageSquare, Pencil, Save, X } from "lucide-react";
import { getWords } from "../utils/text";

function splitParagraphs(text) {
  const parts = String(text || "").split(/(\r?\n\s*\r?\n)/);
  const paragraphs = [];
  let offset = 0;

  for (const part of parts) {
    if (!part) continue;
    if (/^\r?\n\s*\r?\n$/.test(part)) {
      offset += part.length;
      continue;
    }
    paragraphs.push({ text: part, start: offset });
    offset += part.length;
  }
  return paragraphs;
}

function highlightBoundaries(token, tokenStart, highlights) {
  const tokenEnd = tokenStart + token.length;
  const points = new Set([0, token.length]);
  for (const item of highlights) {
    if (item.start > tokenStart && item.start < tokenEnd) points.add(item.start - tokenStart);
    if (item.end > tokenStart && item.end < tokenEnd) points.add(item.end - tokenStart);
  }
  return [...points].sort((left, right) => left - right);
}

function isHighlighted(start, end, highlights) {
  return highlights.some((item) => item.start < end && item.end > start);
}

function getTextPosition(container, offset, root) {
  const textNode = container.nodeType === Node.TEXT_NODE ? container : null;
  const element = textNode ? textNode.parentElement : (container instanceof Element ? container : null);
  const anchor = element?.closest("[data-text-start]");
  if (!anchor || !root.contains(anchor)) return null;
  const start = Number(anchor.dataset.textStart);
  if (!Number.isFinite(start)) return null;
  return start + (textNode ? offset : 0);
}

export default function Reader({ article, articleOffset = 0, pageEnd = Infinity, highlights, onSelectWord, onSaveUnderline, onRemoveUnderline, onUpdateUnderline }) {
  const contentRef = useRef(null);
  const editorRef = useRef(null);
  const [selection, setSelection] = useState(null);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");

  useEffect(() => {
    function dismissEditor(event) {
      if (!contentRef.current?.contains(event.target) && !editorRef.current?.contains(event.target)) setSelection(null);
    }
    function dismissWithEscape(event) { if (event.key === "Escape") setSelection(null); }
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
    if (!range || !root || range.collapsed || !root.contains(range.startContainer) || !root.contains(range.endContainer)) {
      setSelection(null);
      return;
    }

    const start = getTextPosition(range.startContainer, range.startOffset, root);
    const end = getTextPosition(range.endContainer, range.endOffset, root);
    if (start == null || end == null || end <= start) return setSelection(null);
    const text = String(article || "").slice(start, end);
    if (!text.trim()) return setSelection(null);
    setSelection({ start, end, text });
  }

  function saveUnderline() {
    if (!selection) return;
    onSaveUnderline({ id: crypto.randomUUID(), start: articleOffset + selection.start, end: articleOffset + selection.end, text: selection.text, style: "wavy" });
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  }

  function startNoteEdit(item) { setEditingNoteId(item.id); setNoteDraft(item.note || ""); }
  function saveNote(item) { onUpdateUnderline(item.id, { note: noteDraft.trim() }); setEditingNoteId(null); setNoteDraft(""); }

  const paragraphs = splitParagraphs(article);
  const pageHighlights = highlights.filter((item) => item.start < pageEnd && item.end > articleOffset);

  function renderToken(token, tokenStart, key) {
    const absoluteTokenStart = articleOffset + tokenStart;
    const boundaries = highlightBoundaries(token, absoluteTokenStart, pageHighlights);
    const pieces = boundaries.slice(0, -1).map((boundary, index) => {
      const nextBoundary = boundaries[index + 1];
      const piece = token.slice(boundary, nextBoundary);
      const marked = isHighlighted(absoluteTokenStart + boundary, absoluteTokenStart + nextBoundary, pageHighlights);
      return <span className={marked ? "underline-wavy" : undefined} data-text-start={tokenStart + boundary} key={`${key}-${boundary}`}>{piece}</span>;
    });
    const isWord = /^[A-Za-z]+(?:'[A-Za-z]+)?$/.test(token);
    if (!isWord) return <span key={key}>{pieces}</span>;
    return <span className="word" key={key} role="button" tabIndex={0} onClick={() => onSelectWord(token)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectWord(token); } }}>{pieces}</span>;
  }

  return (
    <main className="reader reading-surface">
      <div className="reader-heading">
        <div><p className="eyebrow">Reading room</p></div>
        <span className="reader-hint">Select text in the article to add a note. Click a word to look it up.</span>
      </div>
      <section className="content" aria-label="Article reader" ref={contentRef} onMouseUp={() => window.setTimeout(handleSelection, 0)} onTouchEnd={() => window.setTimeout(handleSelection, 0)}>
        {!paragraphs.length ? <p className="empty-reader">Paste an English article above to start reading.</p> : paragraphs.map((paragraph, paragraphIndex) => {
          let tokenOffset = paragraph.start;
          return <div className="article-paragraph" key={`${paragraph.start}-${paragraphIndex}`}>
            <div className="paragraph-body">{getWords(paragraph.text).map((token, tokenIndex) => {
              const tokenStart = tokenOffset;
              tokenOffset += token.length;
              return renderToken(token, tokenStart, `${paragraphIndex}-${tokenIndex}`);
            })}</div>
          </div>;
        })}
      </section>

      {selection && <section className="underline-editor" aria-label="Add wavy underline" ref={editorRef}>
        <p><strong>Selected passage</strong><br />{selection.text.trim().slice(0, 140)}</p>
        <button className="primary-button underline-save" onClick={saveUnderline}>Add wavy underline</button>
      </section>}

      {pageHighlights.length > 0 && <section className="highlights-list">
        <div className="section-heading"><div><p className="eyebrow">Your notes</p><h3>Underlined passages</h3></div><span>{pageHighlights.length}</span></div>
        {pageHighlights.map((item) => <article className="underline-note" key={item.id}>
          <p className="underline-wavy">&ldquo;{item.text.trim()}&rdquo;</p>
          {editingNoteId === item.id ? <div className="note-editor"><label className="input-label" htmlFor={`note-${item.id}`}>My note</label><textarea id={`note-${item.id}`} value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="Write your thought about this passage..." /><div className="note-actions"><button className="secondary-button" onClick={() => setEditingNoteId(null)}><X size={16} /> Cancel</button><button className="primary-button note-save" onClick={() => saveNote(item)}><Save size={16} /> Save note</button></div></div> : <><>{item.note && <div className="saved-note"><MessageSquare size={16} /><span>{item.note}</span></div>}</><div className="underline-item-actions"><button className="text-button" onClick={() => startNoteEdit(item)}>{item.note ? <><Pencil size={16} /> Edit note</> : <><MessageSquare size={16} /> Add note</>}</button><button className="text-button delete-underline" onClick={() => onRemoveUnderline(item.id)}>Delete underline</button></div></>}
        </article>)}
      </section>}
    </main>
  );
}
