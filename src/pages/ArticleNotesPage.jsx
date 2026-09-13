import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { fetchArticle } from "../api/articles";
import { ChevronLeft, Highlighter, Copy, Check } from "lucide-react";

export default function ArticleNotesPage() {
  const { articleId } = useParams();
  const navigate = useNavigate();
  const [article, setArticle] = useState(null);
  const [highlights, setHighlights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedHighlightId, setSelectedHighlightId] = useState(null);
  const [copiedHighlightId, setCopiedHighlightId] = useState(null);

  useEffect(() => {
    loadArticleNotes();
  }, [articleId]);

  async function loadArticleNotes() {
    try {
      setLoading(true);
      setError("");
      const result = await fetchArticle(articleId);
      if (!result) {
        setError("Article not found.");
        return;
      }
      setArticle(result);
      const articleHighlights = result.highlights || [];
      const sortedHighlights = [...articleHighlights].sort((a, b) => (a.start || 0) - (b.start || 0));
      setHighlights(sortedHighlights);
    } catch (err) {
      setError(err.message || "Failed to load notes.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopyHighlight(event, highlight) {
  event.stopPropagation();

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(highlight.text);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = highlight.text;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "0";
      textarea.setAttribute("readonly", "");

      document.body.appendChild(textarea);

      textarea.focus();
      textarea.select();

      const successful = document.execCommand("copy");

      document.body.removeChild(textarea);

      if (!successful) {
        throw new Error("Copy command failed");
      }
    }

    setCopiedHighlightId(highlight.id);

    setTimeout(() => {
      setCopiedHighlightId((current) =>
        current === highlight.id ? null : current
      );
    }, 1500);
  } catch (err) {
    console.error("Failed to copy highlight:", err);
  }
}

  function handleHighlightClick(highlight) {
    setSelectedHighlightId(highlight.id);
    navigate(`/articles/${articleId}`, {
      state: {
        highlightId: highlight.id,
        highlightStart: highlight.start,
        highlightEnd: highlight.end,
      },
    });
  }

  function formatDate(dateString) {
    if (!dateString) return "";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function getNoteCountLabel(count) {
    return `${count} ${count === 1 ? "note" : "notes"}`;
  }

  if (loading) {
    return (
      <section className="notes-page article-notes-page">
        <header className="notes-header">
          <Link to="/notes" className="back-link" aria-label="Back to Highlights">
            <ChevronLeft size={18} />
            <span>Highlights</span>
          </Link>
          <h1>Loading...</h1>
        </header>
      </section>
    );
  }

  if (error) {
    return (
      <section className="notes-page article-notes-page">
        <header className="notes-header">
          <Link to="/notes" className="back-link" aria-label="Back to Highlights">
            <ChevronLeft size={18} />
            <span>Highlights</span>
          </Link>
          <h1>Error</h1>
        </header>
        <p className="notes-error">{error}</p>
      </section>
    );
  }

  if (!article) {
    return (
      <section className="notes-page article-notes-page">
        <header className="notes-header">
          <Link to="/notes" className="back-link" aria-label="Back to Highlights">
            <ChevronLeft size={18} />
            <span>Highlights</span>
          </Link>
          <h1>Article not found</h1>
        </header>
      </section>
    );
  }

  return (
    <section className="notes-page article-notes-page">
      <header className="notes-header">
        <Link to="/notes" className="back-link" aria-label="Back to Highlights">
          <ChevronLeft size={18} />
          <span>Back</span>
        </Link>
        <h1 className="article-title-main">{article.title}</h1>
        <time className="article-date" dateTime={article.updatedAt}>
          {formatDate(article.updatedAt)}
        </time>
      </header>

      {highlights.length === 0 ? (
        <div className="notes-empty">
          <p>No highlights for this article</p>
          <p className="notes-empty-hint">Highlight something while reading, and it will appear here.</p>
        </div>
      ) : (
        <div className="notes-list">
          <div className="article-card highlight-list-card">
            <div className="highlight-cards">
              {highlights.map((highlight) => (
  <div
  key={highlight.id}
  className={`highlight-card ${
    selectedHighlightId === highlight.id ? "is-selected" : ""
  }`}
  onClick={() => handleHighlightClick(highlight)}
  tabIndex={0}
  onKeyDown={(e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleHighlightClick(highlight);
    }
  }}
>
  <Highlighter
    className="highlight-note-icon"
    size={18}
    aria-hidden="true"
  />

  <div className="highlight-card-content">
    <p className="highlight-text">{highlight.text}</p>
  </div>

  <button
    type="button"
    className="highlight-copy-button"
    onClick={(event) => handleCopyHighlight(event, highlight)}
    aria-label={
      copiedHighlightId === highlight.id
        ? "Copied"
        : "Copy highlight"
    }
    title={
      copiedHighlightId === highlight.id
        ? "Copied"
        : "Copy"
    }
  >
    {copiedHighlightId === highlight.id ? (
      <Check size={16} />
    ) : (
      <Copy size={16} />
    )}
  </button>
</div>
))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}