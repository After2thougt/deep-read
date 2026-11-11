
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchArticles } from "../api/articles";
import { ChevronRight } from "lucide-react";

export default function NotesPage() {
  const navigate = useNavigate();

  const [articlesWithHighlights, setArticlesWithHighlights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sortBy, setSortBy] = useState("recent");

  useEffect(() => {
    loadNotes();
  }, []);

  async function loadNotes() {
    try {
      setLoading(true);
      setError("");

      const result = await fetchArticles({
        page: 1,
        limit: 500,
        tag: "all",
      });

      const grouped = [];

      for (const article of result.items || []) {
        const articleHighlights = article.highlights || [];

        if (articleHighlights.length === 0) continue;

        const highlightTimestamps = articleHighlights
          .map((h) => h.createdAt)
          .filter(Boolean)
          .map((d) => new Date(d).getTime())
          .filter(Number.isFinite);

        const latestHighlightTime =
          highlightTimestamps.length > 0
            ? Math.max(...highlightTimestamps)
            : new Date(article.updatedAt).getTime();

        grouped.push({
          articleId: article.id,
          articleTitle: article.title,
          latestHighlightTime,
          noteCount: articleHighlights.length,
        });
      }

      // Most recent highlight first
      grouped.sort(
        (a, b) => b.latestHighlightTime - a.latestHighlightTime
      );

      setArticlesWithHighlights(grouped);
    } catch (err) {
      setError(err.message || "Failed to load highlights.");
    } finally {
      setLoading(false);
    }
  }

  function handleArticleClick(articleId) {
    navigate(`/highlight/${articleId}`);
  }

  function formatDate(timestamp) {
    if (!Number.isFinite(timestamp)) return "";

    return new Date(timestamp).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function getNoteCountLabel(count) {
    return `${count} ${count === 1 ? "highlight" : "highlights"}`;
  }

  const sortedArticles = [...articlesWithHighlights].sort((a, b) => {
  if (sortBy === "most") {
    return b.noteCount - a.noteCount;
  }

  return b.latestHighlightTime - a.latestHighlightTime;
});

  const totalHighlights = articlesWithHighlights.reduce(
    (total, article) => total + article.noteCount,
    0
  );

  const totalArticles = articlesWithHighlights.length;

  function renderHeader() {
    return (
      <header className="notes-header">
        <p className="notes-subtitle">YOUR READING SPACE</p>
        <h2>Highlights</h2>
        <p className="notes-description">
          Collect the ideas worth remembering.
        </p>

        {!loading && !error && (
          <div className="notes-overview-stats">
            <div className="notes-stat">
              <span className="notes-stat-value">{totalHighlights}</span>
              <span className="notes-stat-label">Highlights</span>
            </div>

            <div className="notes-stat">
              <span className="notes-stat-value">{totalArticles}</span>
              <span className="notes-stat-label">Articles</span>
            </div>
          </div>
        )}
      </header>
    );
  }

  if (loading) {
    return (
      <section className="notes-page notes-overview-page">
        {renderHeader()}
        <p className="notes-loading">Loading highlights...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="notes-page notes-overview-page">
        {renderHeader()}
        <p className="notes-error">{error}</p>
      </section>
    );
  }

  if (articlesWithHighlights.length === 0) {
    return (
      <section className="notes-page notes-overview-page">
        {renderHeader()}
        <div className="notes-empty">
          <p>
            No highlights yet. Highlight something while reading,
            and it will appear here.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="notes-page notes-overview-page">
      {renderHeader()}

      <div className="notes-overview-section">
        <div className="notes-overview-section-header">
          <h3>All highlights</h3>

          <select
            className="notes-sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            aria-label="Sort highlights"
          >
            <option value="recent">Recently updated</option>
            <option value="most">Most highlighted</option>
          </select>
        </div>

        <div className="notes-overview-list">
          {sortedArticles.map((article) => (
            <article
              key={article.articleId}
              className="article-overview-card"
              onClick={() => handleArticleClick(article.articleId)}
              tabIndex={0}
              role="button"
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

                <h2 className="article-overview-title">
                  {article.articleTitle || "Untitled"}
                </h2>

                <time
                  className="article-overview-date"
                  dateTime={
                    Number.isFinite(article.latestHighlightTime)
                      ? new Date(article.latestHighlightTime).toISOString()
                      : undefined
                  }
                >
                  {formatDate(article.latestHighlightTime)}
                </time>
              </div>

              <ChevronRight
                className="article-overview-chevron"
                size={20}
                aria-hidden="true"
              />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
