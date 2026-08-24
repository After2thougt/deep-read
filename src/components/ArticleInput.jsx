import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, FilePlus2, Pencil, Save, Upload } from "lucide-react";
import { uploadArticleImage } from "../api/articles";
import { initialEditorBlocks, editorSourceSignature } from "./article-editor-draft";
import useDraft from "../hooks/useDraft";
import "./article-editor.css";

export default function ArticleInput({
  title,
  article,
  articleId,
  blocks: propsBlocks,
  onTitleChange,
  onArticleChange,
  onBlocksChange,
  onSave,
  onNewArticle,
  onBackToArticles,
  saveMessage,
}) {
  // View mode is per-article. New articles default to edit mode.
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (!articleId) return false; // new article -> edit mode
    try {
      const saved = localStorage.getItem(`deepread:reader-view-mode:${articleId}`);
      if (saved !== null) {
        return JSON.parse(saved);
      }
    } catch {}
    return true; // existing article -> reading mode
  });
  const [blocks, setBlocks] = useState(() =>
    initialEditorBlocks(article, propsBlocks)
  );
  const [isSaving, setIsSaving] = useState(false);

  const editorRef = useRef(null);
  const inputTimer = useRef(null);
  const isComposing = useRef(false);
  const initializedRef = useRef(false);
  const selectedImageEl = useRef(null);
  const isReplacingRef = useRef(false);
  const checkedIdsRef = useRef(new Set());
  const lastRenderedArticleIdRef = useRef(null);

  /* ---------- helpers ---------- */

  function blocksToText(blks) {
    return (blks || [])
      .filter((b) => b.type === "text")
      .map((b) => b.content || "")
      .join("\n\n");
  }

  function serializeDOMToBlocks() {
    if (!editorRef.current) return blocks;
    // Use querySelectorAll to survive browser DOM restructuring inside contentEditable
    const imageWrappers = Array.from(
      editorRef.current.querySelectorAll(".article-editor-image")
    );
    const imagePositions = new Map();
    for (const wrapper of imageWrappers) {
      const pos = childNodeIndexOf(editorRef.current, wrapper);
      if (pos >= 0) imagePositions.set(pos, wrapper);
    }

    const nodes = Array.from(editorRef.current.childNodes);
    const result = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      // Image block – detected via class match (handles both direct children
      // and wrappers buried by browser quirks)
      if (node.nodeType === Node.ELEMENT_NODE && node.classList?.contains("article-editor-image")) {
        const img = node.querySelector("img");
        const src = img?.getAttribute("src") || "";
        if (src) result.push({ type: "image", content: src });
        continue;
      }
      // If an image wrapper exists deeper in this child (browser wrapping), extract it
      if (imagePositions.has(i)) {
        const wrapper = imagePositions.get(i);
        const img = wrapper.querySelector("img");
        const src = img?.getAttribute("src") || "";
        if (src) result.push({ type: "image", content: src });
        continue;
      }
      // Also check whether this node CONTAINS an image wrapper as a descendant
      if (node.nodeType === Node.ELEMENT_NODE && !node.classList?.contains("article-editor-image")) {
        const innerImage = node.querySelector(".article-editor-image");
        if (innerImage) {
          const img = innerImage.querySelector("img");
          const src = img?.getAttribute("src") || "";
          if (src) result.push({ type: "image", content: src });
          continue;
        }
      }
      if (node.nodeType === Node.TEXT_NODE) {
        result.push({ type: "text", content: node.textContent || "" });
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        result.push({ type: "text", content: node.innerText || node.textContent || "" });
      }
    }
    return compactBlocks(result);
  }

  /** Merge runs of consecutive empty text blocks into a single empty block
   *  so the editor stays compact and serialised payloads are minimal. */
  function compactBlocks(blks) {
    const out = [];
    for (let i = 0; i < blks.length; i++) {
      const b = blks[i];
      if (b.type === "text" && (b.content || "").trim() === "") {
        const prev = out[out.length - 1];
        if (prev?.type === "text" && (prev.content || "").trim() === "") continue;
        out.push(b);
      } else {
        out.push(b);
      }
    }
    return out.length ? out : [{ type: "text", content: "" }];
  }

  /** Returns the index of `descendant` among the childNodes of `parent`,
   *  walking up through intermediate ancestors. */
  function childNodeIndexOf(parent, descendant) {
    let el = descendant;
    while (el && el.parentNode !== parent) {
      el = el.parentNode;
    }
    if (!el || el.parentNode !== parent) return -1;
    return Array.from(parent.childNodes).indexOf(el);
  }

  /** Create an editable text block with a <br> anchor so the cursor
   *  reliably lands inside contentEditable. */
  function createTextBlock(content) {
    const div = document.createElement("div");
    div.className = "article-editor-text";
    if (content) {
      div.textContent = content;
    } else {
      div.appendChild(document.createElement("br"));
    }
    return div;
  }

  /** Place the selection at the start of `block`. */
  function placeCursorInBlock(block) {
    const sel = window.getSelection();
    if (!sel || !block) return;
    const range = document.createRange();
    range.selectNodeContents(block);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /** Ensure the editor's last child is an editable text block so the user
   *  can always type after the final image. */
  function ensureTrailingTextBlock() {
    if (!editorRef.current) return;
    const last = editorRef.current.lastChild;
    if (!last || last.classList?.contains("article-editor-image")) {
      editorRef.current.appendChild(createTextBlock());
    }
  }

  function createImageWrapper(src) {
    const wrapper = document.createElement("div");
    wrapper.className = "article-editor-image";
    wrapper.setAttribute("contenteditable", "false");
    wrapper.setAttribute("data-block-type", "image");
    wrapper.setAttribute("data-image-src", src);

    const img = document.createElement("img");
    img.src = src;
    img.setAttribute("src", src);
    img.draggable = false;
    wrapper.appendChild(img);

    const actions = document.createElement("div");
    actions.className = "article-editor-image-actions";

    const replaceBtn = document.createElement("button");
    replaceBtn.className = "article-editor-image-action";
    replaceBtn.type = "button";
    replaceBtn.textContent = "Replace";
    replaceBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      replaceImageBlock(wrapper);
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "article-editor-image-action article-editor-image-remove";
    removeBtn.type = "button";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeImageBlock(wrapper);
    });

    actions.appendChild(replaceBtn);
    actions.appendChild(removeBtn);
    wrapper.appendChild(actions);

    return wrapper;
  }

  function renderBlocksToDOM(blks) {
    if (!editorRef.current) return;
    selectedImageEl.current = null;
    editorRef.current.innerHTML = "";
    for (const block of blks) {
      if (block.type === "image" && block.content) {
        editorRef.current.appendChild(createImageWrapper(block.content));
      } else if (block.type === "text") {
        editorRef.current.appendChild(createTextBlock(block.content));
      }
    }
    ensureTrailingTextBlock();
  }

  /* ---------- draft ---------- */

  const { readDraft, saveDraft, clearDraft } = useDraft(articleId);

  const [showRestorePrompt, setShowRestorePrompt] = useState(false);

  function handleRestoreDraft() {
    const draft = readDraft();
    if (!draft?.blocks?.length) return;
    setBlocks(draft.blocks);
    renderBlocksToDOM(draft.blocks);
    if (draft.title && onTitleChange) onTitleChange(draft.title);
    if (onBlocksChange) onBlocksChange(draft.blocks);
    if (onArticleChange) onArticleChange(blocksToText(draft.blocks));
    setShowRestorePrompt(false);
  }

  function handleIgnoreDraft() {
    setShowRestorePrompt(false);
    // Draft intentionally preserved in localStorage
  }

  /* ---------- lifecycle ---------- */

  // First mount: populate DOM from props, then check for draft
  useEffect(() => {
    if (!initializedRef.current) {
      const initBlocks = initialEditorBlocks(article, propsBlocks);
      setBlocks(initBlocks);
      renderBlocksToDOM(initBlocks);
      initializedRef.current = true;
      lastRenderedArticleIdRef.current = articleId ?? "__new__";
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // After first mount: check if a newer draft exists for this article
  useEffect(() => {
    if (!initializedRef.current) return;
    const idKey = articleId || "__new__";
    if (checkedIdsRef.current.has(idKey)) return;
    checkedIdsRef.current.add(idKey);

    const draft = readDraft();
    if (!draft?.blocks?.length) return;

    const current = initialEditorBlocks(article, propsBlocks);
    if (
      editorSourceSignature(null, draft.blocks) !==
      editorSourceSignature(null, current)
    ) {
      setShowRestorePrompt(true);
    }
  }, [articleId, readDraft, article, propsBlocks]);

  // When article identity changes (new article opened), re-initialise DOM.
  // Uses articleId (identity) not article (content) so typing never triggers this.
  useEffect(() => {
    if (!initializedRef.current || !editorRef.current) return;

    const currentId = articleId ?? "__new__";
    if (currentId === lastRenderedArticleIdRef.current) return;

    selectedImageEl.current = null;
    const initBlocks = initialEditorBlocks(article, propsBlocks);
    setBlocks(initBlocks);
    renderBlocksToDOM(initBlocks);
    lastRenderedArticleIdRef.current = currentId;
  }, [articleId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Propagate isCollapsed based on article existence
  // Only auto-expand for NEW articles (no articleId).
  // Existing articles keep their persisted view mode (or default reading mode).
  useEffect(() => {
    if (!articleId && !article) setIsCollapsed(false);
  }, [article, articleId]);

  // When the editor transitions from collapsed → expanded the contentEditable
  // DOM element mounts for the first time.  If the mount effect (#1) already
  // ran before the DOM existed, populate it now with the current blocks.
  // This is deliberately a single-effect fix — it does NOT re-render on every
  // blocks change, which would reset the cursor while typing.
  useEffect(() => {
    if (isCollapsed) return;
    if (!editorRef.current) return;
    if (editorRef.current.hasChildNodes()) return;
    renderBlocksToDOM(blocks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCollapsed]);

  // Persist view mode (collapsed/expanded) to localStorage per article
  // Only persist for saved articles (with articleId)
  useEffect(() => {
    if (!articleId) return;
    try {
      localStorage.setItem(`deepread:reader-view-mode:${articleId}`, JSON.stringify(isCollapsed));
    } catch {}
  }, [isCollapsed, articleId]);

  // Auto-save blocks + title to localStorage on every change
  useEffect(() => {
    if (blocks.some((b) => b.content?.trim())) {
      saveDraft(blocks, title);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, title]);

  /* ---------- DOM events ---------- */

  /** Immediately serialise DOM → blocks and propagate to parent.
   *  Used after image operations so the Reader updates without the 300 ms
   *  typing debounce. */
  function syncNow() {
    clearTimeout(inputTimer.current);
    const newBlocks = serializeDOMToBlocks();
    console.log("[ArticleInput] syncNow – editor blocks", newBlocks);
    setBlocks(newBlocks);
    if (onBlocksChange) onBlocksChange(newBlocks);
    if (onArticleChange) onArticleChange(blocksToText(newBlocks));
  }

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

    // Text anchor that will sit after the image.
    // May be reassigned if an existing empty block can be reused.
    let textAnchor = createTextBlock();

    if (
      range &&
      editorRef.current &&
      editorRef.current.contains(range.commonAncestorContainer)
    ) {
      // Normalise to editorRef's direct-child level so we always insert
      // image + text anchor as top-level siblings (never inside a text block).
      let cursorChild = range.commonAncestorContainer;
      while (cursorChild && cursorChild.parentNode !== editorRef.current) {
        cursorChild = cursorChild.parentNode;
      }

      const isEmpty = (el) =>
        el?.classList?.contains("article-editor-text") &&
        (el.innerText || el.textContent || "").trim() === "";

      const thisBlockEmpty =
        cursorChild &&
        cursorChild.parentNode === editorRef.current &&
        isEmpty(cursorChild);

      const nextBlockEmpty =
        cursorChild &&
        cursorChild.parentNode === editorRef.current &&
        isEmpty(cursorChild.nextSibling);

      // NEW: If cursor is inside a non-empty text block and not at the very end,
      // split the text content so the image is placed at the exact cursor position
      // (e.g. "Hello |world" → [Hello][image][world]), rather than after the
      // entire paragraph.
      let didSplit = false;
      if (
        cursorChild?.classList?.contains("article-editor-text") &&
        range
      ) {
        const afterRange = document.createRange();
        afterRange.setStart(range.startContainer, range.startOffset);
        afterRange.setEnd(cursorChild, cursorChild.childNodes.length);
        const afterText = afterRange.toString();

        if (afterText) {
          const beforeRange = document.createRange();
          beforeRange.selectNodeContents(cursorChild);
          beforeRange.setEnd(range.startContainer, range.startOffset);
          const beforeText = beforeRange.toString();

          // Replace current text block with the part before the cursor
          cursorChild.innerHTML = "";
          if (beforeText) {
            cursorChild.textContent = beforeText;
          } else {
            cursorChild.appendChild(document.createElement("br"));
          }

          // textAnchor now holds the part after the cursor
          textAnchor = createTextBlock(afterText);
          didSplit = true;
        }
      }

      if (cursorChild && cursorChild.parentNode === editorRef.current) {
        if (didSplit) {
          // Text was split — insert placeholder + textAnchor after cursorChild
          const ref = cursorChild.nextSibling;
          editorRef.current.insertBefore(placeholder, ref);
          editorRef.current.insertBefore(textAnchor, ref);
        } else if (nextBlockEmpty) {
          // Reuse the next empty block instead of creating a new anchor.
          textAnchor = cursorChild.nextSibling;
          editorRef.current.insertBefore(placeholder, textAnchor);
        } else if (thisBlockEmpty) {
          // Cursor is already in an empty block — reuse it.
          textAnchor = cursorChild;
          editorRef.current.insertBefore(placeholder, cursorChild);
        } else {
          const ref = cursorChild.nextSibling;
          editorRef.current.insertBefore(placeholder, ref);
          editorRef.current.insertBefore(textAnchor, ref);
        }
      } else {
        editorRef.current.appendChild(placeholder);
        editorRef.current.appendChild(textAnchor);
      }
    } else {
      // No selection – append to end.  Reuse trailing empty block if present.
      const last = editorRef.current?.lastChild;
      if (
        last?.classList?.contains("article-editor-text") &&
        (last.innerText || last.textContent || "").trim() === ""
      ) {
        textAnchor = last;
        editorRef.current.insertBefore(placeholder, last);
      } else {
        editorRef.current.appendChild(placeholder);
        editorRef.current.appendChild(textAnchor);
      }
    }

    try {
      const result = await uploadArticleImage(file);
      const url = result?.url || result?.path || "";
      const newWrapper = createImageWrapper(url);

      if (placeholder.parentNode) {
        placeholder.replaceWith(newWrapper);
      }

      // Place cursor in the text anchor so the user can type after the image
      placeCursorInBlock(textAnchor);
    } catch {
      placeholder.textContent = "Upload failed. Remove this block or try again.";
      placeholder.style.color = "#b91c1c";
    }

    syncNow();
  }

  /* ---------- image management ---------- */

  function selectImageBlock(wrapper) {
    const prev = selectedImageEl.current;
    if (prev && prev !== wrapper) {
      prev.classList.remove("is-selected");
    }
    if (wrapper.classList.contains("is-selected")) {
      wrapper.classList.remove("is-selected");
      selectedImageEl.current = null;
    } else {
      wrapper.classList.add("is-selected");
      selectedImageEl.current = wrapper;
    }
  }

  function deselectAllImages() {
    const prev = selectedImageEl.current;
    if (prev) {
      prev.classList.remove("is-selected");
      selectedImageEl.current = null;
    }
  }

  function removeImageBlock(wrapper) {
    if (wrapper?.parentNode) {
      const prev = wrapper.previousSibling;
      const next = wrapper.nextSibling;
      wrapper.remove();
      deselectAllImages();

      // When both neighbours are empty text blocks, remove one so we
      // don't accumulate redundant anchors.
      const isEmpty = (el) =>
        el?.classList?.contains("article-editor-text") &&
        (el.innerText || el.textContent || "").trim() === "";
      if (isEmpty(prev) && isEmpty(next)) {
        next.remove();
      }

      ensureTrailingTextBlock();
      syncNow();
    }
  }

  async function replaceImageBlock(wrapper) {
    if (isReplacingRef.current) return;
    isReplacingRef.current = true;

    const replaceBtn = wrapper.querySelector(".article-editor-image-action");
    const originalText = replaceBtn?.textContent || "Replace";
    if (replaceBtn) {
      replaceBtn.textContent = "Uploading\u2026";
      replaceBtn.disabled = true;
    }

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file || !wrapper?.parentNode) {
        isReplacingRef.current = false;
        if (replaceBtn) {
          replaceBtn.textContent = originalText;
          replaceBtn.disabled = false;
        }
        return;
      }

      const img = wrapper.querySelector("img");
      const oldSrc = img?.getAttribute("src") || "";
      if (img) img.style.opacity = "0.4";

      try {
        const result = await uploadArticleImage(file);
        const url = result?.url || result?.path || "";
        if (img && url) {
          img.src = url;
          img.setAttribute("src", url);
          img.style.opacity = "";
          wrapper.setAttribute("data-image-src", url);
        }
      } catch {
        if (img) {
          img.src = oldSrc;
          img.setAttribute("src", oldSrc);
          img.style.opacity = "";
        }
      }

      isReplacingRef.current = false;
      if (replaceBtn) {
        replaceBtn.textContent = originalText;
        replaceBtn.disabled = false;
      }

      syncNow();
    };
    input.click();
  }

  function handleEditorClick(e) {
    const imageWrapper = e.target.closest(".article-editor-image");
    if (imageWrapper && editorRef.current?.contains(imageWrapper)) {
      selectImageBlock(imageWrapper);
    } else {
      deselectAllImages();
    }
  }

  /* ---------- save ---------- */

  async function handleSave() {
    setIsSaving(true);
    const currentBlocks = serializeDOMToBlocks();
    setBlocks(currentBlocks);
    console.log("[ArticleInput] handleSave – save payload", { content: blocksToText(currentBlocks), blocks: currentBlocks });

    try {
      await onSave({
        content: blocksToText(currentBlocks),
        blocks: currentBlocks,
      });
      clearDraft();
      setShowRestorePrompt(false);
      setIsCollapsed(true);
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
      onNewArticle?.();
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
            <Pencil size={18} /> Edit 
          </button>
          {onBackToArticles && (
            <button
              className="secondary-button back-to-articles"
              onClick={onBackToArticles}
              type="button"
            >
              <ChevronLeft size={18} /> Back to Articles
            </button>
          )}
          
        
        </div>
      </section>
    );
  }

  /* ---------- editor view ---------- */

  const hasContent = blocks.some((b) => b.content?.trim());

  return (
    <section className="article-input">
      {showRestorePrompt && (
        <div className="draft-restore-banner">
          <span className="draft-restore-message">
            ⚠️ Unsaved draft found for this article.
          </span>
          <div className="draft-restore-actions">
            <button
              className="primary-button"
              type="button"
              onClick={handleRestoreDraft}
            >
              Restore
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={handleIgnoreDraft}
            >
              Ignore
            </button>
          </div>
        </div>
      )}
      <div className="article-actions">
        {onBackToArticles && (
          <button
            className="secondary-button back-to-articles"
            onClick={onBackToArticles}
            type="button"
          >
            <ChevronLeft size={18} /> Back to Articles
          </button>
        )}
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
          <Save size={18} /> {isSaving ? "Saving..." : "Save "}
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
        onClick={handleEditorClick}
      />

      {saveMessage && <p className="save-message">{saveMessage}</p>}
    </section>
  );
}