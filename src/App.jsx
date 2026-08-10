import { useState } from "react";
import { BookOpen } from "lucide-react";
import ReaderPage from "./pages/ReaderPage";
import VocabularyPage from "./pages/VocabularyPage";
import ArticlesPage from "./pages/ArticlesPage";
import "./index.css";

export default function App() {
  const [page, setPage] = useState("reader");
  const [article, setArticle] = useState("");
  const [articleTitle, setArticleTitle] = useState("");
  const [articleId, setArticleId] = useState(null);
  const [highlights, setHighlights] = useState([]);

  function openArticle(savedArticle) {
    setArticleId(savedArticle.id);
    setArticleTitle(savedArticle.title);
    setArticle(savedArticle.content);
    setHighlights(savedArticle.highlights || []);
    setPage("reader");
  }

  function newArticle() {
    setArticleId(null);
    setArticleTitle("");
    setArticle("");
    setHighlights([]);
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1><BookOpen /> Turn pages, Open minds.</h1>
        <nav aria-label="Main navigation">
          <button className={page === "reader" ? "nav-button active" : "nav-button"} onClick={() => setPage("reader")}>Reader</button>
          <button className={page === "articles" ? "nav-button active" : "nav-button"} onClick={() => setPage("articles")}>My Articles</button>
          <button className={page === "vocabulary" ? "nav-button active" : "nav-button"} onClick={() => setPage("vocabulary")}>Vocabulary Bank</button>
        </nav>
      </header>
      {page === "reader" ? (
        <ReaderPage
          article={article}
          articleId={articleId}
          articleTitle={articleTitle}
          highlights={highlights}
          onArticleChange={setArticle}
          onTitleChange={setArticleTitle}
          onArticleSaved={openArticle}
          onNewArticle={newArticle}
        />
      ) : page === "articles" ? <ArticlesPage onOpenArticle={openArticle} /> : <VocabularyPage />}
    </div>
  );
}
