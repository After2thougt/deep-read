import { useEffect, useRef, useState } from "react";
import { ChevronDown, FilePlus2, Pencil, Save, Upload } from "lucide-react";
import { uploadArticleImage } from "../api/articles";
import { initialEditorBlocks } from "./article-editor-draft";
import "./article-editor.css";

export default function ArticleInput({
  title,
  article,
  blocks: propsBlocks,
  onTitleChange,
  onArticleChange,
  onBlocksChange,
  onSave,
  onNew,
  saveMessage,
}) {
  const [isCollapsed, setIsCollapsed] = useState(() => Boolean(article));
  const [blocks, setBlocks] = useState(() =>
    initialEditorBlocks(article, propsBlocks)
  );
  const [isSaving, setIsSaving] = useState(false);

  const editorRef = useRef(null);
  const inputTimer = useRef(null);
  const isComposing = useRef(false);
  const prevArticleRef = useRef(article);
  const initializedRef = useRef(false);

  /* ---------- helpers ---------- */

  function blocksToText(blks) {
    return (blks || [])
      .filter((b) => b.type === "text")
      .map((b) => b.content || "")
      .join("\n\n");
  }

  function serializeDOMToBlocks() {
    if (!editorRef.current) return blocks;
    const nodes = Array.from(editorRef.current.childNodes);
    const result = [];
    for (const node of nodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || "";
        if (text.trim()) result.push({ type: "text", content: text });
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.classList?.contains("article-editor-image")) {
          const img = node.querySelector("img");
          const src = img?.getAttribute("src") || "";
          if (src) result.push({ type: "image", content: src });
        } else {
          const text = node.innerText || node.textContent || "";
          if (text.trim()) result.push({ type: "text", content: text });
        }
      }
    }
    return result.length
      ? result
      : [{ type: "text", content: "" }];
  }

  function renderBlocksToDOM(blks) {
    if (!editorRef.current) return;
    editorRef.current.innerHTML = "";
    for (const block of blks) {
      if (block.type === "image" && block.content) {
        const wrapper = document.createElement("div");
        wrapper.className = "article-editor-image";
        wrapper.setAttribute("contenteditable", "false");
        wrapper.setAttribute("data-block-type", "image");
        const img = document.createElement("img");
        img.src = block.content;
        img.draggable = false;
        wrapper.appendChild(img);
        editorRef.current.appendChild(wrapper);
      } else if (block.type === "text") {
        const div = document.createElement("div");
        div.textContent = block.content || "";
        editorRef.current.appendChild(div);
      }
    }
    // Ensure at least one editable text block
    if (!editorRef.current.childNodes.length) {
      const div = document.createElement("div");
      editorRef.current.appendChild(div);
    }
  }

  /* ---------- lifecycle ---------- */

  // First mount: populate DOM from props
  useEffect(() => {
    if (!initializedRef.current) {
      const initBlocks = initialEditorBlocks(article, propsBlocks);
      setBlocks(initBlocks);
      renderBlocksToDOM(initBlocks);
      initializedRef.current = true;
      prevArticleRef.current = article;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When article identity changes (new article opened), re-initialise DOM
  useEffect(() => {
    if (!initializedRef.current || !editorRef.current) return;

    const prevEmpty = !prevArticleRef.current?.trim();
    const currEmpty = !article?.trim();

    if (
      prevEmpty !== currEmpty ||
      (article && prevArticleRef.current !== article)
    ) {
      const initBlocks = initialEditorBlocks(article, propsBlocks);
      setBlocks(initBlocks);
      renderBlocksToDOM(initBlocks);
      prevArticleRef.current = article;
    }
  }, [article]); // eslint-disable-line react-hooks/exhaustive-deps

  // Propagate isCollapsed based on article existence
  useEffect(() => {
    if (!article) setIsCollapsed(false);
  }, [article]);

  /* ---------- DOM events ---------- */

  function handleInput() {
    if (isComposing.current) return;
    clearTimeout(inputTimer.current);
    inputTimer.current = setTimeout(() => {
      const newBlocks = serializeDOMToBlocks();
      setBlocks(newBlocks);
      if (onBlocksChange) onBlocksChange(newBlocks);
      if (onArticleChange) onArticleChange(blocksToText(newBlocks));
    }, 300);
  }

  async function handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        await insertImageAtCursor(file);
        return;
      }
    }

    // Plain-text paste: let browser handle it, then sync
    setTimeout(() => handleInput(), 10);
  }

  function handleDrop(e) {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    const imageFile = [...files].find((f) => f.type.startsWith("image/"));
    if (!imageFile) return;

    // Place caret at drop point
    if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(e.clientX, e.clientY);
      if (range) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
    insertImageAtCursor(imageFile);
  }

  /* ---------- image insertion ---------- */

  async function insertImageAtCursor(file) {
    const sel = window.getSelection();
    let range = null;
    if (sel?.rangeCount) {
      range = sel.getRangeAt(0).cloneRange();
    }

    // Placeholder while uploading
    const placeholder = document.createElement("div");
    placeholder.className = "article-editor-image";
    placeholder.setAttribute("contenteditable", "false");
    placeholder.textContent = "Uploading image\u2026";
    placeholder.style.cssText =
      "padding:16px 12px;color:#64748b;font-style:italic;text-align:center;";

    // New empty text block so user can keep typing after the image
    const nextDiv = document.createElement("div");
    nextDiv.textContent = "";

    if (
      range &&
      editorRef.current &&
      editorRef.current.contains(range.commonAncestorContainer)
    ) {
      range.collapse(false);
      range.insertNode(nextDiv);
      range.insertNode(placeholder);
    } else {
      editorRef.current.appendChild(placeholder);
      editorRef.current.appendChild(nextDiv);
    }

    // Move caret into the fresh text block
    const newRange = document.createRange();
    newRange.setStart(nextDiv, 0);
    newRange.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(newRange);

    try {
      const result = await uploadArticleImage(file);
      const url = result?.url || result?.path || "";

      const wrapper = document.createElement("div");
      wrapper.className = "article-editor-image";
      wrapper.setAttribute("contenteditable", "false");
      wrapper.setAttribute("data-block-type", "image");
      const img = document.createElement("img");
      img.src = url;
      img.draggable = false;
      wrapper.appendChild(img);

      if (placeholder.parentNode) {
        placeholder.replaceWith(wrapper);
      }
    } catch {
      placeholder.textContent = "Upload failed. Remove this block or try again.";
      placeholder.style.color = "#b91c1c";
    }

    handleInput();
  }

  /* ---------- save ---------- */

  async function handleSave() {
    setIsSaving(true);
    const currentBlocks = serializeDOMToBlocks();
    setBlocks(currentBlocks);

    try {
      await onSave({
        content: blocksToText(currentBlocks),
        blocks: currentBlocks,
      });
    } finally {
      setIsSaving(false);
    }
  }

  /* ---------- TXT upload ---------- */

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file || !file.name.toLowerCase().endsWith(".txt")) return;

    const content = await file.text();
    onArticleChange(content);
    onTitleChange(file.name.replace(/\.txt$/i, ""));
    setIsCollapsed(true);
    event.target.value = "";
  }

  function startNewArticle() {
    onNew();
    setIsCollapsed(false);
  }

  /* ---------- collapsed view ---------- */

  if (isCollapsed) {
    const charCount = (article || "").length.toLocaleString();
    return (
      <section className="article-input article-summary">
        <div>
          <p className="eyebrow">Current article</p>
          <strong>{title || "Untitled article"}</strong>
          <p className="article-meta">{charCount} characters</p>
          {saveMessage && <p className="save-message">{saveMessage}</p>}
        </div>
        <div className="article-actions">
          <button
            className="secondary-button"
            onClick={() => setIsCollapsed(false)}
            type="button"
          >
            <Pencil size={18} /> Edit article
          </button>
          <button
            className="secondary-button"
            onClick={startNewArticle}
            type="button"
          >
            <FilePlus2 size={18} /> New article
          </button>
          <button
            className="primary-button save-article-button"
            onClick={onSave}
            type="button"
          >
            <Save size={18} /> Save article
          </button>
        </div>
      </section>
    );
  }

  /* ---------- editor view ---------- */

  const hasContent = blocks.some((b) => b.content?.trim());

  return (
    <section className="article-input">
      <div className="article-actions">
        <label className="upload-button">
          <Upload size={18} /> Upload TXT
          <input
            type="file"
            accept=".txt,text/plain"
            onChange={handleFileChange}
          />
        </label>
        <button
          className="secondary-button"
          onClick={startNewArticle}
          type="button"
        >
          <FilePlus2 size={18} /> New article
        </button>
        {article && (
          <button
            className="secondary-button"
            onClick={() => setIsCollapsed(true)}
            type="button"
          >
            <ChevronDown size={18} /> Collapse
          </button>
        )}
        <button
          className="primary-button save-article-button"
          onClick={handleSave}
          type="button"
          disabled={isSaving || !hasContent}
        >
          <Save size={18} /> {isSaving ? "Saving..." : "Save article"}
        </button>
      </div>

      <label className="input-label" htmlFor="article-title">
        Article title
      </label>
      <input
        className="title-input"
        id="article-title"
        value={title}
        placeholder="Untitled article"
        onChange={(event) => onTitleChange(event.target.value)}
      />

      <label className="input-label" htmlFor="article-input">
        Your article
      </label>
      <div
        id="article-input"
        ref={editorRef}
        className="article-rich-editor"
        contentEditable
        suppressContentEditableWarning
        data-placeholder="Write or paste your article here..."
        onInput={handleInput}
        onPaste={handlePaste}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onCompositionStart={() => {
          isComposing.current = true;
        }}
        onCompositionEnd={() => {
          isComposing.current = false;
          handleInput();
        }}
      />

      {saveMessage && <p className="save-message">{saveMessage}</p>}
    </section>
  );
}