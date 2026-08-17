import { useEffect, useMemo, useRef, useState } from "react";
import {
  MessageSquare,
  Pencil,
  Save,
  X,
  Languages,
  Sparkles,
} from "lucide-react";
import { getWords } from "../utils/text";
import { generateId } from "../utils/id";

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
    if (item.start > tokenStart && item.start < tokenEnd) {
      points.add(item.start - tokenStart);
    }
    if (item.end > tokenStart && item.end < tokenEnd) {
      points.add(item.end - tokenStart);
    }
  }

  return [...points].sort((a, b) => a - b);
}

function isHighlighted(start, end, highlights) {
  return highlights.some((item) => item.start < end && item.end > start);
}

function getTextPosition(container, offset, root) {
  const textNode = container.nodeType === Node.TEXT_NODE ? container : null;
  const element = textNode
    ? textNode.parentElement
    : container instanceof Element
      ? container
      : null;

  const anchor = element?.closest("[data-text-start]");
  if (!anchor || !root.contains(anchor)) return null;

  const start = Number(anchor.dataset.textStart);
  if (!Number.isFinite(start)) return null;

  return start + (textNode ? offset : 0);
}

export default function Reader({
  article,
  blocks = null,
  articleOffset = 0,
  pageEnd = Infinity,
  highlights,
  onSelectWord,
  onSaveUnderline,
  onRemoveUnderline,
  onUpdateUnderline,
  onTranslateArticle,
  onAnalyzeArticle,
  translating = false,
  analyzing = false,
}) {
  const contentRef = useRef(null);
  const selectionToolbarRef = useRef(null);
  const toolbarRef = useRef(null);
  const dragStateRef = useRef(null);

  const [selection, setSelection] = useState(null);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");

  const [toolbarPosition, setToolbarPosition] = useState(() => {
    try {
      const saved = localStorage.getItem("deepread:learning-toolbar-position");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) {
          return parsed;
        }
      }
    } catch {}

    return {
      x: Math.max(window.innerWidth - 190, 20),
      y: Math.max(window.innerHeight - 90, 20),
    };
  });

  const contentBlocks = Array.isArray(blocks) && blocks.length
    ? blocks
    : [{ type: "text", content: String(article || "") }];

  console.log("[Reader] rendering – article.blocks (prop)", blocks, "contentBlocks", contentBlocks);

  const pageHighlights = useMemo(
    () =>
      highlights.filter(
        (item) => item.start < pageEnd && item.end > articleOffset
      ),
    [highlights, pageEnd, articleOffset]
  );

  useEffect(() => {
    function dismissSelection(event) {
      if (
        !contentRef.current?.contains(event.target) &&
        !selectionToolbarRef.current?.contains(event.target)
      ) {
        setSelection(null);
      }
    }

    function dismissWithEscape(event) {
      if (event.key === "Escape") setSelection(null);
    }

    document.addEventListener("mousedown", dismissSelection);
    document.addEventListener("keydown", dismissWithEscape);

    return () => {
      document.removeEventListener("mousedown", dismissSelection);
      document.removeEventListener("keydown", dismissWithEscape);
    };
  }, []);

  useEffect(() => {
    function handlePointerMove(event) {
      const drag = dragStateRef.current;
      const toolbar = toolbarRef.current;
      if (!drag || !toolbar) return;

      const rect = toolbar.getBoundingClientRect();
      const margin = 12;

      const x = Math.max(
        margin,
        Math.min(
          event.clientX - drag.offsetX,
          window.innerWidth - rect.width - margin
        )
      );

      const y = Math.max(
        margin,
        Math.min(
          event.clientY - drag.offsetY,
          window.innerHeight - rect.height - margin
        )
      );

      setToolbarPosition({ x, y });
    }

    function handlePointerUp() {
      if (!dragStateRef.current) return;

      dragStateRef.current = null;
      document.body.classList.remove("is-dragging-toolbar");

      setToolbarPosition((position) => {
        try {
          localStorage.setItem(
            "deepread:learning-toolbar-position",
            JSON.stringify(position)
          );
        } catch {}
        return position;
      });
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  useEffect(() => {
    function keepToolbarInViewport() {
      const toolbar = toolbarRef.current;
      if (!toolbar) return;

      const rect = toolbar.getBoundingClientRect();
      const margin = 12;

      setToolbarPosition((position) => {
        const next = {
          x: Math.max(
            margin,
            Math.min(position.x, window.innerWidth - rect.width - margin)
          ),
          y: Math.max(
            margin,
            Math.min(position.y, window.innerHeight - rect.height - margin)
          ),
        };

        if (next.x === position.x && next.y === position.y) return position;
        return next;
      });
    }

    window.addEventListener("resize", keepToolbarInViewport);
    return () => window.removeEventListener("resize", keepToolbarInViewport);
  }, []);

  function startToolbarDrag(event) {
    if (event.button !== 0) return;

    const toolbar = toolbarRef.current;
    if (!toolbar) return;

    const rect = toolbar.getBoundingClientRect();

    dragStateRef.current = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };

    document.body.classList.add("is-dragging-toolbar");
    event.preventDefault();
  }

  function handleSelection() {
    const browserSelection = window.getSelection();
    const range = browserSelection?.rangeCount
      ? browserSelection.getRangeAt(0)
      : null;
    const root = contentRef.current;

    if (
      !range ||
      !root ||
      range.collapsed ||
      !root.contains(range.startContainer) ||
      !root.contains(range.endContainer)
    ) {
      setSelection(null);
      return;
    }

    const start = getTextPosition(range.startContainer, range.startOffset, root);
    const end = getTextPosition(range.endContainer, range.endOffset, root);

    if (start == null || end == null || end <= start) {
      setSelection(null);
      return;
    }

    const text = String(article || "").slice(start, end);
    if (!text.trim()) {
      setSelection(null);
      return;
    }

    const rect = range.getBoundingClientRect();

    setSelection({
      start,
      end,
      text,
      rect: {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      },
    });
  }

  function saveUnderline() {
    if (!selection) return;

    onSaveUnderline({
      id: generateId("underline"),
      start: articleOffset + selection.start,
      end: articleOffset + selection.end,
      text: selection.text,
      style: "wavy",
    });

    window.getSelection()?.removeAllRanges();
    setSelection(null);
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

  function renderToken(token, tokenStart, key) {
    const absoluteTokenStart = articleOffset + tokenStart;
    const boundaries = highlightBoundaries(
      token,
      absoluteTokenStart,
      pageHighlights
    );

    const pieces = boundaries.slice(0, -1).map((boundary, index) => {
      const nextBoundary = boundaries[index + 1];
      const piece = token.slice(boundary, nextBoundary);
      const marked = isHighlighted(
        absoluteTokenStart + boundary,
        absoluteTokenStart + nextBoundary,
        pageHighlights
      );

      return (
        <span
          className={marked ? "underline-wavy" : undefined}
          data-text-start={tokenStart + boundary}
          key={`${key}-${boundary}`}
        >
          {piece}
        </span>
      );
    });

    const isWord = /^[A-Za-z]+(?:'[A-Za-z]+)?$/.test(token);

    if (!isWord) {
      return <span key={key}>{pieces}</span>;
    }

    return (
      <span
        className="word"
        key={key}
        role="button"
        tabIndex={0}
        onClick={() => onSelectWord(token)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelectWord(token);
          }
        }}
      >
        {pieces}
      </span>
    );
  }

  return (
    <main className="reader reading-surface">
      <div className="reader-heading">
        <div>
          <p className="eyebrow">Reading room</p>
        </div>
      </div>

      <section
        className="content"
        aria-label="Article reader"
        ref={contentRef}
        onMouseUp={() => window.setTimeout(handleSelection, 0)}
        onTouchEnd={() => window.setTimeout(handleSelection, 0)}
      >
        {!contentBlocks.some((block) => block.type === "text" && block.content) && !contentBlocks.some((block) => block.type === "image") ? (
          <p className="empty-reader">
            Paste an English article above to start reading.
          </p>
        ) : (
          (() => {
            let contentOffset = 0;
            return contentBlocks.map((block, blockIndex) => {
              if (block.type === "image") {
                return (
                  <div className="article-image-block" key={block.id || `${block.content}-${blockIndex}`}>
                    <img className="article-image" src={block.content} alt="" />
                  </div>
                );
              }

              const textParagraphs = splitParagraphs(block.content);
              // blockStart must be page-local (relative to pageContent),
              // not absolute within the full article.
              const blockStart = Number.isFinite(block.textOffset)
                ? block.textOffset - articleOffset
                : contentOffset;
              contentOffset += String(block.content || "").length;

              return textParagraphs.map((paragraph, paragraphIndex) => {
                let tokenOffset = blockStart + paragraph.start;
                return (
                  <div className="article-paragraph" key={`${block.id || blockIndex}-${paragraph.start}-${paragraphIndex}`}>
                    <div className="paragraph-body">
                      {getWords(paragraph.text).map((token, tokenIndex) => {
                        const tokenStart = tokenOffset;
                        tokenOffset += token.length;
                        return renderToken(token, tokenStart, `${blockIndex}-${paragraphIndex}-${tokenIndex}`);
                      })}
                    </div>
                  </div>
                );
              });
            });
          })()
        )}
      </section>

      <div
        ref={toolbarRef}
        className="learning-toolbar-floating"
        style={{
          position: "fixed",
          left: `${toolbarPosition.x}px`,
          top: `${toolbarPosition.y}px`,
        }}
      >
        <div
          className="learning-toolbar-drag-handle"
          onPointerDown={startToolbarDrag}
          title="Drag toolbar"
          role="button"
          tabIndex={0}
          aria-label="Drag learning toolbar"
        >
          <span className="toolbar-drag-dots">⋮⋮</span>
        </div>

        <div className="learning-toolbar-actions">
          <button
            className="learning-tool-button"
            onClick={onTranslateArticle}
            type="button"
            disabled={!article.trim() || translating}
            title="Translate the current article page"
          >
            <Languages size={17} />
            <span>{translating ? "Translating..." : "Translate"}</span>
          </button>

          <button
            className="learning-tool-button"
            onClick={onAnalyzeArticle}
            type="button"
            disabled={!article.trim() || analyzing}
            title="Analyze the current article page"
          >
            <Sparkles size={17} />
            <span>{analyzing ? "Analyzing..." : "Analyze"}</span>
          </button>
        </div>
      </div>

      {selection && (
        <div
          className="selection-toolbar"
          ref={selectionToolbarRef}
          style={{
            position: "fixed",
            top: `${Math.max(12, selection.rect.top - 52)}px`,
            left: `${Math.max(
              12,
              selection.rect.left + selection.rect.width / 2
            )}px`,
            transform: "translateX(-50%)",
          }}
        >
          <button
            type="button"
            className="selection-tool-button"
            onClick={saveUnderline}
          >
            <span className="underline-preview">〰</span>
            Underline
          </button>
        </div>
      )}

      {pageHighlights.length > 0 && (
        <section className="highlights-list">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Your notes</p>
              <h3>Underlined passages</h3>
            </div>
            <span>{pageHighlights.length}</span>
          </div>

          {pageHighlights.map((item) => (
            <article className="underline-note" key={item.id}>
              <p className="underline-wavy">
                &ldquo;{item.text.trim()}&rdquo;
              </p>

              {editingNoteId === item.id ? (
                <div className="note-editor">
                  <label
                    className="input-label"
                    htmlFor={`note-${item.id}`}
                  >
                    My note
                  </label>

                  <textarea
                    id={`note-${item.id}`}
                    value={noteDraft}
                    onChange={(event) => setNoteDraft(event.target.value)}
                    placeholder="Write your thought about this passage..."
                  />

                  <div className="note-actions">
                    <button
                      className="secondary-button"
                      onClick={() => {
                        setEditingNoteId(null);
                        setNoteDraft("");
                      }}
                      type="button"
                    >
                      <X size={16} />
                      Cancel
                    </button>

                    <button
                      className="primary-button note-save"
                      onClick={() => saveNote(item)}
                      type="button"
                    >
                      <Save size={16} />
                      Save note
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {item.note && (
                    <div className="saved-note">
                      <MessageSquare size={16} />
                      <span>{item.note}</span>
                    </div>
                  )}

                  <div className="underline-item-actions">
                    <button
                      className="text-button"
                      onClick={() => startNoteEdit(item)}
                      type="button"
                    >
                      {item.note ? (
                        <>
                          <Pencil size={16} />
                          Edit note
                        </>
                      ) : (
                        <>
                          <MessageSquare size={16} />
                          Add note
                        </>
                      )}
                    </button>

                    <button
                      className="text-button delete-underline"
                      onClick={() => onRemoveUnderline(item.id)}
                      type="button"
                    >
                      Delete
                    </button>
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
