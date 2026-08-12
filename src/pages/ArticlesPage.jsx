import { useEffect, useState } from "react";
import { BookOpen, Trash2 } from "lucide-react";
import { fetchArticles, removeArticle } from "../api/articles";

export default function ArticlesPage({ onOpenArticle }) {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadArticles() {
      try {
        setLoading(true);
        setError("");
        const articles = await fetchArticles();
        if (mounted) setArticles(articles);
      } catch (err) {
        if (mounted) setError(err.message || "Unable to load articles.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadArticles();
    return () => { mounted = false; };
  }, []);

  async function deleteArticle(id) {
    try {
      setError("");
      await removeArticle(id);
      setArticles((current) => current.filter((article) => article.id !== id));
    } catch (err) {
      setError(err.message || "Unable to delete article.");
    }
  }

  return (
    <section className="articles-page">
      <div>
        <p className="eyebrow">Your reading library</p>
        <h2>Saved Articles</h2>
      </div>
      {loading && <p className="side-message">Loading articles…</p>}
      {error && <p className="error-message">{error}</p>}
      {!loading && !error && articles.length === 0 ? (
        <p className="empty-vocabulary">No saved articles yet. Upload a TXT file or paste an article in Reader.</p>
      ) : (
        <div className="article-list">
          {articles.map((article) => (
            <article className="article-list-item" key={article.id}>
              <button className="article-open-button" onClick={() => onOpenArticle(article)}>
                <BookOpen size={20} />
                <span>
                  <strong>{article.title}</strong>
                  <small>{article.content.length.toLocaleString()} characters · Updated {new Date(article.updatedAt).toLocaleDateString()}</small>
                </span>
              </button>
              <button className="icon-button" onClick={() => deleteArticle(article.id)} aria-label={`Delete ${article.title}`}>
                <Trash2 size={18} />
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
