import { useEffect, useState } from "react";
import { BookOpen, Trash2 } from "lucide-react";
import { getArticles, removeArticle } from "../api/articles";

export default function ArticlesPage({ onOpenArticle }) {
  const [articles, setArticles] = useState([]);

  useEffect(() => {
    setArticles(getArticles());
  }, []);

  function deleteArticle(id) {
    setArticles(removeArticle(id));
  }

  return (
    <section className="articles-page">
      <div>
        <p className="eyebrow">Your reading library</p>
        <h2>Saved Articles</h2>
      </div>
      {articles.length === 0 ? (
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
