import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchArticles } from "../api/articles";
import { clearArticleListCache } from "../api/articles";
import { ChevronRight } from "lucide-react";

export default function NotesPage() {
  const navigate = useNavigate();
  const [articlesWithHighlights, setArticlesWithHighlights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadNotes();
  }, []);

  async function loadNotes() {
    try {
      setLoading(true);
      setError("");
      const result = await fetchArticles({ page: 1, limit: 500, tag: "all" });
      const grouped = [];

      for (const article of result.items || []) {
        const articleHighlights = article.highlights || [];
        if (articleHighlights.length === 0) continue;

        // Find the most recent highlight timestamp for article-level sorting
        const highlightTimestamps = articleHighlights
          .map((h) => h.createdAt)
          .filter(Boolean)
          .map((d) => new Date(d).getTime());
        const latestHighlightTime =
          highlightTimestamps.length > 0
            ? Math.max(...highlightTimestamps)
            : new Date(article.updatedAt).getTime();

        grouped.push({
          articleId: article.id,
          articleTitle: article.title,
          articleUpdatedAt: article.updatedAt,
          latestHighlightTime,
          noteCount: articleHighlights.length,
        });
      }

      // Sort articles by most recent highlight (newest first)
      grouped.sort((a, b) => b.latestHighlightTime - a.latestHighlightTime);
      setArticlesWithHighlights(grouped);
    } catch (err) {
      setError(err.message || "Failed to load notes.");
    } finally {
      setLoading(false);
    }
  }

  function handleArticleClick(articleId) {
    navigate(`/notes/${articleId}`);
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
      <section className="notes-page notes-overview-page">
        <header className="notes-header">
          <h1>Notes</h1>
          <p className="notes-subtitle">Reading highlights</p>
        </header>
        <p className="notes-loading">Loading notes...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="notes-page notes-overview-page">
        <header className="notes-header">
          <h1>Notes</h1>
          <p className="notes-subtitle">Reading highlights</p>
        </header>
        <p className="notes-error">{error}</p>
      </section>
    );
  }

  if (articlesWithHighlights.length === 0) {
    return (
      <section className="notes-page notes-overview-page">
        <header className="notes-header">
          <h1>Notes</h1>
          <p className="notes-subtitle">Reading highlights</p>
        </header>
        <div className="notes-empty">
          <p>No notes yet</p>
          <p className="notes-empty-hint">Highlight something while reading, and it will appear here.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="notes-page notes-overview-page">
      <header className="notes-header">
        <h1>Notes</h1>
        <p className="notes-subtitle">Reading highlights</p>
      </header>

      <div className="notes-overview-list">
        {articlesWithHighlights.map((article) => (
          <article
            key={article.articleId}
            className="article-overview-card"
            onClick={() => handleArticleClick(article.articleId)}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleArticleClick(article.articleId);
              }
            }}
          >
            <div className="article-overview-card-content">
              <div className="article-overview-note-count">
                {getNoteCountLabel(article.noteCount)}
              </div>
              <h2 className="article-overview-title">{article.articleTitle}</h2>
              <time className="article-overview-date" dateTime={article.articleUpdatedAt}>
                {formatDate(article.articleUpdatedAt)}
              </time>
            </div>
            <ChevronRight className="article-overview-chevron" size={20} aria-hidden="true" />
          </article>
        ))}
      </div>
    </section>
  );
}