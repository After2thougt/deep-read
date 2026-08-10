import { useEffect, useState } from "react";
import { ChevronDown, FilePlus2, Pencil, Save, Upload } from "lucide-react";

export default function ArticleInput({
  title,
  article,
  onTitleChange,
  onArticleChange,
  onSave,
  onNew,
  saveMessage,
}) {
  const [isCollapsed, setIsCollapsed] = useState(() => Boolean(article));

  useEffect(() => {
    if (!article) setIsCollapsed(false);
  }, [article]);

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file || !file.name.toLowerCase().endsWith(".txt")) return;

    const content = await file.text();
    onArticleChange(content);
    onTitleChange(file.name.replace(/\.txt$/i, ""));
    setIsCollapsed(true);
    event.target.value = "";
  }

  function handlePaste() {
    window.setTimeout(() => {
      setIsCollapsed(true);
    }, 0);
  }

  function startNewArticle() {
    onNew();
    setIsCollapsed(false);
  }

  if (isCollapsed) {
    return (
      <section className="article-input article-summary">
        <div>
          <p className="eyebrow">Current article</p>
          <strong>{title || "Untitled article"}</strong>
          <p className="article-meta">{article.length.toLocaleString()} characters</p>
          {saveMessage && <p className="save-message">{saveMessage}</p>}
        </div>
        <div className="article-actions">
          <button className="secondary-button" onClick={() => setIsCollapsed(false)} type="button">
            <Pencil size={18} /> Edit article
          </button>
          <button className="secondary-button" onClick={startNewArticle} type="button">
            <FilePlus2 size={18} /> New article
          </button>
          <button className="primary-button save-article-button" onClick={onSave} type="button">
            <Save size={18} /> Save article
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="article-input">
      <div className="article-actions">
        <label className="upload-button">
          <Upload size={18} /> Upload TXT
          <input type="file" accept=".txt,text/plain" onChange={handleFileChange} />
        </label>
        <button className="secondary-button" onClick={startNewArticle} type="button">
          <FilePlus2 size={18} /> New article
        </button>
        {article && (
          <button className="secondary-button" onClick={() => setIsCollapsed(true)} type="button">
            <ChevronDown size={18} /> Collapse
          </button>
        )}
        <button className="primary-button save-article-button" onClick={onSave} type="button" disabled={!article.trim()}>
          <Save size={18} /> Save article
        </button>
      </div>
      <label className="input-label" htmlFor="article-title">Article title</label>
      <input
        className="title-input"
        id="article-title"
        value={title}
        placeholder="Untitled article"
        onChange={(event) => onTitleChange(event.target.value)}
      />
      <label className="input-label" htmlFor="article-input">Your article</label>
      <textarea
        id="article-input"
        placeholder="Paste your article here..."
        value={article}
        onChange={(event) => onArticleChange(event.target.value)}
        onPaste={handlePaste}
      />
      {saveMessage && <p className="save-message">{saveMessage}</p>}
    </section>
  );
}
